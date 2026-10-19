# Assets for the server export

Twins of the desktop's files, copied byte for byte so a server export draws
what the desktop draws. Change both copies together.

| Here | The desktop's twin | Used by |
| --- | --- | --- |
| `fonts/Roboto-Regular.ttf`, `fonts/Roboto-Bold.ttf`, `fonts/LICENSE-Roboto.txt` | `apps/desktop/src/assets/fonts/` (the card painter's "Scoutable Card" family) | `lib/card-paint.ts` |
| `watermark.png` (230×36) | `apps/desktop/src-tauri/resources/watermark.png` (lib.rs `WATERMARK_BYTES`) | the export's concat pass (`workers/game-video-convert/src/export.ts`) |
