import type { Data as TreeData } from "family-chart";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type Sex = "MALE" | "FEMALE" | "UNKNOWN";
export type UnionType = "MARRIAGE" | "PARTNERSHIP" | "UNKNOWN";

export type Individual = {
  id: string;
  givenNames: string;
  surname: string;
  birthSurname: string | null;
  sex: Sex;
  birthDateText: string | null;
  birthPlace: string | null;
  deathDateText: string | null;
  deathPlace: string | null;
  notes: string | null;
  deletedAt?: string | null;
};

export type Relationship =
  | { kind: "CHILD_OF_PARENTS"; parent1Id: string; parent2Id?: string }
  | {
      kind: "PARTNER";
      partnerId: string;
      unionType?: UnionType;
      unionDateText?: string;
      unionPlace?: string;
    };

export type IndividualFields = {
  givenNames: string;
  surname: string;
  birthSurname?: string;
  sex?: Sex;
  birthDateText?: string;
  birthPlace?: string;
  deathDateText?: string;
  deathPlace?: string;
  notes?: string;
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

export async function fetchTree(): Promise<TreeData> {
  const res = await fetch(`${API_URL}/tree`);
  const data = await parseJsonOrThrow(res);
  // The backend's gender is 'M' | 'F' | omitted (unknown sex); family-chart
  // renders a genderless card for anything that isn't 'M'/'F' at runtime,
  // its stricter type just doesn't spell out that third case.
  return data as TreeData;
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
