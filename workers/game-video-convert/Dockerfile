# syntax=docker/dockerfile:1
# The converter container (src/convert.ts), built by `wrangler deploy` from the
# repository root (wrangler.jsonc: image_build_context "../.."), so the
# workspace packages it imports are in the context. The root .dockerignore
# admits only the manifests and the raw TypeScript listed below.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first: the dependency layer is reused until a package.json or the lockfile changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/node-video/package.json packages/node-video/
COPY workers/game-video-convert/package.json workers/game-video-convert/
RUN npm ci -w workers/game-video-convert -w packages/shared -w packages/node-video \
      --include-workspace-root=false --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# The program and the packages it runs from source (tsx compiles on the fly; there is no build step).
COPY packages/shared/lib packages/shared/lib
COPY packages/shared/types packages/shared/types
COPY packages/node-video/lib packages/node-video/lib
# The export's card fonts and wordmark (src/export.ts; twins of the desktop's, see its README).
COPY packages/node-video/assets packages/node-video/assets
COPY workers/game-video-convert/tsconfig.json workers/game-video-convert/
COPY workers/game-video-convert/src workers/game-video-convert/src

ENV NODE_ENV=production \
    FFMPEG=/usr/bin/ffmpeg \
    PORT=8080

WORKDIR /app/workers/game-video-convert
USER node
EXPOSE 8080

# tini forwards SIGTERM to node, which kills ffmpeg, reports job_failed('sigterm') and exits 143.
ENTRYPOINT ["tini", "--", "node", "--import", "tsx", "src/convert.ts"]
