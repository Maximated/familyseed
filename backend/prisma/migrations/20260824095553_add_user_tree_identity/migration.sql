-- CreateTable
CREATE TABLE `user_tree_identities` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `tree_id` VARCHAR(191) NOT NULL,
    `individual_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `user_tree_identities_tree_id_idx`(`tree_id`),
    INDEX `user_tree_identities_individual_id_idx`(`individual_id`),
    UNIQUE INDEX `user_tree_identities_user_id_tree_id_key`(`user_id`, `tree_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_tree_identities` ADD CONSTRAINT `user_tree_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_tree_identities` ADD CONSTRAINT `user_tree_identities_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_tree_identities` ADD CONSTRAINT `user_tree_identities_individual_id_fkey` FOREIGN KEY (`individual_id`) REFERENCES `individuals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
