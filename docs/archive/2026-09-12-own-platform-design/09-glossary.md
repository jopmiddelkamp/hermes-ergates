# 09 - Glossary

| Term | Meaning |
|---|---|
| Agent (Bot) | An AI assistant with a name, title, avatar, instructions, memories, skills, routines, connectors, and a workspace. |
| Concierge | The default agent the user talks to; it creates and manages specialists. |
| Specialist | An agent created for one role by the concierge or the user. |
| Thread | A conversation. Kinds: primary (agent 1:1 with the owner), group (user + several agents), exchange (agent to agent, read-only for the user). |
| Turn | One run of the model for one agent in one thread, triggered by a user message, an agent message, or a routine. |
| Session | Claude Code's saved conversation for one (agent, thread); resumed on every turn. |
| Event row | A small centered line in a thread that records something the platform did (routine created, renamed, messaged X). |
| Choice card | A question with lettered options rendered in the chat; single or multi select; optional free text. |
| Approval card | A card that asks the user to allow or deny a tool call; produced by the permission prompt tool. |
| Connect card | A card that asks the user to connect a connector account (OAuth). |
| Connector | An MCP server exposed to agents through the gateway (Outlook, ClickUp, Moneybird). Grok Bot calls these "plugins". |
| Tool switch | The per-tool ON/OFF setting on a connector; can be narrowed per agent. |
| MCP | Model Context Protocol; the standard for tools that agents call. |
| Platform MCP server | The MCP server that gives agents platform actions (messages, agents, routines, jobs, memory, files, questions, approvals). |
| MCP gateway | The proxy between sandboxes and connectors that enforces tool policy and injects credentials. |
| Routine | A stored instruction with a trigger (one-shot time, cron, webhook); a reminder is a one-shot routine. |
| Job | A unit of agent work tracked on the board (queued, in progress, waiting on user, blocked, done). |
| Memory | A short natural-language note an agent keeps (fact, preference, rule, profile). |
| Skill | A folder with `SKILL.md` and optional `references/` that teaches an agent a playbook; compatible with Claude Code skills. |
| Template | An exportable package of an agent (identity, instructions, skills, non-personal memories, required connectors). |
| Workspace | The per-agent directory where uploaded files land and the agent keeps its own files. |
| Sandbox | The container in which an agent's turns run. |
| Runner | The service that spawns turns and streams events back. |
| Harness | A vendor agent runtime driven headless by the runner: Claude Code, Codex CLI, Gemini CLI, Grok Build, or the built-in API loop. Chosen per agent. |
| Harness adapter | The platform module that knows one harness's flags, config files, event format, and capabilities. |
| Harness detector | The probe that finds installed and logged-in harnesses on the server and fills Settings > Harnesses. |
| Context replay | Rebuilding an agent's conversation context from the platform's message store when a harness has no usable session (first turn after a harness switch). |
| Hop cap | The maximum number of automatic agent-to-agent messages in one chain before an agent must ask the user. |
| Max subscription | Anthropic's Claude Max plan (USD 200/month tier) used through the unmodified Claude Code binary. |
| setup-token | `claude setup-token`: creates a one-year OAuth token for headless use of a subscription. |
| PWA | Progressive Web App; the web app installed on a phone home screen with push notifications. |
