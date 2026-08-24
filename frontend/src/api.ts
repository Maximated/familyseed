import i18n from "./i18n";

// In dev, the frontend (Vite on :5173) and backend (:3001) are separate
// servers, so API calls need an absolute URL. In a production build (the
// Docker image), the backend serves the built frontend itself — same
// origin — so a relative path is both correct and portable: it doesn't
// bake in any particular host/port/domain at build time.
const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3001" : "");

export type Sex = "MALE" | "FEMALE" | "UNKNOWN";
export type UnionType = "MARRIAGE" | "PARTNERSHIP" | "EXTRAMARITAL" | "UNKNOWN";
export type UnionStatus = "ONGOING" | "ENDED_BY_DEATH" | "DIVORCED" | "SEPARATED" | "ANNULLED";
export type DatePrecision = "EXACT" | "ABOUT" | "BEFORE" | "AFTER" | "UNKNOWN";

export type UnionInfo = {
  id: string;
  partner1Id: string;
  partner2Id: string;
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionDateValue: string | null;
  unionDatePrecision: DatePrecision | null;
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
    birthDateValue?: string;
    deathDateValue?: string;
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
  birthDateValue: string | null;
  birthDatePrecision: DatePrecision | null;
  birthPlace: string | null;
  deathDateText: string | null;
  deathDateValue: string | null;
  deathDatePrecision: DatePrecision | null;
  deathPlace: string | null;
  notes: string | null;
  biography: string | null;
  photoUrl: string | null;
  deletedAt?: string | null;
  // Only populated by fetchIndividualRelations (GET /:id) — list/create/
  // update responses don't include it.
  lineageIds?: string[];
  // Only populated by fetchIndividuals (GET /, the list route) — true when
  // this person has no parents/children/partner at all, meaning they're
  // invisible on the tree canvas until linked to someone.
  hasNoRelationships?: boolean;
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
    }
  | { kind: "PARENT_OF"; childId: string };

export type IndividualFields = {
  givenNames: string;
  surname1: string;
  // `null` (not just omission) explicitly clears the field on the backend —
  // see EditPersonForm, which sends it whenever the user empties one of
  // these out. Omitting the key entirely leaves the existing value alone.
  surname2?: string | null;
  surname1BirthName?: string | null;
  alias?: string | null;
  sex?: Sex;
  birthDateText?: string | null;
  birthDateValue?: string | null;
  birthDatePrecision?: DatePrecision | null;
  birthPlace?: string | null;
  deathDateText?: string | null;
  deathDateValue?: string | null;
  deathDatePrecision?: DatePrecision | null;
  deathPlace?: string | null;
  notes?: string | null;
  biography?: string | null;
  // Not settable from the normal create/edit forms (photos go through the
  // upload endpoint instead) — only used when a duplicate merge picks
  // which of the two records' avatar to keep.
  photoUrl?: string;
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

export type AuthUser = { id: string; email: string | null; name: string | null; avatarUrl: string | null };

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

export async function updateProfile(name: string): Promise<AuthUser> {
  const res = await apiFetch("/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow(res);
}

export async function uploadUserAvatar(file: File | Blob, filename?: string): Promise<AuthUser> {
  const formData = new FormData();
  formData.append("file", file, filename ?? (file instanceof File ? file.name : "avatar.jpg"));
  const res = await apiFetch("/auth/me/avatar", { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

export async function fetchAuthConfig(): Promise<{ googleEnabled: boolean }> {
  const res = await apiFetch("/auth/config");
  return parseJsonOrThrow(res);
}

// Full-page navigation, not a fetch — the backend redirects the browser
// to Google's consent screen and back, so this just needs to be a real URL.
export function googleLoginUrl(): string {
  return `${API_URL}/auth/google`;
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
  memberCount: number;
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

export async function deleteTree(treeId: string, confirmName: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmName }),
  });
  await throwIfNotOk(res);
}

export type ShareRole = "EDITOR" | "VIEWER";

export type TreeMemberInfo = {
  userId: string;
  email: string | null;
  name: string | null;
  role: TreeRole;
};

export async function fetchTreeMembers(treeId: string): Promise<TreeMemberInfo[]> {
  const res = await apiFetch(`/trees/${treeId}/members`);
  return parseJsonOrThrow(res);
}

export async function addTreeMember(treeId: string, email: string, role: ShareRole): Promise<TreeMemberInfo> {
  const res = await apiFetch(`/trees/${treeId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  return parseJsonOrThrow(res);
}

export async function updateTreeMemberRole(treeId: string, userId: string, role: ShareRole): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  await throwIfNotOk(res);
}

export async function removeTreeMember(treeId: string, userId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/members/${userId}`, { method: "DELETE" });
  await throwIfNotOk(res);
}

export type InviteLinkInfo = {
  id: string;
  role: ShareRole;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  maxUses: number | null;
  useCount: number;
};

export async function fetchInviteLinks(treeId: string): Promise<InviteLinkInfo[]> {
  const res = await apiFetch(`/trees/${treeId}/invite-links`);
  return parseJsonOrThrow(res);
}

export async function createInviteLink(
  treeId: string,
  params: { role: ShareRole; expiresAt?: string; maxUses?: number },
): Promise<InviteLinkInfo> {
  const res = await apiFetch(`/trees/${treeId}/invite-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res);
}

export async function revokeInviteLink(treeId: string, id: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/invite-links/${id}`, { method: "DELETE" });
  await throwIfNotOk(res);
}

export function inviteLinkUrl(id: string): string {
  return `${window.location.origin}/invite/${id}`;
}

export type InviteLinkPeek = {
  treeName: string;
  role: ShareRole;
  valid: boolean;
  reason?: "revoked" | "expired" | "maxed_out";
};

// Top-level (not /trees/:treeId/...) — reachable while logged out, see
// backend/src/routes/invite-redeem.ts.
export async function peekInviteLink(id: string): Promise<InviteLinkPeek> {
  const res = await apiFetch(`/invite-links/${id}`);
  return parseJsonOrThrow(res);
}

export async function redeemInviteLink(id: string): Promise<{ treeId: string }> {
  const res = await apiFetch(`/invite-links/${id}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
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
  memberCount: number;
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

export type GeneralStatistics = {
  sexCounts: { male: number; female: number; unknown: number; total: number };
  sexPercentages: { male: number; female: number; unknown: number };
  lineageCount: number;
  yearRange: { earliest: number; latest: number } | null;
  longestLived: { individualId: string; name: string; ageYears: number } | null;
  largestLineage: { lineageId: string; name: string; memberCount: number } | null;
  largestGeneration: { generation: number; count: number } | null;
  familyNucleiCount: number;
  incompleteData: { missingBirth: number; missingDeath: number; missingBoth: number };
  mostCommonBirthplace: { place: string; count: number } | null;
};

export type RelationshipResult =
  | { kind: "self" }
  | { kind: "direct-ancestor"; degree: number; labelEs: string }
  | { kind: "direct-descendant"; degree: number; labelEs: string }
  | { kind: "sibling"; half: boolean; labelEs: string }
  | { kind: "collateral"; cousinDegree: number; removal: number; labelEs: string }
  | { kind: "disconnected" };

export type PersonStatistics = {
  personId: string;
  ancestorGenerations: number;
  descendantGenerations: number;
  totalAncestors: number;
  totalDescendants: number;
  age: { years: number; exact: boolean; atDeath: boolean } | null;
  siblingsCount: number;
  childrenCount: number;
  unionsCount: number;
  parentsAgeAtBirth: { parentId: string; parentName: string; ageYears: number; exact: boolean }[];
  meNotSet: boolean;
  generationRelativeToMe: number | null;
  relationshipToMe: RelationshipResult | null;
};

export async function fetchStatistics(
  treeId: string,
  personId?: string,
): Promise<{ general: GeneralStatistics; person?: PersonStatistics }> {
  const qs = personId ? `?personId=${encodeURIComponent(personId)}` : "";
  const res = await apiFetch(`/trees/${treeId}/statistics${qs}`);
  return parseJsonOrThrow(res);
}

export async function fetchMyIdentity(treeId: string): Promise<{ individualId: string | null }> {
  const res = await apiFetch(`/trees/${treeId}/my-identity`);
  return parseJsonOrThrow(res);
}

export async function setMyIdentity(treeId: string, individualId: string): Promise<{ individualId: string | null }> {
  const res = await apiFetch(`/trees/${treeId}/my-identity`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ individualId }),
  });
  return parseJsonOrThrow(res);
}

export async function clearMyIdentity(treeId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/my-identity`, { method: "DELETE" });
  await throwIfNotOk(res);
}

export async function fetchLineages(treeId: string): Promise<Lineage[]> {
  const res = await apiFetch(`/trees/${treeId}/lineages`);
  return parseJsonOrThrow(res);
}

export async function createLineage(treeId: string, name: string, color?: string): Promise<Lineage> {
  const res = await apiFetch(`/trees/${treeId}/lineages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  return parseJsonOrThrow(res);
}

// Re-runs the same surname-based auto-derivation every create/edit/import
// already does per person — a manual fallback for data that predates it or
// slipped through some import path that skipped it.
export async function deriveLineages(treeId: string): Promise<{ lineages: Lineage[]; mergedCount: number }> {
  const res = await apiFetch(`/trees/${treeId}/lineages/derive`, { method: "POST" });
  return parseJsonOrThrow(res);
}

export async function updateLineage(treeId: string, id: string, name: string): Promise<Lineage> {
  const res = await apiFetch(`/trees/${treeId}/lineages/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow(res);
}

export async function deleteLineage(treeId: string, id: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/lineages/${id}`, { method: "DELETE" });
  await throwIfNotOk(res);
}

export async function addIndividualLineage(treeId: string, id: string, lineageId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}/lineages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineageId }),
  });
  await throwIfNotOk(res);
}

export async function removeIndividualLineage(treeId: string, id: string, lineageId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${id}/lineages/${lineageId}`, { method: "DELETE" });
  await throwIfNotOk(res);
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

export type DuplicateConfidence = "high" | "possible";

export type DuplicateSuggestion = {
  aId: string;
  bId: string;
  confidence: DuplicateConfidence;
};

export async function fetchDuplicateSuggestions(treeId: string): Promise<DuplicateSuggestion[]> {
  const res = await apiFetch(`/trees/${treeId}/duplicates/suggestions`);
  return parseJsonOrThrow(res);
}

export async function mergeIndividuals(
  treeId: string,
  keepId: string,
  mergeId: string,
  individual: IndividualFields,
): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/duplicates/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keepId, mergeId, individual }),
  });
  await throwIfNotOk(res);
}

// A "ghost" single-parent Family row left behind by an old import/edit,
// duplicating a child's link to another Family where the same person is
// already a partner — see backend/src/routes/duplicates.ts for detection.
export type FamilyDuplicateSuggestion = {
  familyId: string;
  keepFamilyId: string;
  parentId: string;
  parentName: string;
  childId: string;
  childName: string;
};

export async function fetchFamilyDuplicateSuggestions(treeId: string): Promise<FamilyDuplicateSuggestion[]> {
  const res = await apiFetch(`/trees/${treeId}/duplicates/family-suggestions`);
  return parseJsonOrThrow(res);
}

export async function resolveFamilyDuplicate(treeId: string, familyId: string, childId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/duplicates/family-resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ familyId, childId }),
  });
  await throwIfNotOk(res);
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
export type ReportLayout = "vertical" | "horizontal" | "descending";

// A direct navigation URL (opened via window.open/<a href>, not fetch) —
// the backend serves it with Content-Disposition: attachment, so the
// browser downloads the PDF without any client-side blob handling needed.
// Cookies ride along automatically on a normal browser navigation, so no
// credentials option is needed here the way apiFetch needs it.
export function personReportUrl(
  treeId: string,
  rootIds: string[],
  direction: ReportDirection,
  layout: ReportLayout,
): string {
  const params = new URLSearchParams();
  for (const id of rootIds) params.append("rootIds", id);
  params.set("direction", direction);
  params.set("layout", layout);
  return `${API_URL}/trees/${treeId}/individuals/report?${params.toString()}`;
}

export type ImportResult = { individuals: number; families: number; individualIds: string[] };

export async function importGedcom(treeId: string, file: File): Promise<ImportResult> {
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

export async function importCsv(treeId: string, file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await apiFetch(`/trees/${treeId}/csv/import`, { method: "POST", body: formData });
  return parseJsonOrThrow(res);
}

export function csvExportUrl(treeId: string, personId?: string, direction?: "ancestors" | "descendants"): string {
  if (personId && direction) {
    return `${API_URL}/trees/${treeId}/csv/export?personId=${personId}&direction=${direction}`;
  }
  return `${API_URL}/trees/${treeId}/csv/export`;
}

export function csvTemplateUrl(treeId: string): string {
  return `${API_URL}/trees/${treeId}/csv/template`;
}

export async function updateFamilyNotes(treeId: string, id: string, notes: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/families/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  await throwIfNotOk(res);
}

export type UpdateFamilyPayload = {
  unionType?: UnionType;
  unionStatus?: UnionStatus;
  unionDateText?: string | null;
  unionDateValue?: string | null;
  unionDatePrecision?: DatePrecision | null;
  unionPlace?: string | null;
};

export async function updateFamily(treeId: string, id: string, payload: UpdateFamilyPayload): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/families/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await throwIfNotOk(res);
}

// Permanent — no trash for unions. Any children linked to this union stop
// being linked to these two partners specifically, but the children
// themselves aren't touched.
export async function deleteFamily(treeId: string, id: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/families/${id}`, { method: "DELETE" });
  await throwIfNotOk(res);
}

// Attaches an existing individual as a child of this union directly —
// links them to both partners at once, unlike addParent (which only
// knows one parent at a time).
export async function addFamilyChild(treeId: string, familyId: string, individualId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/families/${familyId}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ individualId }),
  });
  await throwIfNotOk(res);
}

export type SpouseChildCandidate = { id: string; givenNames: string; surname1: string };

// Children already linked to just one of this union's partners through a
// separate single-parent Family row (added before the second parent was
// ever recorded) — candidates for copySpouseChildren below, not this
// union's own children.
export async function getSpouseChildCandidates(treeId: string, familyId: string): Promise<SpouseChildCandidate[]> {
  const res = await apiFetch(`/trees/${treeId}/families/${familyId}/spouse-children`);
  await throwIfNotOk(res);
  return res.json();
}

// Moves every such candidate into this union in one action instead of
// re-picking each one through the same PersonPicker "vincular hijo
// existente" uses.
export async function copySpouseChildren(treeId: string, familyId: string): Promise<SpouseChildCandidate[]> {
  const res = await apiFetch(`/trees/${treeId}/families/${familyId}/copy-spouse-children`, { method: "POST" });
  await throwIfNotOk(res);
  return res.json();
}

export type CopyMode = "single" | "lineage";

export type CopyIndividualPayload = {
  destTreeId: string;
  mode: CopyMode;
  direction?: "ancestors" | "descendants";
};

// Not tree-scoped in the URL (no /trees/:treeId prefix) — copying spans a
// source and a destination tree at once, so the backend resolves both from
// the request body instead of a single URL param.
export async function copyIndividual(
  id: string,
  payload: CopyIndividualPayload,
): Promise<{ individuals: number; families: number }> {
  const res = await apiFetch(`/individuals/${id}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

// Links an already-existing individual as a parent of another — the
// recovery path when someone was created without a relationship first, and
// the parent-child half of the free "link two people" builder.
export async function addParent(treeId: string, personId: string, parentId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${personId}/parents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId }),
  });
  await throwIfNotOk(res);
}

// Undoes a mistaken addParent — removes just that one relationship,
// without deleting either person.
export async function removeParent(treeId: string, personId: string, parentId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/individuals/${personId}/parents/${parentId}`, { method: "DELETE" });
  await throwIfNotOk(res);
}

export type CreateFamilyPayload = {
  partner1Id: string;
  partner2Id?: string;
  unionType?: UnionType;
  unionStatus?: UnionStatus;
  unionDateText?: string;
  unionPlace?: string;
};

// Creates a union between two already-existing individuals — the partner
// half of the free "link two people" builder (AddPersonForm only ever
// creates a union alongside a brand-new person).
export async function createFamily(treeId: string, payload: CreateFamilyPayload): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/families`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await throwIfNotOk(res);
}

// Fills the still-empty partner slot on an existing union — used instead of
// createFamily when the new partner already has children recorded on a
// family with only one known parent, so those children end up shared by
// both parents instead of duplicated onto a second, separate union.
export async function fillFamilyPartner(treeId: string, familyId: string, partnerId: string): Promise<void> {
  const res = await apiFetch(`/trees/${treeId}/families/${familyId}/partner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partnerId }),
  });
  await throwIfNotOk(res);
}
