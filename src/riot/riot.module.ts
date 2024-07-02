import { Module } from '@nestjs/common';
import { RiotController } from './controller/riot.controller';
import { RiotService } from './service/riot.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [RiotController],
  providers: [RiotService, PrismaService],
})
export class RiotModule {}
