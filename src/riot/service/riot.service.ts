import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RiotAPI, PlatformId, RiotAPITypes } from '@fightmegg/riot-api';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RiotService {
  private rAPI: RiotAPI;
  private initialSummonerGameId: string | null = null; // 초기 소환사의 matchId
  private initialSummonerPuuid: string | null = null; // 매분마다 갱신될 초기 소환사

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

  // 모듈이 초기화될 때 자동으로 실행, 초기 소환사 지정
  async onModuleInit() {
    try {
      await this.updateInitialSummoner('hide on bush', 'KR1');
    } catch (error) {
      console.error('Failed to initialize summoner:', error);
    }
  }

  // 초기 소환사의 최근 matchId 업데이트
  async updateInitialSummoner(gameName: string, tagLine: string) {
    // 초기 소환사 정보 가져오기
    const summonerInfo = await this.rAPI.account.getByRiotId({
      region: PlatformId.ASIA,
      gameName: gameName,
      tagLine: tagLine,
    });
    this.initialSummonerPuuid = summonerInfo.puuid;
    // 해당 소환사의 최근 게임 목록 조회
    const recentGames = await this.rAPI.matchV5.getIdsByPuuid({
      cluster: PlatformId.ASIA,
      puuid: this.initialSummonerPuuid,
      params: { start: 0, count: 1 },
    });
    // 초기 게임 지정
    this.initialSummonerGameId = recentGames[0];
    console.log(
      'Updated Initial Game and Summoner:',
      this.initialSummonerGameId,
      this.initialSummonerPuuid,
    );
  }

  // 매분마다 실행되는 크론 작업
  @Cron('* * * * *')
  async fetchMatches() {
    if (!this.initialSummonerGameId) {
      console.log('Initial game ID not set.');
      return;
    }

    try {
      // 초기 게임에서 참여한 소환사들의 게임 정보 가져오기
      const matchDetails = await this.rAPI.matchV5.getMatchById({
        cluster: PlatformId.ASIA,
        matchId: this.initialSummonerGameId,
      });

      // 해당 게임에 참여한 1~10명의 소환사의 최근 게임 정보 조회
      for (const participant of matchDetails.info.participants.slice(0, 2)) {
        const recentGameId = await this.fetchRecentGameIdByPuuid(
          participant.puuid,
        );
        console.log(
          `Recent game for ${participant.summonerName}: ${recentGameId}`,
        );

        if (recentGameId) {
          const participantDetails = await this.rAPI.matchV5.getMatchById({
            cluster: PlatformId.ASIA,
            matchId: recentGameId,
          });

          // 해당 참가자의 최근 게임의 모든 참가자들의 최근 게임을 조회하여 저장
          for (const subParticipant of participantDetails.info.participants) {
            const subRecentGameId = await this.fetchRecentGameIdByPuuid(
              subParticipant.puuid,
            );
            if (subRecentGameId) {
              const subParticipantDetails =
                await this.rAPI.matchV5.getMatchById({
                  cluster: PlatformId.ASIA,
                  matchId: subRecentGameId,
                });
              await this.saveGameDataAndParticipants(subParticipantDetails);
            }
          }
        }
      }
      const randomParticipant =
        matchDetails.info.participants[
          Math.floor(Math.random() * matchDetails.info.participants.length)
        ];
      await this.updateInitialSummoner(
        randomParticipant.summonerName,
        randomParticipant.riotIdTagline,
      );
    } catch (error) {
      console.error('Error fetching matches:', error);
    }
  }

  async fetchRecentGameIdByPuuid(puuid: string): Promise<string | null> {
    const games = await this.rAPI.matchV5.getIdsByPuuid({
      cluster: PlatformId.ASIA,
      puuid: puuid,
      params: { start: 0, count: 1 },
    });
    return games[0]; // 가장 최근 게임 ID 반환
  }

  async saveGameDataAndParticipants(
    gameDetails: RiotAPITypes.MatchV5.MatchDTO,
  ) {
    try {
      const { dataVersion, matchId } = gameDetails.metadata; // 메타데이터에서 매치 정보 추출
      const participants = gameDetails.info.participants; // 참가자 정보 추출

      // 매치 레코드 생성 또는 업데이트
      await this.prisma.match.upsert({
        where: { matchId: matchId },
        update: { dataVersion: dataVersion },
        create: {
          matchId: matchId,
          dataVersion: dataVersion,
        },
      });

      // 각 참가자에 대한 Summoner 레코드 관리
      for (const participant of participants) {
        // 각 참가자의 Summoner 레코드 생성 또는 업데이트
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

        // 매치와 소환사를 연결하는 참가자 항목 생성
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
