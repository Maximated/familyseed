-- DropIndex
DROP INDEX `families_gedcom_xref_key` ON `families`;

-- DropIndex
DROP INDEX `individuals_apellido_1_given_names_idx` ON `individuals`;

-- DropIndex
DROP INDEX `individuals_gedcom_xref_key` ON `individuals`;

-- AlterTable
ALTER TABLE `families` ADD COLUMN `tree_id` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `individuals` ADD COLUMN `tree_id` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `lineages` ADD COLUMN `tree_id` VARCHAR(191) NOT NULL;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `google_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_google_id_key`(`google_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trees` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tree_members` (
    `id` VARCHAR(191) NOT NULL,
    `tree_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'EDITOR', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tree_members_user_id_idx`(`user_id`),
    UNIQUE INDEX `tree_members_tree_id_user_id_key`(`tree_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_log_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tree_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `change_log_entries_tree_id_created_at_idx`(`tree_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `families_tree_id_gedcom_xref_key` ON `families`(`tree_id`, `gedcom_xref`);

-- CreateIndex
CREATE INDEX `individuals_tree_id_apellido_1_given_names_idx` ON `individuals`(`tree_id`, `apellido_1`, `given_names`);

-- CreateIndex
CREATE UNIQUE INDEX `individuals_tree_id_gedcom_xref_key` ON `individuals`(`tree_id`, `gedcom_xref`);

-- CreateIndex
CREATE INDEX `lineages_tree_id_idx` ON `lineages`(`tree_id`);

-- AddForeignKey
ALTER TABLE `tree_members` ADD CONSTRAINT `tree_members_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tree_members` ADD CONSTRAINT `tree_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_log_entries` ADD CONSTRAINT `change_log_entries_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_log_entries` ADD CONSTRAINT `change_log_entries_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `individuals` ADD CONSTRAINT `individuals_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lineages` ADD CONSTRAINT `lineages_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `families` ADD CONSTRAINT `families_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

