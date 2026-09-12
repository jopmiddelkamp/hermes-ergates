# 02 - Functional Design

| Field | Value |
|---|---|
| Version | 0.1 draft |
| Date | 2026-09-12 |
| Basis | research/00-research-summary.md (business rules BR-01..BR-40), Jop's brief |

Requirement IDs: **FR-xxx** functional, **NFR-xxx** non-functional, **BR-xx** business rules from the research. Priority: **M** must (Phase 1), **S** should (Phase 2), **C** could (Phase 3+).

## 1. Actors

| Actor | Description |
|---|---|
| User (Owner) | The person who chats with agents. Phase 1: Jop only. |
| Concierge agent | The default agent the user talks to. Creates and manages specialists. |
| Specialist agent | An agent created for one role (bookkeeper, trainer, dining scout, coach). |
| Platform | The system itself: stores threads, runs agents, enforces tool policy, schedules routines, sends notifications. |
| Connector | An MCP server the platform exposes to agents (Outlook, ClickUp, Moneybird, and so on). |
| Operator | Person who deploys, updates, backs up (Jop). |
| Org admin / Member | Phase 3 business roles. |

## 2. Epics and user stories

### Epic E1 - Conversations
- US-1.1 As a user I open the app and see my agents in a sidebar with avatar, name, title, last message, and time, so I can pick who to talk to. (M)
- US-1.2 As a user I send text, voice-to-text, images, and files to an agent and get replies with rich formatting. (M)
- US-1.3 As a user I answer a question by tapping a choice card, by typing a letter, or by typing my own answer, so interviews are fast on my phone. (M)
- US-1.4 As a user I quote-reply to a specific message so the agent knows what I mean. (S)
- US-1.5 As a user I see compact event rows (routine created, renamed, messaged X) so I always know what happened. (M)
- US-1.6 As a user I start a new chat with one or more agents (group chat) from a "+" button. (S)
- US-1.7 As a user I search my conversations. (S)

### Epic E2 - Agent lifecycle
- US-2.1 As a user I create an agent by telling the concierge, optionally with a zip that contains a skill package. (M)
- US-2.2 As a user I name an agent and give it an avatar by chatting with it. (M)
- US-2.3 As a user I see and edit an agent's name, title, description, notifications, and enabled connectors in a details panel. (M)
- US-2.4 As a user I delete an agent. (M)
- US-2.5 As a user I export an agent as a template and import a template. (S)
- US-2.6 As a user I choose per agent which harness (Claude Code, Codex CLI, Gemini CLI, Grok Build) and which model it uses, including a custom model name, and I can change it later without losing the agent's memory. (M)
- US-2.7 As an operator I see which harnesses are installed and logged in on the server, and the app only offers those. (M)

### Epic E3 - Agent collaboration
- US-3.1 As a concierge I create a specialist, brief it, and get an acknowledgement. (M)
- US-3.2 As a concierge I delegate a task with a report template and get lifecycle pings (start, waiting, done, blocked). (M)
- US-3.3 As a user I open the exchange between two agents as a read-only transcript. (M)
- US-3.4 As a concierge I broadcast one instruction to several agents. (S)

### Epic E4 - Routines and time
- US-4.1 As a user I ask for a reminder or a timer in chat and it fires on time with a push notification. (M)
- US-4.2 As a user I create or edit a routine in a form: name, instruction, trigger (schedule, webhook), active toggle, test run, run history. (M)
- US-4.3 As an agent I create, update, merge, reschedule, and delete my routines. (M)

### Epic E5 - Tools and connectors
- US-5.1 As a user I add a connector from a catalog, connect my account (OAuth or token), and switch tools on or off one by one. (M)
- US-5.2 As a user I decide per agent which connectors it may use. (M)
- US-5.3 As an agent I ask the user to add or connect a connector through a card in the chat. (S)
- US-5.4 As an agent I can inspect which connectors and tools I have and whether they are authenticated. (M)

### Epic E6 - Safety and approvals
- US-6.1 As a user I approve or deny a risky action from a card in the chat, also on my phone. (M)
- US-6.2 As a user I write plain-language rules ("when an agent wants to create a draft email: allow") and the platform applies them. (S)
- US-6.3 As a user I can rely on built-in hard limits that no rule can override (no sending mail when the tool is off). (M)

### Epic E7 - Files and memory
- US-7.1 As a user I upload a zip; the agent unpacks, converts, and analyzes it. (M)
- US-7.2 As an agent I return files as downloadable cards. (M)
- US-7.3 As a user I say "remember this" and the agent keeps it; I can see and edit the agent's memories. (M)

### Epic E8 - Operations
- US-8.1 As an operator I see usage per agent and per day, and a warning before I hit the subscription window. (S)
- US-8.2 As an operator I deploy, update, back up, and restore with documented commands. (M)

### Epic E9 - Business (Phase 3)
- US-9.1 As an org admin I invite members, assign roles, and let each member bring their own model credential. (C)
- US-9.2 As a member I take part in group chats with agents and colleagues. (C)
- US-9.3 As an org admin I read an audit log of every tool call. (C)

## 3. Functional requirements

### 3.1 Conversations and threads
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-101 | The system keeps threads. A thread has participants: exactly one or more users and one or more agents. | M | BR-39 |
| FR-102 | Each agent has a primary 1:1 thread with the owner, shown in the sidebar with name, title badge, avatar, last message preview, time, unread dot. | M | F1 |
| FR-103 | Messages support Markdown: bold, italics, lists, numbered lists, tables, links, inline code, code blocks, block quotes. Tables must degrade to stacked lists on narrow screens. | M | F2, Kevin |
| FR-104 | Messages carry attachments: images (gallery with +N overflow), files (card with name, size, download), link previews. | M | F5, F6, F7 |
| FR-105 | Long messages collapse with "Show more". | S | F8 |
| FR-106 | Date separators and per-message time stamps in the user's time zone. | M | F2 |
| FR-107 | Quote-reply: any message can be replied to; the reply shows the quoted line and "jump to" link. Agents can quote-reply too. | S | BR (F4) |
| FR-108 | Event rows (centered, small): routine created/updated/deleted (with open link), agent renamed, messaged X, message from X, N messages with X, messaged N agents (click shows the list). | M | F9 |
| FR-109 | Group thread: the header shows stacked avatars and a title (list of names, editable); each agent message shows a sender label; clicking a sender opens the agent's primary thread. | S | F17 |
| FR-110 | New chat flow: a "To:" field that searches agents, offers "Create '<name>' agent", and accepts several agents as chips before the first message. Keyboard focus must stay in the "To:" field until the user leaves it (see P9). | S | F17, P9 |
| FR-111 | Search across threads and messages. | S | F1 |
| FR-112 | Voice input (speech to text) in the composer on mobile and desktop. | M | F21 |
| FR-113 | Live updates: every change (message, streamed text, card, agent, routine, job) reaches all connected devices within one second over a persistent connection; after a disconnect the client catches up by event id without a page refresh. | M | discussion 2026-09-12 |

### 3.2 Choice cards and questions
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-120 | An agent can ask a question with a card: title, optional subtitle, options with letter, label and optional description, single or multi select, optional free-text field, dismiss (X). | M | F3 |
| FR-121 | Answering by tap, by typing letters ("A, C"), or by free text. Free text marks the card "Dismissed" and the text is the answer. | M | BR-14 |
| FR-122 | An answered card shows the chosen options greyed with a check; unanswered cards stay open; the agent can continue without an answer. | M | F3 |
| FR-123 | Cards are usable on a phone with one thumb (large tap targets, no hover). | M | C5 |

### 3.3 Agents
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-130 | Agent record: id, name, title (label), avatar, description, instructions (system prompt), model settings (model, effort), enabled connectors, memory entries, routines, workspace, parent agent id, created by (user or agent), status (active, paused, archived). | M | section 3 research |
| FR-131 | Create an agent from: chat instruction to the concierge; the "New chat" field; a template import; an uploaded zip containing a skill package or config. | M | BR-02 |
| FR-132 | An agent can rename itself, set its own avatar from an uploaded image, and update its own description on user request; the chat logs an event. | M | BR-10 |
| FR-133 | An agent with the "manage agents" capability (the concierge by default) can create, brief, rename, retitle, pause, and propose deletion of other agents. Deletion always needs user confirmation. | M | BR-01, BR-09 |
| FR-134 | Agent details panel: live activity (current tool call, current job), routines list, settings (name, label, description, notifications, model, connectors, memories, workspace files). | M | F12 |
| FR-135 | Each agent has an isolated workspace directory. Uploaded files are placed there. The agent may read, write, and run scripts there. The user can browse and download workspace files from the details panel. | M | BR-33 |
| FR-136 | Default concierge: the first agent created at onboarding; runs the onboarding interview (BR-13); has "manage agents" capability. | M | BR-01 |
| FR-137 | Agent settings include: Agent harness (dropdown of detected harnesses), Model (dropdown of known models for that harness plus "Custom model..." free text), and an Advanced section that shows only the settings the harness supports (effort or reasoning level, approval mode, sandbox level, max turns). | M | Jop's screenshot 2026-09-12 |
| FR-138 | Changing an agent's harness or model keeps its identity, memories, files, routines, jobs, and connectors. The platform rebuilds the conversation context for the new harness from its own message store. | M | C7 |
| FR-139 | Harness detection: on startup and on demand the platform probes the server for installed harness binaries, their version, and their login state (which account, subscription or API key). Results are shown in Settings > Harnesses with a "Re-scan" button and a default harness selector. Undetected harnesses are not offered. | M | Buzz-like behavior |
| FR-13A | Each harness reaches the same platform MCP server and the same MCP gateway, so tool policy, approvals, jobs, memory, and routines work identically regardless of harness. | M | |

### 3.4 Agent-to-agent collaboration
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-140 | Agents exchange messages through the platform. A message from agent A to agent B triggers a turn for B; B's reply is delivered to A and triggers A's turn. | M | BR-03..05 |
| FR-141 | Each pair (A,B) has an exchange thread stored separately; the user can open it read-only from the event row. | M | F10 |
| FR-142 | Broadcast: one message to N agents; the event row shows "Messaged N agents" and lists them. | S | BR-08 |
| FR-143 | Loop protection: a maximum number of automatic agent-to-agent hops per conversation chain (default 6) and a per-hour cap per agent; beyond that the agent must ask the user. | M | safety |
| FR-144 | Creation briefing: when an agent creates another agent, the platform requires a briefing message; the template is provided to the model (who created you, for whom, role, scope, seed facts, edge, guardrails, standing instruction). | M | BR-03 |
| FR-145 | Delegation template and lifecycle pings (start, waiting on user, done, blocked) are provided in the concierge's instructions and enforced by the job tracking tool (FR-160). | M | BR-04 |

### 3.5 Jobs and visibility (replaces "task tracker" pattern)
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-160 | Every unit of agent work is a Job: agent, title "[Agent] verb + object", goal, status (queued, in progress, waiting on user, blocked, done), started, last update, next step, progress notes. Agents create and update jobs through a platform tool. | M | Linh 28-29 |
| FR-161 | The user sees a board view (columns by status) and a per-agent list in the app; optional mirror to ClickUp or another board through a connector. | S | BR-05 |
| FR-162 | Agents also log their own work (the concierge included). | M | BR-05, P8 |

### 3.6 Routines and timers
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-170 | Routine record: agent, name, instruction, active, triggers (one-shot at time, cron schedule, webhook, later: Slack/Teams/Linear/Sentry/PagerDuty), context attachments, run history (time, status, output summary, cost). | M | F11 |
| FR-171 | Agents create, update, merge, reschedule, and delete routines through a platform tool; the chat shows event rows. | M | BR-21, BR-22 |
| FR-172 | One-shot routines delete themselves after a successful run. | M | BR-22 |
| FR-173 | A routine run starts an agent turn with the instruction and context; the output is posted in the agent's primary thread and pushed to the user. | M | BR-22 |
| FR-174 | Timers down to 1 minute fire within 5 seconds of the target time and always push to the phone. | M | BR-23, P1 |
| FR-175 | Creating a routine is idempotent per request (no duplicates). | M | P2 |
| FR-176 | Routine editor in the details panel: name, instruction, trigger picker, active toggle, test run, run history. | M | F11 |

### 3.7 Connectors and tools
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-180 | Connector catalog (internal): name, logo, description, transport (remote HTTP MCP or local stdio MCP), auth type (OAuth, bearer token, none), tool list, source link. Add and remove connectors. | M | F14 |
| FR-181 | Connector accounts: connect one or more accounts per connector (OAuth or paste token); show Connected state; reconnect on token expiry. | M | F15 |
| FR-182 | Per-tool switches at connector level (account-wide default). | M | F15, BR-25 |
| FR-183 | Per-agent connector assignment and per-agent tool overrides (narrower only, never wider than the connector default). | M | P5 |
| FR-184 | Enforcement: disabled tools are not listed to the model and are rejected if called. Both rules must hold. | M | BR-29 |
| FR-185 | An agent can list its connectors, tools, and auth state, and can ask the user to connect a connector through a card (connect card). | M | BR-26, BR-27 |
| FR-186 | Adding a remote MCP server by URL is a user action (or agent proposal with user confirmation). | S | BR-26 |
| FR-187 | "Private skills": skills created by agents are stored in the catalog and can be assigned to other agents. | S | F14 |

### 3.8 Safety and approvals
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-190 | Approval cards: when a tool call needs approval, the agent's turn pauses and an approval card appears in the thread with the tool, arguments summary, and Allow/Deny; a push notification is sent. Deny returns a clear result to the agent. | M | BR-28, P4 |
| FR-191 | Approval rules in plain language: "When an agent wants to <action>, it should <allow automatically | ask first | deny>". "Ask first" wins on conflict. Built-in hard limits always apply. | S | F20 |
| FR-192 | Hard limits: disabled tools, per-agent deny lists, no file access outside the workspace, no network except allowed connectors, no shell commands outside the sandbox. | M | BR-29 |
| FR-193 | The user can pause an agent (stop all turns) and resume it. | M | ops |
| FR-194 | Sending email, payments, and deletions are "ask first" by default even when the tool is enabled. | M | BR-30, BR-31 |

### 3.9 Files
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-200 | Upload from composer (+ button): images, documents, zip; size limit configurable (default 50 MB). | M | F5 |
| FR-201 | Files are stored in object storage and copied into the agent's workspace inbox for the turn. | M | BR-32 |
| FR-202 | Images are given to the model as vision input; HEIC is converted to JPEG. | M | BR-32 |
| FR-203 | Agents can return files with a platform tool; the chat shows a file card with download. | M | F6 |
| FR-204 | Nothing received is ever deleted: originals stay in object storage. An agent can search and fetch any past file or message with a `search_history` tool. | M | discussion 2026-09-12 |

### 3.10 Memory
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-210 | Memory entries per agent: text, kind (fact, preference, rule, profile), created by, created at, source message link. Agents write memories through a platform tool; the user can view, edit, delete them in the details panel. | M | BR-34, BR-35 |
| FR-211 | Memories are injected into the agent's context at the start of every turn. | M | |
| FR-212 | Long conversations are summarized automatically so an agent never fails because its context is full. | M | Claude Code compaction |
| FR-213 | An agent's knowledge is shared across its threads (primary and group threads). | S | BR-40 |
| FR-214 | Each agent has a built-in brain: a memory store owned by the platform (no external knowledge product), with kinds fact, preference, rule, profile, and open loop. | M | discussion 2026-09-12 |
| FR-215 | Open loops: an agent records unfinished work with a `waiting_on` value (connector, tool, date, person, user answer). Open loops appear on the jobs board as Blocked or Waiting. | M | Linh Outlook example |
| FR-216 | Retrieval at turn start: memories are indexed by full text and by meaning (vector index). The platform selects the most relevant entries for the incoming message and always includes core rules and all open loops. | M | |
| FR-217 | Automatic extraction: after each turn a cheap model pass extracts facts, preferences, and open loops the agent did not save explicitly; the user can review and delete them. | S | |
| FR-218 | Capability change wake-up: when a connector, tool, or skill becomes available to an agent, the platform matches the change against the agent's open loops and wakes the agent with a system note. The agent asks the user once before acting on an unblocked loop. | M | Linh Outlook example |
| FR-219 | Turn-start briefing: every turn prompt starts with "what changed since your last turn": new tools, new files, unblocked jobs, answered cards. | M | |

### 3.11 Templates and catalog
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-220 | Export an agent as a template archive: identity, instructions, skills (SKILL.md + references), non-personal memories, routines (optional), required connectors. Personal memories are excluded by default. A review card is shown before export. | S | BR-36 |
| FR-221 | Import a template archive or a template from the internal catalog; a new agent is created and briefed. | S | BR-37 |
| FR-222 | Skill package format: a folder with `SKILL.md` (front matter: name, description) and optional `references/`, `scripts/`. Compatible with Claude Code skills. | M | BR-38 |
| FR-223 | Internal catalog UI: Connectors tab and Agents (templates) tab with search and categories. | S | F14, F16 |

### 3.12 Notifications and mobile
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-230 | Web push notifications for: new agent message when the thread is not open, approval needed, routine fired, job blocked. Per-agent notification toggle. | M | F12 |
| FR-231 | Optional Telegram bridge: the same notifications and the ability to reply from Telegram. | S | A5 |
| FR-232 | The web app is installable as a PWA and works on iOS Safari and Android Chrome. | M | F22 |

### 3.13 Usage and settings
| ID | Requirement | Pri | BR |
|---|---|---|---|
| FR-240 | Usage view: turns, tokens, and estimated cost per agent and per day; a rolling 5-hour and weekly counter with a configurable warning threshold. | S | P7 |
| FR-241 | Settings: profile, theme, language, time zone, notification channels, approval rules, harnesses (detected, login state, default), model defaults per harness, connectors, backups, version. | M | F20 |
| FR-242 | Auth: single-user login with passkey or password plus TOTP (Phase 1); org login with roles (Phase 3). | M | |

## 4. Agent behavior specification (prompts and protocols)

These become the default instruction files of the concierge and of every specialist.

### 4.1 Shared rules for all agents
1. Mirror the user's language per message (Dutch or English). (BR-12)
2. Keep replies short. On mobile, prefer stacked lists over tables. (BR-15)
3. When work takes longer than a few seconds, post one interim status line, then the result. (BR-17)
4. Attach evidence for external actions (screenshots, links, file names). (BR-19)
5. Say plainly when something failed or was blocked and what you will do next. (BR-20)
6. Never invent facts; ask when unknown. (Nico brief)
7. Persist new rules and preferences the user states, and confirm in one line what was stored. (BR-15, BR-34)
8. Log every job you start, wait on, finish, or block. (FR-160)
9. If something matters later, save it now: `remember` for facts and rules, `open_loop` for unfinished work with what it waits on. (FR-214, FR-215)
10. When the turn briefing shows a new capability that unblocks an open loop, ask the user once before acting. (FR-218)

### 4.2 Concierge protocol
- Onboarding interview with choice cards, one question at a time. (BR-13)
- Create specialists on request; give each a person name and a role title; send the creation briefing (FR-144). (BR-02, BR-03)
- Delegate with the template: task, boundaries, numbered report format, "ping me when you start, when you wait on the user, when you are done". (BR-04)
- Relay a short natural-language version of reports to the user; board links only on request. (BR-06)
- Keep the board: own jobs too. (BR-05, P8)
- Ask for a go/no-go before building anything or spending money. (BR-30)

### 4.3 Specialist protocol
- Lock scope from the briefing; refuse scope creep politely. (Thijs)
- Report to the concierge only, unless the user talks to you directly. (BR-05)
- Verify briefings against primary sources when they matter; send corrections to the parent. (BR-07)
- Use only your assigned connectors; if a tool is missing, say so and ask. (BR-27)

## 5. UI specification

### 5.1 Screens
| Screen | Content | Notes |
|---|---|---|
| Sidebar | Search; New chat (+); agent list; catalog; account (usage %, settings) | Collapsible; on mobile it is the home screen |
| Thread | Header (avatar, name, title, details button, computer/activity button, template menu); message list; composer (+ attach, text, mic, send) | Sender labels in group threads |
| Agent details | Activity panel; Routines; Settings; Memories; Files; Connectors | Right side panel on desktop, full screen on mobile |
| Routine editor | Active, Name, Instruction, When to run (trigger picker), Test run, Run history | Same as Grok Bot (screenshot 029) |
| Exchange overlay | Read-only transcript between two agents, sender labels, Close | Screenshot 033 |
| Catalog | Tabs Connectors / Agents; search; categories; cards with Add/Added; "Your connectors" | Screenshots 063-071 |
| Connector detail | Accounts (+ add), Tools with switches, Source link, Remove | Screenshot 066 |
| Approval card | Tool, summary of arguments, Allow / Deny / Always allow (creates a rule) | New; replaces Auto-review prompt |
| Connect card | Connector logo, description, tool count, Connect button (starts OAuth) | Screenshot 019 |
| Settings | General, Notifications, Approval rules, Usage, Connectors, Backups, About | Screenshots 074-078 |
| Jobs board | Columns: Queued, In progress, Waiting on user, Blocked, Done | New |

### 5.2 Components
Message bubble (user right, agent left), event row, choice card, approval card, connect card, file card, image gallery, link preview, typing indicator, unread dot, "Scroll to bottom" button, "Show more".

### 5.3 Mobile behaviors
- One-thumb reachable composer; mic button; cards with large targets.
- Tables render as stacked lists below 640 px width.
- Push notification opens the thread at the message.
- Offline: queued messages are sent when back online.

## 6. Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-01 | First token of a reply visible within 3 seconds on a normal turn (streaming). |
| NFR-02 | Timers: 99.9% fire within 5 seconds of target. |
| NFR-03 | Data at rest on the VPS only; backups encrypted. |
| NFR-04 | All tool calls, approvals, and agent-to-agent messages are logged with time, agent, tool, arguments hash, and result status. |
| NFR-05 | Recoverable: a crash of any service does not lose messages; turns are retried or marked failed visibly. |
| NFR-06 | Upgrades with zero data loss and a documented rollback. |
| NFR-07 | Accessibility: keyboard navigation and screen-reader labels on all controls. |
| NFR-08 | The system must keep working when the model provider is rate limited: turns queue and the user is told. |
