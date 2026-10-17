-- Stats cards: a playlist text item can carry a card spec.
--
-- A stats card shows one player's stat line for a game, or their season
-- averages, as a full-frame card (packages/shared/lib/stats-card.ts). It is
-- stored as an ordinary text item (item_type 'text', so the reorder RPC and
-- every reader keep working) whose `card` holds the spec: the player, the
-- game or season, a snapshot of the official numbers, the chosen columns and
-- the heading/details overrides. text_content keeps a readable fallback line,
-- so builds and apps that don't know specs show a plain text card.
--
-- Nullable, and invisible to current apps: they select an explicit column
-- list. Row access is unchanged (playlist_clips policies are row-level).

ALTER TABLE public.playlist_clips
  ADD COLUMN IF NOT EXISTS card jsonb;

ALTER TABLE public.playlist_clips
  DROP CONSTRAINT IF EXISTS playlist_clips_card_check;

ALTER TABLE public.playlist_clips
  ADD CONSTRAINT playlist_clips_card_check CHECK (
    card IS NULL
    OR (
      item_type = 'text'
      AND jsonb_typeof(card) = 'object'
      AND octet_length(card::text) <= 16384
    )
  );

COMMENT ON COLUMN public.playlist_clips.card IS
  'Card spec on a text item (a stats card); see packages/shared/lib/stats-card.ts. NULL = plain text card.';
