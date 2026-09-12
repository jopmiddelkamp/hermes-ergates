# OWASP Engineering Rules

OWASP defines the technical security controls this project applies to every line of product code, across all platforms. Where ISO 27001/SOC 2 say *that* a control must exist, OWASP says *how to build it*. Verification target: **ASVS 5.0 Level 2** as the baseline, plus selected L3 controls around automated actions, audit logging, and medication-record retention. Adopted editions (verified 2026-07):

| Standard | Edition | Applies to |
|---|---|---|
| OWASP Top 10 | 2025 (A01–A10) | Web portal + back-end |
| OWASP API Security Top 10 | 2023 (API1–API10) | Back-end API, sync, webhooks |
| OWASP Mobile Top 10 + MASVS | 2024 / v2.1.0 | Mobile app |
| OWASP ASVS | 5.0.0, Level 2 | Verification baseline, all platforms |
| OWASP Top 10 for LLM Applications | 2025 (LLM01–LLM10) | LLM assistant + automated actions |
| OWASP Proactive Controls | 2024 (C1–C10) | Design-time defaults |
| OWASP Cheat Sheet Series | living | Concrete parameters (bottom of this file) |

## Access control & multi-tenancy (A01, API1/API3/API5, ASVS V8, C1)

- Deny by default through one central authorization layer: every route declares its required permission; a route with no declared policy fails closed and fails CI (ASVS 8.2.1, C1).
- Authorize the object, not just the endpoint: every read/write verifies the resource belongs to the caller's farm AND the caller's role permits the action (IDOR, ASVS 8.2.2). Scope the query to the tenant first, then find by ID (`currentFarm.animals.find(id)`, never `Animal.find(id)`).
- Tenant context comes from the authenticated token/session only — never from a request parameter, header, or body field. Enforce in the repository layer or Postgres RLS (`FORCE ROW LEVEL SECURITY` so it binds the table owner too) (ASVS 8.4.1).
- Return **404, not 403**, for objects outside the caller's tenant — never confirm another farm's records exist (API1).
- Use permission-based checks (`user.can('animal:delete', farm)`), not hard-coded role comparisons; cross-farm actors (vet, mechanic, supplier) act via explicit grant records (actor ↔ farm, scoped, revocable, time-boxed), never via "role implies access" (C1, API5).
- Never bind request bodies to ORM entities. Per-endpoint, per-role input DTOs with `additionalProperties: false`; a worker must not be able to set `farm_id`, `role`, or vet-approval fields via mass assignment (API3 BOPLA). Response DTOs are explicit allow-lists shaped per role.
- Offline-sync batches are the highest-risk surface: authorize and property-filter every record in a push/pull batch individually server-side, through the same DTO/policy pipeline as normal writes, including conflict-resolution paths (API1, API3).
- SSRF (folded into A01:2025): any server-side fetch of a user- or integration-supplied URL goes through an https-only allow-list, blocks private/link-local/metadata ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1) **checked on the resolved IP at connect time**, follows no redirects, runs from a segmented egress path, and never returns the raw response to the client (C10, API7). Provider base URLs come from static server config, never from client input or webhook payloads.
- Per new resource, write the cross-tenant test: authenticate as farm B, request farm A's IDs across GET/PUT/PATCH/DELETE and sync — all must fail. The role matrix (owner/worker/vet/supplier/anonymous × endpoint) is asserted in tests; the matrix is the spec.

## Authentication, sessions & tokens (A07, API2, ASVS V6/V7/V9, C7)

- Use a proven identity library/provider; never hand-rolled password hashing, session handling, or JWT validation. MFA on the web portal and admin surfaces (ASVS 6.3.3).
- Passwords: min 8 chars with MFA / 15 without, max ≥64, all characters allowed, no composition rules, no forced rotation; check against a breached-password list; constant-time comparison; identical generic failure messages (no user enumeration).
- Rate-limit auth endpoints per account (not just IP) with exponential backoff; alert on credential-stuffing patterns (ASVS 6.3.1).
- Access tokens short-lived (~15 min), refresh tokens rotating with reuse detection and server-side revocation per device — "log out other devices" and stolen-phone cutoff must actually work. Rotate the session/token on every (re)authentication (ASVS 7.2.4); terminated sessions are dead immediately (ASVS 7.4.1).
- JWT validation: explicit algorithm allow-list (ES256/EdDSA/PS256 preferred; reject `none` and header-driven alg), validate `iss`, `aud`, `exp`; revocation denylist keyed on `jti`+`iss`; HMAC secrets ≥256-bit CSPRNG, never shared across audiences.
- Step-up re-authentication before: changing email/phone/MFA/recovery settings, changing webhook URLs or payout/order settings, transferring farm ownership (ASVS 7.5.1).
- Machine callers authenticate too: per-integration HMAC secrets for webhooks — never one shared static API key.

## Injection & input/output handling (A05, ASVS V1/V2, C3)

- Parameterized queries for 100% of DB access — backend AND the mobile app's local DB; ban string-built SQL via lint/review (ASVS 1.2.4). Identifiers that can't be bound (column names, sort order) go through allow-list maps.
- No user input into shell commands; if unavoidable, exec APIs with argument arrays, never shell interpolation (ASVS 1.2.5).
- Strict schema validation (types, lengths, enums, ranges, allow-list) at the API boundary for ALL input — including every field of sync payloads and webhook bodies; reject unknown properties; validation lives in the backend, client-side is UX only (ASVS 2.2.1/2.2.2).
- XSS: rely on framework auto-escaping; the escape hatches (`dangerouslySetInnerHTML`, `v-html`, `bypassSecurityTrust*`) are banned except through a DOMPurify wrapper; safe DOM sinks only (`.textContent`, not `.innerHTML`); encoding is the primary defense, validation and CSP are backstops.
- Content placed into outbound emails, call scripts, and order payloads is an injection surface too: use provider structured APIs, escape per context, guard against email header injection and CSV formula injection (`=`, `+`, `-`, `@` prefixes) in exports.
- No native deserialization of untrusted data (Java serialization, pickle) — plain JSON with schema validation only (A08).
- Anchored, length-bounded regexes with explicit character classes (ReDoS-safe); normalize Unicode before validating.

## Web front-end (ASVS V3, C8, cheat sheets)

- Session cookie: `__Host-` prefix, `Secure; HttpOnly; SameSite=Strict; Path=/`, no Domain attribute, generic name, ≥64 bits CSPRNG entropy; never in localStorage or URLs; `Cache-Control: no-store` on responses carrying tokens or sensitive data; `Clear-Site-Data` on logout.
- CSRF on every state-changing request: framework built-in synchronizer tokens (or signed double-submit); `SameSite` is defense-in-depth, not the control; never mutate state via GET (ASVS 3.5.1).
- Security headers on every portal response — the exact set in the parameters section below; CSP without `unsafe-inline` for scripts.
- CORS: exact origin allow-list (portal origin only); never `*` with credentials.
- Self-host all JS; if a third-party-hosted script is unavoidable, Subresource Integrity is mandatory (A08).
- Session timeouts: idle 15–30 min (portal), absolute 4–8 h; regenerate on login and privilege change.

## Cryptography & secrets (A04, ASVS V11/V13, C2, M10)

- Vetted libraries and platform primitives only; AES-256-GCM (or ChaCha20-Poly1305) for application-level encryption; no MD5/SHA-1 for anything security-relevant, no ECB, no homegrown crypto, CSPRNG for every key/nonce/token (≥128 bits for invite/reset tokens) (ASVS 11.3.2, 11.5.1).
- Password hashing: argon2id m=19456 t=2 p=1 (or bcrypt cost ≥10 where argon2 is unavailable); per-user salts are automatic; upgrade work factors by re-hashing at next login (ASVS 11.4.2).
- Secrets in a managed vault/KMS with rotation and access audit — never in code, git, config files, Docker ENV, CI logs, or mobile binaries; gitleaks/detect-secrets as a blocking pre-commit/CI check (ASVS 13.3.1). Anything embedded in the app binary is public — the app holds only per-user revocable tokens.
- TLS 1.2+ (prefer 1.3) everywhere including service-to-service and third-party calls; HSTS with preload; no sensitive data (tokens, animal/medication IDs, personal data) in URLs or query strings — they end up in proxy and server logs (ASVS 14.2.1).

## API, resource limits & third-party consumption (API4/API6/API8/API9/API10, ASVS V4)

- Rate limits at three scopes — per token/device, per user, per farm — so one runaway sync client can't degrade other tenants; 429 with `Retry-After`; clients back off with jitter (API4, ASVS 2.4.1).
- Hard caps everywhere: max body size, max sync-batch size, mandatory pagination with max page size (no "return all"), upload size/count/storage quotas, bounded queue depths, timeouts + circuit breakers on every downstream call.
- Paid/automated outbound actions (calls, emails, orders) get per-farm quotas, spend ceilings, and anomaly alerting — attacker- or bug-triggered loops here cost real money (API4/API6).
- Sensitive business flows (ordering, invitations, medication-record writes) get flow-level throttling and non-human-pattern detection beyond generic rate limits (API6).
- Inbound webhooks are untrusted input: verify HMAC signature + timestamp (replay window) before parsing anything else, enforce idempotency by event ID, schema-validate strictly; a webhook may only transition records **you created**, looked up by your own ID — never create/modify arbitrary records from webhook fields (API10).
- Validate, bound, and timeout all third-party API responses before using them in business logic; provider-triggered automation runs through the same quota/approval controls as user-triggered (API10).
- Wrong method → 405, oversized → 413, wrong content type → 415; every response carries an accurate `Content-Type` (ASVS 4.1.1); generic API errors, no stack traces or framework banners; debug/introspection endpoints (GraphQL introspection, playgrounds, actuators) off in production (API8, ASVS 13.4.2).
- API inventory: OpenAPI generated from code covering every route incl. sync, webhooks, and admin; versioned (`/v1/`) with a sunset policy — old versions kept for old app builds get the same auth middleware and patches; a running route absent from the spec fails CI (API9).
- File uploads: extension allow-list + magic-byte check, random UUID filenames, stored outside the webroot in private buckets, served via tenant-scoped short-lived signed URLs with correct Content-Type, size limits enforced post-decompression.

## Mobile app (M1–M10, MASVS v2.1)

- Local DB (medication records) encrypted with SQLCipher/AES-256; key is a random 256-bit value generated on device, held in Android Keystore (StrongBox where available) / iOS Keychain (`ThisDeviceOnly`, Secure Enclave-backed), never derived from a hardcoded string or user ID (M9, MASVS-STORAGE/CRYPTO).
- Tokens only in keystore-backed secure storage — never SharedPreferences, Hive boxes, or the sync DB; an HTTP interceptor redacts `Authorization` before any logger or crash reporter sees it (M1).
- Backups excluded: `allowBackup=false` (or `dataExtractionRules` excluding DB, WAL/journal, prefs, key files) on Android; `NSURLIsExcludedFromBackupKey` + file protection classes on iOS (M8, MASVS-STORAGE-2).
- Network: `cleartextTrafficPermitted=false`, ATS with no exceptions, full platform cert validation (never a permissive `badCertificateCallback`), certificate/SPKI pinning for the sync API with a backup pin and remote rotation strategy; a pin failure is a security event, not an "offline" state (M5, MASVS-NETWORK).
- Offline auth fails closed: local access gated by device unlock + biometric/PIN unlocking a keystore-protected key (not a flippable boolean); on definitive token revocation (vs. mere network absence — distinguish explicitly), lock the app and block further local edits (M3, MASVS-AUTH).
- Deep links: verified App Links / Universal Links, parameters validated against an allow-list before navigation; nothing from a link goes into a WebView, file path, or query (M4, MASVS-PLATFORM).
- Wipe on logout/farm-removal: delete DB + rotate/destroy the keystore key (crypto-shredding); purge cached exports; no medication data in analytics, notifications, clipboard, or app-switcher previews (M6/M9, MASVS-PRIVACY).
- Release hardening as defense-in-depth (never the boundary): build with obfuscation + split debug info, R8/ProGuard, no `debuggable`; Play Integrity / App Attest verified server-side; root/jailbreak+hooking detection responds by warning and blocking sync of new records, logged server-side (M7, MASVS-RESILIENCE). Red-team each release: run `strings`/jadx on the artifact to confirm no secrets survived.

## LLM assistant & automated actions (LLM01–LLM10)

- Prompt injection is assumed, not prevented: wrap every email body, call transcript, and supplier response in delimited data blocks declared as data-never-instructions; run an injection scanner on inbound content; once untrusted content enters context, taint the session — high-risk tools (place_order, send_email, initiate_call) drop to mandatory human approval (LLM01).
- Recipients, amounts, and targets never come from model-extracted free text: tool schemas take `supplier_id`/`contact_id` enums resolved against the verified contact DB — not `email: string` or `phone: string` (LLM01/LLM05).
- Every LLM-produced tool call is schema-validated server-side (types, enums, ranges) and semantically bounded (order quantity caps, recipients must exist in contacts); LLM output is untrusted input everywhere downstream — parameterized queries, HTML-escaped rendering, never eval'd (LLM05).
- Tiered agency, enforced in the backend executor (hiding a tool from the prompt is not a control): read = auto; draft = auto but visible; send/order/call = explicit farmer confirmation showing exact recipient, content, amount; payments/medication-related/above-threshold = confirmation + step-up auth (LLM06).
- The agent's service credentials are minimally scoped (send only from the farm's assistant address, call only verified contacts); hard daily caps on calls/emails/order value per farm; idempotency keys + cancellation window on queued actions; per-capability, per-farm kill switches checked on every action and auto-tripped on anomaly signals (LLM06/LLM10).
- Context minimization: retrieve only the fields the task needs (never bulk medication history); retrieval is tenant-scoped server-side regardless of what the prompt asks; redact medication records and PII from prompt/response logs; no secrets in system prompts or tool descriptions — assume the system prompt is public (LLM02/LLM07).
- Medication guidance is never free-generated: dosage/withdrawal content must originate from the structured veterinary database or route to a human vet; the backend cross-checks numeric claims against the source of record; no/conflicting data → ask the farmer, as an explicit code branch (LLM09).
- If RAG is used: vector store partitioned per farm at the DB-permission level, documents carry provenance + trust tier, ingestion runs the injection scanner, retrieval respects record ACLs, retrieved doc IDs logged per context (LLM08).
- Bound loops: max agentic iterations, max context size, wall-clock timeout per task — abort safely (no partial order); token/request budgets per farm; model versions pinned; prompt/model changes run the injection red-team suite in CI before rollout (LLM03/LLM10).

## Design-time (A06, C4)

- Threat-model (STRIDE) every feature crossing a trust boundary — tenant boundaries, medication records, third-party actions — before implementation; record abuse cases and required controls in the plan/PR (this is the same artifact as the write-code skill's "state the security requirements" workflow step).
- Write misuse tests alongside unit tests for critical flows: what must NOT be possible is part of the spec.
- Minimize attack surface: no admin tools, sample apps, or unused functionality in production; unauthenticated, tenant, admin, and internal/ops surfaces are distinct routes with distinct credentials.
- Secure defaults as the paved road: the easy way to add an endpoint/query/tool must be the safe way (central middleware, scoped repositories, generated clients) — never security-by-obscurity.

## Supply chain & CI/CD (A03, M2, C6, ASVS V15)

- Lockfiles committed and enforced for backend, portal, and app; upgrades via reviewed PRs only; SCA scanning (osv-scanner/Dependency-Check/Renovate) blocking on known-exploited criticals; SBOM (CycloneDX) generated per release.
- Vet packages touching data, crypto, or storage paths: maintained, provenance-verified, no abandoned dependencies in the data path; scoped package names against dependency confusion.
- CI/CD hardened: MFA on VCS/CI, branch protection with required review and no bypass, short-lived OIDC cloud credentials (no long-lived deploy keys), per-pipeline least-privilege, secrets vault-injected and masked, non-root runners.
- Artifacts signed and verified at deploy; store builds from tagged CI commits only (signing keys in a secrets manager, never laptops); staged rollouts; anything the client fetches and trusts (config pushes, OTA bundles) is signature-checked before use (A08).

## Exceptional conditions & availability (A10, ASVS V16)

- One global exception handler per service: unknown errors → generic message + correlation ID to the client, full detail to logs only; empty `catch` and broad catch-and-continue banned by lint (ASVS 16.5.1).
- Fail closed: if the authz layer, feature-flag store, or a permission lookup errors, deny. Test "dependency down → request denied" explicitly.
- Strict schemas reject missing/extra/null parameters instead of proceeding with defaults — critical for partial sync batches after connectivity loss.
- Multi-step operations are transactional; external side effects that can't roll back get idempotency keys + a reconciliation job — no order placed while the local write failed, no half-merged sync.
- Timeouts, retries with backoff + jitter, and circuit breakers on every third-party call; test unhappy paths in CI (fault injection, malformed sync payloads, mid-operation crashes).

## Logging & alerting (A09, C9, ASVS V16)

- The 2025 emphasis is **alerting**, not just logging: real-time alerts (with a named responder and runbook) on brute-force patterns, 403/404 spikes by authenticated users (IDOR probing), anomalous sync volume, and bursts of automated actions per farm; test that a synthetic failed-login burst actually fires the alert.
- Log security events with when/where/who/what per the audit-trail rules in the ISO reference; additionally log input-validation failures and business-logic sequence violations (C9).
- Strip CR/LF and encode user input in log lines (log injection); never log tokens, passwords, session IDs, or medication/personal payloads.
- Farmers see an activity trail of actions taken on their behalf — customer visibility is part of detection.

## Concrete parameters (Cheat Sheet Series)

Security headers, every portal response (API additionally: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, CSP `frame-ancestors 'none'`):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | app-specific; no `unsafe-inline` scripts; `frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` (allow per feature) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-XSS-Protection` | `0` |
| Remove | `Server`, `X-Powered-By`, version banners |

Reference numbers: argon2id m=19456 KiB t=2 p=1 · bcrypt cost ≥10 · session/JWT ~15 min idle, 4–8 h absolute · session ID ≥64 bits entropy · invite/reset tokens ≥128 bits CSPRNG, single-use, short-lived · password length 8 (with MFA) / 15 (without), max ≥64.

## Verification against this file

Before marking any task complete, beyond the checklists in the owasp and compliance SKILL.md files: (1) new endpoints have the cross-tenant + role-matrix tests; (2) any new input path (endpoint, webhook, sync field, deep link, LLM tool) has strict schema validation; (3) any new error path fails closed; (4) LLM-related changes pass the injection red-team suite. When a change knowingly deviates from a rule here, record it in `docs/security/risk-register.md`.
