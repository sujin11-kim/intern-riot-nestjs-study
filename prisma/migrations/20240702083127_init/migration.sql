-- CreateTable
CREATE TABLE `Match` (
    `matchId` INTEGER NOT NULL,
    `dataVersion` VARCHAR(191) NULL,

    PRIMARY KEY (`matchId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Summoner` (
    `puuid` VARCHAR(191) NOT NULL,
    `riotId` VARCHAR(191) NOT NULL,
    `tagLine` VARCHAR(191) NULL,

    PRIMARY KEY (`puuid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Participant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matchId` INTEGER NOT NULL,
    `summonerPuuid` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Participant` ADD CONSTRAINT `Participant_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`matchId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Participant` ADD CONSTRAINT `Participant_summonerPuuid_fkey` FOREIGN KEY (`summonerPuuid`) REFERENCES `Summoner`(`puuid`) ON DELETE RESTRICT ON UPDATE CASCADE;
