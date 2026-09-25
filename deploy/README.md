# Ergates deployment (single VPS)

## Status: validated-by-review draft, not a live-tested deployment

`docker-compose.yml` has been checked for compose syntax
(`docker compose -f deploy/docker-compose.yml config`) and reviewed against
the wiring contract in `docs/03-technical-design.md` section 9 and
`docs/11-implementation-readiness.md` section 4. **It has not been run on a
VPS.** Do not treat anything here as a completed deployment; treat it as the
starting point for the P0 validation spike that document calls for. The
"Unverified gates" section below is not a footnote -- it is the list of
things that must be proven true before this stack is trusted with real
data.

## Layout

```
deploy/
  docker-compose.yml               # hermes-serve, hermes-gateway, ntfy
                                   #  + read-only mount of ../integrations/ergates
                                   #    at /opt/data/plugins/ergates in both controllers
  .env.example                     # copy to .env, fill in real values, never commit .env
  profiles/
    concierge/{config.yaml,SOUL.md}            # default/launch profile
    specialist-template/{config.yaml,SOUL.md}  # copy per specialist during provisioning
  README.md                        # this file
```

## Install

Prerequisites on the VPS: Docker + Docker Compose v2, and Tailscale already
installed and connected (`tailscale ip -4` must return an address). This
draft assumes both exist on the host already -- neither is a compose
service here (see "Deliberately out of scope" in `docker-compose.yml`).

**Generate the dashboard credentials before the first `up -d`, not after.**
The dashboard bind is non-loopback, so Hermes's auth gate is on from the
first second the container serves (`web_server.py`'s `should_require_auth`
is host-based and `--insecure` does not bypass it) -- and a placeholder
trio *satisfies* that gate. Starting with `change-me` / `change-me` puts a
working login on the tailnet until you get around to fixing it. Nothing in
the first-run flow needs the stack running to mint these.

**What goes in `.env` is the password *hash*, not the password** (04 section
6: "password hash where supported"). The stock provider prefers
`password_hash` and only hashes a plaintext in memory as a fallback
(`plugins/dashboard_auth/basic/__init__.py`), so the plaintext form leaves
the password at rest in `.env` for no benefit.

```bash
git clone <this repo> && cd <this repo>/deploy
cp .env.example .env

# 1. Session secret.
openssl rand -hex 32          # -> HERMES_DASHBOARD_BASIC_AUTH_SECRET in .env

# 2. Data directories first: the throwaway container below bind-mounts them,
#    and Docker would otherwise create them owned by root, which the
#    privilege-dropped hermes user cannot write.
mkdir -p data/hermes data/ntfy

# 3. Password hash. Prompted, so the password never reaches your shell history
#    or a process listing. `run --rm --no-deps` uses a throwaway container and
#    does NOT need the stack up.
docker compose run --rm --no-deps --entrypoint python hermes-serve -c \
  "import getpass; from plugins.dashboard_auth.basic import hash_password; \
   print(hash_password(getpass.getpass('dashboard password: ')))"

# 4. Escape every '$' as '$$' before pasting the hash into .env -- Compose
#    interpolates .env values, and an unescaped scrypt hash silently loses
#    everything after its first '$16384'.
printf '%s\n' 'scrypt$16384$8$1$...' | sed 's/\$/$$/g'
#    -> HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH in .env

# 5. Also set in .env: HERMES_DASHBOARD_BASIC_AUTH_USERNAME, TAILSCALE_IP,
#    DOCKER_SOCK_GID (stat -c '%g' /var/run/docker.sock).
#    Leave HERMES_DASHBOARD_BASIC_AUTH_PASSWORD empty.

# 6. Then validate and start.
docker compose -f docker-compose.yml config   # validate before starting anything
docker compose -f docker-compose.yml up -d
```

Check the interpolation before starting, since a mangled hash fails closed as
a login you cannot use:

```bash
docker compose -f docker-compose.yml config | grep BASIC_AUTH_PASSWORD_HASH
# every '$' must still be there (config output re-escapes them as '$$'),
# and the value must end in the same base64 the hash command printed
```

`HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` (plaintext) remains wired as a
**fallback only**, normally empty. A non-empty value takes *precedence* over
the hash -- the provider hashes it in memory on every start and logs that it
did -- so use it only if the hash command is unavailable in your image, and
replace it with a hash afterwards. UNVERIFIED: the hash command's import path
(`plugins.dashboard_auth.basic`) depends on the image's working directory
being the Hermes app root; if it fails, fall back to the plaintext variable
and record it as a gap.

### Verify the integration plugin is installed

The plugin is not copied anywhere: `docker-compose.yml` bind-mounts
`../integrations/ergates` read-only at `/opt/data/plugins/ergates`, which is
the user-plugin directory Hermes scans (`get_hermes_home()/plugins`, per
`hermes_cli/plugins_discovery.py`). Confirm it actually loaded before
provisioning anything that depends on it -- otherwise the ntfy publisher
token in step 2 below is being stored for a plugin that is not there:

```bash
docker compose exec hermes-serve hermes plugins doctor /opt/data/plugins/ergates
docker compose exec hermes-gateway hermes plugins doctor /opt/data/plugins/ergates
```

Expect one registered tool (`ergates_propose_agent`) and two hooks
(`pre_approval_request`, `post_approval_response`). The gateway matters
separately: that is the process where the approval hooks actually fire.

## First-run credential provisioning

Credentials are provisioned once, interactively -- never baked into
`docker-compose.yml`, `.env.example`, or any file in `profiles/`
(docs/04-security-and-compliance.md section 6). The dashboard trio is
already done above, before first start.

1. **Hermes setup wizard** (API keys, model/provider auth):
   ```bash
   docker compose exec hermes-serve hermes setup
   ```
   Writes to the mounted `/opt/data/.env` -- inside the volume, never in this
   repo.

2. **ntfy accounts and tokens** (deny-by-default ACL, 03 section 9; 04
   section 6 requires *separate scoped tokens*: a server publisher and
   device subscriptions). Two ordinary users, each with the narrowest
   access that works -- never an admin, whose rights no ACL entry
   constrains:

   ```bash
   # Server publisher: may publish to the topic, may not read it.
   docker compose exec ntfy ntfy user add --role=user ergates-publisher
   docker compose exec ntfy ntfy access ergates-publisher 'ergates-*' write-only

   # Device subscriber: may read the topic, may not publish to it.
   docker compose exec ntfy ntfy user add --role=user ergates-phone
   docker compose exec ntfy ntfy access ergates-phone 'ergates-*' read-only

   # One token for the server, and one token per device, from the right account.
   docker compose exec ntfy ntfy token add --label="hermes publisher" ergates-publisher
   docker compose exec ntfy ntfy token add --label="<device name>" ergates-phone
   ```

   `--role=user` is the whole point: an `--role=admin` account ignores ACL
   entries, so `ntfy access` on an admin is decoration and a token minted
   from it hands whoever holds it full control of the ntfy server. The phone
   is the device most likely to be lost, so it gets a read-only subscriber
   token and nothing else. One token per device keeps revocation per device
   (`ntfy token remove`). ([ntfy user/access/token CLI][ntfy-config])

   The publisher token goes **only** into the plugin's settings
   (`plugins.entries.ergates.settings.ntfy.token` on the profile that runs
   the concierge -- see `integrations/ergates/README.md`); the subscriber
   tokens go **only** into the ntfy app on each device. Neither belongs in
   this `deploy/` tree, in `.env`, or on any command line other than the
   `ntfy token add` above.

   The topic itself must match the ACL pattern: set
   `plugins.entries.ergates.settings.ntfy.topic` to an `ergates-`-prefixed
   name (for example `ergates-attention`), and subscribe the devices to the
   same one.

3. **Concierge and specialist profiles**: copy `profiles/concierge/` and
   `profiles/specialist-template/` into the mounted data volume as real
   Hermes profiles, then fill in every `TODO` each `config.yaml` calls out
   (workspace volumes, effective toolset, MCP include list) before treating
   a profile as ready. Specialist profiles must be provisioned with
   `mirror_credentials: false` against an approved role template -- never by
   copying the concierge's credentials (04 section 6; 11 section 4.1).

4. **Schedule the plugin's retry/retention sweep** (below). A failed push is
   scheduled for a retry that nothing in Hermes runs, so without this step
   the retry machinery and every retention rule are dead code.

## Periodic sweep: ntfy retries and retention

The plugin's hooks fire only on an approval or a finished turn -- there is
no periodic-timer hook in that surface -- so the push outbox and the
retention rules need an external driver. `python -m ergates.flush` is that
driver: it sends every due push from the outbox of the control store
(`/opt/data/ergates/control.sqlite3`), expires approvals older than the
approval timeout, and applies retention to attention events, proposal
receipts and reminder receipts.

It reads the ntfy server, topic, token and connection id from the profile's own `config.yaml`
(the same `plugins.entries.ergates.settings.ntfy.*` keys the plugin reads),
so **no credential is ever passed as an argument** and none appears in a
process listing or in the log line it prints (04 section 6). The only
arguments are `--profile` and `--quiet`.

Add this to the host's crontab (`crontab -e`), every two minutes:

```cron
*/2 * * * * cd /srv/ergates/deploy && /usr/bin/docker compose exec -T -e PYTHONPATH=/opt/data/plugins/ergates hermes-serve python -m ergates.flush >> /var/log/ergates-flush.log 2>&1
```

- `-T` disables the pseudo-TTY, which a cron job has no use for.
- `PYTHONPATH=/opt/data/plugins/ergates` puts the mounted plugin directory
  on the import path; the package inside it is `ergates/`.
- Adjust `cd /srv/ergates/deploy` to wherever you cloned this repo, and
  `/usr/bin/docker` to `which docker` on the host (cron's `PATH` is minimal).
- Add `--profile <name>` when the concierge runs as a named profile rather
  than the default one.

Run it once by hand first; it prints one line of counts:

```bash
docker compose exec -T -e PYTHONPATH=/opt/data/plugins/ergates hermes-serve python -m ergates.flush
# ergates.flush: retried=0 expired_notifications=0 pruned_notifications=0 pruned_proposals=0 pruned_reminders=0
```

A systemd timer is equally fine; the requirement is only that *something*
runs it on a short interval. Two minutes is chosen against the plugin's
30s / 2min / 10min publish backoff, so a due retry waits at most ~2 minutes
past its schedule.

## Update

```bash
cd deploy
docker compose pull                 # after moving the image tag/digest forward
docker compose up -d
```

Both `hermes-serve` and `hermes-gateway` read from the same `/opt/data`
volume, so no separate data migration step is expected for a same-major
update -- confirm this against Hermes's own update notes before a real
upgrade, since neither controller has been updated in this draft.

## Backup

Initial policy (04 section 8): **seven daily and four weekly encrypted
off-host snapshots**, covering:

- `${HERMES_DATA_DIR}` (`/opt/data`): profile workspaces, `config.yaml`,
  `.env`, `SOUL.md`, sessions, cron jobs, state database, and this
  package's control store (`ergates/control.sqlite3` with its `-wal` file).
- `${NTFY_DATA_DIR}`: the ntfy auth and cache databases.

A consistency-aware procedure is required, not a raw `cp` of a live SQLite
file:

```bash
# Example only -- not exercised against this stack. Adjust for your actual
# backup target/encryption tooling.
docker compose stop hermes-serve hermes-gateway
tar czf "backup-$(date +%Y%m%d-%H%M%S).tar.gz" data/hermes data/ntfy
docker compose start hermes-serve hermes-gateway
# Encrypt and ship the archive off-host; do not leave it next to the volumes.
```

Stopping both controllers for the backup window is the simplest way to
guarantee a consistent snapshot in this draft; a hot-backup procedure (WAL
checkpoint + copy) is a P0 follow-up if the stop window becomes too
disruptive. Record backup encryption-key recovery separately from the
server itself (04 section 8) -- losing both together makes the backup
worthless.

## Restore drill

Not yet performed against this stack. Before relying on backups:

1. Provision a second, disposable VPS (or a local Docker host).
2. Restore the most recent daily archive to fresh `data/hermes` and
   `data/ntfy` directories.
3. Bring the stack up against the restored data and confirm: the dashboard
   logs in with the restored basic-auth credentials, at least one known
   profile's sessions/memory are present, and a known cron job still lists
   correctly.
4. Record how long the restore took and anything that had to be fixed by
   hand. Repeat quarterly, or after any change to the backup procedure.

## Unverified gates (explicit list)

These are called out, not hidden, because this file is a draft:

1. **Docker socket group access under the s6 privilege drop.** `group_add`
   in `docker-compose.yml` sets a supplementary group on the container's
   PID 1; the supervised `hermes` process is reached only after s6 drops
   privileges via `s6-setuidgid`, and that drop may not preserve the
   supplementary group (03 section 9). Confirm with
   `docker compose exec hermes-serve id` and
   `docker compose exec hermes-serve docker ps` before trusting it.
2. **The ntfy event source.** 11 section 4.2: "ntfy's `send()` alone does
   not subscribe to events from `hermes serve`." Nothing in this draft
   proves that approval-created/resolved/expired events actually reach
   `integrations/ergates`'s hooks while every app socket is disconnected.
3. **iOS locked-phone delivery.** Reachability of this private ntfy server
   from a locked iPhone over Tailscale, after the public upstream wake-up,
   is untested (11 section 4.2; docs.ntfy.sh/config/#ios-instant-notifications).
4. **Workspace path alignment for `terminal.backend: docker` profiles.**
   03 section 9: a host bind mount like `/srv/hermes:/opt/data` does not
   automatically make `/opt/data/sandboxes/...` a valid host path for a
   container that itself launches sibling containers through the host
   daemon. Not proven here.
5. **Image pins are tags, not digests.** Both `nousresearch/hermes-agent`
   and `binwiederhier/ntfy` are pinned to a specific version tag as a
   placeholder, with the digest observed at draft time recorded in a
   comment for convenience. Replace both with a verified digest
   (`@sha256:...`) once this file has actually been run through P0
   validation -- do not ship the tag pin as the final state.
6. **The outbound proxy and its allowlist** (provider/connector egress
   control) are not modeled as a compose service in this draft; the wiring
   contract requires one.
7. **Backup/restore** above is a written procedure, not yet an executed
   drill.
8. **The plugin mount and the periodic sweep have not been run in this
   stack.** `hermes plugins doctor` passes on the plugin directory locally,
   and the discovery path (`get_hermes_home()/plugins`) is read from the
   pinned source, but neither the mount nor the
   `docker compose exec ... python -m ergates.flush` cron line has been
   executed against a running container. Run both during the P0 spike; the
   doctor step above is the check that proves the mount half.

## Corrections applied after review

- The runbook used to bring the stack up with a placeholder basic-auth trio
  and generate real values afterwards. Because the gate is on from the first
  request, that served a `change-me` login on the tailnet in between;
  credentials now come first.
- ntfy provisioning used to create the publisher as `--role=admin` and then
  mint the "narrowly-scoped subscriber token" from that same admin account,
  so a lost phone carried full control of the ntfy server and the
  `ntfy access` line next to it had no effect. Now: two `--role=user`
  accounts, write-only for the server, read-only per device.
- The plugin was never installed into the stack (no mount, no copy step),
  and nothing drove `flush_retries`. Both are wired above.
- The dashboard password was passed as plaintext where the provider prefers a
  hash. `.env` now carries `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH`,
  generated before the first start, with the plaintext variable kept as a
  documented fallback.

[ntfy-config]: https://docs.ntfy.sh/config/
