/*
  Warnings:

  - The primary key for the `match` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE `participant` DROP FOREIGN KEY `Participant_matchId_fkey`;

-- AlterTable
ALTER TABLE `match` DROP PRIMARY KEY,
    MODIFY `matchId` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`matchId`);

-- AlterTable
ALTER TABLE `participant` MODIFY `matchId` VARCHAR(191) NOT NULL;

-- AddForeignKey
ALTER TABLE `Participant` ADD CONSTRAINT `Participant_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`matchId`) ON DELETE RESTRICT ON UPDATE CASCADE;
