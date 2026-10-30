#!/bin/bash
# SessionStart hook (.claude/settings.json): installs dependencies in Claude
# Code cloud sessions (claude.ai/code). Exits at once anywhere else, so local
# sessions are untouched. System packages come from the cloud environment's
# setup script; this covers what lives in the repo.

[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0

# npm ci only when a manifest or the lockfile changed since the last install.
hashes=node_modules/.cloud-install.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  if npm ci --no-audit --no-fund; then
    sha256sum scripts/cloud-install.sh package.json package-lock.json \
      apps/*/package.json packages/*/package.json > "$hashes" || rm -f "$hashes"
  fi
fi

# tauri-build checks that frontendDist and the ffmpeg sidecar exist even for
# cargo clippy / cargo test; stub both like check.yml does (both gitignored).
mkdir -p apps/desktop/dist apps/desktop/src-tauri/binaries
stub=apps/desktop/src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu
[ -e "$stub" ] || { touch "$stub" && chmod +x "$stub"; }

exit 0
