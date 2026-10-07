import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';

describe('Videos API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication to create a draft', async () => {
    await request(app.getHttpServer())
      .post('/videos/drafts')
      .send({
        channel_id: '00000000-0000-0000-0000-000000000000',
        title: 'Demo',
        size_bytes: 1024,
        mime_type: 'video/mp4',
      })
      .expect(401);
  });

  it('returns a standardized not-found error for an unknown public video', async () => {
    const response = await request(app.getHttpServer())
      .get('/videos/unknown-public-key/stream')
      .expect(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'VIDEO_NOT_FOUND',
    });
  });
});
