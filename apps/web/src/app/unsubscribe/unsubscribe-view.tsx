"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthHeading, AuthShell } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";

type State = "idle" | "working" | "done" | "error";

export default function UnsubscribeView({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? "idle" : "error");

  async function unsubscribe() {
    setState("working");
    try {
      const res = await fetch(`/api/unsubscribe?t=${encodeURIComponent(token)}`, { method: "POST" });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <AuthShell>
      {state === "done" ? (
        <AuthHeading
          title="You're unsubscribed"
          description="You won't get tips or offers from Scoutable. You can turn them back on in your profile."
        />
      ) : state === "error" ? (
        <AuthHeading
          title="This link doesn't work"
          description="Turn off tips and offers in your profile instead, or email hello@scoutable.se."
        />
      ) : (
        <>
          <AuthHeading
            title="Unsubscribe from tips and offers?"
            description="You'll still get account emails, such as playlists shared with you."
          />
          <Button className="w-full" onClick={unsubscribe} disabled={state === "working"}>
            {state === "working" && <Loader2 className="animate-spin" />}
            Unsubscribe
          </Button>
        </>
      )}
      <Link href="/" className="mt-6 block text-center text-callout text-primary hover:underline">
        Go to Scoutable
      </Link>
    </AuthShell>
  );
}
