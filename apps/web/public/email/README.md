# Email assets

Served publicly from `https://app.scoutable.se/email/…`. Nothing in `apps/web`
gates `public/`, so email clients can fetch these without a session — which they
must, since they load images unauthenticated.

Used by:

- `supabase/functions/send-email/index.ts` (via `APP_URL`, so staging points at
  its own host)
- `supabase/templates/confirm.html` and `reset.html` (absolute production URL —
  static files with no templating)

## header.png

The whole email header: the `s.` mark above the SCOUTABLE wordmark on solid
`#000408`, `1620x360`, displayed at `540x120` (3x). It is one opaque image on
purpose: Gmail's dark mode (iOS especially) inverts the email's HTML colours
but leaves images alone, so a dark header cell with a light transparent mark
turned white and the mark vanished. An image keeps its own background in both
modes. Regenerate by rendering the old header markup (mark 40x36, 24px top
padding, 10px gap, Barlow Condensed 700 20px, letter-spacing 3px, white) in a
540x120 page at device scale 3 with Playwright, and screenshot it.

## logo-mark.png

No longer used by the templates (the header above replaced it); kept for old
emails still in inboxes.

The `s.` mark, white on transparent, `120x108`, displayed at `40x36` (3x for
retina). Regenerate from the SVG source if the brand mark changes:

```js
// node -e '…' from the repo root
const sharp = require('sharp'), fs = require('fs');
let svg = fs.readFileSync('apps/web/public/logo-mark.svg', 'utf8');
// logo-mark.svg bakes two full-canvas background rects (#ffffff then #161b24).
// They have to go, or the mark shows as a lighter square on the #000408 header.
svg = svg.replace(/<rect x="-150"[^>]*fill="#ffffff"[^>]*\/>/, '')
         .replace(/<rect x="-150"[^>]*fill="#161b24"[^>]*\/>/, '');
const rendered = await sharp(Buffer.from(svg)).resize(600).png().toBuffer();
await sharp(await sharp(rendered).trim().png().toBuffer())
  .resize({ height: 108 })
  .png({ compressionLevel: 9 })
  .toFile('apps/web/public/email/logo-mark.png');
```

Two things to keep in mind if you touch this:

- **PNG, not SVG.** Gmail and Outlook strip `<svg>`, so the repo's SVG can't be
  referenced directly.
- **The mark is light-on-transparent**, so it only reads against a dark header.
  If the header background ever moves to white, the mark needs a dark variant.
