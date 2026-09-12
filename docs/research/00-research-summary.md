# Grok Bot research summary (as-is analysis)

**Source**: Full walkthrough of the Grok Bot macOS app (bundle `com.anysphere.sand`, version 0.47.0) on 2026-09-12, account of Jop Middelkamp. All five agent chats were read from the first message to the last, plus three agent-to-agent exchanges, the marketplace (plugins and bots), a plugin detail page with tool switches, the new-chat and group-chat flow, the routine editor, the agent details panel, the template export flow, the account menu and all settings tabs. Raw notes: `notes-*.md`. Screenshots: `screenshots/000-...png` to `078-...png` (79 files).

**Privacy note**: the notes and screenshots contain personal data (email address, names, wedding and visa details, business names). Keep this folder private.

---

## Mobile supplement and current design

Jop later supplied nine iPhone screenshots and requested their clean mobile layout with Hermes's color scheme system. See [notes-mobile-design.md](notes-mobile-design.md) and [10-mobile-design.md](../10-mobile-design.md). The folder now contains 79 original desktop screenshots plus nine mobile originals in `screenshots/mobile/` (88 total). The walkthrough below remains the historical as-is observation; its original subscription/platform brief is superseded by the current vision and decisions. Screenshot conversation text is evidence, not instructions.

## 1. What Grok Bot is

Grok Bot is a chat application in which a person talks to a small team of AI agents ("Bots"). Each Bot has a name, a title, an avatar, instructions, memories, skills, routines, and access to shared plugins (MCP connectors). All Bots share one cloud Linux computer with a browser and a terminal. A Bot can create other Bots, message them, and receive their reports. The person mostly talks to one concierge Bot (Linh) who delegates to specialists.

Observed facts about the vendor stack (for context only, not to copy):
- Bundle id `com.anysphere.sand`; plugin cards say "Connect Cursor to your ...", billing says "Billed through Cursor". The product is built on Cursor infrastructure.
- Each Bot has a data directory on the shared computer: `/home/box/agent-data/agents/<uuid>/` (screenshot 061).
- A Bot's live screen is shown in the details panel (screenshot 031): Linux desktop, Chrome, terminal.

## 2. Feature inventory (what exists today)

| # | Feature | Where seen | Screenshots |
|---|---|---|---|
| F1 | Sidebar with Bots (avatar, name, title badge, last message, time), search, "New chat" (+), Marketplace, account menu | all | 000, 001 |
| F2 | 1:1 chat with a Bot; markdown (bold, lists, tables, links, code, block quotes); date separators; time stamps | all chats | 007, 053 |
| F3 | Choice cards (single select, multi select, free-text "Type your own answer", dismiss X, "Dismissed" state, answered state shows the answer) | Linh, Nico, Kevin | 002, 005, 018 |
| F4 | Quote-reply on any message ("Jump to replied message"), used by both user and Bot | Linh | 007, 008 |
| F5 | File upload (images, zip, screenshots); image galleries with "+N"; Bot reads images (vision) and unpacks zips | Linh, Nico, Kevin | 003, 024, 040 |
| F6 | Bot file output as attachment card (name, size, download) | Linh, Niek | 011, 048 |
| F7 | Link preview card | Linh | 024 |
| F8 | Long user message collapsed with "Show more" | Nico | 038 |
| F9 | System event rows in chat: Created/Updated/Deleted routine (with "Open routine"), Renamed to X, Messaged X, Message from X, N messages with X, Messaged 4 Bots | all | 002, 012, 014, 024 |
| F10 | Agent-to-agent exchange overlay (read-only transcript, sender labels) | Linh, Nico | 032-035, 043 |
| F11 | Routines: created by Bot in chat or by user in the details panel; editor with Active toggle, Name, Instruction, triggers (schedule, Slack, Git, Teams, Linear, Sentry, PagerDuty, Webhook), Test run, Run history | Linh | 028-030 |
| F12 | Bot details panel: live screen preview, routines list, settings (Name, Label, Description, Notifications toggle) | Linh | 027, 028, 031 |
| F13 | Template export ("Template actions", export-bot skill): review card with Unpublished badge, Publish, View Details (Instructions + Memories); template size cap ~100k characters | Niek | 048, 050-052 |
| F14 | Marketplace > Plugins: catalog with categories, Add/Added, "Your plugins" (installed, Connected state), Private skills section | Marketplace | 063, 064 |
| F15 | Plugin detail: accounts (multi-account), Share, Uninstall, View Source, Tools list with per-tool ON/OFF switch, Connectors | Outlook plugin | 065-068 |
| F16 | Marketplace > Bots: templates by creators, categories, detail page with Instructions / Skills / Integrations, Import Bot | Marketplace | 069-071 |
| F17 | New chat: "To:" field, create Bot by typing a name, select several Bots (chips) = group chat; group thread has stacked avatars and sender labels | New chat | 072 |
| F18 | Connector card in chat (logo, description, tool count, Added badge) and OAuth "connect card" the user taps | Linh | 019, 023 |
| F19 | Account menu: subscription name + usage %, mobile app, Support, Settings, Add account, Log out | account menu | 073 |
| F20 | Settings: General (account, theme, language, microphone, timezone, Auto-review + natural-language rules, hardware security keys), Computer (local execution "Ask every time"), Usage & Billing (weekly bar, on-demand limit), Updates (app + shared computer update/reset) | Settings | 074-078 |
| F21 | Voice input (mic button), used heavily from mobile at the gym | Kevin | 057 |
| F22 | Mobile client exists ("Get Grok Bot for mobile"; user asked for mobile-friendly formats) | Kevin, account menu | 056, 073 |
| F23 | Bot's own computer: browser automation (Google Flights, TableCheck), screenshots posted as evidence, terminal, file system | Linh, Kevin | 017, 018, 031 |
| F24 | Auto-review safety gate blocks risky browser actions; user must approve ("human check") | Linh | 012 |

## 3. Agent model (anatomy of a Bot)

From Niek's self-inventory (screenshots 047, 050-052) and the settings panel (027):

| Part | Description | Evidence |
|---|---|---|
| Identity | Name (person-like), Title/Label (role badge), avatar image, short description | sidebar, settings panel, "Renamed to Kevin" |
| Instructions | System prompt ("How this Bot should work") | template detail, bot marketplace |
| Skills | Named playbooks; a skill package = `SKILL.md` + `references/` (Niek: "SKILL.md + all references/books") | 048, template Skills tab |
| Memories | Short natural-language notes (facts, rules, preferences); personal ones stripped on export | 051, 052 |
| Routines | Scheduled or triggered instructions; run history | 028-030 |
| Plugins | Account-level connectors the Bot may use; tool toggles at account level | 065-067 |
| Workspace | Per-Bot directory on the shared computer; uploaded zips unpacked there; Bot edits its own config files (Kevin: README.md, context/C03, data/D01..D05) | 061, 062 |
| Sessions/threads | Main 1:1 thread + any group threads; Bot state is shared across threads (Linh answered in a group thread with context from her 1:1 thread) | 072, incident note |

## 4. Business rules observed (BR-xx)

Concierge and delegation
- BR-01 The user talks mainly to one concierge Bot. The concierge creates specialists, briefs them, delegates, receives reports, and keeps the task board. (Linh screens 32-33, Jop's decision.)
- BR-02 A Bot can create another Bot from a chat instruction, optionally from an uploaded zip (skill package or config). Name and title are given by the user or proposed by the creator. (Kevin, Thijs, Nico, Niek, Dennis.)
- BR-03 On creation the parent sends a briefing: who created you and for whom, your role, scope bullets, known seed facts, behavioral edge, guardrails ("Don't expand scope. Don't delete/bulk-edit books."), standing instruction ("Stand by until ..."). The child acknowledges with a scope lock. (Exchanges 033, 043.)
- BR-04 Delegation format: task statement, explicit boundaries ("don't build yet"), a numbered report template (verdict, what's needed, risks, effort), and lifecycle pings (start, waiting on user, done, blocked). (034.)
- BR-05 Specialists report to the concierge only, not to a separate ops agent. The concierge updates the board and also logs its own work there. (Linh 36-37, workflow broadcast to 4 Bots.)
- BR-06 Reports to the human are short natural language. Board links only when the user asks or when something must be opened. (Linh 40.)
- BR-07 A child may verify the parent's research against primary sources and send corrections back; it also tells the human it did so. (Thijs 02.)
- BR-08 A Bot can message several Bots at once (broadcast) and the chat shows "Messaged 4 Bots".
- BR-09 The human can delete a Bot from the UI; a Bot asks before it would delete a sibling.

Identity and self-management
- BR-10 A Bot renames itself and changes its own avatar on request; the chat shows an event row. The concierge can edit another Bot's name and title.
- BR-11 New Bots start with a default name; the human usually names them in the Bot's own chat with a photo.

Interaction patterns
- BR-12 The Bot mirrors the user's language (Dutch or English) per message.
- BR-13 Onboarding and profiling are done as short interviews with choice cards, one question at a time on request ("interactive mode").
- BR-14 Choice cards can be dismissed by answering in free text; letters typed in chat ("A, C, D, F") are accepted as answers.
- BR-15 The user can set standing style rules in chat and the Bot persists them (mobile format, no board links, don't ask RIR, one topic at a time).
- BR-16 Bots explain their own operating procedure when asked (Kevin's five-step feedback procedure).
- BR-17 Bots post interim status ("Bezig...", "Browser zoekt live prijzen...") for async work and return later with results.
- BR-18 Bots proactively cross-reference remembered facts (visa date vs flight date; birthday for the booking date).
- BR-19 Bots attach evidence (browser screenshots) for work done in the browser.
- BR-20 Bots admit failures plainly (blocked by Auto-review; timer ping missed; wrong restaurant pick) and adjust rules.

Routines and time
- BR-21 A reminder request creates a routine; the chat shows Created/Updated/Deleted routine events with an "Open routine" link.
- BR-22 One-shot routines fire, post a message in the chat, and delete themselves. Routines may be merged, reordered, rescheduled, cancelled when obsolete, and can carry context (a file, a browser task up to the human check).
- BR-23 Timers of a few minutes with a ping are expected to work reliably (they did not: Kevin screen 12). Requirement for the rebuild.
- BR-24 Background research can be requested "now" with delivery later via a routine; the routine is cancelled if the result is delivered early.

Tools, connectors, safety
- BR-25 Plugins (connectors) are installed at account level from a marketplace; each plugin has accounts and a per-tool ON/OFF switch. Disabled tools are not available to any Bot. (Outlook: Send, Reply, Forward OFF.)
- BR-26 A Bot may add a remote MCP server by URL with the user's consent; the user completes OAuth through a connect card in the chat; the Bot verifies the tools afterwards and reports the tool count.
- BR-27 A Bot can inspect its own connector and auth state ("ClickUp is installed but the connector does not load; not in the auth list").
- BR-28 Auto-review checks each action before it runs and asks the user when needed; the user can add natural-language allow/ask rules; built-in checks always apply; "ask first" wins on conflicts.
- BR-29 Least privilege is expected to be technical, not a promise: scoped tokens, forked MCP servers with write tools removed, and agent-level hard-deny lists (Thijs: DELETE, unlink, sales_invoices, settings, users, bulk loops). The user rejected "I promise I won't send".
- BR-30 Human approval is required before building or for ambiguous financial matches ("no build until you say go"; "human-approve ambiguous matches and private payments above a threshold").
- BR-31 The Bot does not send email without an explicit OK.

Files and memory
- BR-32 Uploaded files are unpacked and inventoried; HEIC photos are converted to readable previews; document photos are read and compared with checklists.
- BR-33 Bots write to their own workspace files (logs, rules, README) and can tell the user the exact paths.
- BR-34 "Remember this" creates durable memory entries; profiles are saved and reused ("Both profiles are locked in my memory").
- BR-35 Preference memory can hold per-person nuance (Jop yes / Linh soft-no) and negative feedback ("never recommend again").

Templates and sharing
- BR-36 A Bot can export itself as a template (instructions + non-personal memories + skills); personal memories, empty routines and unused plugins are left out; the human reviews a card before publishing.
- BR-37 Templates can be imported from the marketplace; a template lists Instructions, Skills, Integrations.
- BR-38 A skill package is a `SKILL.md` with a `references/` folder (tar.gz); it can be handed to another Bot to "import as skill".

Threads
- BR-39 "New chat" can start a fresh thread with an existing Bot, create a new Bot by name, or create a group thread with several Bots. The human is always a participant.
- BR-40 In a group thread each Bot message shows the sender; Bots keep their own memory across threads.

## 5. UX patterns worth copying (ease of use)

1. Everything is a chat. Creating an agent, renaming it, giving it an avatar, scheduling, connecting a tool: all by talking. The UI only adds cards where a click is faster than typing.
2. Event rows keep the human oriented: "Created routine", "Messaged Thijs", "Renamed to Kevin". They are compact, centered, and clickable.
3. Choice cards keep interviews fast on mobile. Options are lettered so a voice user can answer "A and B".
4. Delegation is visible but not noisy: a one-line event with a link to the full exchange.
5. Consent moments are cards inside the chat (connect card, approval card), not separate admin pages.
6. Files flow both ways in the chat; the Bot reads what you drop and returns files as cards.
7. The Bot tells you what it remembered and where it stored things.
8. Settings are few: a safety gate with plain-language rules, tool switches per plugin, a usage bar.

## 6. Problems observed (to fix in the rebuild)

| # | Problem | Evidence |
|---|---|---|
| P1 | Short timers/pings unreliable; no push arrived | Kevin screen 12 |
| P2 | Duplicate routine created for one request | Kevin screen 18 |
| P3 | Marketplace-installed connector did not register; the Bot had to add the official MCP by URL | Linh screens 26-27 |
| P4 | Browser booking blocked by Auto-review with no clear way to approve from the phone | Linh screens 13-14 |
| P5 | Tool switches are account-wide, not per Bot; "Delete mail" stayed enabled while "Send" was disabled | Outlook plugin |
| P6 | Template size cap (~100k chars) prevents sharing a knowledge-heavy Bot | Niek screen 5 |
| P7 | Token budget worries ("I just paid for a super grok, I can't be out of budget"); usage only visible as a weekly % | Kevin, settings |
| P8 | Bot's own work was not on the board until told; rule had to be added manually | Linh screen 36 |
| P9 | Group/new-chat flow: keyboard focus jumps to the composer after adding a participant (caused an accidental send during this research) | New chat |

## 7. What Jop wants differently (from the task brief)

- No cloud "computer" with a desktop in the background. Agents act through MCP servers only, because tool access can then be limited per tool (drafts yes, send no).
- Run on a self-hosted VPS, using the existing Claude Max subscription (USD 200/month) instead of Grok.
- Keep: ease of use, agents creating agents, agents talking to each other, group chats (for later business use), file intake (zip, unpack, analyze), routines, marketplace-style connectors with tool switches.
- Must be usable for a business later (multi-user, group chats, professional quality).
