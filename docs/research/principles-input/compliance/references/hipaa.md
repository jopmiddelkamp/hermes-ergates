# HIPAA Security Baseline Rules

> HIPAA is a US federal law (45 CFR Parts 160/164) protecting human Protected Health Information (PHI) held by covered entities and their business associates.
> **It almost certainly does NOT legally bind this product**: we handle ANIMAL health data (veterinary medication/treatment records) and farmer business data for a Dutch/EU market — the binding law is the GDPR/AVG (see the GDPR rules).
> We adopt the HIPAA **Security Rule** safeguards (45 CFR 164.308/310/312) voluntarily as a best-practice engineering baseline for sensitive health-adjacent records, and for readiness.
> HIPAA would become legally binding only if we (a) expand to US customers AND (b) handle human PHI on behalf of a covered entity (e.g. farmer occupational-health features, US telehealth-style vet integrations touching human data). If either trigger nears, stop and do a formal compliance review.
> Treat treatment records, vet communications, and medication logs as "ePHI-equivalent" throughout these rules.

## Technical safeguards — access control (§164.312(a))

- Give every user, service, and integration its own unique identifier; never share accounts or API keys between farmers, vets, or services (§164.312(a)(2)(i)).
- Enforce authorization on every backend endpoint server-side; never rely on the mobile app or web portal hiding a button (§164.312(a)(1)).
- Scope every query to the authenticated farm/tenant (row-level tenancy filter in every repository method); a missing tenant filter is a release blocker.
- Implement automatic logoff: idle-timeout the web portal session and require re-authentication (biometric/PIN) on the mobile app after inactivity or backgrounding (§164.312(a)(2)(iii)).
- Provide a break-glass emergency access path for support access to production data that is separately authenticated, time-boxed, and fully logged (§164.312(a)(2)(ii)).
- Grant third-party integrations (vet, mechanic, supplier) role-scoped tokens limited to the specific farm and data type they serve; never issue platform-wide credentials.

## Technical safeguards — encryption (§164.312(a)(2)(iv), §164.312(e))

- Encrypt the offline-first mobile database at rest (e.g. SQLCipher/encrypted Realm/Isar) with a key held in the platform keystore (Keychain/Keystore), never hardcoded or stored in app files.
- Encrypt all transport with TLS 1.2+ (prefer 1.3); reject plaintext HTTP everywhere including sync, webhooks, and integration callbacks (§164.312(e)(2)(ii)).
- Encrypt backend data at rest (database, backups, object storage) with managed KMS keys; encrypt backups with a different key than live data.
- Never write treatment or medication details into logs, crash reports, analytics events, push-notification payloads, or URL query strings.
- Keep sync-queue payloads and local caches (images of labels, PDFs from vets) inside the encrypted store, not in plaintext temp or Downloads directories.

## Technical safeguards — audit controls (§164.312(b))

- Emit an immutable audit event (who, what, when, which farm, which record) for every create/read-of-detail/update/delete on treatment and medication records.
- Log all authentication events, permission changes, data exports, and third-party API access; make audit logs append-only and retained separately from application logs.
- Audit-log automated outbound actions too: every automated phone call, email, and order placed on a farmer's behalf gets an audit record with recipient and data categories disclosed.
- Review anomalous access patterns (bulk reads, off-hours exports) via alerting, not manual log-grepping (§164.308(a)(1)(ii)(D)).

## Technical safeguards — integrity and authentication (§164.312(c), (d))

- Protect treatment records from silent alteration: use server-authoritative timestamps, checksums or version columns, and conflict detection in the offline sync protocol (§164.312(c)(2)).
- Resolve sync conflicts on medication records by preserving both versions for review — never last-write-wins silently on dosage, withdrawal period, or animal ID.
- Authenticate every caller before returning data: no unauthenticated "lookup" endpoints, and verify webhook signatures from integration partners (§164.312(d)).
- Make deletions soft-delete with audit trail for treatment records; support hard erasure as a deliberate, logged GDPR-erasure operation.

## Minimum necessary — data minimization (§164.502(b), §164.514(d))

- Return only the fields the consuming screen or partner needs; build per-role/per-purpose API response DTOs instead of serializing full entities.
- Give vets access only to their own patients' records at the farms that granted access, mechanics none of the animal-health data, suppliers only order-relevant data.
- Default list views and search results to non-sensitive summary fields; require an explicit detail fetch (which is audit-logged) for full treatment history.
- Collect only what the feature needs: no free-text fields that invite farmers to paste sensitive personal data where structured fields suffice.
- Strip or pseudonymize identifiers in analytics, error tracking, and any AI/LLM prompt; never send raw treatment records to third-party AI or telemetry services without a processor agreement.

## Treatment-record handling — vet/medication module

- Model medication courses with explicit sensitive-data classification so serializers, loggers, and exporters can enforce redaction by type, not by convention.
- For automated phone calls that speak treatment details aloud: verify the callee (known vet number plus a spoken confirmation step) before disclosing any treatment content, and disclose the minimum necessary for the call's purpose.
- Never leave treatment details in voicemail; leave only a callback request.
- Send vet emails with minimum-necessary content: prefer a link to an authenticated portal view over embedding full treatment history in the email body.
- Do not put animal treatment or medication details in SMS, email subject lines, or push-notification text; use neutral wording ("New treatment update for your review").
- Record withdrawal periods (wachttermijnen) and dosages as validated structured data with unit checks — integrity errors here have food-safety consequences.

## Breach readiness (§§164.400–414 analog; GDPR Art. 33/34 is binding)

- Design so a lost phone is a non-event: encrypted local store, remote session revocation, and short-lived tokens mean device loss ≠ data breach (encryption safe harbor, §164.402).
- Build a "what did this credential touch" query path now: audit logs must answer scope, records, and time-window of any compromise within hours.
- Support immediate revocation of any integration partner's access (kill switch per partner, per farm).
- Keep an incident runbook: classify, contain, assess (four-factor style: what data, who got it, was it viewed, mitigation), and notify — GDPR's 72-hour supervisory-authority deadline governs, stricter than HIPAA's 60 days.
- Alert on bulk export, mass read, and audit-log write failures — detection is a prerequisite of notification.

## Third parties — BAA-equivalent (§164.308(b), §164.314(a))

- Sign a GDPR processor agreement (verwerkersovereenkomst/DPA) — the BAA equivalent — before any vendor (hosting, telephony/voice provider, email service, error tracking, AI APIs) touches treatment or farmer data.
- Prefer EU-region data residency for all processors; document transfer mechanisms (SCCs) for any non-EU vendor before integrating it.
- Verify each integration partner (vet systems, suppliers) receives data only under a documented agreement defining purpose, scope, retention, and deletion.
- Pin per-vendor allowlists in code/config for what data categories may flow to each external service; block new outbound data flows that lack an entry.
- Re-check this file's applicability note before onboarding any US customer or any human-health feature — that is the moment real BAAs and full HIPAA compliance become mandatory.
