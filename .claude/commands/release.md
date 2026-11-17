---
description: Releases a new version of scoutable by bumping the version, tagging, and pushing to trigger the GitHub Actions release workflow.
---

Your task is to execute the release flow for scoutable. The argument is the version bump type: `patch`, `minor`, or `major`. If a specific version number is given (e.g. `0.2.0`), use that instead. If no argument is given, ask the user which bump type to use.

**All commands run from the `scoutable/` repo root.** The versioned package is `apps/desktop/package.json` (the monorepo root has no version field); we target it via npm's `--workspace` flag.

Follow these steps in order. Stop and ask if anything fails.

1. **Pull latest main** (in the repo root):
   ```
   git pull
   ```

2. **Bump version** — from the repo root, target the desktop workspace:
   ```
   npm version <patch|minor|major> --workspace apps/desktop
   ```
   This:
   - Bumps `apps/desktop/package.json`
   - Runs the `version` npm-script hook in `apps/desktop`, which syncs `src-tauri/tauri.conf.json` to match
   - **Does NOT commit or tag** (npm skips those when run against a workspace member)

3. **Commit the bump.** Stage the touched files (the version hook also syncs Cargo.toml/Cargo.lock) and commit with the version as the message:
   ```bash
   VERSION=$(node -p "require('./apps/desktop/package.json').version")
   git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock package-lock.json
   git commit -m "${VERSION}"
   ```

4. **Release message, then tag.** Ask the user: "Enter a short release message for the update banner (leave blank to skip):"
   - **Always create an annotated tag**, with the message or empty (`-m ""`). The release workflow reads the tag annotation for the GitHub release body, which the sc-landing `/api/updates/latest` proxy serves as the in-app update banner text. An empty annotation ⇒ empty banner note (correct); a lightweight tag would be ignored by the workflow's annotation check.
     ```bash
     git tag -a "v${VERSION}" -m "${MSG}"
     ```

5. **Push branch and tag explicitly** (NOT `--follow-tags` — it silently skips tags in some setups, and an unpushed tag means no release build):
   ```bash
   git push origin main "v${VERSION}"
   git ls-remote --tags origin "v${VERSION}"   # must print the tag
   ```

6. **Confirm.** Tell the user the new version and tag that was pushed, and that the GitHub Actions release workflow has been triggered. The workflow will build, notarize, publish to GitHub Releases, and update the sc-landing download URLs automatically.

## Common failure: `npm ci` complains about missing Expo entries

If CI fails with `Missing: @expo/metro-runtime@... from lock file` or similar, the local npm version used to write the lockfile differs from CI's. Both the release/build/check workflows already pin `npm install -g npm@11` after `setup-node` — verify that's still there. If the mismatch reappears after a Node/npm bump on either side, sync the versions in `.github/workflows/*.yml`.
