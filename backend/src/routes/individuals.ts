import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import {
  CHILD_RELATION_TYPE_VALUES,
  DATE_PRECISION_VALUES,
  SEX_VALUES,
  UNION_STATUS_VALUES,
  UNION_TYPE_VALUES,
} from "../enums.js";
import { logChange } from "../tree-context.js";
import { deleteUploadByUrl, saveUpload } from "../uploads.js";
import { buildTreeData } from "../tree-data.js";
import { renderReportHtml, renderReportPdf, type ReportDirection, type ReportLayout } from "../report.js";
import { downloadFilename } from "../filename.js";

// Every optional field also accepts `null` (not just omission) — that's how
// the frontend signals "the user cleared this field," as distinct from "the
// user didn't touch this field." Prisma's update() treats an *omitted* key
// as "leave the column alone" but an explicit `null` as "set it to NULL", so
// without allowing null here a cleared field could never actually be
// cleared: it would just always resend whatever was already in the database.
const optionalNullableString = { type: ["string", "null"] } as const;

export const individualFieldsSchema = {
  type: "object",
  required: ["givenNames", "surname1"],
  properties: {
    givenNames: { type: "string", minLength: 1 },
    surname1: { type: "string", minLength: 1 },
    surname2: optionalNullableString,
    surname1BirthName: optionalNullableString,
    alias: optionalNullableString,
    sex: { type: "string", enum: SEX_VALUES },
    birthDateText: optionalNullableString,
    birthDateValue: { type: ["string", "null"], format: "date" },
    birthDatePrecision: { type: ["string", "null"], enum: [...DATE_PRECISION_VALUES, null] },
    birthPlace: optionalNullableString,
    deathDateText: optionalNullableString,
    deathDateValue: { type: ["string", "null"], format: "date" },
    deathDatePrecision: { type: ["string", "null"], enum: [...DATE_PRECISION_VALUES, null] },
    deathPlace: optionalNullableString,
    notes: optionalNullableString,
    biography: optionalNullableString,
    photoUrl: { type: "string" },
  },
  additionalProperties: false,
};

const relationshipSchema = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: ["CHILD", "CHILD_OF_PARENTS", "PARTNER", "PARENT_OF"] },
    familyId: { type: "string" },
    parent1Id: { type: "string" },
    parent2Id: { type: "string" },
    partnerId: { type: "string" },
    childId: { type: "string" },
    relationType: { type: "string", enum: CHILD_RELATION_TYPE_VALUES },
    unionType: { type: "string", enum: UNION_TYPE_VALUES },
    unionStatus: { type: "string", enum: UNION_STATUS_VALUES },
    unionDateText: { type: "string" },
    unionDateValue: { type: "string", format: "date" },
    unionDatePrecision: { type: "string", enum: DATE_PRECISION_VALUES },
    unionPlace: { type: "string" },
  },
  additionalProperties: false,
};

const createIndividualBodySchema = {
  type: "object",
  required: ["individual"],
  properties: {
    individual: individualFieldsSchema,
    relationship: relationshipSchema,
  },
  additionalProperties: false,
};

const updateIndividualBodySchema = {
  ...individualFieldsSchema,
  required: [],
};

const addParentBodySchema = {
  type: "object",
  required: ["parentId"],
  properties: {
    parentId: { type: "string" },
    relationType: { type: "string", enum: CHILD_RELATION_TYPE_VALUES },
  },
  additionalProperties: false,
};

type AddParentBody = {
  parentId: string;
  relationType?: (typeof CHILD_RELATION_TYPE_VALUES)[number];
};

const addLineageBodySchema = {
  type: "object",
  required: ["lineageId"],
  properties: {
    lineageId: { type: "string" },
  },
  additionalProperties: false,
};

type AddLineageBody = {
  lineageId: string;
};

export type IndividualFieldsInput = {
  givenNames: string;
  surname1: string;
  surname2?: string | null;
  surname1BirthName?: string | null;
  alias?: string | null;
  sex?: (typeof SEX_VALUES)[number];
  birthDateText?: string | null;
  birthDateValue?: string | null;
  birthDatePrecision?: (typeof DATE_PRECISION_VALUES)[number] | null;
  birthPlace?: string | null;
  deathDateText?: string | null;
  deathDateValue?: string | null;
  deathDatePrecision?: (typeof DATE_PRECISION_VALUES)[number] | null;
  deathPlace?: string | null;
  notes?: string | null;
  biography?: string | null;
  photoUrl?: string;
};

type CreateIndividualBody = {
  individual: IndividualFieldsInput;
  relationship?: {
    kind: "CHILD" | "CHILD_OF_PARENTS" | "PARTNER" | "PARENT_OF";
    familyId?: string;
    parent1Id?: string;
    parent2Id?: string;
    partnerId?: string;
    childId?: string;
    relationType?: (typeof CHILD_RELATION_TYPE_VALUES)[number];
    unionType?: (typeof UNION_TYPE_VALUES)[number];
    unionStatus?: (typeof UNION_STATUS_VALUES)[number];
    unionDateText?: string;
    unionDateValue?: string;
    unionDatePrecision?: (typeof DATE_PRECISION_VALUES)[number];
    unionPlace?: string;
  };
};

type UpdateIndividualBody = Partial<CreateIndividualBody["individual"]>;

// Polish (and generally West Slavic) surnames inflect for grammatical
// gender at the very end — Jasiurkowski/Jasiurkowska is still one family,
// not two — so an exact-string match alone would split every such family
// into a separate lineage per gender. Checked longest-suffix-first only to
// keep the three patterns from ever both matching the same word (each
// consonant cluster is mutually exclusive anyway — "-dzka" doesn't also
// end in "-cka" or "-ska" — but ordering by length is the cheap way to stay
// correct if a pattern is ever added that isn't).
const GENDERED_SURNAME_SUFFIXES: Array<[masculine: string, feminine: string]> = [
  ["dzki", "dzka"],
  ["cki", "cka"],
  ["ski", "ska"],
];

// The key two differently-gendered spellings of the same surname collapse
// to for lineage *matching* — never used as anything actually displayed
// (a person's own surname field, and an existing lineage's name, are both
// left exactly as spelled).
function lineageMatchKey(name: string): string {
  for (const [masculine, feminine] of GENDERED_SURNAME_SUFFIXES) {
    if (name.endsWith(feminine)) return name.slice(0, -feminine.length) + masculine;
  }
  return name;
}

// A person can belong to several branches at once (their father's surname,
// their mother's maiden name, ...) — so lineage membership is derived from
// every distinct surname passed in, not just one. Auto-creates a Lineage
// per surname the first time it's seen (by lineageMatchKey, so a later
// person whose surname is just the other gendered spelling of an existing
// lineage joins that same one instead of splitting off a second), then
// links the individual to it. Never removes an existing membership
// (including ones the user added or removed by hand) — a name change just
// adds the new surname's branch alongside whatever was there before, so a
// manual correction never gets silently undone by editing an unrelated
// field.
export async function deriveLineagesFromSurnames(
  db: Prisma.TransactionClient,
  treeId: string,
  individualId: string,
  surnames: Array<string | null | undefined>,
): Promise<void> {
  const names = [...new Set(surnames.filter((s): s is string => !!s && s.trim().length > 0).map((s) => s.trim()))];
  if (names.length === 0) return;

  const existingLineages = await db.lineage.findMany({ where: { treeId } });

  for (const name of names) {
    const key = lineageMatchKey(name);
    let lineage = existingLineages.find((l) => lineageMatchKey(l.name) === key);
    if (!lineage) {
      lineage = await db.lineage.create({ data: { treeId, name } });
      // So a second name in this same call (surname1 and its birth-name
      // variant, say) can also match against a lineage this loop just
      // created, instead of only ones that existed before it started.
      existingLineages.push(lineage);
    }
    await db.individualLineage.upsert({
      where: { individualId_lineageId: { individualId, lineageId: lineage.id } },
      create: { individualId, lineageId: lineage.id },
      update: {},
    });
  }
}

// Soft-deleted individuals (deletedAt set) never show up in the tree or its
// relatives — they can still be referenced by families/family_children (we
// never sever those on delete, see DELETE /:id below), so every place that
// surfaces a *related* individual has to re-check this too, not just the
// top-level query.
function isActive<T extends { deletedAt: Date | null }>(person: T | null | undefined): person is T {
  return !!person && person.deletedAt === null;
}

function personLabel(individual: { givenNames: string; surname1: string }): string {
  return `${individual.givenNames} ${individual.surname1}`;
}

// Shared by "create a new person as parent of X" (relationship.kind =
// PARENT_OF below) and the standalone "link an existing person as parent of
// X" endpoint — links `parentId` as a parent of `childId`, reusing an
// existing single-parent family (filling its empty partner slot) instead of
// creating a redundant second family when the child already has one known
// parent. Runs against whatever Prisma client/transaction is passed in, so
// it composes inside a larger transaction or stands alone.
async function attachParent(
  db: Prisma.TransactionClient,
  treeId: string,
  childId: string,
  parentId: string,
  relationType: (typeof CHILD_RELATION_TYPE_VALUES)[number],
): Promise<{ familyId: string }> {
  const existingLinks = await db.familyChild.findMany({
    where: { individualId: childId, family: { treeId } },
    include: { family: true },
  });

  for (const link of existingLinks) {
    const { family } = link;
    if (family.partner1Id === parentId || family.partner2Id === parentId) {
      throw new HttpError(400, "Esa persona ya es su padre/madre");
    }
  }

  for (const link of existingLinks) {
    const { family } = link;
    if (family.partner1Id && family.partner2Id) continue;
    const knownOtherParentId = family.partner1Id ?? family.partner2Id;

    // Filling this empty slot completes the couple — if a Family already
    // exists for this exact pair elsewhere in the tree (e.g. an earlier
    // sibling got linked to this same couple first, so their own
    // still-empty-slot family was a different row), merge into that one
    // instead of completing this child's own row into a second, duplicate
    // Family for the same two people.
    if (knownOtherParentId) {
      const existingCouple = await db.family.findFirst({
        where: {
          treeId,
          id: { not: family.id },
          OR: [
            { partner1Id: knownOtherParentId, partner2Id: parentId },
            { partner1Id: parentId, partner2Id: knownOtherParentId },
          ],
        },
      });
      if (existingCouple) {
        await db.familyChild.update({
          where: { familyId_individualId: { familyId: family.id, individualId: childId } },
          data: { familyId: existingCouple.id },
        });
        const remainingChildren = await db.familyChild.count({ where: { familyId: family.id } });
        if (remainingChildren === 0) {
          await db.family.delete({ where: { id: family.id } });
        }
        return { familyId: existingCouple.id };
      }
    }

    if (!family.partner1Id) {
      await db.family.update({ where: { id: family.id }, data: { partner1Id: parentId } });
      return { familyId: family.id };
    }
    if (!family.partner2Id) {
      await db.family.update({ where: { id: family.id }, data: { partner2Id: parentId } });
      return { familyId: family.id };
    }
  }

  const family = await db.family.create({ data: { treeId, partner1Id: parentId, unionType: "UNKNOWN" } });
  await db.familyChild.create({ data: { familyId: family.id, individualId: childId, relationType } });
  return { familyId: family.id };
}

// The undo for a mistaken attachParent call — recovers from picking the
// wrong person as someone's parent without having to delete and recreate
// the child. `childId`'s FamilyChild rows are searched (across all their
// families, not just one) for a family where `parentId` is either partner:
//   - if the family still has its other partner slot filled, only that one
//     slot is cleared (data.partner1Id/partner2Id -> null) — this is a real
//     two-parent family, so every child of it shares the same correction,
//     and the other parent/the union itself stays intact.
//   - if `parentId` was the only known parent on that family, there's
//     nothing left tying this child to it, so the FamilyChild link itself
//     is removed instead (leaving the family — and any of its other
//     children — untouched).
async function detachParent(db: Prisma.TransactionClient, treeId: string, childId: string, parentId: string): Promise<void> {
  const links = await db.familyChild.findMany({
    where: { individualId: childId, family: { treeId } },
    include: { family: true },
  });

  const link = links.find((l) => l.family.partner1Id === parentId || l.family.partner2Id === parentId);
  if (!link) {
    throw new HttpError(404, "Esa persona no es su padre/madre");
  }

  const { family } = link;
  const otherPartnerId = family.partner1Id === parentId ? family.partner2Id : family.partner1Id;

  if (otherPartnerId) {
    await db.family.update({
      where: { id: family.id },
      data: family.partner1Id === parentId ? { partner1Id: null } : { partner2Id: null },
    });
  } else {
    await db.familyChild.delete({ where: { id: link.id } });
  }
}

// Shared by "create a new person as partner of X" (relationship.kind =
// PARTNER below) — links `newPersonId` as partner of `existingPersonId`,
// reusing an existing family where `existingPersonId` is already a partner
// with an empty second slot (e.g. one created by attachParent above when
// only one parent was known yet) instead of always creating a brand-new
// family. Without this, adding someone's spouse after their child was
// already linked left two disconnected families: the old one (parent +
// child) and a new one (parent + spouse, no children) — the spouse never
// became the child's parent, and the pair rendered as an isolated island in
// the tree view.
async function attachPartner(
  db: Prisma.TransactionClient,
  treeId: string,
  existingPersonId: string,
  newPersonId: string,
  unionFields: {
    unionType?: (typeof UNION_TYPE_VALUES)[number];
    unionStatus?: (typeof UNION_STATUS_VALUES)[number];
    unionDateText?: string;
    unionDateValue?: Date;
    unionDatePrecision?: (typeof DATE_PRECISION_VALUES)[number];
    unionPlace?: string;
  },
): Promise<{ familyId: string }> {
  const openFamily = await db.family.findFirst({
    where: {
      treeId,
      OR: [
        { partner1Id: existingPersonId, partner2Id: null },
        { partner2Id: existingPersonId, partner1Id: null },
      ],
    },
  });

  if (openFamily) {
    const slot = openFamily.partner1Id === existingPersonId ? { partner2Id: newPersonId } : { partner1Id: newPersonId };
    const updated = await db.family.update({ where: { id: openFamily.id }, data: { ...slot, ...unionFields } });
    return { familyId: updated.id };
  }

  const created = await db.family.create({
    data: { treeId, partner1Id: existingPersonId, partner2Id: newPersonId, ...unionFields },
  });
  return { familyId: created.id };
}

export default async function individualRoutes(fastify: FastifyInstance) {
  // Custom filters reuse the same fields the tree navigation already
  // exposes (lineage chips, birth years for the timeline) — this is a
  // second view over that data, not a new filtering concept.
  fastify.get("/", async (request) => {
    const { search, trashed, lineageId, birthYearFrom, birthYearTo, place } = request.query as {
      search?: string;
      trashed?: string;
      lineageId?: string;
      birthYearFrom?: string;
      birthYearTo?: string;
      place?: string;
    };
    const treeId = request.treeId!;

    const and: Array<Record<string, unknown>> = [];
    if (search) {
      and.push({
        OR: [
          { givenNames: { contains: search } },
          { surname1: { contains: search } },
          { surname2: { contains: search } },
          { surname1BirthName: { contains: search } },
        ],
      });
    }
    if (lineageId) {
      and.push({ lineages: { some: { lineageId } } });
    }
    if (place) {
      and.push({ OR: [{ birthPlace: { contains: place } }, { deathPlace: { contains: place } }] });
    }
    if (birthYearFrom) {
      and.push({ birthDateValue: { gte: new Date(Date.UTC(Number(birthYearFrom), 0, 1)) } });
    }
    if (birthYearTo) {
      and.push({ birthDateValue: { lte: new Date(Date.UTC(Number(birthYearTo), 11, 31, 23, 59, 59)) } });
    }

    const rows = await prisma.individual.findMany({
      where: {
        treeId,
        deletedAt: trashed === "true" ? { not: null } : null,
        ...(and.length ? { AND: and } : {}),
      },
      orderBy: [{ surname1: "asc" }, { givenNames: "asc" }],
      include: {
        _count: { select: { childOf: true, familiesAsPartner1: true, familiesAsPartner2: true } },
      },
    });

    // A person with zero of any of these is invisible on the tree canvas
    // (family-chart only renders what's reachable from the centered
    // person) — surfaced here so the search view can flag "still needs
    // linking" instead of the user having to guess why someone's missing.
    return rows.map(({ _count, ...individual }) => ({
      ...individual,
      hasNoRelationships: _count.childOf === 0 && _count.familiesAsPartner1 === 0 && _count.familiesAsPartner2 === 0,
    }));
  });

  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;

    const individual = await prisma.individual.findFirst({
      where: { id, treeId },
      include: {
        childOf: {
          include: {
            family: {
              include: {
                partner1: true,
                partner2: true,
                children: { include: { individual: true } },
              },
            },
          },
        },
        familiesAsPartner1: {
          include: { partner2: true, children: { include: { individual: true } } },
        },
        familiesAsPartner2: {
          include: { partner1: true, children: { include: { individual: true } } },
        },
        lineages: true,
      },
    });

    if (!isActive(individual)) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    // Keyed by parent id (not a plain array) so leftover duplicate Family
    // rows for the exact same couple — a data bug that's since been fixed
    // at the write side, but may still exist for trees created before that
    // fix — don't show the same parent twice.
    const parents = new Map<string, unknown>();
    const siblings = new Map<string, unknown>();

    for (const familyChild of individual.childOf) {
      const { family } = familyChild;
      if (isActive(family.partner1)) {
        parents.set(family.partner1.id, { ...family.partner1, relationType: familyChild.relationType, familyId: family.id });
      }
      if (isActive(family.partner2)) {
        parents.set(family.partner2.id, { ...family.partner2, relationType: familyChild.relationType, familyId: family.id });
      }
      for (const sibling of family.children) {
        if (sibling.individualId !== id && isActive(sibling.individual)) {
          siblings.set(sibling.individualId, {
            ...sibling.individual,
            relationType: sibling.relationType,
            familyId: family.id,
          });
        }
      }
    }

    // Same reasoning as `parents` above — keyed by partner id (falling back
    // to familyId for a still-single/no-partner-yet family, which has no
    // partner id to key on but also can't collide with a real duplicate).
    const partnerships = new Map<string, unknown>();
    const children = new Map<string, unknown>();

    for (const family of individual.familiesAsPartner1) {
      if (family.partner2 && !isActive(family.partner2)) continue;
      partnerships.set(family.partner2?.id ?? family.id, {
        familyId: family.id,
        partner: family.partner2,
        unionType: family.unionType,
        unionDateText: family.unionDateText,
        unionPlace: family.unionPlace,
      });
      for (const child of family.children) {
        if (!isActive(child.individual)) continue;
        children.set(child.individualId, { ...child.individual, relationType: child.relationType, familyId: family.id });
      }
    }

    for (const family of individual.familiesAsPartner2) {
      if (family.partner1 && !isActive(family.partner1)) continue;
      partnerships.set(family.partner1?.id ?? family.id, {
        familyId: family.id,
        partner: family.partner1,
        unionType: family.unionType,
        unionDateText: family.unionDateText,
        unionPlace: family.unionPlace,
      });
      for (const child of family.children) {
        if (!isActive(child.individual)) continue;
        children.set(child.individualId, { ...child.individual, relationType: child.relationType, familyId: family.id });
      }
    }

    const { childOf, familiesAsPartner1, familiesAsPartner2, lineages, ...individualData } = individual;

    return {
      individual: { ...individualData, lineageIds: lineages.map((l) => l.lineageId) },
      parents: [...parents.values()],
      siblings: [...siblings.values()],
      partnerships: [...partnerships.values()],
      children: [...children.values()],
    };
  });

  fastify.post("/", { schema: { body: createIndividualBodySchema } }, async (request, reply) => {
    const { individual, relationship } = request.body as CreateIndividualBody;

    try {
      const treeId = request.treeId!;

      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.individual.create({
          data: {
            ...individual,
            treeId,
            birthDateValue: individual.birthDateValue ? new Date(individual.birthDateValue) : undefined,
            deathDateValue: individual.deathDateValue ? new Date(individual.deathDateValue) : undefined,
          },
        });

        await deriveLineagesFromSurnames(tx, treeId, created.id, [individual.surname1, individual.surname1BirthName]);

        let family = null;

        if (relationship) {
          switch (relationship.kind) {
            case "CHILD": {
              if (!relationship.familyId) {
                throw new HttpError(400, "familyId es obligatorio para relationship.kind = CHILD");
              }
              const existingFamily = await tx.family.findFirst({
                where: { id: relationship.familyId, treeId },
              });
              if (!existingFamily) {
                throw new HttpError(404, `No existe la familia ${relationship.familyId}`);
              }
              await tx.familyChild.create({
                data: {
                  familyId: existingFamily.id,
                  individualId: created.id,
                  relationType: relationship.relationType ?? "BIOLOGICAL",
                },
              });
              family = existingFamily;
              break;
            }

            case "CHILD_OF_PARENTS": {
              if (!relationship.parent1Id) {
                throw new HttpError(400, "parent1Id es obligatorio para relationship.kind = CHILD_OF_PARENTS");
              }
              const parent1 = await tx.individual.findFirst({
                where: { id: relationship.parent1Id, treeId, deletedAt: null },
              });
              if (!parent1) {
                throw new HttpError(404, `No existe el individuo ${relationship.parent1Id}`);
              }

              let parent2 = null;
              if (relationship.parent2Id) {
                parent2 = await tx.individual.findFirst({
                  where: { id: relationship.parent2Id, treeId, deletedAt: null },
                });
                if (!parent2) {
                  throw new HttpError(404, `No existe el individuo ${relationship.parent2Id}`);
                }
              }

              family = await tx.family.findFirst({
                where: {
                  treeId,
                  ...(parent2
                    ? {
                        OR: [
                          { partner1Id: parent1.id, partner2Id: parent2.id },
                          { partner1Id: parent2.id, partner2Id: parent1.id },
                        ],
                      }
                    : { partner1Id: parent1.id, partner2Id: null }),
                },
              });

              if (!family) {
                family = await tx.family.create({
                  data: { treeId, partner1Id: parent1.id, partner2Id: parent2?.id ?? null, unionType: "UNKNOWN" },
                });
                await logChange({
                  treeId,
                  userId: request.userId ?? null,
                  action: "family.create",
                  entityType: "Family",
                  entityId: family.id,
                });
              }

              await tx.familyChild.create({
                data: {
                  familyId: family.id,
                  individualId: created.id,
                  relationType: relationship.relationType ?? "BIOLOGICAL",
                },
              });
              break;
            }

            case "PARTNER": {
              if (!relationship.partnerId) {
                throw new HttpError(400, "partnerId es obligatorio para relationship.kind = PARTNER");
              }
              const partner = await tx.individual.findFirst({
                where: { id: relationship.partnerId, treeId, deletedAt: null },
              });
              if (!partner) {
                throw new HttpError(404, `No existe el individuo ${relationship.partnerId}`);
              }

              const attachedPartner = await attachPartner(tx, treeId, partner.id, created.id, {
                unionType: relationship.unionType ?? "UNKNOWN",
                unionStatus: relationship.unionStatus ?? "ONGOING",
                unionDateText: relationship.unionDateText,
                unionDateValue: relationship.unionDateValue ? new Date(relationship.unionDateValue) : undefined,
                unionDatePrecision: relationship.unionDatePrecision,
                unionPlace: relationship.unionPlace,
              });
              family = await tx.family.findUniqueOrThrow({ where: { id: attachedPartner.familyId } });
              await logChange({
                treeId,
                userId: request.userId ?? null,
                action: "family.create",
                entityType: "Family",
                entityId: family.id,
              });
              break;
            }

            // The newly created person becomes a parent of an *existing*
            // person — the reverse of CHILD_OF_PARENTS. Covers "I know my
            // father's name but he's not in the tree yet" without first
            // creating him disconnected and linking him up afterward.
            case "PARENT_OF": {
              if (!relationship.childId) {
                throw new HttpError(400, "childId es obligatorio para relationship.kind = PARENT_OF");
              }
              const child = await tx.individual.findFirst({
                where: { id: relationship.childId, treeId, deletedAt: null },
              });
              if (!child) {
                throw new HttpError(404, `No existe el individuo ${relationship.childId}`);
              }

              const attached = await attachParent(
                tx,
                treeId,
                child.id,
                created.id,
                relationship.relationType ?? "BIOLOGICAL",
              );
              family = await tx.family.findUniqueOrThrow({ where: { id: attached.familyId } });
              break;
            }

            default:
              throw new HttpError(400, `relationship.kind desconocido: ${(relationship as { kind: string }).kind}`);
          }
        }

        return { individual: created, family };
      });

      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "individual.create",
        entityType: "Individual",
        entityId: result.individual.id,
        summary: personLabel(result.individual),
      });

      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Error interno" });
    }
  });

  fastify.patch("/:id", { schema: { body: updateIndividualBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as UpdateIndividualBody;
    const treeId = request.treeId!;

    const existing = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    // `undefined` (key omitted) means "leave this column alone" to Prisma;
    // `null` means "clear it" — so a cleared date has to stay `null` here,
    // not collapse to `undefined` the way an empty/missing value normally
    // would when there's nothing to parse into a Date.
    const updated = await prisma.individual.update({
      where: { id },
      data: {
        ...updates,
        birthDateValue:
          updates.birthDateValue === undefined ? undefined : updates.birthDateValue ? new Date(updates.birthDateValue) : null,
        deathDateValue:
          updates.deathDateValue === undefined ? undefined : updates.deathDateValue ? new Date(updates.deathDateValue) : null,
      },
    });

    // Only derive from a surname that actually changed in this save — not
    // every surname on the record. Re-deriving the unchanged ones on every
    // save (e.g. just editing the notes field) would silently resurrect a
    // lineage the user had manually unchecked as a correction.
    const changedSurnames = [
      updates.surname1 !== undefined && updates.surname1 !== existing.surname1 ? updates.surname1 : undefined,
      updates.surname1BirthName !== undefined && updates.surname1BirthName !== existing.surname1BirthName
        ? updates.surname1BirthName
        : undefined,
    ];
    await deriveLineagesFromSurnames(prisma, treeId, updated.id, changedSurnames);

    // "Hasta que la muerte os separe" — recording a death date ends any
    // union of theirs still marked ongoing. Only fires forward (a newly
    // set death date closes the union); clearing a death date to fix a
    // data-entry mistake doesn't reopen it, since the status could have
    // been changed for an unrelated reason (divorce, say) in the meantime.
    if (updates.deathDateValue) {
      await prisma.family.updateMany({
        where: { treeId, unionStatus: "ONGOING", OR: [{ partner1Id: updated.id }, { partner2Id: updated.id }] },
        data: { unionStatus: "ENDED_BY_DEATH" },
      });
    }

    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "individual.update",
      entityType: "Individual",
      entityId: updated.id,
      summary: personLabel(updated),
    });

    return updated;
  });

  // Links an *existing* individual as a parent of this one — the recovery
  // path for a person already created without a relationship (e.g. via
  // "sin relación conocida"), reusing the same attachParent logic that
  // handles it at creation time via relationship.kind = PARENT_OF.
  fastify.post("/:id/parents", { schema: { body: addParentBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { parentId, relationType } = request.body as AddParentBody;
    const treeId = request.treeId!;

    const child = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!child) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }
    if (parentId === id) {
      return reply.code(400).send({ error: "Una persona no puede ser su propio padre/madre" });
    }
    const parent = await prisma.individual.findFirst({ where: { id: parentId, treeId, deletedAt: null } });
    if (!parent) {
      return reply.code(404).send({ error: `No existe el individuo ${parentId}` });
    }

    try {
      const result = await prisma.$transaction((tx) =>
        attachParent(tx, treeId, id, parentId, relationType ?? "BIOLOGICAL"),
      );
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "individual.addParent",
        entityType: "Individual",
        entityId: id,
        summary: `${personLabel(parent)} → ${personLabel(child)}`,
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  // Undoes a mistaken addParent — see detachParent's own comment for what
  // this does to the underlying Family row depending on whether the other
  // parent is known. Never touches the child or parent Individual rows
  // themselves, only the relationship between them.
  fastify.delete("/:id/parents/:parentId", async (request, reply) => {
    const { id, parentId } = request.params as { id: string; parentId: string };
    const treeId = request.treeId!;

    const child = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!child) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    try {
      await prisma.$transaction((tx) => detachParent(tx, treeId, id, parentId));
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "individual.removeParent",
        entityType: "Individual",
        entityId: id,
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  // Add/remove one lineage membership at a time (not a full-set replace) —
  // deliberately, since surname-derived lineages get added automatically on
  // every save (see deriveLineagesFromSurnames above). A "replace the whole
  // set" call built from a stale checkbox snapshot would race with that:
  // saving the main form could silently wipe out a membership the backend
  // had just added a moment earlier as part of the same save.
  fastify.post("/:id/lineages", { schema: { body: addLineageBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { lineageId } = request.body as AddLineageBody;
    const treeId = request.treeId!;

    const person = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!person) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }
    const lineage = await prisma.lineage.findFirst({ where: { id: lineageId, treeId } });
    if (!lineage) {
      return reply.code(404).send({ error: `No existe la rama ${lineageId}` });
    }

    await prisma.individualLineage.upsert({
      where: { individualId_lineageId: { individualId: id, lineageId } },
      create: { individualId: id, lineageId },
      update: {},
    });

    return reply.code(201).send({ lineageId });
  });

  fastify.delete("/:id/lineages/:lineageId", async (request, reply) => {
    const { id, lineageId } = request.params as { id: string; lineageId: string };
    const treeId = request.treeId!;

    const person = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!person) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    await prisma.individualLineage.deleteMany({ where: { individualId: id, lineageId } });

    return reply.code(204).send();
  });

  // Soft delete: never touches families/family_children, so spouses and
  // children keep their links intact — this person just stops showing up
  // (see isActive/activeIds above) until restored or purged for good.
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;

    const existing = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    await prisma.individual.update({ where: { id }, data: { deletedAt: new Date() } });
    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "individual.delete",
      entityType: "Individual",
      entityId: id,
      summary: personLabel(existing),
    });
    return reply.code(204).send();
  });

  fastify.post("/:id/restore", async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;

    const existing = await prisma.individual.findFirst({ where: { id, treeId } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }
    if (existing.deletedAt === null) {
      return reply.code(400).send({ error: "Este individuo no está en la papelera" });
    }

    const restored = await prisma.individual.update({ where: { id }, data: { deletedAt: null } });
    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "individual.restore",
      entityType: "Individual",
      entityId: restored.id,
      summary: personLabel(restored),
    });
    return restored;
  });

  // Single profile photo shown on the tree card itself — distinct from the
  // photos/documents gallery below.
  fastify.post("/:id/photo", async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;

    const existing = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No se recibió ningún archivo" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "El archivo debe ser una imagen" });
    }

    const buffer = await file.toBuffer();
    const { url } = await saveUpload(treeId, id, file.filename, buffer);

    const updated = await prisma.individual.update({ where: { id }, data: { photoUrl: url } });
    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "individual.photo",
      entityType: "Individual",
      entityId: id,
      summary: personLabel(updated),
    });
    return updated;
  });

  // Photos/documents gallery attached to a person (shown as tabs in the
  // info panel) — separate from the single profile photo above.
  fastify.get("/:id/media", async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;

    const individual = await prisma.individual.findFirst({ where: { id, treeId } });
    if (!individual) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    return prisma.personMedia.findMany({ where: { individualId: id, treeId }, orderBy: { createdAt: "desc" } });
  });

  fastify.post("/:id/media", async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;

    const individual = await prisma.individual.findFirst({ where: { id, treeId, deletedAt: null } });
    if (!individual) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No se recibió ningún archivo" });
    }

    const buffer = await file.toBuffer();
    const { url } = await saveUpload(treeId, id, file.filename, buffer);
    const type = file.mimetype.startsWith("image/") ? "PHOTO" : "DOCUMENT";

    const media = await prisma.personMedia.create({
      data: { treeId, individualId: id, type, url, filename: file.filename, mimeType: file.mimetype },
    });
    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "media.create",
      entityType: "PersonMedia",
      entityId: media.id,
      summary: file.filename,
    });
    return reply.code(201).send(media);
  });

  fastify.delete("/:id/media/:mediaId", async (request, reply) => {
    const { id, mediaId } = request.params as { id: string; mediaId: string };
    const treeId = request.treeId!;

    const media = await prisma.personMedia.findFirst({ where: { id: mediaId, individualId: id, treeId } });
    if (!media) {
      return reply.code(404).send({ error: "No existe ese archivo" });
    }

    await prisma.personMedia.delete({ where: { id: mediaId } });
    await deleteUploadByUrl(media.url);
    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "media.delete",
      entityType: "PersonMedia",
      entityId: mediaId,
      summary: media.filename,
    });
    return reply.code(204).send();
  });

  // PDF report of one or more people's ascendants/descendants — walks the
  // very same rels.parents/rels.children graph GET /tree hands to the
  // frontend for navigation (see buildTreeData/walkGraph in tree-data.ts),
  // so the report can never show a different family shape than the tree UI
  // does. `rootIds` is a repeated query param (?rootIds=a&rootIds=b), which
  // Fastify's querystring parser already hands back as an array — kept as
  // a plain GET (rather than a POST+blob-download) so the existing
  // <a target="_blank"> download flow on the frontend needs no changes.
  fastify.get("/report", async (request, reply) => {
    const query = request.query as { rootIds?: string | string[]; direction?: string; layout?: string };
    const rootIds = query.rootIds ? (Array.isArray(query.rootIds) ? query.rootIds : [query.rootIds]) : [];
    if (rootIds.length === 0) {
      return reply.code(400).send({ error: "Elige al menos una persona" });
    }
    const direction: ReportDirection =
      query.direction === "ancestors" || query.direction === "descendants" ? query.direction : "both";
    const layout: ReportLayout =
      query.layout === "horizontal" || query.layout === "descending" ? query.layout : "vertical";

    const treeId = request.treeId!;
    const individuals = await prisma.individual.findMany({ where: { id: { in: rootIds }, treeId, deletedAt: null } });
    const foundIds = new Set(individuals.map((i) => i.id));
    const missingId = rootIds.find((id) => !foundIds.has(id));
    if (missingId) {
      return reply.code(404).send({ error: `No existe el individuo ${missingId}` });
    }

    const tree = await prisma.tree.findUniqueOrThrow({ where: { id: treeId } });
    const { people } = await buildTreeData(treeId);
    const html = await renderReportHtml(people, rootIds, tree.name, direction, layout);
    const pdf = await renderReportPdf(html);

    const byId = new Map(individuals.map((i) => [i.id, i]));
    const filenameBase =
      rootIds.length === 1 ? personLabel(byId.get(rootIds[0])!) : `${rootIds.length}_personas`;
    const filenameSafe = downloadFilename(filenameBase, "informe");
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="${filenameSafe}.pdf"`);
    return reply.send(pdf);
  });
}
