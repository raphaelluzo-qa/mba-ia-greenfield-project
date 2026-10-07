import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Video } from '../videos/entities/video.entity';
import { VIDEO_STORAGE, type VideoStorage } from '../videos/storage.storage';

export interface ProcessVideoJob {
  videoId: string;
}

@Injectable()
export class VideoProcessorService {
  private readonly logger = new Logger(VideoProcessorService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @Inject(VIDEO_STORAGE)
    private readonly storage: VideoStorage,
  ) {}

  async process(job: Job<ProcessVideoJob>): Promise<void> {
    const video = await this.videoRepository.findOneBy({
      id: job.data.videoId,
    });
    if (!video || video.status === 'READY' || video.status === 'ERROR') return;
    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const sourcePath = join(workDir, 'source');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');
    try {
      const source = await this.storage.getObject(video.source_key);
      await pipeline(source.body, createWriteStream(sourcePath));
      const probe = await runProcess('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=width,height,codec_name',
        '-of',
        'json',
        sourcePath,
      ]);
      const metadata = JSON.parse(probe) as {
        format?: { duration?: string };
        streams?: Array<{ width?: number; height?: number }>;
      };
      await runProcess('ffmpeg', [
        '-y',
        '-i',
        sourcePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-1',
        thumbnailPath,
      ]);
      const thumbnailKey = `videos/${video.public_key}/thumbnail.jpg`;
      await this.storage.putObject(
        thumbnailKey,
        createReadStream(thumbnailPath),
        'image/jpeg',
      );
      const stream = metadata.streams?.find(
        (item) => item.width || item.height,
      );
      video.duration_seconds = metadata.format?.duration
        ? Math.round(Number(metadata.format.duration))
        : null;
      video.width = stream?.width ?? null;
      video.height = stream?.height ?? null;
      video.thumbnail_key = thumbnailKey;
      video.metadata = metadata as unknown as Record<string, unknown>;
      video.status = 'READY';
      video.error_code = null;
      video.processed_at = new Date();
      await this.videoRepository.save(video);
      this.logger.log(`Processed video ${video.id} from job ${job.id}`);
    } catch (error) {
      if ((job.attemptsMade ?? 0) + 1 >= 3) {
        video.status = 'ERROR';
        video.error_code = 'VIDEO_PROCESSING_FAILED';
        await this.videoRepository.save(video);
        await this.deleteFailedObjects(video.source_key, video.thumbnail_key);
      }
      this.logger.error(
        `Processing failed for video ${video.id} job ${job.id}`,
      );
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async deleteFailedObjects(
    sourceKey: string,
    thumbnailKey: string | null,
  ): Promise<void> {
    for (const key of [sourceKey, thumbnailKey].filter(
      (value): value is string => value !== null,
    )) {
      try {
        await this.storage.deleteObject(key);
      } catch {
        this.logger.warn(`Could not remove failed video object ${key}`);
      }
    }
  }
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}
