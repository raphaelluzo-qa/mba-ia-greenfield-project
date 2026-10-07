import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { VIDEO_JOB_NAME, VIDEO_QUEUE_NAME } from '../videos/videos.constants';
import {
  VideoProcessorService,
  type ProcessVideoJob,
} from './video-processor.service';

@Processor(VIDEO_QUEUE_NAME)
export class VideoWorkerProcessor extends WorkerHost {
  constructor(private readonly processor: VideoProcessorService) {
    super();
  }

  async process(job: Job<ProcessVideoJob>): Promise<void> {
    if (job.name !== VIDEO_JOB_NAME) return;
    await this.processor.process(job);
  }
}
