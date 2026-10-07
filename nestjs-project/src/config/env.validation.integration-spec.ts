import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — video infrastructure', () => {
  it('accepts the Compose storage and queue settings', () => {
    const { error, value } = validate({
      S3_ENDPOINT: 'http://minio:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: 'minioadmin',
      S3_SECRET_KEY: 'minioadmin',
      S3_BUCKET: 'videos',
      S3_FORCE_PATH_STYLE: 'true',
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
    });
    expect(error).toBeUndefined();
    expect(value.S3_BUCKET).toBe('videos');
    expect(value.REDIS_HOST).toBe('redis');
  });

  it('rejects malformed storage and queue settings', () => {
    const { error } = validate({
      S3_ENDPOINT: 'not-a-url',
      S3_FORCE_PATH_STYLE: 'maybe',
      REDIS_PORT: 'not-a-port',
    });
    expect(error).toBeDefined();
    expect(error!.message).toEqual(
      expect.stringContaining('S3_ENDPOINT'),
    );
  });
});
