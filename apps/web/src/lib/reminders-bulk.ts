/**
 * Bulk playlist reminders with the shared toast vocabulary: Home's next
 * action ("N players haven't finished watching") sends one per straggler of
 * the newest shared playlist. The web twin of the desktop's
 * lib/reminders-bulk.ts.
 *
 * Cooldown handling: reminders-db raises "Already reminded in the last 24
 * hours." per recipient; repeat clicks are expected, so those count as
 * neither sent nor failed (detected by the literal "24 hours"; keep in sync
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
  targets: readonly RemindTarget[],
  onSent?: (target: RemindTarget) => void,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      await sendPlaylistReminder(t.playlistId, t.userId);
      sent++;
      onSent?.(t);
    } catch (e) {
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
    toast.error("Couldn't send reminders. Try again.");
  }
  return { sent, failed };
}
