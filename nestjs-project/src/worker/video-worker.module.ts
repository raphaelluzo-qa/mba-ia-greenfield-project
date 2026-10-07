import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { Video } from '../videos/entities/video.entity';
import { S3StorageService } from '../videos/s3-storage.service';
import { VIDEO_STORAGE } from '../videos/storage.storage';
import { VIDEO_QUEUE_NAME } from '../videos/videos.constants';
import { VideoProcessorService } from './video-processor.service';
import { VideoWorkerProcessor } from './video-worker.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [queueConfig, storageConfig],
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'db',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'streamtube',
      password: process.env.DB_PASSWORD ?? 'streamtube',
      database: process.env.DB_NAME ?? 'streamtube',
      autoLoadEntities: true,
      synchronize: false,
    }),
    TypeOrmModule.forFeature([Video, Channel]),
    BullModule.registerQueueAsync({
      name: VIDEO_QUEUE_NAME,
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
  providers: [
    S3StorageService,
    { provide: VIDEO_STORAGE, useExisting: S3StorageService },
    VideoProcessorService,
    VideoWorkerProcessor,
  ],
})
export class VideoWorkerModule {}
