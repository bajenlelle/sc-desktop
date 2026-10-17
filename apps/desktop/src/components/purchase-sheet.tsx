import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "react-qr-code";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink, Loader2, ShoppingBag, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { Callout } from "@/components/ui/group";
import { useAuth } from "@/lib/auth-context";
import { usePlayerAccess } from "@/lib/player-access";
import { openUpgradeFlow, startPlayerCheckout } from "@/lib/billing";
import { trackEvent } from "@/lib/analytics";
import { fadeVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  passNotOfferedReason,
  purchaseArrived,
  sheetOffers,
  type GameAccess,
  type PlayerAccess,
  type PurchaseKind,
  type SheetOffer,
} from "@scoutable/shared/lib/player-access";

/** Where the sheet opened; also the checkout's `surface` for analytics. */
export type PurchaseSurface = "import" | "export_playlist" | "send_to_phone" | "profile";

interface PurchaseSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Overrides the line under the title. */
  description?: string;
  surface: PurchaseSurface;
  /** The game that hit the limit (import); null from export or the profile. */
  game: GameAccess | null;
  gameKey?: string | null;
  /** upgrade_gate_hit's `feature`, so the existing funnel keeps counting. */
  analyticsFeature: string;
  /** A purchase arrived while the sheet waited, e.g. to resume an import. */
  onPurchased?: (kind: PurchaseKind) => void;
  /** Opens "Your team" when the pass can't be offered without one. */
  onSetTeam?: () => void;
}

const POLL_MS = 3_000;
const WAIT_LIMIT_MS = 10 * 60_000;

function priceLabel(o: SheetOffer): string {
  return o.kind === "pro" ? `${o.price} kr a month` : `${o.price} kr`;
}

function defaultDescription(surface: PurchaseSurface, access: PlayerAccess | null): string {
  if (surface === "import") {
    return access && access.trialGames > 0
      ? `You've used your ${access.trialGames} free games. Choose how to import this one.`
      : "Choose how to import this game.";
  }
  if (surface === "profile") return "Buy a game or the season pass. Export opens with any purchase.";
  return "Export opens for all your games when you buy a game or the season pass.";
}

export function PurchaseSheet({
  open,
  onClose,
  title,
  description,
  surface,
  game,
  gameKey,
  analyticsFeature,
  onPurchased,
  onSetTeam,
}: PurchaseSheetProps) {
  const { user, profile, expectPlanChange } = useAuth();
  const { access, reload } = usePlayerAccess();
  const role = profile?.declaredRole ?? null;

  const [phase, setPhase] = useState<"choose" | "waiting">("choose");
  const [busy, setBusy] = useState<SheetOffer["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [waitingKind, setWaitingKind] = useState<PurchaseKind | null>(null);
  const [parentOpen, setParentOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const beforeRef = useRef<PlayerAccess | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    trackEvent("upgrade_gate_hit", { feature: analyticsFeature, player_mode: true });
    setPhase("choose");
    setError(null);
    setCheckoutUrl(null);
    setWaitingKind(null);
    setParentOpen(false);
    setWaitedTooLong(false);
    doneRef.current = false;
  }, [open, analyticsFeature]);

  function finish(kind: PurchaseKind) {
    if (doneRef.current) return;
    doneRef.current = true;
    trackEvent("player_purchase_seen", { kind, surface });
    toast.success(kind === "season_pass" ? "Season pass added" : "Game added");
    onClose();
    onPurchased?.(kind);
  }

  // While waiting: poll, and also react to the provider's own refreshes
  // (focus, imports) through `access`.
  useEffect(() => {
    if (!open || phase !== "waiting" || !waitingKind) return;
    const started = Date.now();
    const timer = window.setInterval(async () => {
      if (Date.now() - started > WAIT_LIMIT_MS) {
        setWaitedTooLong(true);
        window.clearInterval(timer);
        return;
      }
      const fresh = await reload();
      if (fresh && purchaseArrived(beforeRef.current, fresh, waitingKind)) {
        window.clearInterval(timer);
        finish(waitingKind);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
    // finish/reload are stable for this sheet's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, waitingKind]);

  useEffect(() => {
    if (phase === "waiting" && waitingKind && access && purchaseArrived(beforeRef.current, access, waitingKind)) {
      finish(waitingKind);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, phase, waitingKind]);

  async function choose(offer: SheetOffer) {
    setError(null);
    if (offer.kind === "pro") {
      trackEvent("upgrade_clicked", { source: "purchase_sheet", surface });
      setBusy("pro");
      try {
        const err = await openUpgradeFlow(user?.email);
        if (err) { setError(err); return; }
        expectPlanChange();
        onClose();
      } finally {
        setBusy(null);
      }
      return;
    }
    trackEvent("player_checkout_started", {
      kind: offer.kind,
      surface,
      own_team: game?.ownTeam ?? null,
      trial_left: access?.trialLeft ?? null,
      singles_left: access?.singlesLeft ?? null,
      role,
    });
    setBusy(offer.kind);
    beforeRef.current = access;
    try {
      const res = await startPlayerCheckout({ kind: offer.kind, gameKey, surface });
      if ("error" in res) { setError(res.error); return; }
      setCheckoutUrl(res.url);
      setWaitingKind(offer.kind);
      setPhase("waiting");
    } finally {
      setBusy(null);
    }
  }

  function copyLink() {
    if (!checkoutUrl) return;
    void navigator.clipboard.writeText(checkoutUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  function toggleParent() {
    if (!parentOpen) trackEvent("player_parent_link_shown", { kind: waitingKind, surface });
    setParentOpen((v) => !v);
  }

  const offers = access ? sheetOffers(game, access, role === "coach" || role === "player" ? role : null) : [];
  const missingPass = access && game ? passNotOfferedReason(game, access) : null;
  const needsTeam = !!access && !access.team && !!onSetTeam;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-primary" />
            {phase === "waiting" ? "Finish paying in your browser" : title}
          </DialogTitle>
          <DialogDescription>
            {phase === "waiting"
              ? "The payment page is open in your browser. This updates as soon as the payment goes through."
              : description ?? defaultDescription(surface, access)}
          </DialogDescription>
        </DialogHeader>

        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false}>
            {phase === "choose" ? (
              <motion.div key="choose" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="space-y-3">
                <div className="divide-y divide-separator overflow-hidden rounded-window ring-1 ring-separator">
                  {offers.map((o) => (
                    <button
                      key={o.kind}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void choose(o)}
                      className={cn(
                        "flex w-full items-start gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none disabled:opacity-60",
                        o.kind === "season_pass" && "bg-primary/5",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{o.title}</span>
                        <span className="mt-0.5 block text-callout text-muted-foreground">{o.detail}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-foreground nums">
                        {busy === o.kind && <Loader2 className="size-4 animate-spin" />}
                        {priceLabel(o)}
                      </span>
                    </button>
                  ))}
                </div>
                {missingPass && (
                  <Callout
                    action={
                      needsTeam ? (
                        <Button size="xs" variant="outline" onClick={onSetTeam}>
                          Set your team
                        </Button>
                      ) : undefined
                    }
                  >
                    {missingPass}
                  </Callout>
                )}
                {error && <Callout tone="destructive">{error}</Callout>}
              </motion.div>
            ) : (
              <motion.div key="waiting" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="space-y-3">
                <div className="flex items-center gap-2 text-callout text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Waiting for the payment…
                </div>
                {parentOpen && checkoutUrl && (
                  <div className="flex flex-col items-center gap-3 py-1">
                    <div className="rounded-lg bg-white p-3 shadow-menu">
                      <QRCode value={checkoutUrl} size={168} />
                    </div>
                    <p className="text-center text-callout text-muted-foreground">
                      Scan with a phone to pay there, with Swish or a card.
                    </p>
                    <Button variant="outline" size="sm" onClick={copyLink}>
                      {copied ? <Check /> : <Copy />}
                      {copied ? "Copied" : "Copy payment link"}
                    </Button>
                  </div>
                )}
                {waitedTooLong && (
                  <Callout>If you paid, your purchase shows up here within a few minutes. You can close this and keep working.</Callout>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </AutoHeight>

        <DialogFooter>
          {phase === "waiting" ? (
            <>
              <Button variant="outline" onClick={toggleParent}>
                <Smartphone />
                {parentOpen ? "Hide parent link" : "Let a parent pay"}
              </Button>
              <Button variant="outline" onClick={() => checkoutUrl && void openUrl(checkoutUrl)}>
                <ExternalLink />
                Open payment page
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose} disabled={busy !== null}>
              Not now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
