import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { S3StorageService } from './s3-storage.service';
import { VIDEO_STORAGE } from './storage.storage';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VIDEO_QUEUE_NAME } from './videos.constants';

@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
    ConfigModule.forFeature(storageConfig),
    TypeOrmModule.forFeature([Video, Channel]),
    BullModule.registerQueueAsync({
      name: VIDEO_QUEUE_NAME,
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: config.host,
          port: config.port,
          password: config.password,
        },
      }),
    }),
  ],
  controllers: [VideosController],
  providers: [
    VideosService,
    S3StorageService,
    { provide: VIDEO_STORAGE, useExisting: S3StorageService },
  ],
  exports: [VideosService, TypeOrmModule, VIDEO_STORAGE],
})
export class VideosModule {}
