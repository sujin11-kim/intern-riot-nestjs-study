import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RiotAPI, PlatformId } from '@fightmegg/riot-api';

@Injectable()
export class RiotService {
  private readonly RIOT_API_KEY = 'RGAPI-3eac3794-a86d-42c0-a59e-3df119f0c5e8';
  private rAPI = new RiotAPI(this.RIOT_API_KEY);
  private initialSummonerGameId: string | null = null; // 초기 소환사의 matchId
  private initialSummonerPuuid: string | null = null; // 매분마다 갱신될 초기 소환사

  constructor() {}

  // 모듈이 초기화될 때 자동으로 실행, 초기 소환사 지정
  async onModuleInit() {
    await this.updateInitialSummoner('hide on bush', 'KR1');
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
        const puuid = participant.puuid;
        const recentGameId = await this.fetchRecentGameIdByPuuid(puuid);
        console.log(
          `Recent game for ${participant.summonerName}: ${recentGameId}`,
        );

        if (recentGameId) {
          // 참여한 소환사들의 최근 게임의 10명의 참여자들 게임 가져오기
          const participantDetails = await this.rAPI.matchV5.getMatchById({
            cluster: PlatformId.ASIA,
            matchId: recentGameId,
          });
          participantDetails.info.participants.forEach(async (p) => {
            const subRecentGameId = await this.fetchRecentGameIdByPuuid(
              p.puuid,
            );

            if (subRecentGameId) {
              // 게임의 정보 가져오기
              const gameDetails = await this.rAPI.matchV5.getMatchById({
                cluster: PlatformId.ASIA,
                matchId: subRecentGameId,
              });
              console.log(
                `Subsequent game details for ${p.summonerName}:`,
                gameDetails,
              );
            } else {
              console.log(`No recent game found for ${p.summonerName}`);
            }
          });
        }
      }
      const randomParticipant =
        matchDetails.info.participants[
          Math.floor(Math.random() * matchDetails.info.participants.length)
        ];
      await this.updateInitialSummoner(randomParticipant.summonerName, 'KR1');
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
}
