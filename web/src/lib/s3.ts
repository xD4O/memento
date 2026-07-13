import { Client } from "minio";

const g = globalThis as unknown as {
  __mementoS3?: Client;
  __mementoBucketReady?: Promise<void>;
};

export const s3 =
  g.__mementoS3 ??
  (g.__mementoS3 = new Client({
    endPoint: process.env.S3_ENDPOINT_HOST ?? "localhost",
    port: Number(process.env.S3_ENDPOINT_PORT ?? 9400),
    useSSL: false,
    accessKey: process.env.S3_ACCESS_KEY ?? "",
    secretKey: process.env.S3_SECRET_KEY ?? "",
  }));

export const BUCKET = process.env.S3_BUCKET ?? "memento-media";

export function ensureBucket(): Promise<void> {
  g.__mementoBucketReady ??= (async () => {
    if (!(await s3.bucketExists(BUCKET))) await s3.makeBucket(BUCKET);
  })();
  return g.__mementoBucketReady;
}
