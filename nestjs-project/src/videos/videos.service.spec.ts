import {
  VideoNotOwnerException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
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
  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    channelRepository.findOneBy.mockResolvedValue({ id: 'channel-id' });
    storage.createMultipartUpload.mockResolvedValue('upload-id');
    storage.presignUploadPart.mockResolvedValue('https://minio/part');
  });

  it('creates a channel-owned multipart draft plan', async () => {
    const service = new VideosService(
      videoRepository as never,
      channelRepository as never,
      storage as never,
      queue as never,
    );

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
    const service = new VideosService(
      videoRepository as never,
      channelRepository as never,
      storage as never,
      queue as never,
    );

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
    const service = new VideosService(
      videoRepository as never,
      channelRepository as never,
      storage as never,
      queue as never,
    );

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
    const service = new VideosService(
      videoRepository as never,
      channelRepository as never,
      storage as never,
      queue as never,
    );

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
  });

  it('does not enqueue when another completion won the atomic transition', async () => {
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
    storage.headObject.mockResolvedValue({ contentLength: 1024 });
    const service = new VideosService(
      videoRepository as never,
      channelRepository as never,
      storage as never,
      queue as never,
    );

    await expect(
      service.completeUpload(user, 'video-id', {
        parts: [{ part_number: 1, etag: '"etag"' }],
      }),
    ).resolves.toEqual({ id: 'video-id', status: 'PROCESSING' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns a range response without buffering the object', async () => {
    const service = new VideosService(
      videoRepository as never,
      channelRepository as never,
      storage as never,
      queue as never,
    );
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

    const result = await service.getPublicPlayback(
      'public-key',
      'bytes=0-1023',
    );
    expect(result.statusCode).toBe(206);
    expect(storage.getObject).toHaveBeenCalledWith(
      'videos/key/source',
      'bytes=0-1023',
    );
  });
});
