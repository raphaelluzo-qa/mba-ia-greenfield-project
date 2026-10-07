import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1779000000000 implements MigrationInterface {
  name = 'CreateVideos1779000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "channel_id" uuid NOT NULL,
        "public_key" character varying(64) NOT NULL,
        "title" character varying(255) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "source_key" character varying(512) NOT NULL,
        "thumbnail_key" character varying(512),
        "upload_id" character varying(255),
        "size_bytes" bigint NOT NULL,
        "duration_seconds" integer,
        "width" integer,
        "height" integer,
        "mime_type" character varying(128) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "error_code" character varying(64),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_videos_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_videos_public_key" UNIQUE ("public_key"),
        CONSTRAINT "CHK_videos_status" CHECK ("status" IN ('DRAFT', 'PROCESSING', 'READY', 'ERROR')),
        CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_videos_channel_id"`);
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
