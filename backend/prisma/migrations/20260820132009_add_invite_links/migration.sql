-- CreateTable
CREATE TABLE `tree_invite_links` (
    `id` VARCHAR(191) NOT NULL,
    `tree_id` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'EDITOR', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `created_by_user_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `max_uses` INTEGER NULL,

    INDEX `tree_invite_links_tree_id_idx`(`tree_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tree_invite_link_redemptions` (
    `id` VARCHAR(191) NOT NULL,
    `invite_link_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tree_invite_link_redemptions_user_id_idx`(`user_id`),
    UNIQUE INDEX `tree_invite_link_redemptions_invite_link_id_user_id_key`(`invite_link_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tree_invite_links` ADD CONSTRAINT `tree_invite_links_tree_id_fkey` FOREIGN KEY (`tree_id`) REFERENCES `trees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tree_invite_links` ADD CONSTRAINT `tree_invite_links_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tree_invite_link_redemptions` ADD CONSTRAINT `tree_invite_link_redemptions_invite_link_id_fkey` FOREIGN KEY (`invite_link_id`) REFERENCES `tree_invite_links`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tree_invite_link_redemptions` ADD CONSTRAINT `tree_invite_link_redemptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
