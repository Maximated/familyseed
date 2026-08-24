import type { Individual } from "./api";

// Spanish naming convention: apellido1 (surname1) comes from the father,
// apellido2 (surname2) from the mother — falls back to plain parent1/
// parent2 positional order when sex isn't recorded for both parents, since
// there's then no reliable way to tell which parent's surname goes where.
export function surnameSuggestion(
  parent1: Pick<Individual, "sex" | "surname1"> | null | undefined,
  parent2: Pick<Individual, "sex" | "surname1"> | null | undefined,
  slot: "surname1" | "surname2",
): string | null {
  const father = parent1?.sex === "MALE" ? parent1 : parent2?.sex === "MALE" ? parent2 : null;
  const mother = parent1?.sex === "FEMALE" ? parent1 : parent2?.sex === "FEMALE" ? parent2 : null;
  if (father && mother) {
    return (slot === "surname1" ? father : mother).surname1 || null;
  }
  const bySlot = slot === "surname1" ? parent1 : parent2;
  return bySlot?.surname1 || null;
}
