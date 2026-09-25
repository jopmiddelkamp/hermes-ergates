/** Public API of the attention feature (ADR-029): screens, UI and other features import only this file. */
export { openTarget, rewriteDeepLink, type OpenTarget } from './deep-link'
export { draftFromPrefs, normalizeClock, prefsFromDraft, scopeLabel, type PrefsDraft } from './prefs'
export { attentionPrefsKey, useAttentionPrefs } from './use-attention-prefs'
