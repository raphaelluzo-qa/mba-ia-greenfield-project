---
kind: phase
name: phase-03-videos
status: planned
---

# phase-03-videos — Context

## Scope

Backend NestJS, worker Docker separado, PostgreSQL migration/entity, Redis/BullMQ, MinIO S3-compatible storage, OpenAPI, tests, and operational documentation for upload and processing.

## Capabilities

- Authenticated draft creation tied to the user's channel.
- Multipart presigned upload directly to MinIO.
- Idempotent completion and asynchronous processing.
- ffprobe metadata and ffmpeg thumbnail extraction.
- `DRAFT -> PROCESSING -> READY|ERROR`.
- Public unique URL, range streaming, and download after READY.

## Out of scope

Frontend, publishing/visibility, comments, likes, subscriptions, search, and recommendation logic.

## Inherited constraints

JWT guard is global; public methods must use `@Public()`. TypeORM migrations are mandatory and Compose service names must be used for inter-service hosts.
