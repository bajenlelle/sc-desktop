import { AuthHeading, AuthShell } from "@/components/auth/auth-frame";
import { seasonLabel } from "@scoutable/shared/lib/player-access";

export type CompleteState =
  | { kind: "ready"; purchase: "single_game" | "season_pass"; teamName: string | null; seasonId: string | null }
  | { kind: "processing" }
  | { kind: "canceled" }
  | { kind: "unknown" };

function copy(state: CompleteState): { title: string; description: string } {
  switch (state.kind) {
    case "ready":
      if (state.purchase === "season_pass") {
        const season = state.seasonId ? ` ${seasonLabel(state.seasonId)}` : "";
        return {
          title: `Your season pass${season} is ready`,
          description: state.teamName
            ? `Every ${state.teamName} game this season is included. Go back to Scoutable to import your games.`
            : "Go back to Scoutable to import your games.",
        };
      }
      return {
        title: "Your game is ready",
        description: "Go back to Scoutable to import it. A receipt is on its way to your email.",
      };
    case "processing":
      return {
        title: "Payment processing",
        description: "Your purchase shows up in Scoutable as soon as the payment goes through. You can close this page.",
      };
    case "canceled":
      return {
        title: "Payment canceled",
        description: "Nothing was charged. Go back to Scoutable to choose again.",
      };
    default:
      return {
        title: "This payment couldn't be confirmed",
        description:
          "If you paid, the purchase reaches your account within a few minutes. Questions: hello@scoutable.se",
      };
  }
}

export default function PurchaseCompleteView({ state }: { state: CompleteState }) {
  const { title, description } = copy(state);
  return (
    <AuthShell>
      <AuthHeading title={title} description={description} />
      <p className="mt-6 text-center text-callout text-muted-foreground">You can close this tab.</p>
    </AuthShell>
  );
}
