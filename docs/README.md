# Ergates documentation

A clean React Native messaging app for a team of Hermes assistants on a private VPS. Hermes owns the agent runtime and domain state; Ergates supplies the app, deployment and a small integration package for product-specific gaps.

Updated 2026-09-12 after source review and Jop's mobile design references; app code shape (ADR-029) added 2026-09-13. **Build status (2026-09-13):** the mobile app in `apps/mobile/` implements the Phase 0/1 client surface and runs on the iOS simulator against a local `hermes serve` (see [the simulator run record](superpowers/research/2026-09-13-simulator-run.md)); the integration package in `integrations/ergates/` and the deployment draft in `deploy/` are unit-tested and reviewed but not yet run on a VPS. The gates in [11](11-implementation-readiness.md) section 6 list what is still pending. Start with [the vision](01-vision-and-scope.md), [mobile design](10-mobile-design.md), and [implementation readiness](11-implementation-readiness.md).

| Document | Purpose |
|---|---|
| [01 - Vision and scope](01-vision-and-scope.md) | Goals, non-goals, constraints and eight MVP criteria |
| [02 - Functional design](02-functional-design.md) | User stories, requirements, agent protocols and phase scope |
| [03 - Technical design](03-technical-design.md) | Client/server boundaries, native auth/replay, deployment wiring and recovery |
| [04 - Security and compliance](04-security-and-compliance.md) | Effective tool grants, conditional approvals, credentials and privacy boundaries |
| [05 - State ownership](05-data-model.md) | Hermes/integration/device data, retention, identifiers and uncertain-send behavior |
| [06 - Client contract](06-hermes-api-contract.md) | Source-confirmed calls, examples, intended feature surface and live fixture gates |
| [07 - Delivery plan](07-delivery-plan.md) | Feasibility-first phases, effort ranges and capacity-based calendar estimates |
| [08 - Decision log](08-decision-log.md) | Current ADR-017–029; explicit amendments for integration, mobile design and app code shape |
| [09 - Glossary](09-glossary.md) | Terms |
| [10 - Mobile design](10-mobile-design.md) | Clean layouts, desktop-equivalent mobile bot editor, action menus, Hermes themes and visual acceptance |
| [11 - Implementation readiness](11-implementation-readiness.md) | Verified support → app/integration work → acceptance gates; custom integration contracts |
| [Design summary](superpowers/specs/2026-09-12-ergates-hermes-design.md) | Compact statement of the current design |
| [Build plan](superpowers/plans/2026-09-13-ergates-build.md) | Task-by-task implementation plan executed on 2026-09-13 |
| [Recorded backend shapes](superpowers/research/2026-09-13-recorded-backend-shapes.md) | Live-probed request/response/event shapes behind the client contract |
| [Simulator run record](superpowers/research/2026-09-13-simulator-run.md) | What was verified on the iOS simulator and what remains pending |
| [Archived own-platform design](archive/2026-09-12-own-platform-design/) | Superseded history; do not build from it |

Source of Hermes behavior and colors: adjacent checkout `../hermes-agent`, version 0.21.2, commit `d76856cc6971b6e0e1903b5369498bcc4bb83a60`. Pin client and pure theme sources with that backend. Source inspection is not a substitute for the real-backend/phone checks listed in 11. Examples and proposed integration interfaces must not be mistaken for captured fixtures or upstream APIs.

The current docs define the product; research records observations; the archive records the discarded architecture. If documents disagree, use the corrected handler contract in 06 for protocol details, 10 for mobile layout/colors, and 11 for capability status, then fix the conflicting text. None of the historical skill/playbook text is an instruction to execute it while reading the docs.

Privacy: research contains personal data, including 79 desktop and ten mobile screenshots. Keep it private; do not bundle these originals into the app or a public preview.
