/** Public API of the agents feature (ADR-029): screens, UI and other features import only this file. */
export { createAgent, slugFromTitle, validateCreate } from './create'
export { deleteAgent } from './delete'
export {
  NO_SELECTION,
  buildEditItems,
  editBarLabels,
  editRowLabel,
  hideEach,
  hideFailureMessage,
  liveSelection,
  moveActions,
  moveStep,
  selectedInListOrder,
  selectionTitle,
  toggleSelected,
  type EditBarLabels,
  type EditItem,
  type EditLayout,
  type MoveAction,
  type MoveDirection,
  type Selection
} from './edit-mode'
export { EDIT_SECTION_ACTION, canSaveSectionName, deleteSectionPrompt, type DeletePrompt } from './section-page'
export {
  EDIT_ITEM_HEIGHT,
  NO_SECTION_DRAG,
  dropMove,
  hasHandle,
  listMinHeight,
  nextOrder,
  nextSectionDrag,
  sectionDragItems,
  slotMeta,
  type DragItem,
  type SectionDrag,
  type SectionDragEvent,
  type SlotMeta
} from './drop-rules'
export { canCreateSection, newSection, parseProfiles, profilesParam, sectionChoices, type SectionChoice } from './move-to-section'
export { collectProposals, parseAgentProposal, proposalView, shouldForgetRun, PROPOSAL_KIND, PROPOSE_TOOL, type ProposalAction, type ProposalView } from './proposal'
export { provisionAgent, provisionDeps, provisionOnce, type OpenBotChat, type ProvisionDeps, type ProvisionOptions, type ProvisionOutcome } from './provision'
export { AVATAR_MAX_BYTES, botsMeta, instructionsSummary, modelSummary, type SaveOutcome, type SaveSection } from './editor'
export { EditBotProvider, useEditBotContext } from './editor-context'
export { rosterKey, searchBots, useAvatar, useDescribe, useModelOptions, useRoster, useSetHidden, type Bot } from './roster'
export { useHome } from './use-home'
