# TypeScript / React coding standards (web/)

## Toolchain
- Node LTS pinned in `.nvmrc`; pnpm with a committed lockfile; Vite; React (current stable, pinned); TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- ESLint (typescript-eslint recommended-type-checked, react-hooks, jsx-a11y) and Prettier; CI fails on warnings.
- Tailwind for styling; design tokens in `src/shared/ui/tokens.css`.

## Structure
- Feature folders under `src/features/<feature>/` with `components/`, `hooks/`, `api.ts`, `__tests__/`. Cross-feature imports go through `src/shared/` only.
- Data fetching with TanStack Query; server state never copied into local state. UI state in small Zustand stores per feature.
- Routing with TanStack Router (typed routes).
- Forms with react-hook-form and zod schemas generated from `contracts/schemas`.

## Contracts
- API client and types are generated from `contracts/openapi.yaml` into `src/generated/` (`make contracts`); hand-written request or response types are a DRY violation.
- Event envelopes and cards are validated at runtime with zod schemas generated from the JSON Schemas before rendering.

## Real-time
- One SignalR connection (`@microsoft/signalr`) in `src/shared/hub/`; automatic reconnect; on reconnect send `Resume(lastEventId)`; events applied through a reducer per feature; duplicates dropped by event id.
- Optimistic updates for the user's own messages, reconciled by the server event.

## Security
- No `dangerouslySetInnerHTML` except in `src/shared/ui/Markdown.tsx`, which renders through a sanitizer (DOMPurify) with an allow-list; links get `rel="noopener noreferrer"`.
- No tokens in localStorage; auth is cookie-based; CSRF token header on mutations.
- CSP compatible: no inline scripts or styles; Vite configured with nonces where needed.
- User content is data: never build DOM or URLs from it without encoding.

## UI rules
- Every component has loading, empty, error, and success states; every async action has a disabled and pending state.
- Mobile first: one-thumb composer, 44 px minimum tap targets, tables collapse to stacked lists under 640 px.
- Accessibility: WCAG 2.2 AA; labels on all controls; focus visible; keyboard operable cards and menus; live region for incoming messages.
- Text lives in `src/shared/i18n/{nl,en}.json`; no hard-coded user-facing strings.
- Long lists (threads, messages) are virtualized.

## Testing
- Vitest + Testing Library for components and hooks (DAMP); MSW for API mocking from the OpenAPI file; Playwright for end-to-end on Chromium and WebKit (iPhone viewport); axe checks in Playwright.

## Comments
- Same `// KISS:` / `// DRY:` / `// SOLID-DEVIATION:` conventions as the C# standards.
