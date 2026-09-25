# Ergates

A clean React Native messaging app for a team of Hermes Agent assistants on your own server. Hermes owns the agents; Ergates is the phone app, a small server integration package and the deployment configuration.

| Part | Path | Status |
|---|---|---|
| Mobile app (Expo SDK 57) | [apps/mobile](apps/mobile/README.md) | Runs on the iOS simulator against a local `hermes serve`; see the app README |
| Integration package (Hermes plugin, Python) | [integrations/ergates](integrations/ergates/README.md) | Unit-tested; not yet installed on a live gateway |
| Deployment (Compose, profile templates, runbook) | [deploy](deploy/README.md) | Reviewed draft; not yet run on a VPS |
| Design documents | [docs](docs/README.md) | Authoritative specification; `docs/superpowers/` holds the plans (among them the Fable upgrade roadmap) and research notes |

## Quick start (simulator)

```bash
# 1. backend, loopback token mode
export HERMES_DASHBOARD_SESSION_TOKEN="$(openssl rand -hex 16)"; echo "$HERMES_DASHBOARD_SESSION_TOKEN"
hermes serve --host 127.0.0.1 --port 9119 --skip-build

# 2. app
cd apps/mobile && npm install && npx expo run:ios
```

Connect in the app with `http://127.0.0.1:9119` and the token.

## Verification

`scripts/ci-local.sh` runs the CI jobs locally; `.github/workflows/ci.yml` runs the same script on GitHub Actions.

| Job | What it checks |
|---|---|
| `lint` | the workflow files (actionlint) and the runner script |
| `mobile` | `npm run typecheck`, Vitest with the coverage gate, the ADR-029 dependency rules |
| `integration` | the Python suite with a 90% branch-coverage gate, including the Hermes boundary guard |
| `contract` | facts about the pinned Hermes source the integration relies on |
| `deploy` | `docker compose config` and static checks of `deploy/` |

Run one job with `scripts/ci-local.sh mobile`, several with `scripts/ci-local.sh integration contract`. The quick loops:

- `cd apps/mobile && npm test && npm run typecheck`
- `cd integrations/ergates && uv run --python 3.11 --with pytest --with pytest-cov --with pyyaml pytest`
- Live backend smoke: `ERGATES_LIVE=1 ERGATES_TOKEN=… npx vitest run test/live` (from `apps/mobile`)

Hermes pin: `d76856cc6971b6e0e1903b5369498bcc4bb83a60` (v0.21.2). Re-verify the vendored client and the recorded shapes in `docs/superpowers/research/` on every upgrade.
