import crypto from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let client = null;

function getClient() {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

// Uploads a photo buffer to the R2 bucket and returns its public URL.
// The bucket must have public access enabled (r2.dev URL or a custom domain)
// since report links stay valid indefinitely and we don't want to re-sign
// URLs every time an old report is opened.
export async function uploadPhoto(buffer, contentType) {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (!bucket || !publicBase) {
    throw new Error("R2 is not configured — set R2_BUCKET_NAME, R2_PUBLIC_BASE_URL");
  }
  const ext = contentType === "image/png" ? "png" : "jpg";
  const key = `photos/${crypto.randomUUID()}.${ext}`;
  await getClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
  );
  return `${publicBase.replace(/\/$/, "")}/${key}`;
}
