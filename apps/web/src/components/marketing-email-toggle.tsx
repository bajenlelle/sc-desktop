"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Switch } from "@/components/ui/switch";
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
    <label htmlFor="marketing-emails" className="flex min-h-11 cursor-default items-center gap-4 px-4 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-sm">Tips and offers by email</span>
        <span className="block text-callout text-muted-foreground">
          Product tips, offers and free-import top-ups. Account emails, like playlists shared with you, arrive either way.
        </span>
      </span>
      <Switch
        id="marketing-emails"
        checked={consent ?? false}
        disabled={consent === null || saving}
        onCheckedChange={(v) => void toggle(v)}
      />
    </label>
  );
}
