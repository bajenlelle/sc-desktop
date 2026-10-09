"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { AuthError } from "@/components/auth/auth-frame";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

/**
 * Apple and Google. The page passes its own sign-in (the OAuth redirect and
 * its analytics); a failure shows inline. The Apple button follows Apple's
 * own style (black in light, white in dark).
 */
export function SocialSignIn({
  onProvider,
}: {
  onProvider: (provider: "apple" | "google") => Promise<void>;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const go = (provider: "apple" | "google") => async () => {
    setError(null);
    try {
      await onProvider(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't open ${provider === "apple" ? "Apple" : "Google"} sign-in`);
    }
  };
  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={go("apple")}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-black text-sm font-medium text-white outline-none transition-[background-color,transform] duration-100 hover:bg-black/85 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-2 pointer-coarse:h-11 dark:bg-white dark:text-black dark:hover:bg-white/90"
      >
        <AppleLogo />
        Continue with Apple
      </button>
      <Button variant="outline" type="button" className="w-full" onClick={go("google")}>
        <GoogleLogo />
        Continue with Google
      </Button>
      <AuthError message={error} />
    </div>
  );
}
