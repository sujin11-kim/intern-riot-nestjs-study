import { Controller, Get, Param, Query } from '@nestjs/common';
import { RiotService } from '../service/riot.service';

@Controller('riot')
export class RiotController {
  constructor(private readonly riotService: RiotService) {}

  // controller - 경기 리스트 반환
  @Get('/matches')
  async getAllMatches(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '10',
  ) {
    const pageNumber = parseInt(page, 10);
    const pageSizeNumber = parseInt(pageSize, 10);
    return this.riotService.getAllMatches(pageNumber, pageSizeNumber);
  }

  // controller - 경기에 참가한 소환사 조회
  @Get('/matches/:matchId/summoners')
  async getSummonersByMatchId(@Param('matchId') matchId: string) {
    return this.riotService.getSummonersByMatchId(matchId);
  }

  // controller - 소환사 정보 조회
  @Get('summoner')
  async getSummonerByPuuid(@Query('puuid') puuid: string) {
    return await this.riotService.getSummonerByPuuid(puuid);
  }

  // 소환사의 최근 10개 매치 반환
  @Get('recent-matches')
  async getRecentMatchesByPuuid(@Query('puuid') puuid: string) {
    return await this.riotService.getRecentMatchesByPuuid(puuid);
  }
}
