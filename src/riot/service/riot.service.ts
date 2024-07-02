import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RiotAPI, PlatformId, RiotAPITypes } from '@fightmegg/riot-api';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RiotService {
  private rAPI: RiotAPI;
  private initialMatchId: string | null = 'KR_7132207284'; // 초기 matchId

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const riotApiKey = this.configService.get<string>('RIOT_API_KEY');
    this.rAPI = new RiotAPI(riotApiKey);
  }

  // controller - 경기 리스트 반환
  async getAllMatches(page: number, pageSize: number) {
    try {
      const skip = (page - 1) * pageSize; // 건너뛸 항목 수 계산
      const matches = await this.prisma.match.findMany({
        // 디비에 저장된 경기 조회
        skip: skip,
        take: pageSize,
        include: {
          participants: {
            select: {
              summonerPuuid: true, // 참가자의 소환사 PUUID만 조회
            },
          },
        },
      });

      // 경기 참가자 리스트 형태로 수정
      const matchList = matches.map((match) => ({
        matchId: match.matchId,
        dataVersion: match.dataVersion,
        participants: match.participants.map(
          (participant) => participant.summonerPuuid,
        ),
      }));

      return { matchList };
    } catch (error) {
      console.error('Error retrieving all matches:', error);
      throw new Error('Failed to retrieve matches');
    }
  }

  // controller - 소환사 정보 조회
  async getSummonerByPuuid(puuid: string) {
    try {
      const summoner = await this.prisma.summoner.findUnique({
        // puuid로 디비에 저장된 소환사 정보 조회
        where: { puuid },
      });

      if (!summoner) {
        throw new Error(`No summoner found with puuid: ${puuid}`);
      }

      return summoner;
    } catch (error) {
      console.error('Error retrieving summoner:', error);
      throw new Error('Failed to retrieve summoner');
    }
  }

  // controller - 경기에 참가한 소환사 조회
  async getSummonersByMatchId(matchId: string) {
    try {
      const participants = await this.prisma.participant.findMany({
        // matchId에 참가한 소환사 조회
        where: { matchId: matchId },
      });

      return { participants };
    } catch (error) {
      console.error('Error retrieving summoners by match ID:', error);
      throw new Error('Failed to retrieve summoners');
    }
  }

  // controller - 소환사의 최근 10개 매치 반환
  async getRecentMatchesByPuuid(puuid: string) {
    try {
      // 최근 10개 매치 가져오기
      const matchIds = await this.rAPI.matchV5.getIdsByPuuid({
        cluster: PlatformId.ASIA,
        puuid: puuid,
        params: { start: 0, count: 10 },
      });

      // 각 매치 ID에 대한 매치의 metadata 반환
      const matchMetadata = await Promise.all(
        matchIds.map(async (matchId) => {
          const match = await this.rAPI.matchV5.getMatchById({
            cluster: PlatformId.ASIA,
            matchId: matchId,
          });
          return match.metadata;
        }),
      );

      return { matches: matchMetadata };
    } catch (error) {
      console.error('Error retrieving recent matches:', error);
      throw new Error('Failed to retrieve recent matches');
    }
  }

  // 매분마다 실행되는 크론 작업
  @Cron('* * * * *')
  async fetchMatches() {
    try {
      // 초기 게임에 참여한 소환사들의 게임 정보 가져오기
      const matchDetails = await this.rAPI.matchV5.getMatchById({
        cluster: PlatformId.ASIA,
        matchId: this.initialMatchId,
      });

      // matchId를 저장할 리스트
      const allRecentGameIds = [];

      // 초기 게임에 참여한 소환사 10명에 대해 반복
      for (const participant of matchDetails.info.participants) {
        // 소환사의 최근 게임 2개 조회
        const recentGameIds = await this.fetchRecentGamesByPuuid(
          participant.puuid,
          2,
        );

        for (const recentGameId of recentGameIds) {
          // matchId 중복 체크
          const isAlreadySaved = await this.prisma.match.findUnique({
            where: { matchId: recentGameId },
          });

          if (!isAlreadySaved) {
            // matchId 리스트에 저장
            allRecentGameIds.push(recentGameId);
            // 게임 조회
            const participantDetails = await this.rAPI.matchV5.getMatchById({
              cluster: PlatformId.ASIA,
              matchId: recentGameId,
            });
            // 디비에 게임 정보 저장
            await this.saveGameDataAndParticipants(participantDetails);
          }
        }
      }

      // 조회한 매치 아이디 중 하나를 랜덤으로 초기 매치 아이디로 지정
      if (allRecentGameIds.length > 0) {
        const randomIndex = Math.floor(Math.random() * allRecentGameIds.length);
        this.initialMatchId = allRecentGameIds[randomIndex];
      }
    } catch (error) {
      console.error('Error fetching matches:', error);
    }
  }

  // 최근 게임 조회
  async fetchRecentGamesByPuuid(
    puuid: string,
    count: number,
  ): Promise<string[]> {
    const games = await this.rAPI.matchV5.getIdsByPuuid({
      cluster: PlatformId.ASIA,
      puuid: puuid,
      params: { start: 0, count: count },
    });
    return games;
  }

  async saveGameDataAndParticipants(
    gameDetails: RiotAPITypes.MatchV5.MatchDTO,
  ) {
    try {
      const { dataVersion, matchId } = gameDetails.metadata; // 메타데이터에서 매치 정보 추출
      const participants = gameDetails.info.participants; // 참가자 정보 추출

      // 경기 정보 match 테이블에 저장
      await this.prisma.match.upsert({
        where: { matchId: matchId },
        update: { dataVersion: dataVersion },
        create: {
          matchId: matchId,
          dataVersion: dataVersion,
        },
      });

      // 각 참가자를 Summoner 테이블에 저장
      for (const participant of participants) {
        const summoner = await this.prisma.summoner.upsert({
          where: { puuid: participant.puuid },
          update: {
            riotId: participant.summonerName,
            tagLine: participant.riotIdTagline,
          },
          create: {
            puuid: participant.puuid,
            riotId: participant.summonerName,
            tagLine: participant.riotIdTagline,
          },
        });

        // 매치와 소환사를 participant 테이블에 저장 (참여 기록)
        await this.prisma.participant.create({
          data: {
            matchId: matchId,
            summonerPuuid: summoner.puuid,
          },
        });
      }
      console.log(
        `Game data and participant information has been saved for match ID: ${matchId}.`,
      );
    } catch (error) {
      console.error(
        'Error occurred while saving game data and participant information:',
        error,
      );
    }
  }
}
