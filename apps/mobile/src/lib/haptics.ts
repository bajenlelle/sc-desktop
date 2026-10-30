/**
 * Haptics, used sparingly (Apple: causality, harmony, utility): a selection
 * tick when a segmented control or menu changes, and a success tap when an
 * action completes (a reminder sent, a club joined). Fire-and-forget; devices
 * without a Taptic Engine (and simulators) simply do nothing.
 */
import * as Haptics from "expo-haptics";

export function selectionHaptic() {
  Haptics.selectionAsync().catch(() => {});
}

export function successHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function warningHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
