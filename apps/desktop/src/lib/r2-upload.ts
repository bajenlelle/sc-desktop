import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { invoke } from "@tauri-apps/api/core";

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
 * Upload a local file to Cloudflare R2. Returns the public URL.
 *
 * Reads through the read_file Tauri command (raw bytes over IPC) — NOT
 * fetch() against stream://, whose responses cap at 4 MiB and whose headers
 * aren't readable cross-origin; that combination once silently truncated
 * every upload over 4 MiB. std::fs::read returns the whole file or errors.
 */
export async function uploadToR2(
  localPath: string,
  key: string,
  contentType: string = "video/mp4",
  signal?: AbortSignal,
): Promise<string> {
  const body = new Uint8Array(await invoke<ArrayBuffer>("read_file", { path: localPath }));

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: import.meta.env.VITE_R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
    { abortSignal: signal },
  );

  return `${import.meta.env.VITE_R2_PUBLIC_URL}/${key}`;
}
