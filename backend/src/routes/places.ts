import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { logChange } from "../tree-context.js";

// Photon (komoot's OpenStreetMap geocoder) rather than Nominatim: it's built
// for search-as-you-type, free and keyless, whereas Nominatim's usage policy
// explicitly forbids autocomplete. Overridable so a self-hosted deployment
// can point at its own Photon instance.
const PHOTON_URL = (process.env.PHOTON_URL || "https://photon.komoot.io").replace(/\/$/, "");

// Settlements and administrative areas only — births/deaths/marriages are
// recorded at town level, and street/house results would just bury them.
const PHOTON_LAYERS = ["city", "locality", "district", "county", "state", "country"];

// Photon's public instance only localizes into these; anything else falls
// back to "default", which is each place's local name (fine for es/pl).
const PHOTON_LANGUAGES = new Set(["en", "de", "fr"]);

export type PlaceSuggestion = {
  label: string;
  lat: number;
  lng: number;
  source: "tree" | "osm";
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
  };
};

// Family trees keep naming the same handful of towns, so caching identical
// queries in memory spares the shared public Photon instance most repeats.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const photonCache = new Map<string, { at: number; results: PlaceSuggestion[] }>();

function photonLabel(properties: PhotonFeature["properties"]): string {
  const parts = [properties.name, properties.city, properties.county, properties.state, properties.country];
  const unique: string[] = [];
  for (const part of parts) {
    if (part && !unique.includes(part)) unique.push(part);
  }
  return unique.join(", ");
}

async function searchPhoton(
  query: string,
  lang: string | undefined,
  bias: { lat: number; lng: number } | null,
): Promise<PlaceSuggestion[]> {
  const language = lang && PHOTON_LANGUAGES.has(lang) ? lang : "default";
  const biasKey = bias ? `${bias.lat.toFixed(1)},${bias.lng.toFixed(1)}` : "";
  const cacheKey = `${language}:${biasKey}:${query.toLowerCase()}`;
  const cached = photonCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  const params = new URLSearchParams({ q: query, limit: "6", lang: language });
  for (const layer of PHOTON_LAYERS) params.append("layer", layer);
  if (bias) {
    params.set("lat", bias.lat.toFixed(4));
    params.set("lon", bias.lng.toFixed(4));
  }

  const response = await fetch(`${PHOTON_URL}/api/?${params}`, {
    headers: { "User-Agent": "FamilySeed (self-hosted family tree app)" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Photon respondió ${response.status}`);

  const body = (await response.json()) as { features?: PhotonFeature[] };
  const results = (body.features ?? [])
    .map((feature) => ({
      label: photonLabel(feature.properties),
      lat: feature.geometry.coordinates[1],
      lng: feature.geometry.coordinates[0],
      source: "osm" as const,
    }))
    .filter((result) => result.label);

  if (photonCache.size >= CACHE_MAX_ENTRIES) {
    photonCache.delete(photonCache.keys().next().value!);
  }
  photonCache.set(cacheKey, { at: Date.now(), results });
  return results;
}

// Rough centre of the places this tree already located, used to bias the
// geocoder towards the family's own region — so "madr" offers Madrid before
// a same-prefix village in France once the tree has a few Spanish places.
async function treeCentre(treeId: string): Promise<{ lat: number; lng: number } | null> {
  const avg = await prisma.individual.aggregate({
    where: { treeId, deletedAt: null, birthPlaceLat: { not: null }, birthPlaceLng: { not: null } },
    _avg: { birthPlaceLat: true, birthPlaceLng: true },
  });
  const { birthPlaceLat: lat, birthPlaceLng: lng } = avg._avg;
  return lat !== null && lng !== null ? { lat, lng } : null;
}

// Places this tree already located — offered first, so the same village
// typed for the tenth cousin resolves to the exact same point (and label)
// without another round trip to the geocoder.
async function searchTreePlaces(treeId: string, query: string): Promise<PlaceSuggestion[]> {
  const [births, deaths, unions] = await Promise.all([
    prisma.individual.findMany({
      where: { treeId, deletedAt: null, birthPlace: { contains: query }, birthPlaceLat: { not: null }, birthPlaceLng: { not: null } },
      select: { birthPlace: true, birthPlaceLat: true, birthPlaceLng: true },
      distinct: ["birthPlace"],
      take: 10,
    }),
    prisma.individual.findMany({
      where: { treeId, deletedAt: null, deathPlace: { contains: query }, deathPlaceLat: { not: null }, deathPlaceLng: { not: null } },
      select: { deathPlace: true, deathPlaceLat: true, deathPlaceLng: true },
      distinct: ["deathPlace"],
      take: 10,
    }),
    prisma.family.findMany({
      where: { treeId, unionPlace: { contains: query }, unionPlaceLat: { not: null }, unionPlaceLng: { not: null } },
      select: { unionPlace: true, unionPlaceLat: true, unionPlaceLng: true },
      distinct: ["unionPlace"],
      take: 10,
    }),
  ]);

  const byLabel = new Map<string, PlaceSuggestion>();
  const add = (label: string | null, lat: number | null, lng: number | null) => {
    if (label && lat !== null && lng !== null && !byLabel.has(label)) byLabel.set(label, { label, lat, lng, source: "tree" });
  };
  for (const row of births) add(row.birthPlace, row.birthPlaceLat, row.birthPlaceLng);
  for (const row of deaths) add(row.deathPlace, row.deathPlaceLat, row.deathPlaceLng);
  for (const row of unions) add(row.unionPlace, row.unionPlaceLat, row.unionPlaceLng);
  return [...byLabel.values()].slice(0, 5);
}

export type MapEvent = {
  kind: "BIRTH" | "DEATH" | "UNION";
  individualId: string;
  label: string;
  place: string;
  lat: number;
  lng: number;
  dateText: string | null;
};

export type UnlocatedPlace = {
  text: string;
  // How many birth/death/union fields carry this exact text — so the user
  // sees that locating "Sevilla" once pins a dozen people at a stroke.
  uses: number;
};

const locateBodySchema = {
  type: "object",
  required: ["text", "lat", "lng"],
  properties: {
    text: { type: "string", minLength: 1 },
    lat: { type: "number", minimum: -90, maximum: 90 },
    lng: { type: "number", minimum: -180, maximum: 180 },
  },
  additionalProperties: false,
};

type LocateBody = { text: string; lat: number; lng: number };

export default async function placeRoutes(fastify: FastifyInstance) {
  // Distinct place texts in this tree that have no coordinates yet, most
  // used first — the worklist for the "locate all" pass in the map view.
  fastify.get("/unlocated", async (request) => {
    const treeId = request.treeId!;
    const [individuals, families] = await Promise.all([
      prisma.individual.findMany({
        where: { treeId, deletedAt: null },
        select: { birthPlace: true, birthPlaceLat: true, deathPlace: true, deathPlaceLat: true },
      }),
      prisma.family.findMany({ where: { treeId, unionPlace: { not: null } }, select: { unionPlace: true, unionPlaceLat: true } }),
    ]);

    const uses = new Map<string, number>();
    const count = (place: string | null, lat: number | null) => {
      const text = place?.trim();
      if (!text || lat !== null) return;
      uses.set(text, (uses.get(text) ?? 0) + 1);
    };
    for (const ind of individuals) {
      count(ind.birthPlace, ind.birthPlaceLat);
      count(ind.deathPlace, ind.deathPlaceLat);
    }
    for (const fam of families) count(fam.unionPlace, fam.unionPlaceLat);

    const result: UnlocatedPlace[] = [...uses.entries()]
      .map(([text, n]) => ({ text, uses: n }))
      .sort((a, b) => b.uses - a.uses || a.text.localeCompare(b.text));
    return result;
  });

  // Pins every still-unlocated field whose text matches exactly. The text
  // itself is left as the user wrote it — only the coordinates are added,
  // so a historical name ("Lemberg") keeps reading as such on the tree
  // while still landing on today's Lviv on the map.
  fastify.post("/locate", { schema: { body: locateBodySchema } }, async (request) => {
    const treeId = request.treeId!;
    const { text, lat, lng } = request.body as LocateBody;
    const trimmed = text.trim();

    const [births, deaths, unions] = await prisma.$transaction([
      prisma.individual.updateMany({
        where: { treeId, deletedAt: null, birthPlace: trimmed, birthPlaceLat: null },
        data: { birthPlaceLat: lat, birthPlaceLng: lng },
      }),
      prisma.individual.updateMany({
        where: { treeId, deletedAt: null, deathPlace: trimmed, deathPlaceLat: null },
        data: { deathPlaceLat: lat, deathPlaceLng: lng },
      }),
      prisma.family.updateMany({
        where: { treeId, unionPlace: trimmed, unionPlaceLat: null },
        data: { unionPlaceLat: lat, unionPlaceLng: lng },
      }),
    ]);

    const updated = births.count + deaths.count + unions.count;
    if (updated > 0) {
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "place.locate",
        entityType: "Tree",
        entityId: treeId,
        summary: `${trimmed} → ${updated}`,
      });
    }
    return { updated };
  });

  fastify.get("/search", async (request) => {
    const { q, lang } = request.query as { q?: string; lang?: string };
    const query = q?.trim() ?? "";
    if (query.length < 2) return [];

    const treeId = request.treeId!;
    const [local, centre] = await Promise.all([searchTreePlaces(treeId, query), treeCentre(treeId)]);

    let remote: PlaceSuggestion[] = [];
    try {
      remote = await searchPhoton(query, lang, centre);
    } catch (error) {
      // The geocoder being down/slow must never block typing a place —
      // the field still works as plain text, just without suggestions.
      request.log.warn({ err: error }, "Photon place search failed");
    }

    const seen = new Set(local.map((s) => s.label));
    return [...local, ...remote.filter((s) => !seen.has(s.label))];
  });

  // Every located birth/death/union in the tree, flattened into map pins,
  // plus how many places are still unlocated free text (so the map can say
  // "N places not on the map" instead of silently looking incomplete).
  fastify.get("/map", async (request) => {
    const treeId = request.treeId!;

    const [individuals, families] = await Promise.all([
      prisma.individual.findMany({
        where: { treeId, deletedAt: null },
        select: {
          id: true,
          givenNames: true,
          surname1: true,
          surname2: true,
          birthPlace: true,
          birthPlaceLat: true,
          birthPlaceLng: true,
          birthDateText: true,
          deathPlace: true,
          deathPlaceLat: true,
          deathPlaceLng: true,
          deathDateText: true,
        },
      }),
      prisma.family.findMany({
        where: { treeId, unionPlace: { not: null } },
        select: {
          partner1Id: true,
          partner2Id: true,
          unionPlace: true,
          unionPlaceLat: true,
          unionPlaceLng: true,
          unionDateText: true,
        },
      }),
    ]);

    const names = new Map(
      individuals.map((ind) => [ind.id, [ind.givenNames, ind.surname1, ind.surname2].filter(Boolean).join(" ")]),
    );
    const events: MapEvent[] = [];
    let unlocated = 0;

    for (const ind of individuals) {
      const label = names.get(ind.id)!;
      if (ind.birthPlace) {
        if (ind.birthPlaceLat !== null && ind.birthPlaceLng !== null) {
          events.push({ kind: "BIRTH", individualId: ind.id, label, place: ind.birthPlace, lat: ind.birthPlaceLat, lng: ind.birthPlaceLng, dateText: ind.birthDateText });
        } else {
          unlocated++;
        }
      }
      if (ind.deathPlace) {
        if (ind.deathPlaceLat !== null && ind.deathPlaceLng !== null) {
          events.push({ kind: "DEATH", individualId: ind.id, label, place: ind.deathPlace, lat: ind.deathPlaceLat, lng: ind.deathPlaceLng, dateText: ind.deathDateText });
        } else {
          unlocated++;
        }
      }
    }

    for (const fam of families) {
      // Unions whose partners are all trashed have nobody left to open.
      const partnerIds = [fam.partner1Id, fam.partner2Id].filter((id): id is string => !!id && names.has(id));
      if (partnerIds.length === 0 || !fam.unionPlace) continue;
      if (fam.unionPlaceLat === null || fam.unionPlaceLng === null) {
        unlocated++;
        continue;
      }
      events.push({
        kind: "UNION",
        individualId: partnerIds[0],
        label: partnerIds.map((id) => names.get(id)).join(" & "),
        place: fam.unionPlace,
        lat: fam.unionPlaceLat,
        lng: fam.unionPlaceLng,
        dateText: fam.unionDateText,
      });
    }

    return { events, unlocated };
  });
}
