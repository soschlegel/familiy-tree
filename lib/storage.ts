import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";

export const BUCKET = process.env.S3_BUCKET ?? "familytree";

export const s3 = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? "us-east-1",
  // MinIO spricht kein Virtual-Host-Style.
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  },
});

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObjectStream(key: string) {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  return res.Body as ReadableStream | null;
}

/**
 * Objekt vollständig als Buffer. Nutzt bewusst transformToByteArray des SDK:
 * res.Body ist unter Node ein Node-Stream, kein Web-ReadableStream — ein
 * getReader() darauf schlägt fehl.
 */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) return null;
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
