/** Public API of the agents feature (ADR-029): screens, UI and other features import only this file. */
export { createAgent, slugFromTitle, validateCreate } from './create'
export { deleteAgent } from './delete'
export { AVATAR_MAX_BYTES, botsMeta, type SaveOutcome, type SaveSection } from './editor'
export { EditBotProvider, useEditBotContext } from './editor-context'
export { rosterKey, searchBots, useAvatar, useDescribe, useModelOptions, useRoster, useSetHidden, type Bot } from './roster'
export { useHome } from './use-home'
