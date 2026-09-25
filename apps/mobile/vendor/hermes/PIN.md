# Vendored Hermes sources

Upstream: Hermes Agent by Nous Research, MIT license (see `LICENSE` in this directory).
Pin: commit `d76856cc6971b6e0e1903b5369498bcc4bb83a60`, version 0.21.2.
Upstream checkout used for the copy: `~/Projects/misc/hermes/hermes-agent`.

| Vendored file | Upstream path | Local change |
|---|---|---|
| `shared/json-rpc-gateway.ts` | `apps/shared/src/json-rpc-gateway.ts` | none |
| `shared/skin.ts` | `apps/shared/src/skin.ts` | none |
| `themes/types.ts` | `apps/desktop/src/themes/types.ts` | none |
| `themes/presets.ts` | `apps/desktop/src/themes/presets.ts` | none |
| `themes/color.ts` | `apps/desktop/src/themes/color.ts` | none |
| `themes/skin.ts` | `apps/desktop/src/themes/skin.ts` | import path `@hermes/shared/skin` -> `../shared/skin` |

Protocol constants recorded from the same pin (not copied as code):

- `tools/bot_mode_probe.py::BOT_CHAT_TITLE = "Bot Chat"`
- `hermes_cli/dashboard_auth/ws_tickets.py::TTL_SECONDS = 30`
- `hermes_cli/web_server.py::_SESSION_HEADER_NAME = "X-Hermes-Session-Token"`
- `tui_gateway/ws.py::_TOKEN_COALESCE_S = 0.033`

Re-verify every file and constant against the backend on each Hermes upgrade (docs/06 section 7).
