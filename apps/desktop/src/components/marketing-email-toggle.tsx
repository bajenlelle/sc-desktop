import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { getMarketingEmailsOn, setMarketingEmailsOn } from "@scoutable/shared/lib/email-preferences";

/**
 * Turn marketing email (tips, offers, free-import top-ups) off or back on.
 * On by default for now, until the user turns it off or unsubscribes.
 * Account emails, such as shared playlists, aren't affected.
 */
export function MarketingEmailToggle() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMarketingEmailsOn(createClient())
      .then(setConsent)
      .catch(() => setConsent(null));
  }, []);

  async function toggle(next: boolean) {
    setSaving(true);
    setConsent(next);
    try {
      await setMarketingEmailsOn(createClient(), next);
    } catch (e) {
      setConsent(!next);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        checked={consent ?? false}
        disabled={consent === null || saving}
        onChange={(e) => toggle(e.target.checked)}
      />
      <span>
        <span className="text-foreground">Email me tips and offers</span>
        <span className="block text-xs text-muted-foreground">
          Product tips, offers and free-import top-ups. Account emails, such as playlists shared with you, arrive either way.
        </span>
      </span>
    </label>
  );
}
