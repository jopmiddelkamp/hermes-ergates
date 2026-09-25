/**
 * The one place that touches `expo-haptics` (docs/10 "Settings": "A light tap
 * when you send or open a menu"). Screens stay wiring-only: they pass the
 * user's `prefs.haptics` and this decides whether anything happens.
 *
 * Fire-and-forget: haptics are never worth an error path, and the module is
 * imported lazily so importing this file costs nothing under Node/Vitest.
 */

export function lightTap(enabled: boolean): void {
  if (!enabled) {
    return
  }
  void import('expo-haptics')
    .then(m => m.impactAsync(m.ImpactFeedbackStyle.Light))
    .catch(() => {
      // A device without a haptics engine (or a simulator) is not an error.
    })
}
