-- 20260909120000: Track when an org invite link was copied
--
-- The admin onboarding steps "invite your coaches" / "invite players" must
-- complete when the admin ACTS (sends email invites or copies the invite
-- link), not when someone eventually joins — joining isn't the admin's step.
-- Email invites already leave org_invites rows with email set; copying left
-- no trace, and the link row itself is created eagerly when the invite modal
-- opens, so row existence can't be the signal.

ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS copied_at timestamptz;

-- Stamped fire-and-forget from the invite modals' Copy button. SECURITY
-- DEFINER because org_invites has no UPDATE policy (and shouldn't — this is
-- the only mutation staff may make to an existing invite).
CREATE OR REPLACE FUNCTION mark_org_invite_copied(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Coaches can generate (and copy) coach invites too, so the bar is org
  -- staff of the invite's org — mirrors generate_org_invite.
  UPDATE org_invites i
     SET copied_at = now()
   WHERE i.id = p_invite_id
     AND EXISTS (
       SELECT 1 FROM org_memberships m
        WHERE m.org_id = i.org_id
          AND m.user_id = v_uid
          AND m.role IN ('admin', 'coach')
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_org_invite_copied(uuid) TO authenticated;
