-- Aspect-aware, content-keyed link reuse for "send to phone".
--
-- aspect: '16:9' | '9:16' — a vertical send must never reuse (or be reused
-- as) a widescreen master. Existing rows are all 16:9 (vertical shipped
-- after this column).
--
-- content_key: fingerprint of exactly what was rendered (clip identities,
-- order, roll offsets, crop-pan keyframes, text cards). Reuse requires a
-- match, so edits between sends re-render automatically instead of serving
-- a stale link. Nullable: pre-existing rows have no key and simply never
-- match — one fresh render, then cached again.
ALTER TABLE highlight_shares
  ADD COLUMN IF NOT EXISTS aspect text NOT NULL DEFAULT '16:9',
  ADD COLUMN IF NOT EXISTS content_key text;
