---
name: owasp
description: The technical security controls for this project, per OWASP — Top 10 2025 (web), API Security Top 10 2023, Mobile Top 10 2024 + MASVS v2.1, ASVS 5.0 Level 2, LLM Top 10 2025, Proactive Controls, and cheat-sheet parameters. Use when writing or reviewing ANY code that handles input, auth, APIs, sync, uploads, LLM features, or third-party calls — even when the user does not mention security. Also use for any question about OWASP, injection, XSS, sessions, or securing an endpoint. Always loaded together with the write-code skill; also load the compliance skill for the framework side.
---

# OWASP Technical Security Controls

Where ISO 27001 and SOC 2 (see the `compliance` skill) say *that* a control must exist, OWASP says *how to build it*. Verification target: **ASVS 5.0 Level 2** as the baseline, plus selected L3 controls around automated actions, audit logging, and medication-record retention.

## The rules (source of truth)

`references/owasp.md` holds the full rule set, organized by control area (access control & multi-tenancy, auth & sessions, injection & I/O, crypto, logging, dependencies, mobile, LLM, cheat-sheet parameters). Read the sections matching the platforms your change touches — web portal, back-end API, sync/webhooks, mobile app, or LLM assistant. For anything non-trivial, read the whole file; it is one file for a reason.

## OWASP design gates (check on every change)

- **Authorization**: every new endpoint/query is deny-by-default, checked server-side, and tenant-scoped (farm_id filter or RLS). A missing tenant filter is a release blocker.
- **Untrusted input** (A05/API10/LLM01): every input path — endpoint, webhook body, sync-batch field, deep link, file upload, LLM tool argument, third-party API response — gets strict allow-list schema validation server-side; parameterized queries and context-aware output encoding only; webhook signatures verified before parsing.
- **Fail closed** (A10): errors in authz, feature-flag, or permission lookups deny the action; one global exception handler (generic message + correlation ID out, detail to logs); multi-step operations are transactional or idempotent+reconciled — never half-applied.
- **Resource limits** (API4): new endpoints get rate limits (per device/user/farm), pagination with a max page size, and payload/batch caps; paid or outbound actions get quotas and spend ceilings.
- **Prompt injection** (LLM01/LLM06): untrusted content (emails, transcripts, supplier responses) enters LLM context only in delimited data blocks and taints the session — high-risk tools then require human approval; action targets resolve from verified contact/supplier IDs, never model-extracted free text.

## Verification checklist (before marking any task complete)

- [ ] Auth + tenant scoping tested (attempt cross-tenant access in a test; it must fail)
- [ ] New input paths schema-validated and injection-safe (parameterized queries, encoded output), covered by a negative test
- [ ] New error paths fail closed (dependency-down and malformed-input cases tested)
- [ ] For LLM-facing changes: injection red-team suite passes; tool calls schema-validated server-side
- [ ] New dependencies pinned in the lockfile and free of known critical CVEs
