# Verified facts about agent harnesses (fetched 2026-09-12)

A "harness" is a vendor agent runtime that provides the model loop, built-in tools, MCP support, and sessions. The platform can drive any of them headless. Quotes are verbatim from the official pages.

## 1. Claude Code (Anthropic)
See notes-claude-platform-facts.md. Summary: `claude -p`, `--output-format stream-json`, `--resume <id>`, `--mcp-config`, `permissions.allow/deny/ask`, `--permission-prompt-tool`, subscription via `claude setup-token` (Pro/Max/Team/Enterprise), API key via `ANTHROPIC_API_KEY`. Anthropic allows the unmodified binary with the user's own subscription, also when hosted; third-party products must use API keys.

## 2. OpenAI Codex CLI
Sources: https://learn.chatgpt.com/docs/non-interactive-mode, https://learn.chatgpt.com/docs/auth, https://learn.chatgpt.com/docs/pricing, https://developers.openai.com/codex/mcp
- Headless: `codex exec "<task>"`; "Codex streams progress to stderr and prints only the final agent message to stdout"; `--json` makes "stdout ... a JSON Lines (JSONL) stream" with events `thread.started`, `turn.started`, `turn.completed`, `item.*`.
- Resume: `codex exec resume --last "<task>"` or `codex exec resume <SESSION_ID>`.
- Structured output: `--output-schema ./schema.json -o ./output.json`; `--ephemeral` avoids persisting session files.
- Sandbox: default read-only; `--sandbox workspace-write`; `--sandbox danger-full-access`.
- MCP: config in `~/.codex/config.toml` under `[mcp_servers.<name>]`; stdio (`command`, `args`, `env`) and Streamable HTTP (`url` + `bearer_token_env_var`, `http_headers`, `env_http_headers`, OAuth via `codex mcp login <name>`); `required = true` makes `codex exec` fail if the server does not start. Per-tool enable/disable keys: to verify in the official MCP page (search results mention them; not confirmed here).
- Auth: ChatGPT sign-in for "subscription access"; credentials in `~/.codex/auth.json` ("Treat ~/.codex/auth.json like a password"); headless login `codex login --device-auth`; for CI the docs recommend `CODEX_API_KEY` and call ChatGPT-account auth in CI "advanced" (keep auth.json secure). "Codex ... included in your ChatGPT Free, Go, Plus, Pro, Business, Edu, or Enterprise plan." Usage: rolling five-hour windows per plan; extra credits purchasable. API key: "Pay for Codex usage based on API pricing".
- Open point: OpenAI's terms on running a ChatGPT-plan login on a server for a personal agent platform are not stated as explicitly as Anthropic's; API key is the documented CI path. Treat subscription use as "personal, ordinary use only" and keep the API-key switch.

## 3. Gemini CLI (Google)
Sources: https://geminicli.com/docs/cli/headless/, https://geminicli.com/docs/cli/cli-reference/, https://geminicli.com/docs/get-started/authentication/, https://geminicli.com/docs/tools/mcp-server/
- Headless: activates "when the CLI is run in a non-TTY environment or when providing a query with the -p (or --prompt) flag"; `--output-format text|json|stream-json`; stream events `init`, `message`, `tool_use`, `tool_result`, `error`, `result`; exit codes 0, 1, 42 (input error), 53 (turn limit).
- Resume: `--resume / -r` ("latest" or index), `--list-sessions`, `--delete-session`.
- Approval: `--approval-mode default|auto_edit|yolo|plan` (`--yolo` deprecated); `--allowed-mcp-server-names`; `--model / -m` (default `auto`); `--include-directories`.
- MCP: `settings.json` `mcpServers` with `command`/`args`/`env`/`cwd` (stdio), `url` (SSE), `httpUrl` (HTTP streaming), `headers`, `timeout` (default 600000 ms), `trust` (bypass confirmations), `includeTools`, `excludeTools` ("excludeTools takes precedence over includeTools"). Tool names: `mcp_{serverName}_{toolName}`; avoid underscores in server names.
- Auth: Google account login (individual free tier "Gemini Code Assist for individuals", paid "Google AI Pro and Ultra"), `GEMINI_API_KEY`, or Vertex AI (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`). "Headless mode will use your existing authentication method, if an existing authentication credential is cached." No automation restriction stated on that page; Google's program terms for the free tier must be checked before server use.

## 4. Grok Build (xAI)
Sources: https://docs.x.ai/build/overview, https://docs.x.ai/build/cli/headless-scripting, https://github.com/xai-org/grok-build
- Product: terminal coding agent, open source (Apache 2.0), "interactively, headlessly for scripting/CI, or embedded in editors via the Agent Client Protocol (ACP)". Extension system covers "skills, plugins, hooks, and MCP servers".
- Install: `curl -fsSL https://x.ai/cli/install.sh | bash`.
- Headless: `grok -p "<prompt>"`; `--output-format plain|json|streaming-json`; `-m <model>`; `-s, --session-id <ID>` (create or resume a named headless session), `-r, --resume <ID>`, `-c, --continue`; `--always-approve` auto-approves tool executions; `--cwd <PATH>`.
- Auth: browser login on first launch (`grok login`; subscription SuperGrok or X Premium+), or `XAI_API_KEY`. Credential storage path not documented; auth methods reported as `xai.api_key` and `cached_token`.
- Models: custom models in `~/.grok/config.toml` (`model`, `base_url`, `name`, `env_key`).
- MCP config keys: not fetched (docs page not found at the guessed URL); verify in the user guide under `crates/codegen/xai-grok-pager/docs/user-guide/` in the repository before implementing.

## 5. Capability matrix (what the adapter must fill in)

| Capability | Claude Code | Codex CLI | Gemini CLI | Grok Build |
|---|---|---|---|---|
| Headless prompt | `-p` | `exec` | `-p` | `-p` |
| Streaming JSON events | stream-json | `--json` JSONL | stream-json | streaming-json |
| Resume by session id | yes (`--resume`) | yes (`exec resume <id>`) | yes (`--resume`, index or latest) | yes (`-s`, `-r`) |
| MCP stdio | yes | yes | yes | yes (documented as supported) |
| MCP remote HTTP with headers | yes | yes (Streamable HTTP, bearer env, headers) | yes (`httpUrl`, `headers`) | to verify |
| Per-tool allow/deny in config | yes (`permissions`) | to verify | yes (`includeTools`/`excludeTools`) | to verify |
| Permission prompt hook to an MCP tool | yes (`--permission-prompt-tool`) | no (sandbox modes only) | no (approval modes only) | no (`--always-approve`) |
| Structured output schema | `--json-schema` | `--output-schema` | json output only | json output only |
| Subscription login | Pro/Max/Team/Enterprise (`setup-token`) | ChatGPT plans (`auth.json`) | Google account (free, AI Pro, Ultra) | SuperGrok / X Premium+ |
| API key | `ANTHROPIC_API_KEY` | `CODEX_API_KEY` / `OPENAI_API_KEY` | `GEMINI_API_KEY` / Vertex | `XAI_API_KEY` |
| Custom model string | `--model` | `-m` / config | `--model` | `-m` + config.toml |
| Isolated config dir | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` | per-`HOME` `~/.gemini` (verify env override) | per-`HOME` `~/.grok` (verify) |

Conclusion for the design: approvals and tool policy cannot rely on a harness feature. They must live in the platform's MCP gateway, which every harness reaches through MCP. Claude Code's permission hook becomes an optional extra.
