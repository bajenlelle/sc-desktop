-- =============================================================================
-- The sample game's video covers Q1 only — trim its play-by-play to match,
-- or Q2–Q4 clips seek past the end of the file.
--
-- NOTE for future re-capture: admin_capture_demo_template snapshots ALL of
-- the source match's events. If the template is ever re-captured from a
-- full game against a partial video, re-apply this trim (or trim the source
-- match first).
-- =============================================================================

-- Template: feeds every future seed.
UPDATE demo_templates
SET events = COALESCE(
      (SELECT jsonb_agg(e)
       FROM jsonb_array_elements(events) e
       WHERE (e->>'period')::smallint = 1),
      '[]'::jsonb),
    updated_at = now()
WHERE id = 'default';

-- Already-seeded copies.
DELETE FROM play_by_play_events pbe
USING matches m
WHERE m.id = pbe.match_id
  AND m.is_demo
  AND pbe.period IS DISTINCT FROM 1;
