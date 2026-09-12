# C# / .NET coding standards

Applies to every project under `src/` and `tests/`. Enforced by `.editorconfig`, analyzers, and CI.

## Toolchain
- .NET 10 LTS; SDK pinned in `global.json`; packages pinned centrally in `Directory.Packages.props`.
- `<Nullable>enable</Nullable>`, `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`, `<AnalysisLevel>latest-recommended</AnalysisLevel>`, `<ImplicitUsings>enable</ImplicitUsings>`.
- Formatting by `dotnet format`; CI fails on diffs.

## Architecture rules
- Clean architecture layers as in repo-layout.md. Domain has no package references except the BCL.
- Ports are interfaces in Application (`IAgentRepository`, `IFileStore`, `IHarnessAdapter`, `IClock`). Adapters live in Infrastructure. Interfaces exist only at layer boundaries or when 3+ implementations exist (kiss, solid skills).
- Use cases are classes with one `Handle` method: `CreateAgentCommand` + `CreateAgentHandler`. No god services.
- Constructor injection only; 0-5 dependencies healthy, 8+ is a defect.
- No static access to infrastructure (`DateTime.UtcNow`, `File.*`, `HttpClient` creation) inside Domain or Application; use `TimeProvider`, `IFileStore`, `IHttpClientFactory`.

## Naming
- PascalCase for types, methods, properties; camelCase for locals and parameters; `_camelCase` for private fields.
- Async methods end with `Async` and take a `CancellationToken` as the last parameter. Never `.Result`, `.Wait()`, or `async void`.
- Booleans read as questions: `IsActive`, `HasApproval`.
- No `Manager`, `Helper`, `Utils`, `Processor` in type names.

## Errors
- Domain and application failures are typed results, not exceptions: `Result<T, Error>` with an error code from `contracts/error-catalog.md`.
- Exceptions only for programming errors and infrastructure failures. One global exception handler in the API maps everything to RFC 9457 ProblemDetails with a correlation id; never a stack trace to the client.
- No empty `catch`; no catch-and-continue. Catch the narrowest type.

## Data access
- EF Core with migrations in Infrastructure; every migration reviewed with its SQL in `contracts/db/`.
- Every entity has `TenantId`; a global query filter applies the current tenant; Postgres RLS is enabled with `FORCE ROW LEVEL SECURITY` and the connection sets `app.tenant_id` per request. Both must hold (defense in depth).
- Parameterized queries only; `FromSqlInterpolated` allowed, string concatenation banned by analyzer.
- Multi-step writes in one transaction; events go to the outbox table in the same transaction.
- Concurrency: `xmin` or a `Version` column on mutable aggregates.
- Ids: `Guid` version 7 (`Guid.CreateVersion7()`); time in `DateTimeOffset` UTC; user time zones as IANA strings.

## API (Cobbers.Api)
- Minimal APIs grouped per feature (`MapAgentsEndpoints`); every endpoint declares `.RequireAuthorization("<permission>")`; an endpoint without a policy fails a startup test.
- Request DTOs are records with FluentValidation validators; unknown JSON properties rejected (`JsonUnmappedMemberHandling.Disallow`); response DTOs are explicit records per role.
- Versioned under `/api/v1`; OpenAPI generated at build and diffed against `contracts/openapi.yaml` in CI.
- Pagination: cursor-based, `limit` capped at 100. Body size cap 50 MB on upload endpoints, 1 MB elsewhere.
- Rate limiting middleware per user and per tenant; 429 with `Retry-After`.
- Security headers exactly as `docs/bible/03-security-baseline.md`.

## Real-time (SignalR)
- One hub `CobbersHub`; groups per thread and per user; client calls: `Subscribe`, `Resume(sinceEventId)`, `Typing`, `Read`. Server pushes `Event(envelope)` only; the envelope is the JSON Schema `event.json`.
- The outbox relay is the only publisher. No direct `IHubContext` calls from use cases.

## Background work
- Quartz.NET with the PostgreSQL job store for schedules; the turn queue is a table consumed by `Cobbers.Runner` with `FOR UPDATE SKIP LOCKED`, leases with heartbeat, max 3 attempts with jittered backoff, then dead-letter.
- Hosted services implement graceful shutdown: stop taking jobs, finish or release leases within 30 s.

## Logging and telemetry
- `ILogger<T>` with structured templates; never string-interpolated messages; never message bodies, memories, tokens, or personal data.
- Every log line carries `TenantId`, `CorrelationId`, and where relevant `AgentId`, `ThreadId`, `TurnId` via scopes.
- OpenTelemetry traces for HTTP, EF Core, HttpClient, hub, jobs; metrics named per `docs/bible/05-test-strategy.md` appendix.

## Configuration
- Options pattern with `ValidateDataAnnotations().ValidateOnStart()`; every key documented in `contracts/config-catalog.md`; secrets from environment or a secret store, never appsettings in git.

## Testing
- xUnit, FluentAssertions, NSubstitute; Testcontainers for Postgres; `WebApplicationFactory` for API tests; Verify for snapshot tests of prompts and ProblemDetails.
- Tests are DAMP: one scenario per test, explicit arrange and assert; shared builders in `tests/Cobbers.TestKit`.
- Naming: `Method_Scenario_Expectation` or sentence style; misuse tests are mandatory for tenancy, policy, hop caps, and approvals.

## Comments
- `// KISS:`, `// KISS-DEVIATION:`, `// DRY:`, `// DRY-DEVIATION:`, `// SOLID-DEVIATION:` as defined in the skills. No other explanatory comments for what the code already says.
