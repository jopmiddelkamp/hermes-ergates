# 11 - Implementation Readiness and Integration Contracts

Version: 0.3. Date: 2026-09-12. Status: documentation corrected after source review; app, deployment and integration plugin are not implemented or live-verified.

## 1. Reading the status correctly

**Verified** means confirmed in Hermes source at `d76856cc69`, not demonstrated on the intended VPS or phone. **App work** is client implementation. **Integration work** is an Ergates extension or deployment configuration, not a built-in Hermes guarantee. **Gate** means a named acceptance check must pass before the dependent feature is counted as delivered. Research observations describe Grok Bot, not Hermes.

## 2. Capability and acceptance matrix

| Requirement | Verified Hermes support | App / integration work | Acceptance gate |
|---|---|---|---|
| Chat, image intake, approvals (FR-103, 190, 202) | JSON-RPC handlers; path attachment and separate byte attachment; approval events | Native cookie/ticket transport, rendering, byte encoding | P0: real phone connects, uploads image, streams, answers approval, reconnects |
| Replay (FR-113) | `session.events.since(last_seen)`; bounded in-process ring and epoch | History recovery on truncation/restart; dedup by owning session and row | P0: disconnect mid-stream; restart backend; no duplicated bubbles |
| Safe offline send (NFR-05) | No durable submit-idempotency contract established for this WebSocket route | Outbox states and uncertain-delivery UI | P0: drop connection after submit before acknowledgement; no automatic replay of that submit |
| Agents (FR-130–136) | Profiles and Bot Chat conventions; create/configure are separate operations | Typed proposal tool, user confirmation, safe provisioning and receipt | P1: create by chat; reject invalid proposal; recover after every provisioning step |
| Mobile Edit Bot (FR-13B) | Desktop editor; `profiles.describe/configure`, assets, metadata revisions; independent section results | Staged mobile form, display-name/role mapping, config/subscription adapters, partial-save recovery | P1: all fields on phone; Save/Cancel, dirty close, conflict, partial failure, offline draft; same profile/history after rename; active-turn model/tool effects |
| Bot actions (FR-13C) | Shared metadata Hide; profile deletion; template/clone primitives | Local unread/pins/sections, Hidden Bots recovery, accessible menus, coordinated deletion; sanitized duplicate/template in P2 | P1: local organization survives restart, Hide recovers without pausing; deletion cleanup interruption is recoverable. P2: duplicate/export excludes secrets, history, memory and active schedules |
| Permissions (FR-182–194) | Session tool-schema validation; MCP config changes deferred; shell approvals are conditional | Stop/rebuild affected sessions; narrow connector credentials and tool lists; effective-state UI | P0/P1: tool excluded, then revoked mid-chat, cannot execute by direct or delegated call |
| Work tracking (FR-160) | Shared kanban tools | Seed toolset and prompt protocol in P1; board UI P2 | P1: concierge and specialist each record and finish a card |
| Reminders (FR-170–176) | Cron; default polling interval 60 s; multiplex must be configured for secondary profiles | Delivery routing, explicit timezone, concurrency-safe dedup integration | P0: reminder on two profiles with app closed; P1: retry/concurrent-create/restart cases |
| Precise short timers (former G5/NFR-02) | Five-second scheduling/delivery is not supplied by the default ticker | Explicit future timer design if precision is required | Deferred; never presented as an MVP reliability guarantee |
| Background attention (FR-190, 230) | ntfy adapter can publish delivered platform messages; live WS events exist | Durable server bridge for approval/message attention, deep-link metadata, iOS upstream configuration | P0 spike and P1 gate: locked phone, offline phone, expired request, duplicate push |
| Files (FR-135, 200–203) | Managed file endpoints and host-path attachments | Resolve managed roots; explicit transfer into/out of owning sandbox | P0/P1: upload zip → shell reads it → artifact downloads; sibling profile denied |
| Local privacy (NFR-03) | Server owns domain state | In-memory history by default, opt-in local cache, draft storage, sign-out clearing | P0: remove connection; its cookies, drafts, cache and files are gone |
| Clean UI and Hermes colors (FR-250–252) | Nous palettes, semantic theme types and skin events | Native resolver, simple screen layouts | P0/P1: checks in [10-mobile-design.md](10-mobile-design.md#6-visual-acceptance) |
| Rooms and multiple gateways (FR-109) | Same-gateway room driver; cross-gateway paths depend on client relay/topology | P2 rooms; separate P3 cross-person sharing proof | Do not promise unattended cross-gateway rooms until tested with clients disconnected |
| Operations (US-8.2, NFR-06) | Hermes backup/diagnostic commands | Pinned build, mount/egress configuration, encrypted off-host backup and restore runbook | P0: restore onto empty storage; run chat and a secondary-profile reminder |

## 3. Phase 0 evidence to collect

Record the full Hermes commit, built image digest, app/runtime versions, deployment configuration, phone OS, sanitized request/response/event fixtures, and observed results. Source-derived examples in 06 are not recorded fixtures.

The fake gateway tests rendering and error handling. It cannot prove routing, permissions, file visibility, cookie handling, iOS delivery or behavior of a new Hermes version. Those need an integration run against the real pinned backend, with live vendor calls limited to smoke checks. Preserve old fixtures when upgrading and compare behavior before replacing them.

## 4. Proposed Ergates integration package

This package is new work. ADR-025 supersedes the assumption that only app code and an optional push adapter are needed. Use Hermes's documented external plugin/tool hooks where possible. Verify the needed lifecycle hooks in the P0 spike; if a hook is missing, record a scoped upstream change instead of pretending a platform adapter supplies it. Do not create a second agent runtime, scheduler, or domain database.

### 4.1 Agent proposals and provisioning

Define a custom tool `ergates_propose_agent` for the concierge. It validates input and returns a typed proposal; it does not create a profile or change permissions. The proposal is persisted by the package and also appears in the Hermes tool result. The UI recognizes only this tool's validated result, not arbitrary Markdown, attachment contents, or a `clarify` option claiming to be an action.

Proposed payload (not a Hermes RPC):

```json
{
  "kind": "ergates.agent-proposal.v1",
  "proposal_id": "server-generated-uuid",
  "source_session_id": "concierge-session",
  "expires_at": "ISO-8601 UTC timestamp",
  "agent": {
    "name": "thijs",
    "title": "Thijs",
    "role": "Bookkeeper",
    "description": "Read invoices and prepare reconciliation notes.",
    "template_id": "bookkeeper-readonly",
    "provider": "operator-selected-provider",
    "model": "operator-selected-model"
  },
  "briefing": "Role, boundaries, seed facts and reporting instructions."
}
```

- Tool caller identity and source session come from the backend context, not model-supplied parameters. Gate proposals to the operator-configured concierge profile. The user may also create an agent from the UI through the same provisioning path.
- The app shows name, role, model, requested connector set and scope. User edits are validated again. Expiry is 24 hours; rejection performs no provisioning.
- Confirming calls a proposed authenticated integration accept operation with `proposal_id` and the approved payload hash. This operation is not in upstream Hermes and its registration/auth mechanism is a P0 gate. It verifies operator auth, atomically claims the proposal and resumes by receipt on retries. Never expose this accept operation as an agent tool.
- The integration drives the supported profile operations: fresh profile with credential mirroring off, approved role config, `profiles.configure`, canonical Bot Chat, then briefing. Resolve provider credentials on the server; do not copy a concierge `.env` or clone all of its rights. Inspect every `applied` field; a transport success is not a fully configured agent.
- Keep a small locked, atomically replaced integration journal under the Hermes data root (`ergates/proposals/`). Each receipt records proposal hash, reserved profile name, completed steps, session id and briefing delivery state. Profile names are unique; an unrelated name collision is an error, never an overwrite.
- On partial failure, leave the profile clearly incomplete and prevent its first turn until the approved tool policy and sandbox settings are verified. Retry resumes the receipt. If briefing submission is uncertain, inspect history and require a deliberate retry rather than blindly submitting again. Cleanup of an already-created profile remains an explicit user action.

Self-rename, avatar changes and sibling management use the same typed proposal/confirmation pattern with action-specific validation. The phrase “manage agents capability” refers to this Ergates gate, not an existing Hermes role system.

User-initiated Edit Bot writes use authenticated profile/config calls (06), without a concierge proposal. Save is not atomic across metadata, assets, model/tools and subscriptions. Metadata conflicts use backend revisions; stronger guarantees for non-metadata concurrent edits need a proven serialized integration operation. Friendly names use desktop `title`; the proposal's `name` is the unique profile identifier and `role` is the separate Ergates badge.

Deletion must coordinate active work, pending approvals, owned jobs, subscriptions and cached state before removing a non-default profile. Verify stock deletion cleanup at the pin; add an authenticated, journaled integration wrapper for uncovered steps. Record completed cleanup so interruptions do not report a deleted bot while it can still run. Template export and Duplicate in P2 share a reviewed configuration snapshot allowlist; create a fresh identity and separately provision credentials. A raw clone/export is not proof that sensitive state was excluded.

### 4.2 Background attention and push

The package needs an explicit server event source for approval-created/resolved/expired and completed-message attention. ntfy's `send()` alone does not subscribe to events from `hermes serve`. The P0 spike must connect this source while all app sockets are disconnected; failure blocks the corresponding push feature.

Keep durable, non-secret delivery records under `ergates/notifications/`: event id, owning profile/session, approval id when applicable, event state, attempts, next retry and delivery result. Push is at-least-once; deduplicate in the app. Store subscription destinations and quiet-hour preferences on the server. Retain pending events until resolved or expired; retain resolved delivery metadata for seven days, then delete it. Never retry an expired approval notification.

Phase 1 transports through ntfy. Extend publication to include a `Click` URL, for example `ergates://chat/<session>?connection=<id>&profile=<name>` with values encoded. A notification carries a generic preview and identifiers, never credentials, commands or approval decisions. The connection id is a previously registered app connection; opening an unknown id leads to connection selection, never automatic trust of a supplied URL. On tap, authenticate, fetch the authoritative request and show its current state. Native Allow/Deny actions wait for Phase 2 and must perform the same authenticated state check.

Self-hosted iOS instant delivery requires `upstream-base-url` (normally `https://ntfy.sh`) and phone access to the private ntfy server after wake-up. Document the upstream's message-id/topic-hash metadata and test Tailscale reachability on a locked phone. [ntfy configuration](https://docs.ntfy.sh/config/#ios-instant-notifications). Provider acceptance is not proof that the phone displayed a notification.

### 4.3 Reminder creation and timing

Hermes remains the scheduler. Treat list-before-create and app-only duplicate detection as advisory. The proposed integration reminder-create operation serializes creation per profile and records an idempotency key with the normalized schedule/timezone/prompt hash and resulting cron job id. Route Ergates UI and agent creation through that operation; retries with a different payload must fail. Preserve native cron for list/edit/delete. Exclude the raw creation path from the agent's effective grant if it bypasses the operation; confirm the hook/tool policy can enforce this in P0, otherwise duplicate-free creation stays gated.

When a Hermes cron create succeeds but its receipt is uncertain, reconcile the existing job before retrying; no unconditional second create. Acceptance includes two concurrent requests, disconnect after creation, and backend restart. Timers under a minute and guaranteed five-second precision are deferred. For ordinary reminders, measure scheduled time → job start → push accepted → phone displayed separately. With a healthy idle server, the P1 engineering target is job start within 90 seconds in at least 99% of a test batch of 100 reminders; report actual latency and failures. This is a release test target, not an unconditional delivery promise.

## 5. Documentation review validation

The 2026-09-12 review checked current-document relative links/anchors and code fences, preserved nine mobile originals byte-for-byte (88 research screenshots total), and compared the Nous reference colors with the pinned source. The local interaction preview was checked in a sandboxed browser for Edit Bot Save/Cancel/dirty dismissal, name propagation, pinning, search, More and narrow-width overflow at 320/390/430 pixels. These are documentation/preview checks; all real-backend, native OS, deployment and locked-phone acceptance gates above remain pending.
