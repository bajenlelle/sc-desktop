/**
 * Local HTTP proxy between ffmpeg and the replay's CDN. BasketTV's MP4s keep
 * their index (moov, 3–11 MB) at the end of the file, so every ffmpeg process
 * would otherwise fetch it again; this serves byte ranges from a chunk cache,
 * counts what is actually pulled from upstream, and keeps the signed URL out
 * of ffmpeg's argv.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

interface Target {
  url: string;
  size: number | null;
  chunks: Map<number, Buffer>;
  pending: Map<number, Promise<Buffer>>;
  fetchedBytes: number;
  upstreamRequests: number;
  clientRequests: number;
  errors: string[];
}

export interface ProxyStats {
  size: number | null;
  fetchedBytes: number;
  cachedChunks: number;
  upstreamRequests: number;
  clientRequests: number;
  errors: string[];
}

export interface RangeProxy {
  /** Register an upstream URL; returns the local URL to hand to ffmpeg. */
  register(url: string): string;
  stats(localUrl: string): ProxyStats;
  release(localUrl: string): void;
  close(): void;
}

export async function startRangeProxy(chunkSize = 512 * 1024): Promise<RangeProxy> {
  const targets = new Map<string, Target>();

  async function sizeOf(t: Target): Promise<number> {
    if (t.size != null) return t.size;
    const res = await fetch(t.url, { headers: { Range: "bytes=0-0" } });
    const m = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
    await res.arrayBuffer();
    t.upstreamRequests++;
    if (res.status !== 206 || !m) throw new Error(`upstream does not serve byte ranges (status ${res.status})`);
    t.size = Number(m[1]);
    return t.size;
  }

  function chunk(t: Target, idx: number): Promise<Buffer> {
    const cached = t.chunks.get(idx);
    if (cached) return Promise.resolve(cached);
    const pending = t.pending.get(idx);
    if (pending) return pending;
    const start = idx * chunkSize;
    const end = Math.min(t.size as number, start + chunkSize) - 1;
    const p = (async () => {
      const res = await fetch(t.url, { headers: { Range: `bytes=${start}-${end}` } });
      if (res.status !== 206) throw new Error(`upstream range failed (status ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      t.upstreamRequests++;
      t.fetchedBytes += buf.length;
      t.chunks.set(idx, buf);
      t.pending.delete(idx);
      return buf;
    })();
    t.pending.set(idx, p);
    return p;
  }

  const server = http.createServer(async (req, res) => {
    const t = targets.get((req.url ?? "").slice(1));
    if (!t) {
      res.writeHead(404);
      res.end();
      return;
    }
    t.clientRequests++;
    try {
      const size = await sizeOf(t);
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      res.writeHead(range ? 206 : 200, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      let pos = start;
      while (pos <= end && !res.destroyed && !req.destroyed) {
        const idx = Math.floor(pos / chunkSize);
        const buf = await chunk(t, idx);
        const from = pos - idx * chunkSize;
        const to = Math.min(buf.length, end - idx * chunkSize + 1);
        const ok = res.write(buf.subarray(from, to));
        pos += to - from;
        if (!ok) await new Promise<void>((r) => res.once("drain", () => r()));
      }
      res.end();
    } catch (e) {
      t.errors.push(String((e as Error)?.message ?? e));
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const idOf = (localUrl: string) => localUrl.split("/").pop() ?? "";
  return {
    register(url) {
      const id = randomUUID();
      targets.set(id, { url, size: null, chunks: new Map(), pending: new Map(), fetchedBytes: 0, upstreamRequests: 0, clientRequests: 0, errors: [] });
      return `http://127.0.0.1:${port}/${id}`;
    },
    stats(localUrl) {
      const t = targets.get(idOf(localUrl));
      if (!t) return { size: null, fetchedBytes: 0, cachedChunks: 0, upstreamRequests: 0, clientRequests: 0, errors: [] };
      return { size: t.size, fetchedBytes: t.fetchedBytes, cachedChunks: t.chunks.size, upstreamRequests: t.upstreamRequests, clientRequests: t.clientRequests, errors: t.errors };
    },
    release(localUrl) {
      targets.delete(idOf(localUrl));
    },
    close() {
      server.close();
    },
  };
}
