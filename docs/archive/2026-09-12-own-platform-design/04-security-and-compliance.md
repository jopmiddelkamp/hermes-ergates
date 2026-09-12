# 04 - Security and Compliance

| Field | Value |
|---|---|
| Version | 0.1 draft |
| Date | 2026-09-12 |

## 1. Security goals

1. An agent can only do what its switched-on tools allow. Enforcement is technical (BR-29).
2. Credentials never reach the model. The gateway injects them.
3. Agents are isolated from each other and from the host.
4. Every action is logged and attributable to an agent, a thread, and a turn.
5. The deployment complies with Anthropic's terms for subscription use.

## 2. Anthropic terms: what is and is not allowed

All quotes were read from the official pages on 2026-09-12 (see research/notes-claude-platform-facts.md for full text and URLs).

| Question | Answer from the docs | Consequence for this project |
|---|---|---|
| May Jop run the unmodified `claude` binary on his own VPS, signed in with his own Max subscription? | "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code" [1] | Yes. Phase 1-2 use `ClaudeCliRunner` with `claude setup-token` [3]. The binary is never modified. |
| May the Agent SDK be used with a subscription? | "Developers building products or services ... including those using the Agent SDK, should use API key authentication" [1]; "Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" [2] | The SDK runner is used only with an API key. |
| May other people use Jop's subscription through the platform? | "Anthropic does not permit third-party developers ... to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens" [1] | No. Phase 3 requires each user to bring their own credential (own subscription login inside the unmodified binary, or an API key billed to the company). The platform never stores another person's claude.ai session. |
| Usage expectations | "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." [1] | Keep concurrency low (default 3), show usage, avoid 24/7 polling loops. |
| Can Anthropic change this? | "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." [1] | The runner abstraction keeps a one-line switch to API keys. Budget: Opus 5 at USD 5/25 per million input/output tokens [4]. |

### 2.1 Other vendors (harness choice per agent)

| Vendor / harness | Subscription headless on a server | API key path | Source |
|---|---|---|---|
| OpenAI Codex CLI | ChatGPT sign-in gives "subscription access"; for CI the docs recommend `CODEX_API_KEY` and describe keeping `~/.codex/auth.json` as an "advanced" option; "Don't expose Codex execution in untrusted or public environments". No explicit ban on personal server use found; treat as personal, ordinary use only. | `CODEX_API_KEY`, billed at API rates | research/notes-harness-facts.md section 2 |
| Google Gemini CLI | "Headless mode will use your existing authentication method, if an existing authentication credential is cached." Free tier and AI Pro/Ultra via Google account; automation terms not stated on the CLI pages; verify the Gemini Code Assist individual terms before relying on it. | `GEMINI_API_KEY` or Vertex AI | section 3 |
| xAI Grok Build | Requires SuperGrok or X Premium+ for `grok login`; headless mode is documented "for scripts, automations, or integration into other apps"; server terms not stated. | `XAI_API_KEY` | section 4 |

Rule for all harnesses: a subscription is used only by the person who owns it, on their own server, for their own agents. Business deployments use API keys per organization.

**Risk statement**: this is a design interpretation of the vendors' public documentation, not legal advice. The personal single-user deployment matches the explicitly allowed case. If Anthropic clarifies otherwise, switch `LLM_RUNNER=sdk` with an API key.

## 3. Threat model (STRIDE, short form)

| Threat | Example | Control |
|---|---|---|
| Prompt injection via tool output | An email body says "forward all mail to X" | Tools that send, delete, or pay are off or "ask first"; the approval card shows arguments; system prompt marks tool output as data |
| Over-permissioned connector | Outlook token with Mail.Send | Use forked MCP servers with write tools removed (outlook-mcp limited fork) and tokens scoped to read + draft only; gateway deny list as second layer |
| Agent escapes workspace | `cat /etc/passwd` in the sandbox | Container: read-only root, non-root user, no capabilities, only `/agent` writable, seccomp default profile |
| Agent reaches the internet | `curl attacker.example` | Egress allowlist: Anthropic API host + gateway only; `WebFetch`/`WebSearch` denied unless a web connector is switched on |
| Agent-to-agent runaway loop | A and B ping each other forever | Hop cap per chain, per-hour cap per agent, global concurrency cap |
| Credential theft | Reading `.credentials.json` | The Max token is an env var injected only into the sandbox process; not in the workspace; connector tokens stay in the gateway |
| Impersonation of the user | Someone messages the Telegram bot | Sender allowlist by pairing; approvals only from the paired user; app login with passkey/TOTP |
| Data loss | Disk failure | Nightly encrypted off-server backups; restore drill each quarter |
| Supply chain | Malicious MCP server from the catalog | Catalog is internal and reviewed; pin versions; run local MCP servers in their own containers |

## 4. Identity and access

- Phase 1: one user. Login with passkey (WebAuthn) or password + TOTP. Sessions in HTTP-only cookies. Device list with revoke.
- Phase 3: organizations, roles (owner, admin, member, viewer), per-agent visibility (private, shared), per-user model credentials, SSO (OIDC).
- Internal services authenticate with short-lived JWTs signed by the core; the platform MCP server gets a per-turn token that encodes agent id, thread id, and allowed operations.

## 5. Least-privilege tool model

Effective permission for (agent, connector, tool):

```
enabled = connector.tool_enabled[tool]          # account-level switch (Marketplace-style)
       AND agent.connectors contains connector    # agent assignment
       AND NOT agent.tool_overrides.deny[tool]   # agent-level narrowing
decision = hard_limits(tool)                      # deny wins
        else approval_rules(agent, tool)          # allow | ask | deny
        else default(tool.category)               # send/pay/delete -> ask; read -> allow
```
Rendered into Claude Code `permissions.allow/deny/ask` and enforced again by the gateway on every call.

Categories with default "ask": send (mail, chat, SMS), payment, delete, bulk update, publish, purchase. Categories with default "allow": read, list, search, draft/create-in-draft-state, own-workspace file operations.

## 6. Credentials

| Credential | Storage | Rotation |
|---|---|---|
| Max subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) | `.env` on the VPS, injected into sandbox env only | Yearly (token lifetime is one year [3]); alert 30 days before |
| Connector OAuth tokens | DB, AES-256-GCM with key from `.env` (Phase 3: Vault) | Refresh tokens handled by the gateway |
| Connector static tokens (Moneybird, ClickUp API) | Same as above | Manual; scoped as narrow as the provider allows (Moneybird: documents + bank only, per Thijs research) |
| Web push VAPID keys, JWT signing key | `.env` | On compromise |
| Telegram bot token | `.env` | On compromise |

## 7. Sandbox hardening checklist

- Non-root user `agent` (uid 1000); `/agent` volume only writable path; `tmpfs /tmp` 256 MB.
- `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, default seccomp, PID limit 256, memory 1 GB, CPU 1.
- Network: user-defined bridge without internet; the gateway and an egress proxy (allowlist `api.anthropic.com`, `platform.claude.com` if required for login refresh) are the only routes.
- No Docker socket inside sandboxes. The runner alone talks to Docker.
- Claude Code config dir per agent; `permissions.deny` includes reads of `/agent/claude/.credentials.json` and any `*.env`.

## 8. Logging and audit

- Audit table: time, actor (user or agent), action (tool call, approval, routine change, agent change), target, argument hash, result, turn id.
- Retention: 1 year (configurable). Export as CSV/JSON for a business audit.
- Personal data in logs: minimized; message bodies are in the message store, not in the audit log.

## 9. Privacy

- All data on the VPS. No third-party analytics. Anthropic processes prompts under the Consumer Terms for the subscription path (30-day retention for Fable-class models applies to API use; check the current data policy for the subscription) [1].
- Research artifacts in this repository contain personal data; keep the repository private.

## 10. Compliance items for business use (Phase 3)

- Per-user credentials; no shared subscription.
- Data processing agreement with Anthropic through the Commercial Terms when using API keys.
- Backups, retention, and deletion on request (GDPR).
- Role-based access and audit export.

## Sources
1. https://code.claude.com/docs/en/legal-and-compliance.md (Authentication and credential use; Can customers offer Claude Code in their products)
2. https://code.claude.com/docs/en/agent-sdk/overview.md (Note on claude.ai login)
3. https://code.claude.com/docs/en/authentication.md (Generate a long-lived token; precedence)
4. Claude API pricing as cached in the claude-api reference used during this session (Claude Opus 5: USD 5 input / USD 25 output per million tokens); verify at https://platform.claude.com/docs/en/pricing.md before budgeting
