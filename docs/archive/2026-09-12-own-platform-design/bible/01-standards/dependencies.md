# Approved dependencies

Add a dependency only from this list, pinned, via a card that names it. Anything else requires a new row here through a PR reviewed by Jop.

## .NET
| Package | Purpose |
|---|---|
| Microsoft.AspNetCore.* (in-box), Microsoft.AspNetCore.SignalR | HTTP, minimal APIs, real-time |
| Microsoft.EntityFrameworkCore, Npgsql.EntityFrameworkCore.PostgreSQL | Data access |
| FluentValidation | Request validation |
| Quartz, Quartz.Serialization.Json, Quartz.AspNetCore | Schedules with PostgreSQL store |
| ModelContextProtocol (official MCP C# SDK) | Platform MCP server and gateway |
| Docker.DotNet | Sandbox lifecycle |
| OpenTelemetry.*, Serilog.AspNetCore, Serilog.Sinks.Console | Telemetry and logs |
| WebPush | Web push |
| Telegram.Bot | Optional Telegram notifier |
| Microsoft.AspNetCore.Identity (in-box) + Fido2.NetLib | Login, passkeys |
| Otp.NET | TOTP |
| xunit, FluentAssertions, NSubstitute, Testcontainers.PostgreSql, Verify.Xunit, Microsoft.AspNetCore.Mvc.Testing | Tests |

## Web
| Package | Purpose |
|---|---|
| react, react-dom, vite, typescript | Core |
| @tanstack/react-query, @tanstack/react-router, zustand | Data, routing, UI state |
| @microsoft/signalr | Real-time |
| react-hook-form, zod | Forms and validation |
| tailwindcss, @radix-ui/* (primitives), lucide-react | UI |
| react-markdown, remark-gfm, dompurify | Safe markdown |
| @tanstack/react-virtual | Virtualized lists |
| vite-plugin-pwa, workbox | PWA and push |
| openapi-typescript, openapi-fetch, json-schema-to-zod | Generated contracts |
| vitest, @testing-library/react, msw, @playwright/test, @axe-core/playwright | Tests |
