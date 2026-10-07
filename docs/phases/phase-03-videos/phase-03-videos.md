# Fase 03 — Upload e processamento de vídeos

## SI-03.1 — Draft e upload

- `POST /videos/drafts` cria um draft autenticado e retorna `id`, `publicKey`, `uploadId`, `partSize`, `partCount` e URLs presignadas.
- `POST /videos/:id/complete` conclui o multipart e enfileira o processamento.
- Limite: 10 GiB; estado inicial: `DRAFT`.

## Data Model

`videos`: UUID interno, `channel_id` FK, `public_key` unique, `title`, `description`, `source_key`, `thumbnail_key`, `upload_id`, `size_bytes`, `duration_seconds`, `width`, `height`, `mime_type`, `metadata` JSONB, `status`, `error_code`, `processed_at`, timestamps.

## API Contracts

- `POST /videos/drafts` — 201, authenticated.
- `POST /videos/:id/parts` — 201, authenticated, presign a part.
- `POST /videos/:id/complete` — 202, authenticated, idempotent.
- `GET /videos/:publicKey/stream` — 200/206, public when READY.
- `GET /videos/:publicKey/download` — 200/206, public when READY.

## Authorization Matrix

| Operation | Anonymous | Authenticated owner | Other authenticated user |
|---|---:|---:|---:|
| Create draft | no | yes | n/a |
| Presign/complete | no | yes | no |
| Stream/download READY | yes | yes | yes |

## Error Catalog

`VIDEO_NOT_FOUND` (404), `VIDEO_NOT_READY` (409), `VIDEO_NOT_OWNER` (403), `VIDEO_TOO_LARGE` (422), `VIDEO_UPLOAD_NOT_FOUND` (422), `VIDEO_PROCESSING_FAILED` (500).

## Events/Messages

Queue `video-processing`; job name `process-video`; payload `{ videoId }`; id `video:<videoId>`; attempts 3; exponential backoff 5s.

## Dependency Map

VideosModule → ChannelsModule/UsersModule, TypeORM, StorageService, BullMQ. VideoWorkerModule → TypeORM, StorageService, ffprobe/ffmpeg, BullMQ. Compose → PostgreSQL, Redis, MinIO.

## Deliverables

Entity, migration, API, S3 storage adapter, worker, Docker Compose/Dockerfiles, env validation, OpenAPI export, unit/integration/e2e tests, and progress report.
