import { PrismaClient, Sex, DatePrecision } from "@prisma/client";

const prisma = new PrismaClient();

// Fictional 4-generation Polish family (plus one Spanish in-law), used to
// validate the schema against real-world cases: a second union after
// widowhood (half-siblings), a cousin branch, a husband taking his wife's
// surname (the reverse of the usual case), individuals without a known
// partner, a double surname (Spanish convention), and lineages that overlap
// rather than partition the tree (a person's paternal and maternal lineage
// at once).

type IndividualInput = {
  givenNames: string;
  surname1: string;
  surname2?: string;
  surname1BirthName?: string;
  sex: Sex;
  birthDateText?: string;
  birthDateValue?: Date;
  birthDatePrecision?: DatePrecision;
  birthPlace?: string;
  deathDateText?: string;
  deathDateValue?: Date;
  deathDatePrecision?: DatePrecision;
  deathPlace?: string;
};

async function createIndividual(data: IndividualInput) {
  return prisma.individual.create({ data });
}

async function createLineage(name: string, color: string) {
  return prisma.lineage.create({ data: { name, color } });
}

async function addToLineage(individualId: string, lineageId: string) {
  await prisma.individualLineage.create({ data: { individualId, lineageId } });
}

async function main() {
  // --- Lineages ---
  // Purely a navigation aid — membership is manual and overlapping, not
  // derived from surname1.
  const lineageZawadzki = await createLineage("Zawadzki", "#4a7a94");
  const lineageKaczmarek = await createLineage("Kaczmarek", "#b06a7a");
  const lineageSikora = await createLineage("Sikora", "#8a6a9a");
  const lineageLewandowski = await createLineage("Lewandowski", "#6a9a7a");
  const lineageNowak = await createLineage("Nowak", "#9a8a6a");
  const lineageDabrowski = await createLineage("Dąbrowski", "#7a6a9a");
  const lineageKowalski = await createLineage("Kowalski", "#9a6a6a");
  const lineageGarciaLopez = await createLineage("García López", "#6a8a9a");

  // --- Generation 1 ---
  const bronislaw = await createIndividual({
    givenNames: "Bronisław",
    surname1: "Zawadzki",
    sex: Sex.MALE,
    birthDateText: "12 marzo 1925",
    birthDateValue: new Date("1925-03-12"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
    deathDateText: "2 noviembre 1998",
    deathDateValue: new Date("1998-11-02"),
    deathDatePrecision: DatePrecision.EXACT,
    deathPlace: "Kraków, Polonia",
  });
  await addToLineage(bronislaw.id, lineageZawadzki.id);

  const maria = await createIndividual({
    givenNames: "Maria",
    surname1: "Zawadzka",
    surname1BirthName: "Kaczmarek",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1927",
    birthDateValue: new Date("1927-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Kraków, Polonia",
    deathDateText: "1965",
    deathDateValue: new Date("1965-01-01"),
    deathDatePrecision: DatePrecision.EXACT,
    deathPlace: "Kraków, Polonia",
  });
  // Belongs to both her married family and her birth family at once —
  // exactly the non-exclusive membership lineages are meant to represent.
  await addToLineage(maria.id, lineageZawadzki.id);
  await addToLineage(maria.id, lineageKaczmarek.id);

  // Bronisław remarries after Maria's death — second union.
  const janina = await createIndividual({
    givenNames: "Janina",
    surname1: "Zawadzka",
    surname1BirthName: "Sikora",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1935",
    birthDateValue: new Date("1935-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Tarnów, Polonia",
  });
  await addToLineage(janina.id, lineageZawadzki.id);
  await addToLineage(janina.id, lineageSikora.id);

  const familyBronislawMaria = await prisma.family.create({
    data: {
      partner1Id: bronislaw.id,
      partner2Id: maria.id,
      unionType: "MARRIAGE",
      unionDateText: "hacia 1946",
      unionDatePrecision: DatePrecision.ABOUT,
      unionPlace: "Kraków, Polonia",
    },
  });

  const familyBronislawJanina = await prisma.family.create({
    data: {
      partner1Id: bronislaw.id,
      partner2Id: janina.id,
      unionType: "MARRIAGE",
      unionDateText: "1967",
      unionDateValue: new Date("1967-01-01"),
      unionDatePrecision: DatePrecision.EXACT,
      unionPlace: "Kraków, Polonia",
    },
  });

  // --- Generation 2 ---
  const henryk = await createIndividual({
    givenNames: "Henryk",
    surname1: "Zawadzki",
    sex: Sex.MALE,
    birthDateText: "20 junio 1948",
    birthDateValue: new Date("1948-06-20"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });
  await addToLineage(henryk.id, lineageZawadzki.id);

  // Half-sister to Henryk: child of Bronisław's second union.
  const krystyna = await createIndividual({
    givenNames: "Krystyna",
    surname1: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1968",
    birthDateValue: new Date("1968-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Kraków, Polonia",
  });
  await addToLineage(krystyna.id, lineageZawadzki.id);

  await prisma.familyChild.create({
    data: { familyId: familyBronislawMaria.id, individualId: henryk.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyBronislawJanina.id, individualId: krystyna.id, relationType: "BIOLOGICAL" },
  });

  const irena = await createIndividual({
    givenNames: "Irena",
    surname1: "Zawadzka",
    surname1BirthName: "Lewandowska",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1950",
    birthDateValue: new Date("1950-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Kraków, Polonia",
  });
  await addToLineage(irena.id, lineageZawadzki.id);
  await addToLineage(irena.id, lineageLewandowski.id);

  const wojciech = await createIndividual({
    givenNames: "Wojciech",
    surname1: "Nowak",
    sex: Sex.MALE,
    birthDateText: "hacia 1955",
    birthDateValue: new Date("1955-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Tarnów, Polonia",
  });
  await addToLineage(wojciech.id, lineageNowak.id);

  const familyHenrykIrena = await prisma.family.create({
    data: {
      partner1Id: henryk.id,
      partner2Id: irena.id,
      unionType: "MARRIAGE",
      unionDateText: "1970",
      unionDateValue: new Date("1970-01-01"),
      unionDatePrecision: DatePrecision.EXACT,
      unionPlace: "Kraków, Polonia",
    },
  });

  const familyKrystynaWojciech = await prisma.family.create({
    data: {
      partner1Id: krystyna.id,
      partner2Id: wojciech.id,
      unionType: "MARRIAGE",
      unionDateText: "hacia 1990",
      unionDatePrecision: DatePrecision.ABOUT,
      unionPlace: "Tarnów, Polonia",
    },
  });

  // --- Generation 3 ---
  const piotr = await createIndividual({
    givenNames: "Piotr",
    surname1: "Zawadzki",
    sex: Sex.MALE,
    birthDateText: "15 septiembre 1972",
    birthDateValue: new Date("1972-09-15"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });
  // Paternal AND maternal lineage at once — the clearest case of
  // non-exclusive membership.
  await addToLineage(piotr.id, lineageZawadzki.id);
  await addToLineage(piotr.id, lineageLewandowski.id);

  const anna = await createIndividual({
    givenNames: "Anna",
    surname1: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "28 febrero 1975",
    birthDateValue: new Date("1975-02-28"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });
  await addToLineage(anna.id, lineageZawadzki.id);
  await addToLineage(anna.id, lineageLewandowski.id);

  const barbara = await createIndividual({
    givenNames: "Barbara",
    surname1: "Nowak",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1991",
    birthDateValue: new Date("1991-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Tarnów, Polonia",
  });
  await addToLineage(barbara.id, lineageNowak.id);
  await addToLineage(barbara.id, lineageZawadzki.id);

  await prisma.familyChild.create({
    data: { familyId: familyHenrykIrena.id, individualId: piotr.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyHenrykIrena.id, individualId: anna.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyKrystynaWojciech.id, individualId: barbara.id, relationType: "BIOLOGICAL" },
  });

  const agnieszka = await createIndividual({
    givenNames: "Agnieszka",
    surname1: "Zawadzka",
    surname1BirthName: "Dąbrowska",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1974",
    birthDateValue: new Date("1974-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Kraków, Polonia",
  });
  await addToLineage(agnieszka.id, lineageZawadzki.id);
  await addToLineage(agnieszka.id, lineageDabrowski.id);

  // The reverse case: Marek takes his wife Anna's surname instead of the
  // other way around. Same `surname1BirthName` field, just applied to the
  // husband — the field is symmetric, not tied to sex.
  const marek = await createIndividual({
    givenNames: "Marek",
    surname1: "Zawadzki",
    surname1BirthName: "Kowalski",
    sex: Sex.MALE,
    birthDateText: "hacia 1973",
    birthDateValue: new Date("1973-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Warszawa, Polonia",
  });
  await addToLineage(marek.id, lineageZawadzki.id);
  await addToLineage(marek.id, lineageKowalski.id);

  const familyPiotrAgnieszka = await prisma.family.create({
    data: {
      partner1Id: piotr.id,
      partner2Id: agnieszka.id,
      unionType: "MARRIAGE",
      unionDateText: "1997",
      unionDateValue: new Date("1997-01-01"),
      unionDatePrecision: DatePrecision.EXACT,
      unionPlace: "Kraków, Polonia",
    },
  });

  const familyAnnaMarek = await prisma.family.create({
    data: {
      partner1Id: anna.id,
      partner2Id: marek.id,
      unionType: "MARRIAGE",
      unionDateText: "2000",
      unionDateValue: new Date("2000-01-01"),
      unionDatePrecision: DatePrecision.EXACT,
      unionPlace: "Warszawa, Polonia",
    },
  });

  // --- Generation 4 ---
  const tomasz = await createIndividual({
    givenNames: "Tomasz",
    surname1: "Zawadzki",
    sex: Sex.MALE,
    birthDateText: "1999",
    birthDateValue: new Date("1999-01-01"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });
  await addToLineage(tomasz.id, lineageZawadzki.id);
  await addToLineage(tomasz.id, lineageDabrowski.id);

  // No known partner — validates that individuals don't require a Family to exist.
  const karolina = await createIndividual({
    givenNames: "Karolina",
    surname1: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "2002",
    birthDateValue: new Date("2002-01-01"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });
  await addToLineage(karolina.id, lineageZawadzki.id);
  await addToLineage(karolina.id, lineageDabrowski.id);

  const julia = await createIndividual({
    givenNames: "Julia",
    surname1: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "2001",
    birthDateValue: new Date("2001-01-01"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Warszawa, Polonia",
  });
  await addToLineage(julia.id, lineageZawadzki.id);
  await addToLineage(julia.id, lineageKowalski.id);

  await prisma.familyChild.create({
    data: { familyId: familyPiotrAgnieszka.id, individualId: tomasz.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyPiotrAgnieszka.id, individualId: karolina.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyAnnaMarek.id, individualId: julia.id, relationType: "BIOLOGICAL" },
  });

  // Spanish double-surname in-law, married to Tomasz — validates surname2.
  const sofia = await createIndividual({
    givenNames: "Sofía",
    surname1: "García",
    surname2: "López",
    sex: Sex.FEMALE,
    birthDateText: "2000",
    birthDateValue: new Date("2000-01-01"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Madrid, España",
  });
  await addToLineage(sofia.id, lineageGarciaLopez.id);

  await prisma.family.create({
    data: {
      partner1Id: tomasz.id,
      partner2Id: sofia.id,
      unionType: "MARRIAGE",
      unionDateText: "2023",
      unionDateValue: new Date("2023-01-01"),
      unionDatePrecision: DatePrecision.EXACT,
      unionPlace: "Madrid, España",
    },
  });

  console.log("Seed completado: 15 individuos, 7 uniones familiares, 8 linajes.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
