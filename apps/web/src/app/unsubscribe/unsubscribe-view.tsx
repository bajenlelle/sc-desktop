"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-center space-y-3">
          {state === "done" ? (
            <>
              <p className="font-semibold text-foreground">You&apos;re unsubscribed</p>
              <p className="text-sm text-muted-foreground">
                You won&apos;t get tips or offers from Scoutable. You can turn them back on in your profile.
              </p>
            </>
          ) : state === "error" ? (
            <>
              <p className="font-semibold text-foreground">This link doesn&apos;t work</p>
              <p className="text-sm text-muted-foreground">
                Turn off tips and offers in your profile instead, or email hello@scoutable.se.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-foreground">Unsubscribe from tips and offers?</p>
              <p className="text-sm text-muted-foreground">
                You&apos;ll still get account emails, such as playlists shared with you.
              </p>
              <Button className="w-full" size="sm" onClick={unsubscribe} disabled={state === "working"}>
                {state === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unsubscribe"}
              </Button>
            </>
          )}
          <Link href="/" className="block text-sm text-primary underline">Go to Scoutable</Link>
        </CardContent>
      </Card>
    </div>
  );
}
