"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

type Result = "sent" | "too_soon" | "disabled" | "error";

const RESULT_COPY: Record<Result, string> = {
  sent: "Sent. Check your inbox.",
  too_soon: "We just sent one. Try again in a few minutes.",
  disabled: "We couldn't send it right now. Try again later.",
  error: "We couldn't send it right now. Try again later.",
};

/** Phone variant of the get-started welcome: the download link is in the email, with a way to send it again. */
export function ResendWelcome() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function resend() {
    setPending(true);
    let next: Result;
    try {
      const { data, error } = await createClient().rpc("resend_welcome_email");
      next = error ? "error" : data === "sent" || data === "too_soon" || data === "disabled" ? data : "error";
    } catch {
      next = "error";
    }
    setResult(next);
    setPending(false);
    trackEvent("welcome_link_resent", { result: next });
  }

  return (
    <>
      <p className="max-w-md text-sm text-muted-foreground">
        Scoutable runs on Mac and Windows. We&apos;ve emailed you the download link: open it on your computer and
        sign in with this account.
      </p>
      <Button className="mt-2" onClick={resend} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Mail />}
        Send the link again
      </Button>
      {result && (
        <p role="status" className="text-callout text-muted-foreground">
          {RESULT_COPY[result]}
        </p>
      )}
    </>
  );
}
