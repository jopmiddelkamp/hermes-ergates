---
name: compliance
description: Compliance-first development rules for this project — ISO 27001, SOC 2, and the voluntary HIPAA security baseline, plus the audit-evidence files and compliance design gates. Use when writing or reviewing ANY product code, and for any question about audit readiness, certifications, data handling, retention, vendors, or "is this compliant". Always loaded together with the write-code skill; also load the owasp skill for the technical security controls.
---

# Compliance-First Development

This product plans phone calls, sends emails, and places orders on a farmer's behalf, and stores animal medication records with food-safety consequences. Security and compliance controls must exist from the first line of code: SOC 2 Type II needs months of operating evidence, ISO 27001 audits your history, and retrofitting encryption or audit trails into a shipped offline-first sync protocol is far more expensive than building them in.

This skill covers the management-system frameworks and the audit evidence they demand. The *technical* security controls (authorization mechanics, input validation, session parameters, LLM safety) live in the companion `owasp` skill — load both.

## The framework rules (source of truth)

Three framework files in this skill's `references/` define the controls. They are short — read all three before designing anything non-trivial, or at minimum the ones matching your task:

| File | What it governs | Read it when |
|---|---|---|
| `references/iso-27001.md` | Secure SDLC, access control, crypto, logging, backup, suppliers, incident readiness, audit-evidence docs | Always — it is the broadest baseline |
| `references/soc2.md` | Change management/CI-CD, monitoring, availability, **processing integrity** (automated real-world actions), vendors | Any feature that acts in the real world (orders, calls, emails), CI/CD, or infra work |
| `references/hipaa.md` | Treatment/medication records ("ePHI-equivalent"), minimum-necessary data exposure, sync integrity, breach readiness | Any feature touching animal treatment, medication, vet communication, or sensitive-record display |

Note: HIPAA does not legally bind this product (animal data, EU market — GDPR/AVG is the binding law); its Security Rule is adopted voluntarily as a baseline. Do not claim HIPAA compliance in user-facing text or marketing copy.

## Compliance design gates (check on every change)

- **Data classification**: treatment/medication records and personal contact data are marked sensitive in the data model; serializers, loggers, and exports treat them by type, not convention.
- **Minimum necessary**: responses use per-role/per-purpose DTOs, never full-entity serialization; integrations receive only the fields they need.
- **Secrets**: nothing secret in code, config files in git, logs, or mobile app bundles; secrets come from the secret manager/keystore.
- **Audit trail**: security-relevant events (auth, permission change, export, sensitive-record detail read, every automated action) emit append-only structured audit records with who/what/when/which-farm/on-whose-behalf.
- **Automated actions** (orders, calls, emails, bookings): explicit farmer approval checked at execution time, idempotency key enforced at the integration boundary, persisted state machine (draft → approved → submitted → confirmed/failed), server-side spend/frequency guardrails, per-integration and global kill switch.
- **Encryption**: TLS 1.2+ everywhere; at rest for DB, backups, object storage, and the mobile offline database (key in platform keystore).
- **No production data** in tests, fixtures, or local dev — synthetic herds only.

## Repo evidence files

The rules reference living documents that serve as audit evidence. Create them the first time a task needs one; update them whenever the relevant thing changes:

- `docs/security/supplier-register.md` — every third-party service, data shared, auth method, DPA status, region (create/update before wiring any integration)
- `docs/security/data-inventory.md` — systems, data categories, locations
- `docs/security/risk-register.md` — add an entry whenever a design decision accepts a security trade-off
- `docs/security/incident-response.md` — detection, containment, GDPR 72h notification steps
- `docs/security/continuity.md` — RPO/RTO targets, backup/restore procedure
- `docs/security/access-reviews/` — dated quarterly access-review notes

## Verification checklist (before marking any task complete)

- [ ] No sensitive fields in logs, error messages, analytics, or LLM prompts introduced by this change
- [ ] Audit events emitted for new security-relevant operations, and covered by a test
- [ ] Secrets untouched by git (`git diff` shows no keys, tokens, connection strings)
- [ ] For automated-action features: idempotency, approval check, guardrails, and kill switch each covered by a test
- [ ] Evidence files updated if the change added a vendor, data store, or accepted risk
