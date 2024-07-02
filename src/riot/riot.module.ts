import { Module } from '@nestjs/common';
import { RiotController } from './controller/riot.controller';
import { RiotService } from './service/riot.service';

@Module({
  controllers: [RiotController],
  providers: [RiotService],
})
export class RiotModule {}
