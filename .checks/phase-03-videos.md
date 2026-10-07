# Fase 03 — Upload e processamento de vídeos

## Boundary

Implement only the backend API, worker, Docker infrastructure, migrations, OpenAPI, and process artifacts for draft video upload, asynchronous processing, thumbnails, streaming/download, retries, idempotency, and lifecycle cleanup. Publishing, visibility management, comments, likes, subscriptions, and frontend UI are out of scope.

## Checks

| ID | Observable criterion | Proof |
|---|---|---|
| SI-03.1 | A draft belongs to exactly one authenticated channel and accepts at most 10 GiB; an invalid owner or size returns the standardized domain error. | `videos.service.spec.ts` and `videos.e2e-spec.ts` |
| SI-03.2 | The create-draft response contains a unique public key and an S3-compatible multipart upload plan without proxying file bytes through the API. | `videos.service.spec.ts` |
| SI-03.3 | Completing an upload verifies object existence, is idempotent, changes `DRAFT` to `PROCESSING`, and enqueues one deterministic job. | `videos.service.spec.ts` and `videos.service.integration-spec.ts` |
| SI-03.4 | The worker runs ffprobe/ffmpeg outside the API process, persists duration/metadata/thumbnail, transitions to `READY`, and transitions failures to `ERROR` with retry attempts bounded to three. | `video-processor.service.spec.ts` and `video-worker.integration-spec.ts` |
| SI-03.5 | Only the owner can complete or inspect a draft; READY playback/download is public, and missing/not-ready objects return standardized errors. | `videos.e2e-spec.ts` |
| SI-03.6 | Streaming and download use object-store streams and support byte ranges without buffering the complete object in API memory. | `videos.service.spec.ts` |
| SI-03.7 | Compose starts PostgreSQL, Redis, MinIO, API, and worker with service-name networking; env validation covers all required storage/queue settings. | `compose.yaml`, `env.validation.integration-spec.ts`, `docker compose config` |
| SI-03.8 | The videos entity and migration preserve the channel relationship, unique public key, state constraints, and timestamps. | `video.entity.integration-spec.ts` and `migrations.integration-spec.ts` |
| SI-03.9 | OpenAPI contains every video route, success response, auth requirement, and shared error envelope. | `openapi-export.integration-spec.ts` and `openapi.json` |

## Sweep

- Validation: Joi and DTO constraints; maximum is 10 GiB and multipart part size is fixed at 64 MiB.
- Failure modes: standardized domain exceptions; worker failures are persisted and rethrown to BullMQ for retry.
- Idempotency/retry: deterministic job id `video:<id>`; completion and processing guard terminal states.
- Authorization: authenticated owner for draft mutations; playback/download only after READY.
- Concurrency/ordering: database state guards and BullMQ deduplication.
- Data lifecycle: incomplete drafts expire after 24 hours; failed source/thumbnail objects are removed best-effort after state persistence.
- External dependencies: S3-compatible MinIO and Redis are real in integration/Compose tests.
- Observability: structured Nest logger messages include video id and job id.

## Handoff

Single implementation batch: the backend, worker, infrastructure, and documentation are tightly coupled and remain below the project handoff budget.

## Landing

No additional one-way doors beyond the approved defaults. The implementation records fixed values above and uses direct S3-compatible multipart presigning rather than proxy upload.
