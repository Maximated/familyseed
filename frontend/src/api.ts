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
  deletedAt?: string | null;
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
    throw new Error(body?.error ?? `La API respondió ${res.status}`);
  }
  return body;
}

export async function fetchIndividuals(): Promise<Individual[]> {
  const res = await fetch(`${API_URL}/individuals`);
  return parseJsonOrThrow(res);
}

export async function fetchTree(): Promise<{ people: TreePerson[]; unions: UnionInfo[] }> {
  const res = await fetch(`${API_URL}/tree`);
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
    throw new Error(body?.error ?? `La API respondió ${res.status}`);
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
