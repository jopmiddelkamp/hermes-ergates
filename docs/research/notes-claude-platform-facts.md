# Verified platform facts for the Claude-based rebuild (fetched 2026-09-12)

All statements below were read from the official pages on 2026-09-12. Quotes are verbatim.

## 1. Subscription (Claude Max) vs API key - what is allowed

Source A: https://code.claude.com/docs/en/legal-and-compliance.md
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication ... Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens"
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under Can customers offer Claude Code in their products? above."
- Hosting rules: "The Claude Code binary must not be modified." and "Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential"
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

Source B: https://code.claude.com/docs/en/agent-sdk/overview.md
- "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

Source C: https://code.claude.com/docs/en/authentication.md
- `claude setup-token` -> "generate a one-year OAuth token" -> set as `CLAUDE_CODE_OAUTH_TOKEN`. "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. It can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors. MCP servers you configure locally still work."
- "Bare mode does not read CLAUDE_CODE_OAUTH_TOKEN."
- Credential precedence: cloud provider > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > profiles > /login OAuth.
- On Linux credentials live in `~/.claude/.credentials.json` (0600); `CLAUDE_CONFIG_DIR` relocates it.

Source D: GitHub issue anthropics/claude-code#42106 (request to allow Max tokens with the Agent SDK for personal dev) - closed "not planned", no staff statement visible.

INTERPRETATION FOR THIS PROJECT (design decision, not legal advice):
- Single-user personal deployment where Jop runs the UNMODIFIED `claude` binary on his own VPS, signed in with his OWN Max subscription, is the case the docs explicitly allow ("end user signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code").
- Offering the platform to OTHER people on Jop's subscription is NOT allowed. For business/multi-user use every user must bring their own credential (own subscription login or own API key), or the deployment uses API keys billed to the company.
- The Agent SDK (Python/TypeScript library) is documented as "use API key". Therefore the compliant Max-subscription path is the CLI (`claude -p`), not the SDK. Design an "LLM runner" abstraction so the runner can be switched to Agent SDK + API key without touching the rest of the system.
- Usage limits: Max shares one pool across web/desktop/mobile/Claude Code, metered per rolling 5-hour window plus a weekly cap; Max 20x can buy extra usage at API rates under a self-set cap. (support.claude.com "What is the Max plan?", "About Claude Max plan usage")

## 2. Headless Claude Code facts (https://code.claude.com/docs/en/headless.md, cli-reference.md, sessions.md)
- `claude -p "<prompt>"` non-interactive; exit code 0 on success.
- `--output-format text|json|stream-json`; `--input-format text|stream-json` (bidirectional streaming over stdin/stdout); `--include-partial-messages`; `--replay-user-messages`.
- `--session-id <uuid>`, `--resume <id|name|transcript-path>`, `--continue`, `--fork-session`. Sessions from `-p` can be resumed by ID from any directory. Transcripts: `~/.claude/projects/<project>/<session-id>.jsonl` (format internal, changes between versions). `CLAUDE_CONFIG_DIR` + `CLAUDE_CODE_PROJECT_DIR_NAME` let a host give each session/agent its own config dir and project name ("This suits a host that embeds Claude Code and gives each session its own config directory").
- Resume does NOT restore `--mcp-config`, `--settings`, `--plugin-dir`, `--add-dir` -> pass them every time.
- `--mcp-config <json-file-or-string>` (space separated, multiple), `--strict-mcp-config`.
- `--allowedTools`, `--disallowedTools`, `--tools`, `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions|manual`, `--permission-prompt-tool <mcp tool>` (an MCP tool answers permission prompts in non-interactive mode), `--permission-prompts host|none`.
- `--append-system-prompt`, `--system-prompt`, `--system-prompt-file`, `--agents <json>` (custom subagents), `--model`, `--effort low..max`, `--max-turns`, `--max-budget-usd`, `--json-schema` (validated structured output), `--add-dir`, `--settings`, `--plugin-dir`, `--name`.
- `--bare` skips hooks/skills/plugins/MCP/CLAUDE.md auto-discovery BUT does not read the OAuth token -> do NOT use --bare on the subscription path; isolate with CLAUDE_CONFIG_DIR instead.
- stream-json events: `system/init` (model, tools, mcp_servers with status, plugin errors, capabilities), `assistant`/`user` messages (subagent messages carry `parent_tool_use_id`), `system/api_retry`, `permission_denied`, final `result` (text, cost, session_id, permission_denials).
- SIGINT ends the turn gracefully; SIGTERM leaves the turn unfinished (exit 143).
- Piped stdin capped at 10MB.
- With `--permission-prompts none`, AskUserQuestion is removed (Claude can't ask the user) -> our platform must supply its own "ask user" MCP tool for choice cards.

## 3. MCP in Claude Code (https://code.claude.com/docs/en/mcp.md)
- Config: `{"mcpServers": {"name": {"command","args","env"}}}` for stdio; `{"type":"http","url","headers","timeout"}` for remote; `headersHelper` for dynamic headers; env expansion `${VAR:-default}`.
- Tool permission names: `mcp__<server>__<tool>`; wildcard `mcp__<server>` for all tools. Allow/deny/ask rules in settings `permissions.allow|deny|ask`. Deny wins.
- Tool `_meta: {"anthropic/requiresUserInteraction": true}` forces a prompt on every call (denied in dontAsk).
- Remote OAuth in headless mode is NOT possible (no browser flow in `claude -p`); do OAuth once interactively or use static bearer tokens via headers. -> Our platform must own OAuth for remote MCP servers (or run local MCP servers with tokens we manage).
- Timeouts: `MCP_TIMEOUT` (startup, default 30s), `MCP_TOOL_TIMEOUT`, per-server `timeout`; output cap `MAX_MCP_OUTPUT_TOKENS` default 25k.

## 4. Channels (https://code.claude.com/docs/en/channels.md) - research preview
- A channel is an MCP server that pushes events into a running session; Telegram, Discord, iMessage plugins exist; `claude --channels plugin:telegram@claude-plugins-official`; sender allowlist by pairing; permission relay possible.
- Requires claude.ai or Console auth; Pro/Max individuals can use it. Useful as an optional "chat bridge" but NOT a replacement for a custom multi-agent app.

## 5. Scheduling
- Claude Code `/schedule` routines need a claude.ai login and are not available with setup-token/profile auth ("Features that need your claude.ai login, such as claude.ai connectors and /schedule, aren't available ..."). -> Routines/scheduler must be built in OUR orchestrator (cron + one-shot timers), which the Grok Bot analysis needs anyway.
