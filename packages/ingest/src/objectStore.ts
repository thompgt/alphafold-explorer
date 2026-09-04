import fs from 'node:fs';
import path from 'node:path';
import { config } from '@afx/core';

/**
 * Where model files live. MinIO is the real target; the local-directory
 * implementation keeps `npm run ingest` working before anyone starts Docker.
 */
export interface ObjectStore {
  readonly kind: 's3' | 'local';
  put(key: string, body: string, contentType: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

export function localStore(dir = path.resolve('./data/structures')): ObjectStore {
  fs.mkdirSync(dir, { recursive: true });
  return {
    kind: 'local',
    async put(key, body) {
      const target = path.join(dir, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, 'utf8');
    },
    async get(key) {
      const target = path.join(dir, key);
      return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    },
  };
}

export async function s3Store(): Promise<ObjectStore> {
  const { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } =
    await import('@aws-sdk/client-s3');

  const client = new S3Client({
    region: 'us-east-1',
    endpoint: config.s3Endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
  }

  return {
    kind: 's3',
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
        );
        return (await result.Body?.transformToString()) ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Uses MinIO when it is reachable, otherwise falls back to the local directory. */
export async function openObjectStore(): Promise<ObjectStore> {
  if (!config.s3Enabled) return localStore();
  try {
    return await s3Store();
  } catch (error) {
    console.warn(
      `object store: MinIO unreachable at ${config.s3Endpoint} (${String(error)}); using ./data/structures`,
    );
    return localStore();
  }
}
