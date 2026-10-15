-- AlterTable
ALTER TABLE `individuals` ADD COLUMN `birth_place_lat` DOUBLE NULL,
    ADD COLUMN `birth_place_lng` DOUBLE NULL,
    ADD COLUMN `death_place_lat` DOUBLE NULL,
    ADD COLUMN `death_place_lng` DOUBLE NULL;

-- AlterTable
ALTER TABLE `families` ADD COLUMN `union_place_lat` DOUBLE NULL,
    ADD COLUMN `union_place_lng` DOUBLE NULL;
