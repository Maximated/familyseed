import type { Sex } from "./api";

// A single, sex-aware placeholder identity for the "persona desconocida"
// toggle in AddPersonForm/EditPersonForm — shared so every unknown person
// added anywhere in the app ends up with the exact same wording, rather
// than each form (or each user) typing their own variant of "Desconocido".
export function unknownGivenNameFor(t: (key: string) => string, sex: Sex): string {
  if (sex === "MALE") return t("personFields.unknownGivenNameMale");
  if (sex === "FEMALE") return t("personFields.unknownGivenNameFemale");
  return t("personFields.unknownGivenNameNeutral");
}
