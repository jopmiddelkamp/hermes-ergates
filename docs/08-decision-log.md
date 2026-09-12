# 08 - Architecture Decision Log

Updated 2026-09-12 after Jop requested corrections and supplied mobile references. These are current design decisions, not claims of implementation or approval of purchases/deployment. Unverified extension mechanisms are gates in 11. Earlier own-platform records ADR-001–016 remain in the [archived decision log](archive/2026-09-12-own-platform-design/08-decision-log.md); do not build from them.

## ADR-017 Hermes owns the backend domain

Hermes supplies the agent loop, sessions, memory, profiles, tools, cron and rooms. Build the mobile app and deployment against its supported client surfaces. Keep no independent agent runtime, domain database, memory index or general API facade. Amended by ADR-025: narrowly scoped integration state and extension endpoints are necessary for product behavior Hermes does not already supply.

## ADR-018 React Native over the Hermes client protocol

Use Expo development builds and the pinned JSON-RPC client plus REST. Native HTTP/cookies, sockets, image transfer and persistence are adapters with P0 checks. The OpenAI-compatible API server is a separate optional automation path; its run-idempotency guarantees do not apply to mobile `prompt.submit`. The mobile app has no web/desktop-client deliverable.

## ADR-019 One assistant is one Hermes profile

Use `ui_meta`, assets, `SOUL.md`, canonical `BOT_CHAT_TITLE` sessions and Bot Mode messaging conventions. Enable kanban work tracking in P1, its UI in P2. Agent creation by chat needs the typed proposal and safe provisioning path in 11. Same-gateway room limits are not global Bot-message hop/spend limits; cross-gateway relay and human sharing need separate proof.

## ADR-020 Model access is a per-profile provider setting

Select from the pinned backend's configured provider/model options. API-key access is the initial engineering default until the operator supplies a chosen account. Keep provider entitlement/billing/terms distinct from source-level technical support. Do not claim changing auth paths is always one line. Do not hardcode unverified model ids in role defaults; use available options and validate the selected model.

## ADR-021 Effective grants and conditional approvals

Hermes owns session tool grants; MCP config saves may be deferred. A revocation must stop/drain affected work, narrow configuration, rebuild execution contexts and verify the result before the UI says Off. Shell `manual` approval is conditional and is not a universal MCP action gate. Send/pay/delete remain excluded until explicit tool-specific approval semantics are implemented. Plain-language custom policy rules are deferred. Details in 04.

## ADR-022 Sandboxes are air-gapped by default

Use one Docker shell workspace per profile, narrow verified mounts, resource limits and no shared container key. Both trusted tool-running controllers need Docker access; shell sandboxes get neither the daemon socket nor connector/provider grants. Host-side MCP/plugin execution is a separate boundary. Controllers use enforced outbound allowlisting; networked shells require a later explicit design. Deployment is accepted only after actual mount/network tests, not from a sketch.

## ADR-023 Push needs a server attention bridge

P1 uses private ntfy; P2 adds Expo transport. Both rely on the integration event source and durable delivery records. Stock ntfy publication does not subscribe to mobile-chat approval events or supply chat deep links. Implement those, configure iOS upstream wake-up, and prove locked-phone delivery in P0/P1. Approval timeout is a pending-window setting, not a notification mechanism.

## ADR-024 Private auth first

Use the basic provider over Tailscale through JSON password login, a tested cookie adapter and short-lived WebSocket tickets. Later public access uses TLS plus OAuth/OIDC and a verified native redirect flow; desktop loopback support is not mobile compatibility. Keep no public service listener in P0–P2.

## ADR-025 Small Ergates integration package

The previous app/config-only assumption did not cover typed creation actions, failure-safe provisioning, reminder deduplication or server-to-phone attention. Define these as new extension work with small atomic file journals and authenticated operator operations in 11. Prefer supported external plugin hooks; prove event-source and authenticated-route registration in P0. If absent, scope the upstream extension explicitly. Never give agents the authenticated accept operation or control-plane credentials. This amends ADR-017, 019 and 023 without creating a second agent runtime.

## ADR-026 Mobile layout from references, colors from Hermes

Jop explicitly requested the clean iPhone style shown in nine screenshots. Adopt flat Home rows, optional pinned avatars, compact chat controls, rounded bubbles/composer and grouped settings sheets. Use Hermes `DesktopThemeColors`, Nous light/dark palettes and `HermesSkin` conversion/resolution. Appearance defaults to System. Mobile includes desktop-equivalent Edit Bot with Save/Cancel, partial-save recovery, and compact context menus/More as explicitly requested. Friendly name and role badge have separate metadata mappings. Detailed tokens, native geometry, states and visual acceptance live in 10; screenshot colors and vendor branding are not product tokens.

## ADR-027 Honest reminder and offline-delivery semantics

The pinned cron ticker defaults to 60 seconds. P1 ordinary reminders target measured job start within 90 seconds on a healthy idle server, with phone delivery measured separately. Sub-minute/five-second precision is deferred. Client request ids do not establish durable exactly-once submission: uncertain sends require reconciliation and deliberate retry. Custom proposal/job-create retries use integration receipts, not text matching.

## ADR-028 Explicit local data and capacity

Authoritative history remains on the VPS; encrypted off-host backups, device drafts and optional caches are documented in 05. Default history caching is memory-only; connection removal clears account data and warns about unsent work. The schedule is derived from effort and actual engineering availability; 07 replaces the earlier part-time label paired with effectively full-time dates.
