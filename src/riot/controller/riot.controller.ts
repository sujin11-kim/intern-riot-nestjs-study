import { Controller, Get } from '@nestjs/common';
import { RiotService } from '../service/riot.service';

@Controller('riot')
export class RiotController {
  constructor(private readonly riotService: RiotService) {}

  @Get('/matches')
  async getAllMatches() {
    return this.riotService.getAllMatches();
  }
}
