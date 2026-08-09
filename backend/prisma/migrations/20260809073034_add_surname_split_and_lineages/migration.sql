/*
  Warnings:

  - You are about to drop the column `birth_surname` on the `individuals` table. All the data in the column will be lost.
  - You are about to drop the column `surname` on the `individuals` table. All the data in the column will be lost.
  - Added the required column `apellido_1` to the `individuals` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `individuals_surname_given_names_idx` ON `individuals`;

-- AlterTable
ALTER TABLE `individuals` DROP COLUMN `birth_surname`,
    DROP COLUMN `surname`,
    ADD COLUMN `apellido_1` VARCHAR(191) NOT NULL,
    ADD COLUMN `apellido_1_nacimiento` VARCHAR(191) NULL,
    ADD COLUMN `apellido_2` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `lineages` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `individual_lineages` (
    `id` VARCHAR(191) NOT NULL,
    `individual_id` VARCHAR(191) NOT NULL,
    `lineage_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `individual_lineages_lineage_id_idx`(`lineage_id`),
    UNIQUE INDEX `individual_lineages_individual_id_lineage_id_key`(`individual_id`, `lineage_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `individuals_apellido_1_given_names_idx` ON `individuals`(`apellido_1`, `given_names`);

-- AddForeignKey
ALTER TABLE `individual_lineages` ADD CONSTRAINT `individual_lineages_individual_id_fkey` FOREIGN KEY (`individual_id`) REFERENCES `individuals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `individual_lineages` ADD CONSTRAINT `individual_lineages_lineage_id_fkey` FOREIGN KEY (`lineage_id`) REFERENCES `lineages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
