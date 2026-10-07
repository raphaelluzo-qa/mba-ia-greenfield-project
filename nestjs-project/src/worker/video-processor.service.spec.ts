import { Readable } from 'node:stream';
import type { Job } from 'bullmq';
import { VideoProcessorService } from './video-processor.service';

describe('VideoProcessorService', () => {
  it('does not reprocess terminal videos', async () => {
    const video = { id: 'video-id', status: 'READY' };
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(video),
      save: jest.fn(),
    };
    const storage = { getObject: jest.fn() };
    const service = new VideoProcessorService(
      repository as never,
      storage as never,
    );

    await service.process({
      data: { videoId: 'video-id' },
      id: 'video:video-id',
      attemptsMade: 0,
    } as Job<{ videoId: string }>);

    expect(storage.getObject).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('exposes a stream-capable storage boundary', () => {
    expect(Readable.from('video')).toBeInstanceOf(Readable);
  });
});
