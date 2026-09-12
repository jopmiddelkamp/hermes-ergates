# 00 - Builder contract

This contract binds every AI builder (and every human) who changes the Cobbers codebase. It is loaded at the start of every task. If a rule here conflicts with a task card, this contract wins. If a rule here conflicts with a skill file, the stricter rule wins.

## 1. Where you work
- You work in the dev container defined in `deploy/devcontainer/`. It has the .NET SDK, Node, Docker-in-Docker for tests, and PostgreSQL via Testcontainers.
- Network: package registries (NuGet, npm) and the Git remote only. No calls to Anthropic, OpenAI, Google, xAI, or any connector. Model calls in tests go to the fake harness binary in `fixtures/fake-harness/`.
- Data: synthetic only. Never copy production data, real emails, real tokens, or the research screenshots into tests or fixtures.
- Secrets: none. If a task seems to need a real secret, stop and ask.

## 2. What you may do
- Change files listed under "Touches" in your task card, plus tests for them, plus documentation that describes them.
- Add a dependency only if the card allows it, it is on the approved list in `01-standards/dependencies.md`, and you pin it in the lockfile.
- Run: build, tests, lint, format, migrations against the test database, the fake harness.
- Open one pull request per task card, targeting `main`, with the PR template filled in.

## 3. What you must not do
- Touch files outside "Touches" (except tests and docs for them). If the card cannot be finished without it, stop and report.
- Widen scope, add "nice to have" features, or add abstractions the card does not ask for (KISS skill).
- Delete, weaken, skip, or mark-as-flaky any existing test.
- Disable lint rules, analyzers, or CI gates; add `#pragma warning disable`, `// eslint-disable`, `[SuppressMessage]`, or `any` without a card that allows it.
- Log or print message bodies, memories, tokens, connector credentials, or personal data.
- Change a database migration that has been merged; add a new one.
- Change a JSON Schema, the OpenAPI file, or a state machine without a card that names that contract.
- Use `--dangerously-skip-permissions`, `--yolo`, `--always-approve`, or equivalent flags anywhere in product code or scripts.
- Commit to `main` directly, force-push, rewrite history, or merge your own PR.
- Leave `TODO`, `FIXME`, `HACK`, or commented-out code in a PR.

## 4. How you work through a task card
1. Read the card, the contracts it links, and the skills it lists (always: kiss, dry, solid, owasp, compliance).
2. Restate the card's acceptance tests in your own words in the PR description before coding. If anything is ambiguous, stop and ask; do not guess.
3. Write or extend the tests named in the card first. They must fail for the right reason.
4. Implement the smallest change that makes them pass. Follow `01-standards/`.
5. Run every gate locally: `make check` (build, format, lint, analyzers, unit and integration tests, contract tests, secret scan). All green.
6. Self-review with the checklists in section 6. Record the answers in the PR description.
7. Open the PR. Title in Conventional Commits form: `feat(gateway): hold ask-tools until approval (T-042)`.

## 5. When to stop and ask
- The card is ambiguous or two readings lead to different code.
- A test outside your card fails and the cause is not your change.
- You need a file, dependency, secret, or network access the card does not grant.
- A security checklist item cannot be satisfied within the card.
- The change would alter a contract, migration, or state machine.
Write the question in the PR description, mark the PR as draft, and end the task.

## 6. Self-review checklists (answer every line in the PR)
Security (from the owasp skill):
- [ ] Every new endpoint declares its permission; tenant scoping tested by a cross-tenant test that fails.
- [ ] Every new input path has strict schema validation with unknown properties rejected; a negative test exists.
- [ ] Errors fail closed; a dependency-down test exists where relevant.
- [ ] No message bodies, memories, tokens, or personal data in logs, errors, or prompts.
- [ ] Tool calls from models are validated server-side; tool policy is checked at the gateway.
Compliance (from the compliance skill):
- [ ] Audit events emitted for security-relevant operations and covered by a test.
- [ ] Automated actions have idempotency, approval check, guardrails, and a kill switch, each tested.
- [ ] Evidence files updated when a vendor, data store, or accepted risk was added.
Design (from the kiss, dry, solid skills):
- [ ] No new abstraction without a present-tense reason; deviations documented with `// KISS-DEVIATION:` etc.
- [ ] No business rule duplicated; no magic numbers.
- [ ] Interfaces only at layer boundaries or with 3+ implementations.
Quality:
- [ ] `make check` green; coverage on touched modules not lower than before.
- [ ] Docs updated (standards, contracts, runbooks) where behavior changed.

## 7. Definition of done
A card is done when: all its acceptance tests pass in CI, all gates are green, the checklists are answered, the PR is reviewed and merged by someone other than the author, and nothing outside "Touches" changed.

## 8. Escalation ladder
Builder -> reviewing model (checks the PR against the bible) -> Jop (final approval for seams: auth, gateway policy, harness adapters, migrations, anything that sends, pays, or deletes).
