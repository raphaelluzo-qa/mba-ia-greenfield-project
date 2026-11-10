import { getQueueToken } from '@nestjs/bullmq';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import queueConfig from '../src/config/queue.config';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import {
  VIDEO_STORAGE,
  type VideoStorage,
} from '../src/videos/storage.storage';
import { VIDEO_QUEUE_NAME } from '../src/videos/videos.constants';
import { VideosModule } from '../src/videos/videos.module';
import {
  VideoProcessorService,
  type ProcessVideoJob,
} from '../src/worker/video-processor.service';

describe('Videos API (e2e)', () => {
  let app: INestApplication<App>;
  let queue: Queue;

  beforeAll(async () => {
    const config = queueConfig();
    queue = new Queue(`${VIDEO_QUEUE_NAME}-e2e-${randomUUID()}`, {
      connection: {
        host: config.host,
        port: config.port,
        password: config.password,
      },
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, VideosModule],
      providers: [VideoProcessorService],
    })
      .overrideProvider(getQueueToken(VIDEO_QUEUE_NAME))
      .useValue(queue)
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
  });

  afterAll(async () => {
    if (queue) {
      try {
        await queue.obliterate();
      } finally {
        await queue.close();
      }
    }
    if (app) await app.close();
  });

  it('requires authentication to create a draft', async () => {
    await request(app.getHttpServer())
      .post('/videos/drafts')
      .send({
        channel_id: '00000000-0000-0000-0000-000000000000',
        title: 'Demo',
        size_bytes: 1024,
        mime_type: 'video/mp4',
      })
      .expect(401);
  });

  it('returns a standardized not-found error for an unknown public video', async () => {
    const response = await request(app.getHttpServer())
      .get('/videos/unknown-public-key/stream')
      .expect(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'VIDEO_NOT_FOUND',
    });
  });

  it('uploads a small video, completes with 202 and consumes the real job to READY', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'streamtube-upload-e2e-'));
    const dataSource = app.get(DataSource);
    const storage = app.get<VideoStorage>(VIDEO_STORAGE);
    const users = dataSource.getRepository(User);
    const channels = dataSource.getRepository(Channel);
    const videos = dataSource.getRepository(Video);
    const config = queueConfig();
    const connection = {
      host: config.host,
      port: config.port,
      password: config.password,
    };
    const events = new QueueEvents(queue.name, { connection });
    let worker: Worker<ProcessVideoJob> | undefined;
    let owner: User | undefined;
    let channel: Channel | undefined;
    let video: Video | undefined;
    try {
      await events.waitUntilReady();
      const sourcePath = join(directory, 'sample.mp4');
      await promisify(execFile)(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=blue:s=160x90:r=10',
          '-t',
          '2',
          '-c:v',
          'mpeg4',
          sourcePath,
        ],
        { timeout: 10_000 },
      );
      const source = await readFile(sourcePath);
      owner = await users.save({
        email: `upload-${randomUUID()}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      });
      channel = await channels.save({
        user_id: owner.id,
        name: 'Upload regression',
        nickname: randomUUID(),
      });
      const token = await app.get(JwtService).signAsync({
        sub: owner.id,
        email: owner.email,
      });
      const draftResponse = await request(app.getHttpServer())
        .post('/videos/drafts')
        .auth(token, { type: 'bearer' })
        .send({
          channel_id: channel.id,
          title: 'Small upload regression',
          size_bytes: source.length,
          mime_type: 'video/mp4',
        })
        .expect(201);
      const draft = draftResponse.body as {
        id: string;
        urls: Array<{ partNumber: number; url: string }>;
      };
      video = await videos.findOneByOrFail({ id: draft.id });
      const upload = await fetch(draft.urls[0].url, {
        method: 'PUT',
        body: new Uint8Array(source),
      });
      expect(upload.ok).toBe(true);
      const etag = upload.headers.get('etag');
      expect(etag).not.toBeNull();
      const complete = { parts: [{ part_number: 1, etag }] };

      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request(app.getHttpServer())
          .post(`/videos/${draft.id}/complete`)
          .auth(token, { type: 'bearer' })
          .send(complete)
          .expect(202);
        expect(response.body).toEqual({ id: draft.id, status: 'PROCESSING' });
      }
      const job = await queue.getJob(`video-${draft.id}`);
      expect(job).toBeDefined();
      expect(await queue.getJobCounts('wait')).toMatchObject({ wait: 1 });
      if (!job) throw new Error('Completed upload did not enqueue a job');
      const finished = job.waitUntilFinished(events, 15_000);
      const processor = app.get(VideoProcessorService);
      worker = new Worker<ProcessVideoJob>(
        queue.name,
        async (queuedJob) => processor.process(queuedJob),
        { connection },
      );
      await finished;

      video = await videos.findOneByOrFail({ id: draft.id });
      expect(video).toMatchObject({
        status: 'READY',
        duration_seconds: 2,
        width: 160,
        height: 90,
        error_code: null,
      });
      expect(video.processed_at).toBeInstanceOf(Date);
      expect(video.metadata).toMatchObject({
        format: { duration: expect.any(String) },
        streams: expect.arrayContaining([
          expect.objectContaining({ width: 160, height: 90 }),
        ]),
      });
      expect(video.thumbnail_key).toBeTruthy();
      if (!video.thumbnail_key) {
        throw new Error('Worker did not persist a thumbnail');
      }
      const thumbnail = await storage.headObject(video.thumbnail_key);
      expect(thumbnail.contentLength).toBeGreaterThan(0);
    } finally {
      if (worker) await worker.close();
      await events.close();
      if (video) {
        const current = await videos.findOneByOrFail({ id: video.id });
        await storage.deleteObject(current.source_key);
        if (current.thumbnail_key) {
          await storage.deleteObject(current.thumbnail_key);
        }
        await videos.delete(current.id);
      }
      if (channel) await channels.delete(channel.id);
      if (owner) await users.delete(owner.id);
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
