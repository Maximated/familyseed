-- AlterTable
ALTER TABLE `individuals` ADD COLUMN `origin_individual_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `individuals_origin_individual_id_idx` ON `individuals`(`origin_individual_id`);

-- AddForeignKey
ALTER TABLE `individuals` ADD CONSTRAINT `individuals_origin_individual_id_fkey` FOREIGN KEY (`origin_individual_id`) REFERENCES `individuals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
