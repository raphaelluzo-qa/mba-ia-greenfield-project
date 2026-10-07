export const VIDEO_MAX_SIZE_BYTES = 10 * 1024 * 1024 * 1024;
export const VIDEO_PART_SIZE_BYTES = 64 * 1024 * 1024;
export const VIDEO_MAX_PARTS = Math.ceil(
  VIDEO_MAX_SIZE_BYTES / VIDEO_PART_SIZE_BYTES,
);
export const VIDEO_DRAFT_TTL_HOURS = 24;
export const VIDEO_QUEUE_NAME = 'video-processing';
export const VIDEO_JOB_NAME = 'process-video';
export const VIDEO_JOB_ATTEMPTS = 3;
export const VIDEO_JOB_BACKOFF_MS = 5_000;

export const VIDEO_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'READY',
  'ERROR',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];
