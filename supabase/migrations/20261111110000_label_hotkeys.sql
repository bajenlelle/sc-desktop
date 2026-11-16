-- A key per label (docs/game-view.md, "Labelling"): a coach gives up to nine of their labels a
-- key, 1 to 9, and Option (Alt) with that digit puts the label on the clip on screen without
-- opening the label picker (packages/shared/lib/label-keys.ts). The key is kept on the label, so
-- it follows the account: a label is already one coach's own in one space (labels_owner_all),
-- and so is its key.
-- NULL = no key. One label per key in a vocabulary: the partial unique index. Moving a key to
-- another label is therefore two writes that must land together, which is why it goes through
-- set_label_hotkey and not two updates from the client.
-- Released apps name the columns they read and never see this one. move_to_club recreates the
-- labels it needs in the club by name and colour only, so a label arrives there without a key
-- and can't collide with one the club vocabulary already has.
ALTER TABLE labels ADD COLUMN hotkey smallint;
ALTER TABLE labels ADD CONSTRAINT labels_hotkey_check CHECK (hotkey IS NULL OR hotkey BETWEEN 1 AND 9);
CREATE UNIQUE INDEX labels_user_org_hotkey_idx ON labels (user_id, org_id, hotkey) WHERE hotkey IS NOT NULL;
COMMENT ON COLUMN labels.hotkey IS 'The key (1-9) that puts this label on a clip; see packages/shared/lib/label-keys.ts';

-- Gives the caller's label a key, or takes its key away (NULL). The label in the same vocabulary
-- that had the key loses it in the same transaction.
CREATE OR REPLACE FUNCTION set_label_hotkey(p_label_id uuid, p_hotkey integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_hotkey IS NOT NULL AND p_hotkey NOT BETWEEN 1 AND 9 THEN
    RAISE EXCEPTION 'invalid_hotkey';
  END IF;

  SELECT org_id INTO v_org FROM labels WHERE id = p_label_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  IF p_hotkey IS NOT NULL THEN
    UPDATE labels SET hotkey = NULL
    WHERE user_id = v_uid AND org_id = v_org AND hotkey = p_hotkey AND id <> p_label_id;
  END IF;
  UPDATE labels SET hotkey = p_hotkey WHERE id = p_label_id;
END;
$$;

REVOKE ALL ON FUNCTION set_label_hotkey(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_label_hotkey(uuid, integer) TO authenticated;
