# 10 - Mobile Design

Version: 0.3. Date: 2026-09-12. Direction: requested by Jop. Implementation status: specification; no mobile app exists yet.

## 1. Design direction

A quiet messaging app for a small team of assistants. Use the layouts in [the mobile reference inventory](research/notes-mobile-design.md): generous whitespace, circular avatars, flat conversation rows, rounded message bubbles, a compact composer, and grouped settings in a sheet. Colors come from Hermes's semantic theme system. Keep the main experience focused on conversations.

Home is a single screen, not a permanent multi-tab dashboard. The account avatar opens Settings, search opens a focused search view, and the plus button opens a compact creation menu. Routines, files, tools, model selection, and memory live behind the agent's name in chat. The board and catalog are secondary destinations when their phases ship.

## 2. Hermes theme source and resolution

Verified in the adjacent `hermes-agent` checkout at commit `d76856cc6971b6e0e1903b5369498bcc4bb83a60`:

| Source under that checkout | Role |
|---|---|
| `apps/desktop/src/themes/presets.ts` | Built-in palettes; `DEFAULT_SKIN_NAME = 'nous'`; light `colors` and dark `darkColors` |
| `apps/desktop/src/themes/types.ts` | `DesktopThemeColors` semantic token contract |
| `apps/shared/src/skin.ts` | `HermesSkin` payload from the backend |
| `apps/desktop/src/themes/skin.ts` and `color.ts` | Pure `skinToDesktopTheme` conversion and color helpers |
| `apps/desktop/src/themes/backend-sync.ts` | Built-in names retain their desktop palettes; `default` resolves to Nous; connect-time skin discovery does not overwrite a saved choice |

Port the pure palette data and conversion functions into the app's pinned vendor directory, retaining the upstream license and provenance. Adapt persistence and application to React Native; do not import desktop DOM, CSS, localStorage, or nanostore wiring. Components consume a typed mobile theme object rather than literal hex colors. Palette upgrades happen with the Hermes pin.

Initial appearance is **System**, using Nous light or dark as appropriate. Settings offers Appearance (System / Light / Dark) and Theme (Hermes built-ins, plus valid discovered skins). Cache the selected non-secret palette for first paint. A custom single-mode skin keeps its supplied palette in both appearances, matching Hermes's converter.

On `gateway.ready`, register discovered skins without replacing the saved mobile preference. On an explicit `skin.changed`, apply the valid active gateway skin using the desktop resolution rules; events from inactive connections must not repaint the app. A built-in name always resolves to its preset, and `default` means Nous. Invalid payloads retain the last valid palette. A mobile-only Appearance/Theme change does not write gateway config. Cross-device synchronization of local desktop preferences is not provided by these backend events.

## 3. Default palette and component mapping

These values are a reference snapshot of `nousTheme`, not a second independently maintained palette. Preview and eventual app code must use the vendored source tokens.

| Semantic token | Light | Dark | Mobile use |
|---|---|---|---|
| `background` | `#ffffff` | `#0d1117` | Home and chat canvas |
| `foreground` | `#1f2328` | `#e6edf3` | Names and body text |
| `card` | `#f6f8fa` | `#010409` | Secondary inset surfaces where separation remains clear |
| `muted` | `#f6f6f6` | `#1a1e24` | Assistant bubbles, grouped settings rows, title badges |
| `mutedForeground` | `#656d76` | `#7d8590` | Metadata, timestamps; verify contrast on the actual surface |
| `popover` | `#ffffff` | `#161b22` | Creation menu and settings sheet |
| `primary` / `midground` | `#0053fd` | `#4a84fe` | Send action, selection, unread dot, active switch |
| `primaryForeground` | `#ffffff` | `#161616` | Text/icon on filled primary controls |
| `accent` | `#e3edff` | `#17243a` | Quiet selected surfaces |
| `border` | `#d0d7de` | `#30363d` | Composer outline, sheet dividers |
| `input` | `#ffffff` | `#0d1117` | Composer and search input |
| `userBubble` | `#dae7fd` | `#07162c` | User messages, with `foreground` text |
| `destructive` | `#cf222e` | `#f85149` | Delete, sign-out, errors with text labels |

Use accent color sparingly. Regular row icons and navigation stay neutral; photos carry most of the visual variety. Use paired surface/foreground tokens for buttons. For small text, validate the resolved contrast rather than lowering opacity; promote metadata to `foreground` on a surface where its muted token fails the accessibility check. The screenshot's green switches and orange working mascot are not copied. Working state uses a small Hermes-accent indicator plus text; there is no new mascot asset.

## 4. Layout and interaction contract

All dimensions below are logical points/dp, not screenshot pixels. Reference screenshots are 1179 × 2556 physical pixels; do not reproduce that scale in React Native.

| Element | Initial design value | Behavior |
|---|---|---|
| Page padding | 20; 16 on narrow devices | Respect safe areas; never overlap content with the status bar |
| Spacing scale | 4, 8, 12, 16, 24, 32 | Use whitespace to group content |
| Body and composer | 17 / 24 line height | Native system font, scalable with device text size |
| Row name | 17, medium | One line normally; permit wrapping with larger text |
| Metadata | 13–15 | Legible contrast; accessible full value for truncation |
| Controls | At least 44 × 44 hit area | Simple outline icons; screen-reader labels |
| List avatar | 48 | Circular image or initials fallback |
| Pinned avatar | 80–88 | Up to two prominent shortcuts; empty section hidden |
| Chat avatar | 28–32 | Part of the agent details button |
| Bubble | Radius 22; padding 12 × 16; max width 88% | Natural content width; assistant left, user right |
| Composer | Minimum 48 high; radius 24 | Grows up to five lines, then scrolls within the input |
| Settings group | Radius 20; row minimum 52 | Dividers inset to text; labels wrap at large text sizes |
| Sheet | Radius 28 at top | Close button, native dismissal and Android back support |

### Home

- Top row: account avatar at left; Search and Add at right. No large marketing header, counts, charts, or permanent bottom tab bar.
- Optional pinned agents below; pins and order are device preferences. New installs pin the concierge only.
- Recent conversations: avatar, name, compact role badge when it fits, timestamp, one-line message or event preview. An unread dot includes an accessible unread label. Avoid cards or separators around each row.
- The Add menu contains New Agent; New Group Chat appears when Phase 2 rooms are available. Selecting an action closes the menu before opening its sheet.
- Search focuses its input. Phase 1 searches the loaded roster by name, role, and description; Phase 2 adds conversation-content search. State the selected scope in the input label. Closing search restores home position.

### Bot actions

Long-press a conversation or pinned avatar to open a compact action menu. Provide the same actions through the agent details overflow and native accessibility actions, so long-press is never the only route. Add **Edit Bot** as the first action: it is Jop's explicit requirement, even though it is not shown in the two additional menu screenshots. Keep the highlighted row visible behind the menu; use an opaque `popover` surface and neutral icons. Dismiss on outside tap or Back, and return focus to the trigger.

| Action | Behavior | Phase |
|---|---|---|
| Edit Bot | Opens the editor below; also available directly from agent details | 1 |
| Mark Unread / Mark Read | Device-local reading marker; opening the conversation clears the manual unread flag | 1 |
| Pin / Unpin | Device-local shortcut; first two prominent, additional pins in a horizontal strip | 1 |
| New Section / Move to Section | Device-local named sections and membership; remove section returns its agents to the ordinary list | 1 |
| Hide / Unhide | Shared Hermes bot metadata; removes from the usual roster without pausing work or muting notifications. Settings > Hidden Bots provides recovery | 1 |
| Share as Template | Review a sanitized configuration snapshot before export; exclude credentials, conversation history, memory, files and active routines by default | 2 |
| More > Copy ID | Copy the profile identifier with its gateway label; no URL credentials or access token | 1 |
| More > Duplicate | New identity from a reviewed configuration snapshot, with fresh provisioning and separately approved tool access. Do not copy secrets, history, memory or active schedules | 2 |
| More > Delete | Confirm the named bot and data affected; stop work, settle pending approvals, clean up owned routines/subscriptions, then delete. Default concierge cannot be deleted | 1 |

Template and duplication actions are part of the design and remain absent until Phase 2 is implemented. Hide is reversible and neutral; Delete uses `destructive`. Deletion cleanup and failure recovery must pass the lifecycle gate in 11. New Section is an organization feature, not a group chat. Device-local pins/sections deliberately do not claim desktop synchronization; mobile must preserve any existing desktop `pinned` and `sectionId` metadata when saving other fields.

### Chat

- Header: Back, compact avatar/name button, and an Activity button only when relevant. Agent name opens details. No Computer icon or model/usage toolbar in the default header.
- Header surface is opaque or sufficiently filled; scrolling messages never reduce its legibility. Insets keep the latest content clear of header and composer.
- Assistant and user bubbles use the mapped tokens. Event rows are smaller and unboxed. Timestamps appear at useful breaks and through message details rather than on every bubble.
- While working, show one short line such as “Linh is working” and a Stop action. Tool details, subagents, and available reasoning are behind Activity, collapsed by default. Do not fabricate reasoning content.
- Composer: separate Attach button, rounded “Ask Linh” input, Mic when empty and Send when text exists. Keyboard Return inserts a newline; Send is explicit. Voice recording requires a clear recording state and cancel control.
- Use native keyboard insets and safe-area handling. Preserve scroll position and drafts through backgrounding. Follow new output only when the user is already at the bottom; otherwise show a jump-to-latest control.
- Approval and creation cards appear inline with the same radius and typography, concise action descriptions, and explicit actions. Requests remain accessible from Activity after reconnect. Technical configuration and raw protocol errors stay in details/debug views.

### Settings and agent details

- Account avatar opens the grouped sheet pattern from the references: gateway/account, usage when available, connectors, appearance/language/haptics, notification preferences, about/version, sign-out.
- Show measured usage and its unit. Do not invent a subscription percentage for providers that expose only tokens or cost estimates.
- Agent details puts **Edit Bot** first, followed by routines, tools/connectors, memory and files, with an overflow for the roster actions above. The editor contains model and instructions. Advanced holds approvals mode, terminal configuration and iteration settings; labels explain their actual scope.
- Permission switches distinguish “Applying…” from “Off”; do not claim a live connector is disabled until the enforcement transition in [04](04-security-and-compliance.md#5-least-privilege-tool-model) completes.
- Notification toggles are effective server subscription settings once the integration supports them; a phone-only preference cannot stop the ntfy service publishing.
- Timezone changes affect display by default. Editing a recurring routine's timezone shows its next run for confirmation; travel must not silently rewrite existing schedules.
- Offer only implemented destinations. Do not reproduce vendor subscription, legal, Computer, Auto-review Rules, or Help Center rows that have no Ergates implementation.

### Edit Bot on mobile

Mobile provides desktop-equivalent bot editing in a full-height sheet or pushed screen. A stable header contains Cancel, **Edit Bot**, and Save. The basic form is short; long instructions and capability lists open focused subpages that return to the same unsaved draft. Opening a picker does not save. Routines, memories and files remain separate destinations.

| Field | Mobile presentation / persistence |
|---|---|
| Name | Friendly display name, stored as `ui_meta['hermes-bots'].title`, matching desktop Bot Mode. The underlying profile identifier stays unchanged |
| Avatar | Preview, choose/replace/remove photo, or initials/shape fallback; existing desktop shape/color remains representable. Compress/convert before the 2,000,000-byte PNG/JPEG/WebP asset limit |
| Role | Optional short badge, e.g. “Dining scout”; proposed `ui_meta.ergates.role`, separate from Hermes's `title`, which is the display name |
| Description | Short purpose statement in Hermes profile metadata |
| Instructions | Multiline `SOUL.md` editor; preserve the existing text and any required messaging protocol, never silently replace it with the description |
| Provider / Model | Server-supported picker plus custom model name; show model-specific confirmation when required |
| Skills / Tools / Connectors | Searchable capability subpages with staged changes and accurate current/effective status; narrower tool access by default |
| Notifications | Per-agent subscription preference, saved through the server attention integration; show pending/unavailable state until confirmed |
| Advanced | Supported reasoning effort, approvals mode, terminal and iteration settings through separately verified config calls; do not send unknown fields to `profiles.configure` |

Source parity: `apps/desktop/src/plugins/hermes-bots/edit-profile-dialog.tsx` and `profile-config.tsx` at the pin support appearance/title/description plus model, SOUL, skills, toolsets and MCP. `labels.ts` confirms that desktop **Title** is a friendly name, not a separate role badge. The explicit mobile role and subscription fields are Ergates additions. User-initiated edits call authenticated profile/config operations directly; they do not require the concierge proposal flow.

Load current values and metadata revisions on entry, stage only changed fields, and enable Save only for a valid dirty form. Cancel discards the draft; closing a dirty form offers Keep Editing or Discard. Offline edits may remain an encrypted draft, but never report “Saved” or automatically apply stale configuration on reconnect. Refetch before saving after reconnect.

Save retains the screen while it runs. Use per-key `ui_meta_expected_revisions`, preserve unrelated/unknown metadata, and reconcile a conflict against the fresh server version before an explicit retry. These revisions protect metadata only: SOUL, model, capability and asset writes lack an established atomic cross-field/version contract. Compare fresh values before writing; require a serialized integration check if conflict-free concurrent editing is promised. Never label the whole form atomic.

Inspect each `applied` result, the separate avatar response, and notification save. On partial failure, show which sections saved and keep failed edits available for retry; Cancel cannot roll back sections already saved. A model-confirmation response resubmits only that section after the user's decision. Do not copy the desktop's immediate capability side effects into a form that promises Save/Cancel.

Refresh Home, search, pinned labels, chat identity and details after confirmed saves. Model/instruction changes apply between turns according to verified lifecycle behavior; tool revocation stays “Applying…” until stop/rebuild/verification finishes. Keep the profile id, chat, memories, files and routines intact when changing the display name. Actual profile-directory renaming is a separate migration operation, outside this editor.

## 5. Essential states

| State | What stays simple and explicit |
|---|---|
| First launch | Connect a gateway, then open the concierge; no empty dashboard |
| Offline | Small connection line; preserve drafts; queued-unsent messages clearly marked |
| Delivery uncertain | “Delivery unconfirmed”; inspect history before a deliberate retry; never silently duplicate an action |
| Approval expired | Card says Expired; action buttons disabled; retry starts a fresh request |
| Agent provisioning interrupted | “Setup incomplete”; resume only after checking existing profile/receipt |
| Empty search | One explanatory line and a clear dismiss path |
| Large text | Wrap settings and message text; hide optional role badge before compressing names |
| Reduced motion | Static working indicator; native transitions reduced; no perpetual decorative animation |

## 6. Visual acceptance

Compare Home, Chat (keyboard open/closed), Search, Add menu, bot action menu/More, Edit Bot (basic and advanced), Settings and an approval card against the supplied reference layouts. Check on 320–430 logical-pixel widths, iPhone safe areas, Android, both Nous appearances, and large text. Verify screen-reader labels, focus return after sheets, non-color state indicators, and contrast on every mapped surface. Theme switching must recolor all surfaces and controls without changing layout or resetting the conversation. Exercise Save, Cancel, dirty dismissal, partial failure, concurrent metadata edits and a model/tool change during an active turn. Confirm a display-name edit appears across Home/search/chat while the same profile and transcript remain selected.

The conversation preview illustrates this direction with sample content. It is not a working mobile build; this document and the implementation checks remain authoritative.
