import i18n from "./i18n";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type Sex = "MALE" | "FEMALE" | "UNKNOWN";
export type UnionType = "MARRIAGE" | "PARTNERSHIP" | "EXTRAMARITAL" | "UNKNOWN";
export type UnionStatus = "ONGOING" | "ENDED_BY_DEATH" | "DIVORCED" | "SEPARATED" | "ANNULLED";

export type UnionInfo = {
  id: string;
  partner1Id: string;
  partner2Id: string;
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionPlace: string | null;
  notes: string | null;
  // Chronological order of this union among each partner's own unions
  // (max of both, so a remarriage shows as such even if it's the other
  // partner's first) — used to mark 2nd+ marriages on the tree.
  order: number;
};

export type Lineage = {
  id: string;
  name: string;
  color: string | null;
};

// The shape GET /tree returns: family-chart's Datum plus the extra fields
// used only by the timeline/lineage-chip navigation (not the genealogy
// itself). Kept separate from family-chart's own (stricter) Data type so
// Timeline/LineageChips don't need to know about card-rendering concerns.
export type TreePerson = {
  id: string;
  data: {
    "first name": string;
    "last name": string;
    "birth name"?: string;
    alias?: string;
    "birth place"?: string;
    "death place"?: string;
    gender?: string;
    birthday?: string;
    deathday?: string;
    birthYear?: number;
    deathYear?: number;
    birthPrecision?: string;
    deathPrecision?: string;
    notes?: string;
    biography?: string;
    lineageIds: string[];
    [key: string]: unknown;
  };
  rels: {
    parents: string[];
    spouses: string[];
    children: string[];
  };
};

export type Individual = {
  id: string;
  givenNames: string;
  surname1: string;
  surname2: string | null;
  surname1BirthName: string | null;
  alias: string | null;
  sex: Sex;
  birthDateText: string | null;
  birthPlace: string | null;
  deathDateText: string | null;
  deathPlace: string | null;
  notes: string | null;
  biography: string | null;
  photoUrl: string | null;
  deletedAt?: string | null;
};

export type PersonMediaType = "PHOTO" | "DOCUMENT";

export type PersonMediaItem = {
  id: string;
  individualId: string;
  type: PersonMediaType;
  url: string;
  filename: string;
  mimeType: string | null;
  createdAt: string;
};

export type Relationship =
  | { kind: "CHILD_OF_PARENTS"; parent1Id: string; parent2Id?: string }
  | {
      kind: "PARTNER";
      partnerId: string;
      unionType?: UnionType;
      unionStatus?: UnionStatus;
      unionDateText?: string;
      unionPlace?: string;
    };

export type IndividualFields = {
  givenNames: string;
  surname1: string;
  surname2?: string;
  surname1BirthName?: string;
  alias?: string;
  sex?: Sex;
  birthDateText?: string;
  birthPlace?: string;
  deathDateText?: string;
  deathPlace?: string;
  notes?: string;
  biography?: string;
};

export type CreateIndividualPayload = {
  individual: IndividualFields;
  relationship?: Relationship;
};

export type UpdateIndividualPayload = Partial<IndividualFields>;

async function parseJsonOrThrow(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? i18n.t("errors.apiResponded", { status: res.status }));
  }
  return body;
}

// Uploaded files are served from the backend (a different origin in dev)
// at a relative /uploads/... path — this is the one place that knows how
// to turn that into something an <img>/<a> can actually load.
export function mediaUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_URL}${path}`;
}

export type ReportDirection = "ancestors" | "descendants" | "both";

// A direct navigation URL (opened via window.open, not fetch) — the backend
// serves it with Content-Disposition: attachment, so the browser downloads
// the PDF without any client-side blob handling needed.
export function personReportUrl(id: string, direction: ReportDirection): string {
  return `${API_URL}/individuals/${id}/report?direction=${direction}`;
}

export type IndividualFilters = {
  search?: string;
  lineageId?: string;
  birthYearFrom?: number;
  birthYearTo?: number;
  place?: string;
};

export async function fetchIndividuals(filters?: IndividualFilters): Promise<Individual[]> {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.lineageId) params.set("lineageId", filters.lineageId);
  if (filters?.birthYearFrom) params.set("birthYearFrom", String(filters.birthYearFrom));
  if (filters?.birthYearTo) params.set("birthYearTo", String(filters.birthYearTo));
  if (filters?.place) params.set("place", filters.place);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/individuals${qs ? `?${qs}` : ""}`);
  return parseJsonOrThrow(res);
}

export async function fetchTree(): Promise<{
  id: string;
  name: string;
  people: TreePerson[];
  unions: UnionInfo[];
}> {
  const res = await fetch(`${API_URL}/tree`);
  return parseJsonOrThrow(res);
}

export async function updateTreeName(name: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${API_URL}/tree`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow(res);
}

export type Me = { id: string; name: string | null; email: string | null; role: string };

export async function fetchMe(): Promise<Me> {
  const res = await fetch(`${API_URL}/me`);
  return parseJsonOrThrow(res);
}

export async function fetchLineages(): Promise<Lineage[]> {
  const res = await fetch(`${API_URL}/lineages`);
  return parseJsonOrThrow(res);
}

export async function createIndividual(
  payload: CreateIndividualPayload,
): Promise<{ individual: Individual }> {
  const res = await fetch(`${API_URL}/individuals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export type RelatedPerson = Individual & { relationType: string; familyId: string };

export type Partnership = {
  familyId: string;
  partner: Individual | null;
  unionType: UnionType;
  unionDateText: string | null;
  unionPlace: string | null;
};

export type IndividualRelations = {
  individual: Individual;
  parents: RelatedPerson[];
  siblings: RelatedPerson[];
  partnerships: Partnership[];
  children: RelatedPerson[];
};

// Same GET /individuals/:id endpoint fetchIndividual uses — this variant
// keeps the parents/siblings/partnerships/children the edit form discards,
// for the compact "Relaciones" summary view.
export async function fetchIndividualRelations(id: string): Promise<IndividualRelations> {
  const res = await fetch(`${API_URL}/individuals/${id}`);
  return parseJsonOrThrow(res);
}

export async function fetchIndividual(id: string): Promise<Individual> {
  const res = await fetch(`${API_URL}/individuals/${id}`);
  const body = await parseJsonOrThrow(res);
  return body.individual;
}

export async function updateIndividual(
  id: string,
  payload: UpdateIndividualPayload,
): Promise<Individual> {
  const res = await fetch(`${API_URL}/individuals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function deleteIndividual(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/individuals/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? i18n.t("errors.apiResponded", { status: res.status }));
  }
}

export async function fetchTrash(): Promise<Individual[]> {
  const res = await fetch(`${API_URL}/individuals?trashed=true`);
  return parseJsonOrThrow(res);
}

export async function restoreIndividual(id: string): Promise<Individual> {
  const res = await fetch(`${API_URL}/individuals/${id}/restore`, { method: "POST" });
  return parseJsonOrThrow(res);
}

export async function uploadPersonPhoto(id: string, file: File | Blob, filename?: string): Promise<Individual> {
  const formData = new FormData();
  formData.append("file", file, filename ?? (file instanceof File ? file.name : "photo.jpg"));
  const res = await fetch(`${API_URL}/individuals/${id}/photo`, { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

export async function fetchPersonMedia(id: string): Promise<PersonMediaItem[]> {
  const res = await fetch(`${API_URL}/individuals/${id}/media`);
  return parseJsonOrThrow(res);
}

export async function uploadPersonMedia(id: string, file: File | Blob, filename?: string): Promise<PersonMediaItem> {
  const formData = new FormData();
  formData.append("file", file, filename ?? (file instanceof File ? file.name : "archivo"));
  const res = await fetch(`${API_URL}/individuals/${id}/media`, { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

export async function deletePersonMedia(id: string, mediaId: string): Promise<void> {
  const res = await fetch(`${API_URL}/individuals/${id}/media/${mediaId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? i18n.t("errors.apiResponded", { status: res.status }));
  }
}

export async function importGedcom(file: File): Promise<{ individuals: number; families: number }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetch(`${API_URL}/gedcom/import`, { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

// A direct navigation URL (opened via window.open, not fetch) — same
// pattern as personReportUrl, the backend serves it as an attachment.
export function gedcomExportUrl(personId?: string, direction?: "ancestors" | "descendants"): string {
  if (personId && direction) {
    return `${API_URL}/gedcom/export?personId=${personId}&direction=${direction}`;
  }
  return `${API_URL}/gedcom/export`;
}

export async function updateFamilyNotes(id: string, notes: string): Promise<void> {
  const res = await fetch(`${API_URL}/families/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? i18n.t("errors.apiResponded", { status: res.status }));
  }
}
