# Ergates design summary

Date: 2026-09-12. Version: 0.3, corrected after source review and Jop's mobile design instruction. Status: specification; no implemented app, deployment or live acceptance evidence yet. [Document index](../../README.md).

## Product

A clean native messaging app for a team of Hermes assistants on a private VPS. Home shows pinned avatars and a flat conversation list. Chat uses rounded bubbles and a compact composer; settings open as grouped sheets. [The nine supplied mobile screenshots](../../research/notes-mobile-design.md) guide layout, while [Hermes semantic themes and Nous light/dark palettes](../../10-mobile-design.md) define colors. Appearance defaults to System. Mobile Edit Bot exposes desktop-equivalent appearance, name, description, instructions, model and capabilities through a staged Save/Cancel form. Context menus provide organization, Hide/recovery and lifecycle actions; templates/duplication follow in Phase 2.

## Architecture

React Native/Expo connects to pinned `hermes serve` via REST and JSON-RPC over Tailscale. A multiplexed `hermes gateway` runs cron and platforms. Hermes owns profiles, execution, sessions, tools, memory and rooms. A small Ergates integration package adds typed proposals, safe user-confirmed provisioning, reminder-create receipts and background attention delivery; these are explicit custom work, not upstream capabilities.

Basic login uses JSON and cookies, followed by fresh WebSocket tickets. Native cookie/transport behavior is a P0 gate. Sandbox shell access is air-gapped by default with narrow volumes; host-side MCP and plugins are separate trusted components. Permission changes stop/rebuild/verify active grants before the app shows Off.

## First implementation

P0 proves the private deployment, auth, chat, image bytes, approvals, replay/restart, file mapping, policy revocation, two-profile cron and locked-iPhone attention delivery. P1 adds the roster, concierge proposals and specialist briefing, ordinary routines, reviewed connectors, files/voice, clean settings and Hermes theme behavior.

The default cron tick is 60 seconds. Five-second/sub-minute timer precision is deferred; scheduling and phone-delivery latency are measured separately. ntfy push requires the attention bridge, deep-link forwarding and iOS upstream configuration. A longer approval timeout alone does not make push work.

## Scope and evidence

No web/desktop client, own agent runtime, domain database, memory index, public marketplace or multi-tenant gateway roles. Later phases cover same-gateway rooms, native Expo push, templates and separately verified cross-person sharing.

[11-implementation-readiness.md](../../11-implementation-readiness.md) distinguishes source-verified behavior, app work, integration work and acceptance gates. [07-delivery-plan.md](../../07-delivery-plan.md) derives calendar time from available engineering hours, with ranges that include the integration work. Actual provider credentials/budget remain an operator setup decision. Future implementation starts with the P0 feasibility gates; this documentation task does not deploy services or authorize purchases.
