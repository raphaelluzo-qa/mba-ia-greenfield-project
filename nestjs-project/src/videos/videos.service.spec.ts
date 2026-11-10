import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import {
  VideoNotOwnerException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import { Video } from './entities/video.entity';
import { VIDEO_STORAGE } from './storage.storage';
import { VIDEO_QUEUE_NAME } from './videos.constants';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  const user = { sub: 'user-id', email: 'user@example.com' };
  const storage = {
    createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
    presignUploadPart: jest.fn().mockResolvedValue('https://minio/part'),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    headObject: jest.fn().mockResolvedValue({ contentLength: 1024 }),
    getObject: jest.fn(),
  };
  const channelRepository = {
    findOneBy: jest.fn().mockResolvedValue({ id: 'channel-id' }),
  };
  const videoRepository = {
    create: jest.fn((value: Record<string, unknown>) => ({
      id: 'video-id',
      ...value,
    })),
    save: jest.fn((value) => Promise.resolve(value)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOneBy: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const queue = {
    add: jest.fn(),
    getJob: jest.fn(),
  };
  let module: TestingModule;
  let service: VideosService;

  beforeEach(async () => {
    jest.clearAllMocks();
    channelRepository.findOneBy.mockResolvedValue({ id: 'channel-id' });
    storage.createMultipartUpload.mockResolvedValue('upload-id');
    storage.presignUploadPart.mockResolvedValue('https://minio/part');
    videoRepository.update.mockResolvedValue({ affected: 1 });
    queue.add.mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue(undefined);
    module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: getRepositoryToken(Channel), useValue: channelRepository },
        { provide: VIDEO_STORAGE, useValue: storage },
        { provide: getQueueToken(VIDEO_QUEUE_NAME), useValue: queue },
      ],
    }).compile();
    service = module.get(VideosService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('creates a channel-owned multipart draft plan', async () => {
    const result = await service.createDraft(user, {
      channel_id: 'channel-id',
      title: 'Demo',
      size_bytes: 1024,
      mime_type: 'video/mp4',
    });

    expect(result.partCount).toBe(1);
    expect(result.partSize).toBe(64 * 1024 * 1024);
    expect(result.urls).toHaveLength(1);
    expect(storage.createMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^videos\/.+\/source$/),
      'video/mp4',
    );
  });

  it('rejects oversized drafts before storage access', async () => {
    await expect(
      service.createDraft(user, {
        channel_id: 'channel-id',
        title: 'Too large',
        size_bytes: 10 * 1024 * 1024 * 1024 + 1,
        mime_type: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(VideoTooLargeException);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('rejects drafts from channels owned by another user', async () => {
    channelRepository.findOneBy.mockResolvedValue(null);
    await expect(
      service.createDraft(user, {
        channel_id: 'other-channel',
        title: 'Nope',
        size_bytes: 1024,
        mime_type: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(VideoNotOwnerException);
  });

  it('atomically transitions a completed draft before enqueueing', async () => {
    const video = {
      id: 'video-id',
      status: 'DRAFT',
      upload_id: 'upload-id',
      source_key: 'videos/key/source',
      size_bytes: '1024',
    };
    videoRepository.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(video),
    });
    storage.headObject.mockResolvedValue({ contentLength: 1024 });
    await expect(
      service.completeUpload(user, 'video-id', {
        parts: [{ part_number: 1, etag: '"etag"' }],
      }),
    ).resolves.toEqual({ id: 'video-id', status: 'PROCESSING' });

    expect(videoRepository.update).toHaveBeenCalledWith(
      {
        id: 'video-id',
        status: 'DRAFT',
        upload_id: 'upload-id',
      },
      { status: 'PROCESSING', upload_id: null },
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(videoRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
      queue.add.mock.invocationCallOrder[0],
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process-video',
      { videoId: 'video-id' },
      {
        jobId: 'video-video-id',
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  });

  it('preserves the job when another completion won the atomic transition', async () => {
    const video = {
      id: 'video-id',
      status: 'DRAFT',
      upload_id: 'upload-id',
      source_key: 'videos/key/source',
      size_bytes: '1024',
    };
    videoRepository.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(video),
    });
    videoRepository.update.mockResolvedValue({ affected: 0 });
    videoRepository.findOneBy.mockResolvedValue({
      id: 'video-id',
      status: 'PROCESSING',
    });
    queue.getJob.mockResolvedValue({ id: 'video-video-id' });
    storage.headObject.mockResolvedValue({ contentLength: 1024 });
    await expect(
      service.completeUpload(user, 'video-id', {
        parts: [{ part_number: 1, etag: '"etag"' }],
      }),
    ).resolves.toEqual({ id: 'video-id', status: 'PROCESSING' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('recovers a missing job when another completion won the transition', async () => {
    videoRepository.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'video-id',
        status: 'DRAFT',
        upload_id: 'upload-id',
        source_key: 'videos/key/source',
        size_bytes: '1024',
      }),
    });
    videoRepository.update.mockResolvedValue({ affected: 0 });
    videoRepository.findOneBy.mockResolvedValue({
      id: 'video-id',
      status: 'PROCESSING',
    });
    storage.headObject.mockResolvedValue({ contentLength: 1024 });

    await expect(
      service.completeUpload(user, 'video-id', {
        parts: [{ part_number: 1, etag: '"etag"' }],
      }),
    ).resolves.toEqual({ id: 'video-id', status: 'PROCESSING' });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('propagates enqueue failure and recovers on a subsequent completion', async () => {
    const video = {
      id: 'video-id',
      status: 'DRAFT',
      upload_id: 'upload-id',
      source_key: 'videos/key/source',
      size_bytes: '1024',
    };
    videoRepository.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(video),
    });
    storage.headObject.mockResolvedValue({ contentLength: 1024 });
    const enqueueError = new Error('Redis unavailable');
    queue.add.mockRejectedValueOnce(enqueueError);
    const dto = { parts: [{ part_number: 1, etag: '"etag"' }] };

    await expect(service.completeUpload(user, video.id, dto)).rejects.toBe(
      enqueueError,
    );
    video.status = 'PROCESSING';

    await expect(
      service.completeUpload(user, video.id, dto),
    ).resolves.toEqual({ id: video.id, status: 'PROCESSING' });
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(videoRepository.update).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.getJob).toHaveBeenLastCalledWith('video-video-id');
  });

  it('does not duplicate an existing job for a processing video', async () => {
    videoRepository.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'video-id',
        status: 'PROCESSING',
      }),
    });
    queue.getJob.mockResolvedValue({ id: 'video-video-id' });

    await expect(
      service.completeUpload(user, 'video-id', { parts: [] }),
    ).resolves.toEqual({ id: 'video-id', status: 'PROCESSING' });
    expect(queue.add).not.toHaveBeenCalled();
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('propagates queue lookup errors instead of claiming processing was queued', async () => {
    videoRepository.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'video-id',
        status: 'PROCESSING',
      }),
    });
    const error = new Error('Redis unavailable');
    queue.getJob.mockRejectedValueOnce(error);

    await expect(
      service.completeUpload(user, 'video-id', { parts: [] }),
    ).rejects.toBe(error);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each(['READY', 'ERROR'])(
    'does not enqueue a terminal %s video',
    async (status) => {
      videoRepository.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'video-id', status }),
      });

      await expect(
        service.completeUpload(user, 'video-id', { parts: [] }),
      ).resolves.toEqual({ id: 'video-id', status });
      expect(queue.getJob).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    },
  );

  it('returns a range response without buffering the object', async () => {
    videoRepository.findOneBy.mockResolvedValue({
      public_key: 'public-key',
      status: 'READY',
      source_key: 'videos/key/source',
      mime_type: 'video/mp4',
    });
    storage.headObject.mockResolvedValue({ contentLength: 4096 });
    storage.getObject.mockResolvedValue({
      body: expect.anything(),
      contentLength: 1024,
      contentRange: 'bytes 0-1023/4096',
    });

    const result = await service.getPublicPlayback('public-key', 'bytes=0-1023');
    expect(result.statusCode).toBe(206);
    expect(storage.getObject).toHaveBeenCalledWith(
      'videos/key/source',
      'bytes=0-1023',
    );
  });
});
