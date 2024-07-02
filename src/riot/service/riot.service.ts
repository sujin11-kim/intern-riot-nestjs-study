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
  async getAllMatches() {
    try {
      const matches = await this.prisma.match.findMany({
        select: { matchId: true }, // 오직 matchId만 선택하여 가져옵니다.
      });

      const matchIds = matches.map((match) => match.matchId); // matchId만 추출합니다.

      return { matchIds }; // 'match' 키를 사용하여 matchId 리스트를 반환합니다.
    } catch (error) {
      console.error('Error retrieving all matches:', error);
      throw new Error('Failed to retrieve matches');
    }
  }

  async getSummonersByMatchId(matchId: string) {
    try {
      const participants = await this.prisma.participant.findMany({
        where: { matchId: matchId },
      });

      return { participants }; // 'summoners' 키로 puuid 리스트 반환
    } catch (error) {
      console.error('Error retrieving summoners by match ID:', error);
      throw new Error('Failed to retrieve summoners');
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
        `게임 데이터 및 참가자 정보가 match ID: ${matchId}에 대해 저장되었습니다.`,
      );
    } catch (error) {
      console.error('게임 데이터 및 참가자 정보 저장 중 오류 발생:', error);
    }
  }
}
