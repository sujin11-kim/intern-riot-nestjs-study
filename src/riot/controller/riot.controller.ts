import { Controller, Get, Param, Query } from '@nestjs/common';
import { RiotService } from '../service/riot.service';

@Controller('riot')
export class RiotController {
  constructor(private readonly riotService: RiotService) {}

  @Get('/matches')
  async getAllMatches() {
    return this.riotService.getAllMatches();
  }

  @Get('/matches/:matchId/summoners')
  async getSummonersByMatchId(@Param('matchId') matchId: string) {
    return this.riotService.getSummonersByMatchId(matchId);
  }

  @Get('summoner')
  async getSummonerByPuuid(@Query('puuid') puuid: string) {
    return await this.riotService.getSummonerByPuuid(puuid);
  }
}
