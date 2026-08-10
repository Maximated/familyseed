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

// The shape GET /trees/:treeId returns: family-chart's Datum plus the extra
// fields used only by the timeline/lineage-chip navigation (not the
// genealogy itself). Kept separate from family-chart's own (stricter) Data
// type so Timeline/LineageChips don't need to know about card-rendering
// concerns.
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

// Every fetch needs the session cookie sent along (backend + frontend are
// different origins in dev) — centralized here so call sites can't forget it.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, { ...init, credentials: "include" });
}

async function parseJsonOrThrow(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? i18n.t("errors.apiResponded", { status: res.status }));
  }
  return body;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? i18n.t("errors.apiResponded", { status: res.status }));
  }
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

export type AuthUser = { id: string; email: string | null; name: string | null };

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow(res);
}

export async function register(email: string, password: string, name?: string): Promise<AuthUser> {
  const res = await apiFetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  return parseJsonOrThrow(res);
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
}

// Distinguishes "not logged in" (null) from an actual network/server error
// (thrown) — callers checking auth state on mount want the former to be a
// quiet, expected outcome, not a caught exception.
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await apiFetch("/auth/me");
  if (res.status === 401) return null;
  return parseJsonOrThrow(res);
}

// ---------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------

export type TreeRole = "OWNER" | "EDITOR" | "VIEWER";

export type TreeSummary = {
  id: string;
  name: string;
  role: TreeRole;
  createdAt: string;
};

export async function fetchTrees(): Promise<{ owned: TreeSummary[]; shared: TreeSummary[] }> {
  const res = await apiFetch("/trees");
  return parseJsonOrThrow(res);
}

export async function createTree(name: string): Promise<TreeSummary> {
  const res = await apiFetch("/trees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow(res);
}

// ---------------------------------------------------------------------
// Uploaded files (photos/documents) — served at a relative /uploads/...
// path already scoped by treeId server-side, so this just needs the origin.
// ---------------------------------------------------------------------

export function mediaUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_URL}${path}`;
}

// ---------------------------------------------------------------------
// Tree-scoped data — every function below operates within one tree,
// mirroring the backend's /trees/:treeId/... routes.
// ---------------------------------------------------------------------

export type IndividualFilters = {
  search?: string;
  lineageId?: string;
  birthYearFrom?: number;
  birthYearTo?: number;
  place?: string;
};

export async function fetchIndividuals(treeId: string, filters?: IndividualFilters): Promise<Individual[]> {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.lineageId) params.set("lineageId", filters.lineageId);
  if (filters?.birthYearFrom) params.set("birthYearFrom", String(filters.birthYearFrom));
  if (filters?.birthYearTo) params.set("birthYearTo", String(filters.birthYearTo));
  if (filters?.place) params.set("place", filters.place);
  const qs = params.toString();
  const res = await apiFetch(`/trees/${treeId}/individuals${qs ? `?${qs}` : ""}`);
  return parseJsonOrThrow(res);
}

export async function fetchTree(treeId: string): Promise<{
  id: string;
  name: string;
  role: TreeRole;
  people: TreePerson[];
  unions: UnionInfo[];
}> {
  const res = await apiFetch(`/trees/${treeId}`);
  return parseJsonOrThrow(res);
}

export async function updateTreeName(treeId: string, name: string): Promise<{ id: string; name: string }> {
  const res = await apiFetch(`/trees/${treeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow(res);
}

export async function fetchLineages(treeId: string): Promise<Lineage[]> {
  const res = await apiFetch(`/trees/${treeId}/lineages`);
  return parseJsonOrThrow(res);
}

export async function createIndividual(
  treeId: string,
  payload: CreateIndividualPayload,
): Promise<{ individual: Individual }> {
  const res = await apiFetch(`/trees/${treeId}/individuals`, {
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

// Same GET /trees/:treeId/individuals/:id endpoint fetchIndividual uses —
// this variant keeps the parents/siblings/partnerships/children the edit
// form discards, for the compact "Relaciones" summary view.
export async function fetchIndividualRelations(treeId: string, id: string): Promise<IndividualRelations> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}`);
  return parseJsonOrThrow(res);
}

export async function fetchIndividual(treeId: string, id: string): Promise<Individual> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}`);
  const body = await parseJsonOrThrow(res);
  return body.individual;
}

export async function updateIndividual(
  treeId: string,
  id: string,
  payload: UpdateIndividualPayload,
): Promise<Individual> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function deleteIndividual(treeId: string, id: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}`, { method: "DELETE" });
  await throwIfNotOk(res);
}

export async function fetchTrash(treeId: string): Promise<Individual[]> {
  const res = await apiFetch(`/trees/${treeId}/individuals?trashed=true`);
  return parseJsonOrThrow(res);
}

export async function restoreIndividual(treeId: string, id: string): Promise<Individual> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}/restore`, { method: "POST" });
  return parseJsonOrThrow(res);
}

export async function uploadPersonPhoto(
  treeId: string,
  id: string,
  file: File | Blob,
  filename?: string,
): Promise<Individual> {
  const formData = new FormData();
  formData.append("file", file, filename ?? (file instanceof File ? file.name : "photo.jpg"));
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}/photo`, { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

export async function fetchPersonMedia(treeId: string, id: string): Promise<PersonMediaItem[]> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}/media`);
  return parseJsonOrThrow(res);
}

export async function uploadPersonMedia(
  treeId: string,
  id: string,
  file: File | Blob,
  filename?: string,
): Promise<PersonMediaItem> {
  const formData = new FormData();
  formData.append("file", file, filename ?? (file instanceof File ? file.name : "archivo"));
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}/media`, { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

export async function deletePersonMedia(treeId: string, id: string, mediaId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}/media/${mediaId}`, { method: "DELETE" });
  await throwIfNotOk(res);
}

export type ReportDirection = "ancestors" | "descendants" | "both";

// A direct navigation URL (opened via window.open/<a href>, not fetch) —
// the backend serves it with Content-Disposition: attachment, so the
// browser downloads the PDF without any client-side blob handling needed.
// Cookies ride along automatically on a normal browser navigation, so no
// credentials option is needed here the way apiFetch needs it.
export function personReportUrl(treeId: string, id: string, direction: ReportDirection): string {
  return `${API_URL}/trees/${treeId}/individuals/${id}/report?direction=${direction}`;
}

export async function importGedcom(treeId: string, file: File): Promise<{ individuals: number; families: number }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await apiFetch(`/trees/${treeId}/gedcom/import`, { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

export function gedcomExportUrl(treeId: string, personId?: string, direction?: "ancestors" | "descendants"): string {
  if (personId && direction) {
    return `${API_URL}/trees/${treeId}/gedcom/export?personId=${personId}&direction=${direction}`;
  }
  return `${API_URL}/trees/${treeId}/gedcom/export`;
}

export async function updateFamilyNotes(treeId: string, id: string, notes: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/families/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  await throwIfNotOk(res);
}
