-- CreateTable
CREATE TABLE `person_media` (
    `id` VARCHAR(191) NOT NULL,
    `tree_id` VARCHAR(191) NOT NULL,
    `individual_id` VARCHAR(191) NOT NULL,
    `type` ENUM('PHOTO', 'DOCUMENT') NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `person_media_individual_id_idx`(`individual_id`),
    INDEX `person_media_tree_id_idx`(`tree_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `person_media` ADD CONSTRAINT `person_media_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `person_media` ADD CONSTRAINT `person_media_individual_id_fkey` FOREIGN KEY (`individual_id`) REFERENCES `individuals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

