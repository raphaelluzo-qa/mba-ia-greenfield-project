# Fase 03 — Library references

| Library | Version/source | Usage |
|---|---|---|
| `@nestjs/bullmq` | BullMQ NestJS guide | Queue registration and worker processor |
| `bullmq` | `6.3.11` pinned in `nestjs-project/package-lock.json`; [Job IDs guide](https://docs.bullmq.io/guide/jobs/job-ids), [versioned source](https://github.com/taskforcesh/bullmq/blob/v6.3.11/src/classes/job.ts) | `video-<uuid>` custom IDs, duplicate suppression, retries, backoff |
| `@aws-sdk/client-s3` | AWS SDK v3 S3 examples | MinIO-compatible commands and range reads |
| `@aws-sdk/s3-request-presigner` | AWS SDK v3 | Presigned multipart URLs |
| `ffprobe`/`ffmpeg` | Official manuals | Metadata extraction and thumbnail generation |
| TypeORM `0.3.x` | `package.json` and existing migrations | Entity/repository/migration contract |

Compatibility correction verified against official documentation and `Job.validateOptions` / `Job.create` in tag `v6.3.11` on 2026-11-10. Context7 is not available in this session's tool catalog; the official versioned source was used instead. The runtime-installed version could not be inspected because the Docker daemon is unavailable.
