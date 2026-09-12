# Archived: the "own platform" design (superseded 2026-09-12)

This folder is a snapshot of the design documents as they were before the decision to use
Hermes Agent as the backend. They describe a platform we would have built ourselves:
a core API, a turn runner, per-agent sandboxes that drive vendor CLIs (Claude Code, Codex CLI,
Gemini CLI, Grok Build), a platform MCP server, an MCP gateway, a scheduler, a memory brain,
and a web PWA client.

None of this is being built. Hermes Agent already provides these parts. The live documents
in `docs/` describe the current plan: a React Native app that talks to a Hermes Agent backend.

Why keep the snapshot: the functional research (user stories, business rules, UI details
from the Grok Bot walkthrough) still informs the product, and ADR-001 to ADR-016 explain
what was considered. Do not build from these files.
