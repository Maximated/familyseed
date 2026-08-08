import { PrismaClient, Sex, DatePrecision } from "@prisma/client";

const prisma = new PrismaClient();

// Fictional 4-generation Polish family, used to validate the schema against
// real-world cases: a second union after widowhood (half-siblings), a
// cousin branch, a husband taking his wife's surname (the reverse of the
// usual case), and individuals without a known partner.

type IndividualInput = {
  givenNames: string;
  surname: string;
  birthSurname?: string;
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

async function main() {
  // --- Generation 1 ---
  const bronislaw = await createIndividual({
    givenNames: "Bronisław",
    surname: "Zawadzki",
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

  const maria = await createIndividual({
    givenNames: "Maria",
    surname: "Zawadzka",
    birthSurname: "Kaczmarek",
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

  // Bronisław remarries after Maria's death — second union.
  const janina = await createIndividual({
    givenNames: "Janina",
    surname: "Zawadzka",
    birthSurname: "Sikora",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1935",
    birthDateValue: new Date("1935-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Tarnów, Polonia",
  });

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
    surname: "Zawadzki",
    sex: Sex.MALE,
    birthDateText: "20 junio 1948",
    birthDateValue: new Date("1948-06-20"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });

  // Half-sister to Henryk: child of Bronisław's second union.
  const krystyna = await createIndividual({
    givenNames: "Krystyna",
    surname: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1968",
    birthDateValue: new Date("1968-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Kraków, Polonia",
  });

  await prisma.familyChild.create({
    data: { familyId: familyBronislawMaria.id, individualId: henryk.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyBronislawJanina.id, individualId: krystyna.id, relationType: "BIOLOGICAL" },
  });

  const irena = await createIndividual({
    givenNames: "Irena",
    surname: "Zawadzka",
    birthSurname: "Lewandowska",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1950",
    birthDateValue: new Date("1950-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Kraków, Polonia",
  });

  const wojciech = await createIndividual({
    givenNames: "Wojciech",
    surname: "Nowak",
    sex: Sex.MALE,
    birthDateText: "hacia 1955",
    birthDateValue: new Date("1955-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Tarnów, Polonia",
  });

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
    surname: "Zawadzki",
    sex: Sex.MALE,
    birthDateText: "15 septiembre 1972",
    birthDateValue: new Date("1972-09-15"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });

  const anna = await createIndividual({
    givenNames: "Anna",
    surname: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "28 febrero 1975",
    birthDateValue: new Date("1975-02-28"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });

  const barbara = await createIndividual({
    givenNames: "Barbara",
    surname: "Nowak",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1991",
    birthDateValue: new Date("1991-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Tarnów, Polonia",
  });

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
    surname: "Zawadzka",
    birthSurname: "Dąbrowska",
    sex: Sex.FEMALE,
    birthDateText: "hacia 1974",
    birthDateValue: new Date("1974-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Kraków, Polonia",
  });

  // The reverse case: Marek takes his wife Anna's surname instead of the
  // other way around. Same `birthSurname` field, just applied to the husband.
  const marek = await createIndividual({
    givenNames: "Marek",
    surname: "Zawadzki",
    birthSurname: "Kowalski",
    sex: Sex.MALE,
    birthDateText: "hacia 1973",
    birthDateValue: new Date("1973-01-01"),
    birthDatePrecision: DatePrecision.ABOUT,
    birthPlace: "Warszawa, Polonia",
  });

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
    surname: "Zawadzki",
    sex: Sex.MALE,
    birthDateText: "1999",
    birthDateValue: new Date("1999-01-01"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });

  // No known partner — validates that individuals don't require a Family to exist.
  const karolina = await createIndividual({
    givenNames: "Karolina",
    surname: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "2002",
    birthDateValue: new Date("2002-01-01"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Kraków, Polonia",
  });

  const julia = await createIndividual({
    givenNames: "Julia",
    surname: "Zawadzka",
    sex: Sex.FEMALE,
    birthDateText: "2001",
    birthDateValue: new Date("2001-01-01"),
    birthDatePrecision: DatePrecision.EXACT,
    birthPlace: "Warszawa, Polonia",
  });

  await prisma.familyChild.create({
    data: { familyId: familyPiotrAgnieszka.id, individualId: tomasz.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyPiotrAgnieszka.id, individualId: karolina.id, relationType: "BIOLOGICAL" },
  });
  await prisma.familyChild.create({
    data: { familyId: familyAnnaMarek.id, individualId: julia.id, relationType: "BIOLOGICAL" },
  });

  console.log("Seed completado: 14 individuos, 6 uniones familiares.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
