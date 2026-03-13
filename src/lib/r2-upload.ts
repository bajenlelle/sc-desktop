import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { streamFileSrc } from "@/lib/stream";

let r2: S3Client | null = null;

function getR2Client(): S3Client {
  if (!r2) {
    r2 = new S3Client({
      region: "auto",
      endpoint: import.meta.env.VITE_R2_ENDPOINT,
      credentials: {
        accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
        secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2;
}

/**
 * Upload a local file to Cloudflare R2 via the existing stream:// protocol.
 * Returns the public URL of the uploaded object.
 */
export async function uploadToR2(localPath: string, key: string): Promise<string> {
  // Read the local file via the stream:// protocol already registered in lib.rs.
  // Use streamFileSrc to encode each path segment individually (preserving /) —
  // the same construction used for video playback.
  const streamUrl = streamFileSrc(localPath);
  const resp = await fetch(streamUrl);
  if (!resp.ok) throw new Error(`Failed to read temp file (${resp.status}): ${localPath}`);
  const body = new Uint8Array(await resp.arrayBuffer());

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: import.meta.env.VITE_R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
    }),
  );

  return `${import.meta.env.VITE_R2_PUBLIC_URL}/${key}`;
}
