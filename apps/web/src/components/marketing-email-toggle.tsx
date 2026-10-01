"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { getMarketingConsent, setMarketingConsent } from "@scoutable/shared/lib/email-preferences";

/**
 * Opt in or out of marketing email (tips, offers, the free-refill email).
 * Account emails, such as shared playlists, aren't affected.
 */
export function MarketingEmailToggle() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMarketingConsent(createClient())
      .then((at) => setConsent(at !== null))
      .catch(() => setConsent(false));
  }, []);

  async function toggle(next: boolean) {
    setSaving(true);
    setConsent(next);
    try {
      await setMarketingConsent(createClient(), next);
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
          Account emails, such as playlists shared with you, still arrive either way.
        </span>
      </span>
    </label>
  );
}
