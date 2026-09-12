# Repository layout (Cobbers monorepo)

```
cobbers/
  Cobbers.sln
  Directory.Build.props            # shared build settings: net10.0, nullable, warnings as errors, analyzers
  Directory.Packages.props         # central package versions (pinned)
  global.json                      # SDK version pin
  .editorconfig                    # C# and TS formatting rules
  src/
    Cobbers.Domain/                # entities, value objects, domain events, state machines; no dependencies
    Cobbers.Application/           # use cases (commands, queries), ports (interfaces), DTOs, validators
    Cobbers.Infrastructure/        # EF Core, Postgres, file store, outbox relay, Quartz, notifiers, harness adapters, docker
    Cobbers.Api/                   # ASP.NET Core host: minimal API endpoints, SignalR hub, auth, ProblemDetails, OpenAPI
    Cobbers.Runner/                # worker host: job consumer, sandbox lifecycle, harness detector
    Cobbers.Gateway/               # MCP gateway host: policy filter, credential injection, approval hold
    Cobbers.PlatformMcp/           # stdio MCP server shipped into the sandbox image
    Cobbers.Contracts/             # C# types generated from contracts/ (schemas), shared by all hosts
  tests/
    Cobbers.Domain.Tests/          # pure unit tests
    Cobbers.Application.Tests/     # use case tests with fakes
    Cobbers.Infrastructure.Tests/  # Testcontainers Postgres, outbox, jobs, adapters against fixtures
    Cobbers.Api.Tests/             # WebApplicationFactory: endpoints, auth, tenant isolation, hub
    Cobbers.Gateway.Tests/         # policy, hold, credential injection
    Cobbers.Contract.Tests/        # every harness adapter and connector against recorded fixtures
    Cobbers.E2E.Tests/             # docker compose + fake harness, walking-skeleton scenarios
  web/                             # React + Vite + TypeScript PWA
    src/app/                       # routes, providers, shell
    src/features/<feature>/        # one folder per feature: components, hooks, api, tests
    src/shared/                    # ui kit, hub client, generated api client, i18n, utils
    src/generated/                 # OpenAPI client and schema types (do not edit)
  contracts/
    openapi.yaml                   # REST contract (source of truth for the client)
    schemas/*.json                 # events, cards, platform tools, harness turn events, config
    db/                            # migration SQL reviewed alongside EF migrations
    state-machines.md
    error-catalog.md
    config-catalog.md
  prompts/                         # concierge.md, specialist.md, templates, extraction; versioned
  fixtures/
    fake-harness/                  # a small .NET console app that replays recorded vendor streams
    harness-streams/<harness>/     # recorded stream-json / JSONL / streaming-json samples
    mcp/                           # recorded MCP exchanges
    golden/                        # golden transcripts for prompt tests
  deploy/
    docker-compose.yml
    Caddyfile
    cloud-init.yaml                # VPS bootstrap
    devcontainer/
    sandbox/Dockerfile             # agent sandbox image with pinned harness CLIs
  docs/                            # design (01-09), bible, security evidence, research
  .claude/skills/                  # owasp, compliance, solid, dry, kiss (adapted), cobbers-standards
  .github/workflows/               # ci.yml, release.yml, deploy.yml
  Makefile                         # make check, make test, make migrate, make e2e
```

Rules
- Dependency direction: Domain <- Application <- Infrastructure <- hosts. Hosts reference Infrastructure; nothing references a host.
- `Cobbers.Contracts` is generated from `contracts/`; regenerate with `make contracts`; never hand-edit.
- One feature folder per bounded context on both sides: chat, agents, harness, connectors, routines, jobs, files, memory, notifications, settings, auth.
