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
 * The stream:// protocol caps every response at 4 MiB (lib.rs CHUNK_SIZE)
 * and fetch() doesn't auto-follow ranges the way media elements do — a
 * single un-ranged fetch would silently truncate anything larger (fine for
 * Clip & Ship's small clips, fatal for a full highlight reel). Read the
 * whole file with explicit Range requests instead.
 */
const READ_CHUNK = 4 * 1024 * 1024;

async function readLocalFile(streamUrl: string, localPath: string): Promise<Uint8Array> {
  const first = await fetch(streamUrl, { headers: { Range: `bytes=0-${READ_CHUNK - 1}` } });
  if (!first.ok) throw new Error(`Failed to read temp file (${first.status}): ${localPath}`);
  // Content-Range: "bytes 0-4194303/52428800" — the total after the slash.
  const contentRange = first.headers.get("Content-Range");
  const total = contentRange ? parseInt(contentRange.split("/")[1], 10) : NaN;
  const firstChunk = new Uint8Array(await first.arrayBuffer());
  if (!Number.isFinite(total) || firstChunk.length >= total) return firstChunk;

  const body = new Uint8Array(total);
  body.set(firstChunk, 0);
  let offset = firstChunk.length;
  while (offset < total) {
    const end = Math.min(offset + READ_CHUNK, total) - 1;
    const resp = await fetch(streamUrl, { headers: { Range: `bytes=${offset}-${end}` } });
    if (!resp.ok) throw new Error(`Failed to read temp file (${resp.status}) at ${offset}: ${localPath}`);
    const chunk = new Uint8Array(await resp.arrayBuffer());
    if (chunk.length === 0) throw new Error(`Empty read at ${offset}: ${localPath}`);
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
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
  const body = await readLocalFile(streamUrl, localPath);

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
