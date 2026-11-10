import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VIDEO_STORAGE } from './storage.storage';
import { VIDEO_QUEUE_NAME } from './videos.constants';
import { VideosService } from './videos.service';

describe('VideosService completion (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let queue: Queue;
  let videos: Repository<Video>;
  let video: Video;
  let user: User;
  const dto = { parts: [{ part_number: 1, etag: '"etag"' }] };
  const storage = {
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    headObject: jest.fn().mockResolvedValue({ contentLength: 1024 }),
  };

  beforeAll(async () => {
    const config = queueConfig();
    queue = new Queue(`${VIDEO_QUEUE_NAME}-test-${randomUUID()}`, {
      connection: {
        host: config.host,
        port: config.port,
        password: config.password,
      },
    });
    await queue.waitUntilReady();
    const entities = [User, Channel, Video, RefreshToken, VerificationToken];
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(entities).options),
        TypeOrmModule.forFeature([Video, Channel]),
      ],
      providers: [
        VideosService,
        { provide: VIDEO_STORAGE, useValue: storage },
        { provide: getQueueToken(VIDEO_QUEUE_NAME), useValue: queue },
      ],
    }).compile();
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
    videos = dataSource.getRepository(Video);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await cleanAllTables(dataSource);
    await queue.drain();
    user = await dataSource.getRepository(User).save({
      email: `queue-${randomUUID()}@example.com`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      user_id: user.id,
      name: 'Queue regression',
      nickname: randomUUID(),
    });
    video = await videos.save({
      channel_id: channel.id,
      public_key: randomUUID(),
      title: 'Queue regression',
      source_key: 'videos/queue-regression/source',
      upload_id: 'upload-id',
      size_bytes: '1024',
      mime_type: 'video/mp4',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await cleanAllTables(dataSource);
    if (module) await module.close();
    if (queue) {
      try {
        await queue.obliterate();
      } finally {
        await queue.close();
      }
    }
  });

  it('enqueues a BullMQ-valid deterministic job and preserves it on repeated completion', async () => {
    const owner = { sub: user.id, email: user.email };

    await expect(
      service.completeUpload(owner, video.id, dto),
    ).resolves.toEqual({ id: video.id, status: 'PROCESSING' });
    await expect(
      service.completeUpload(owner, video.id, dto),
    ).resolves.toEqual({ id: video.id, status: 'PROCESSING' });

    const job = await queue.getJob(`video-${video.id}`);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId: video.id });
    expect(job?.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
    expect(await queue.getJobCounts('wait')).toMatchObject({ wait: 1 });
    expect(await videos.findOneByOrFail({ id: video.id })).toMatchObject({
      status: 'PROCESSING',
      upload_id: null,
    });
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('recovers the persisted PROCESSING state after enqueue rejection', async () => {
    const enqueueError = new Error('Queue temporarily unavailable');
    jest.spyOn(queue, 'add').mockRejectedValueOnce(enqueueError);
    const owner = { sub: user.id, email: user.email };

    await expect(service.completeUpload(owner, video.id, dto)).rejects.toBe(
      enqueueError,
    );
    expect(await videos.findOneByOrFail({ id: video.id })).toMatchObject({
      status: 'PROCESSING',
      upload_id: null,
    });
    expect(await queue.getJob(`video-${video.id}`)).toBeUndefined();

    await expect(
      service.completeUpload(owner, video.id, dto),
    ).resolves.toEqual({ id: video.id, status: 'PROCESSING' });
    expect(await queue.getJob(`video-${video.id}`)).toBeDefined();
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent recovery calls through the real Redis queue', async () => {
    await videos.update(video.id, { status: 'PROCESSING', upload_id: null });
    const owner = { sub: user.id, email: user.email };

    const results = await Promise.all([
      service.completeUpload(owner, video.id, dto),
      service.completeUpload(owner, video.id, dto),
    ]);

    expect(results).toEqual([
      { id: video.id, status: 'PROCESSING' },
      { id: video.id, status: 'PROCESSING' },
    ]);
    expect(await queue.getJobCounts('wait')).toMatchObject({ wait: 1 });
    expect(await queue.getJob(`video-${video.id}`)).toBeDefined();
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });
});
