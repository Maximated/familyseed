-- Upload URLs/filenames used to be VARCHAR(191) (Prisma's MySQL default), which a
-- long original filename (e.g. a Wikimedia Commons download) overflowed — the file
-- was written to disk but the row update failed, so the photo silently never
-- appeared. Widened here alongside the new titles table.

-- AlterTable
ALTER TABLE `individuals` ADD COLUMN `has_titles` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `photo_url` VARCHAR(512) NULL;

-- AlterTable
ALTER TABLE `person_media` MODIFY `url` VARCHAR(512) NOT NULL,
    MODIFY `filename` VARCHAR(512) NOT NULL;

-- AlterTable
ALTER TABLE `family_media` MODIFY `url` VARCHAR(512) NOT NULL,
    MODIFY `filename` VARCHAR(512) NOT NULL;

-- CreateTable
CREATE TABLE `person_titles` (
    `id` VARCHAR(191) NOT NULL,
    `individual_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `ordinal` VARCHAR(191) NULL,
    `domain` VARCHAR(191) NULL,
    `from_text` VARCHAR(191) NULL,
    `to_text` VARCHAR(191) NULL,
    `consort` BOOLEAN NOT NULL DEFAULT false,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `person_titles_individual_id_idx`(`individual_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `person_titles` ADD CONSTRAINT `person_titles_individual_id_fkey` FOREIGN KEY (`individual_id`) REFERENCES `individuals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

