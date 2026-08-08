-- CreateTable
CREATE TABLE `individuals` (
    `id` VARCHAR(191) NOT NULL,
    `given_names` VARCHAR(191) NOT NULL,
    `surname` VARCHAR(191) NOT NULL,
    `birth_surname` VARCHAR(191) NULL,
    `sex` ENUM('MALE', 'FEMALE', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `birth_date_text` VARCHAR(191) NULL,
    `birth_date_value` DATETIME(3) NULL,
    `birth_date_precision` ENUM('EXACT', 'ABOUT', 'BEFORE', 'AFTER', 'UNKNOWN') NULL,
    `birth_place` VARCHAR(191) NULL,
    `death_date_text` VARCHAR(191) NULL,
    `death_date_value` DATETIME(3) NULL,
    `death_date_precision` ENUM('EXACT', 'ABOUT', 'BEFORE', 'AFTER', 'UNKNOWN') NULL,
    `death_place` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `photo_url` VARCHAR(191) NULL,
    `gedcom_xref` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `individuals_gedcom_xref_key`(`gedcom_xref`),
    INDEX `individuals_surname_given_names_idx`(`surname`, `given_names`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `families` (
    `id` VARCHAR(191) NOT NULL,
    `partner1_id` VARCHAR(191) NULL,
    `partner2_id` VARCHAR(191) NULL,
    `union_type` ENUM('MARRIAGE', 'PARTNERSHIP', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `union_date_text` VARCHAR(191) NULL,
    `union_date_value` DATETIME(3) NULL,
    `union_date_precision` ENUM('EXACT', 'ABOUT', 'BEFORE', 'AFTER', 'UNKNOWN') NULL,
    `union_place` VARCHAR(191) NULL,
    `gedcom_xref` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `families_gedcom_xref_key`(`gedcom_xref`),
    INDEX `families_partner1_id_idx`(`partner1_id`),
    INDEX `families_partner2_id_idx`(`partner2_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `family_children` (
    `id` VARCHAR(191) NOT NULL,
    `family_id` VARCHAR(191) NOT NULL,
    `individual_id` VARCHAR(191) NOT NULL,
    `relation_type` ENUM('BIOLOGICAL', 'ADOPTED', 'FOSTER', 'STEP', 'UNKNOWN') NOT NULL DEFAULT 'BIOLOGICAL',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `family_children_individual_id_idx`(`individual_id`),
    UNIQUE INDEX `family_children_family_id_individual_id_key`(`family_id`, `individual_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `families` ADD CONSTRAINT `families_partner1_id_fkey` FOREIGN KEY (`partner1_id`) REFERENCES `individuals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `families` ADD CONSTRAINT `families_partner2_id_fkey` FOREIGN KEY (`partner2_id`) REFERENCES `individuals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_children` ADD CONSTRAINT `family_children_family_id_fkey` FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_children` ADD CONSTRAINT `family_children_individual_id_fkey` FOREIGN KEY (`individual_id`) REFERENCES `individuals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
