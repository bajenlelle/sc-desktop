/**
 * Bulk playlist reminders with the shared toast vocabulary — used by the
 * SharedByMe dashboard and the Home page's engagement strip / hero.
 *
 * Cooldown handling: reminders-db raises "Already reminded in the last 24
 * hours." per recipient; repeat clicks are expected, so those are counted as
 * neither sent nor failed (detected by the literal "24 hours" — keep in sync
 * with shared/lib/reminders-db.ts).
 */
import { toast } from "sonner";
import { sendPlaylistReminder } from "@/lib/reminders-db";
import { trackEvent } from "@/lib/analytics";

export interface RemindTarget {
  playlistId: string;
  userId: string;
}

export async function bulkSendReminders(
  targets: RemindTarget[],
  onSent?: (target: RemindTarget) => void
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      await sendPlaylistReminder(t.playlistId, t.userId);
      sent++;
      onSent?.(t);
    } catch (e) {
      // Cooldown hits are expected on repeat clicks — not failures.
      if (!(e as Error).message.includes("24 hours")) failed++;
    }
  }
  if (sent > 0) trackEvent("reminder_sent", { bulk: true, count: sent });
  if (sent > 0 && failed === 0) {
    toast.success(`Reminded ${sent} player${sent === 1 ? "" : "s"}`);
  } else if (sent > 0) {
    toast.warning(`Reminded ${sent}, ${failed} failed`);
  } else if (failed === 0) {
    toast.info("Everyone was already reminded recently");
  } else {
    toast.error("Couldn't send reminders — try again");
  }
  return { sent, failed };
}
