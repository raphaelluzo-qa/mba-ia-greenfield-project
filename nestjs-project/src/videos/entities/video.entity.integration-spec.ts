import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('persists the channel relation and unique public key', async () => {
    const user = await userRepository.save(
      userRepository.create({
        email: `video-${Date.now()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Video Channel',
        nickname: `video_${Date.now()}`,
        user_id: user.id,
      }),
    );
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_key: `public-${Date.now()}`,
        title: 'Demo',
        source_key: 'videos/demo/source',
        size_bytes: '1024',
        mime_type: 'video/mp4',
        metadata: {},
      }),
    );

    const found = await videoRepository.findOne({
      where: { id: video.id },
      relations: ['channel'],
    });
    expect(found?.channel.id).toBe(channel.id);
    expect(found?.status).toBe('DRAFT');
  });

  it('rejects an invalid lifecycle status', async () => {
    const user = await userRepository.save(
      userRepository.create({
        email: `invalid-video-${Date.now()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Video Channel',
        nickname: `invalid_${Date.now()}`,
        user_id: user.id,
      }),
    );
    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          public_key: `invalid-${Date.now()}`,
          title: 'Invalid',
          source_key: 'videos/invalid/source',
          size_bytes: '1024',
          mime_type: 'video/mp4',
          status: 'BROKEN' as never,
          metadata: {},
        }),
      ),
    ).rejects.toThrow();
  });
});
