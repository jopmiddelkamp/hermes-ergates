# 04 - Algorithms

Step-by-step logic with numbers. Names match `02-contracts.md`.

## 1. Turn queue and worker (`apps/runner`)

```
enqueueTurn(agentId, threadId, kind, triggerMessageId, chainId):
  turn = insert turn(status=queued, chain_id=chainId)
  queue "turns".add(name=agentId, data={turnId}, {jobId: turnId})   # one BullMQ job per turn
  publish turn.status(queued)

worker (concurrency = MAX_CONCURRENT_TURNS, default 3):
  lock = redis SET agent-lock:{agentId} NX EX 1500     # one turn per agent at a time
  if not lock: job.moveToDelayed(now + 2000); return
  try:
    agent = load agent; if agent.status != active: mark turn skipped; return
    input = buildTurnInput(turn)                    # section 2
    adapter = registry.get(agent.harness)
    prepared = adapter.prepare(input)
    process = spawn(prepared) (host mode) | docker exec (docker mode)
    for line in process.stdout lines: ev = adapter.parse(line); if ev: handleEvent(turn, ev)   # section 3
    wait exit; if no 'result' event seen: fail turn with HARNESS_UNAVAILABLE
  finally: release lock
```
Timeout: a timer at TURN_TIMEOUT_MS sends SIGINT; after 30 s SIGKILL; turn failed `TURN_TIMEOUT`; post status row "I got interrupted after 20 minutes".
Retry: on failure with `RATE_LIMITED`, re-add with delay 60 s, then 300 s, then 900 s (attempt counter on the turn); after 3 retries fail and post a status row.

## 2. Building `TurnInput`

```
buildTurnInput(turn):
  agent, thread, participant = load
  messages = pending inbound messages for (agent, thread) since last succeeded turn (user, agent, routine kinds)
  copy each attachment file into workspace/inbox/{messageId}/ ; collect filePaths, imagePaths (mime image/*; HEIC converted to JPEG)
  memories = retrieveMemories(agent, messages)            # section 6
  openLoops = memory where kind=open_loop and status=open (max 50)
  changes = eventsSince(agent.lastTurnAt) mapped to sentences (section 7)
  harnessSessionId = participant.harness_session_id if participant.harness == agent.harness else null
  contextReplay = harnessSessionId == null and thread has messages ? buildContextReplay(thread) : null   # section 8
  systemPrompt = render(turn/prompt.md template) ; instructions file = render(section 2 of 03-templates) written to workspace
  policy = resolvePolicy(agent)                             # section 4
  mcpServers = [platform] + [gateway server per connector in policy.connectors]
  return TurnInput{...}
```

## 3. Handling turn events

| Event | Action |
|---|---|
| init | store harnessSessionId on turn; if a required MCP server (platform) failed: fail turn `HARNESS_UNAVAILABLE` |
| text_delta | append to buffer; every 150 ms publish `message.delta` (create the agent message row on first delta with kind=text, body empty) |
| text_final | set message.body_md; publish `message.created` (final) |
| tool_call | insert tool_call(started); publish `turn.status(running, "Using <tool>")` |
| tool_result | update tool_call(result_status) |
| status | publish `turn.status(running, text)` |
| result | update turn(status, usage, harness_session_id); store session id on thread_participant; publish `turn.status(done|failed)`; enqueue extraction job if ok and turn had a user message |
| error | mark failed with code; status row |

## 4. Policy resolution (`packages/shared/src/policy.ts`)

```
resolvePolicy(agent) -> { allowed: ToolRef[], ask: ToolRef[], denied: ToolRef[], connectors: string[] }
  for each agent_connector ac of agent:
    for each connector_tool t of ac.connector:
      if !t.enabled: denied.add ; continue                           # account-level switch
      if ac.tool_overrides.deny includes t.name: denied.add ; continue
      decision = hardLimit(t) ?? ruleDecision(agent, t) ?? categoryDefault(t.category)
      if decision == deny: denied.add
      else if decision == ask or t.requires_approval or ac.tool_overrides.ask includes t.name: ask.add
      else allowed.add
  hardLimit(t): category in [send, pay, delete] and platform setting HARD_ASK_SEND_PAY_DELETE=true -> 'ask' (never 'allow')
  categoryDefault: read/draft/write -> allow ; send/pay/delete/other -> ask
```
Rendered to the harness (adapter): allowed and ask tools appear in `tools/list` (ask tools flagged), denied tools are absent. The gateway re-evaluates `resolvePolicy` on every `tools/call` (cached 30 s per agent).

## 5. Gateway `tools/call`

```
onToolCall(jwt, connectorKey, toolName, args):
  claims = verify(jwt); agent = claims.sub; turn = claims.turn
  p = resolvePolicy(agent)
  ref = connectorKey + ":" + toolName
  if ref in p.denied or ref not in (p.allowed ∪ p.ask): return error TOOL_DISABLED; audit
  if ref in p.ask:
     card = createApprovalCard(turn, connectorKey, toolName, summarize(args)); notify(user)
     decision = await waitDecision(card.id, timeout 540 s)
     if decision == null: return error APPROVAL_PENDING ("Approval pending. The user has been notified. Stop and wait; do not retry.")
     if decision == deny: return error APPROVAL_DENIED
  account = connector account for (connector, user); if none/expired: return error CONNECTOR_UNAUTHENTICATED
  result = upstream.call(toolName, args, credentials(account))          # stdio client per connector, or HTTP with injected header
  if size(result) > 25000 tokens: write to workspace/outbox/gateway/{callId}.json; return {path}
  audit(tool_call row: decision, result_status); return result
```
Late approval: when a card with state open is allowed after `APPROVAL_PENDING` was returned, `enqueueTurn(agent, thread, kind=system, message="Approved: {tool} with the same arguments. Call it now.")`.

## 6. Memory retrieval

```
retrieveMemories(agent, messages):
  q = last user/agent message text + previous 2 messages, truncated to 2000 chars
  vec = embed(q)                                                    # multilingual-e5-small, 384 dims, prefix "query: "
  always = memory where kind in (rule) or (kind=profile) ; loops handled separately
  cands = SELECT ... WHERE agent_id=? AND kind IN (fact,preference,profile) ORDER BY embedding <=> vec LIMIT 40
  keep cands with cosine similarity >= 0.30 ; union with full-text hits (plainto_tsquery('simple', q)) LIMIT 20
  order: rules, profile, then cands by similarity desc; cut to 4000 tokens (ceil(chars/4))
```
Memory insert: `embedding = embed("passage: " + text)`.

## 7. "Since your last turn" sentences

Events since the agent's last turn end, mapped: `connector.updated` with tools enabled for this agent -> "New capability: {connector} ({n} tools: a, b, c)"; file uploaded -> "New file in inbox: {name}"; `card.updated` answered -> "The user answered your question '{question}': {answer}"; `job.updated` blocked->in_progress -> "Job unblocked: {title}"; `routine.fired` -> "Routine fired: {name}"; `agent.created` by this agent -> "You created {name}". Max 20 lines, newest first.

## 8. Context replay

```
buildContextReplay(thread):
  recent = last 40 messages (user, agent, system kinds text/file/card) formatted "[{senderName} · {time}] {text}"
  if thread has more than 40 messages:
     if thread.summary empty or summary_upto is > 200 messages behind: summary = extractionModel(summarizePrompt(older messages)) ; save
     block = "Summary of earlier conversation:\n" + summary + "\n\nRecent messages:\n" + recent
  else block = recent
  truncate oldest recent lines until block <= 12000 tokens
```

## 9. Agent-to-agent messaging and caps

```
sendMessageToAgent(from, to, text, kind, chainId):
  if to.status != active: error AGENT_UNAVAILABLE
  hops = redis INCR chain:{chainId}:hops (EX 6h); if hops > 6: DECR; error HOP_LIMIT
  perHour = redis INCR a2a:{from}:{hourBucket} (EX 2h); if perHour > 30: error HOP_LIMIT
  exchange = getOrCreateExchange(from, to)  (thread kind=exchange, title "{A} <-> {B}")
  msg = insert message(thread=exchange.thread, sender=from, body=text)
  insert event rows "Messaged {to}" in from.primary thread and "Message from {from}" in to.primary thread (kind=event with refId=exchange.id)
  enqueueTurn(to, to.primaryThreadId, kind=agent_message, msg.id, chainId)
```
Broadcast: same per recipient; one event row "Messaged {n} agents" with the list in payload.

## 10. Routines and timers

```
createRoutine(agent, req, turnId):
  key = sha256(turnId + "|" + req.name.trim().toLowerCase() + "|" + JSON.stringify(req.trigger))
  existing = routine where agent_id and idempotency_key = key; if existing: return {id, created:false}
  insert; schedule:
    once: queue "routines".add({routineId}, {delay: at - now, jobId: "r:"+routineId+":"+at})
    cron: queue "routines".add({routineId}, {repeat: {pattern: expr, tz}, jobId: "r:"+routineId})
    webhook: nothing (fires via POST /hooks/routines/{id}/{secret})
  event row "Created routine {name}" with refId
fire(routineId):
  if !active or agent paused: insert routine_run(skipped); return
  run = insert routine_run(running)
  enqueueTurn(agent, agent.primaryThreadId, kind=routine, message="[Routine: {name}] {instruction}" + context files, chainId=new)
  on turn result: run.status = succeeded|failed, run.summary = first 300 chars of the agent's final text
  if oneShot and succeeded: delete routine; event row "Deleted routine {name}"
  if failed: retry via turn retry (section 1); after final failure, run.status=failed and status row
```
Timers: a "remind me in 2 minutes" is `once` with `at = now + 2m`; the notifier pushes as soon as the turn posts its first message; if no message within 10 s, push the routine name as the reminder text.

## 11. Harness detection

```
detect(harness): 
  version = exec(`${binary} --version`, timeout 10 s) ; installed = exit 0
  authKind: claude_code -> env CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY present ? ... : file /srv/harness-home/claude_code/token exists ? subscription : none
            codex -> /srv/harness-home/codex/auth.json exists ? subscription : env CODEX_API_KEY|OPENAI_API_KEY ? api_key : none
            gemini -> /srv/harness-home/gemini/.gemini/oauth_creds.json exists ? subscription : env GEMINI_API_KEY|GOOGLE_CLOUD_PROJECT ? api_key : none
            grok_build -> /srv/harness-home/grok_build/.grok exists ? subscription : env XAI_API_KEY ? api_key : none
  store harness_status; publish harness.updated
probe(harness): only on manual rescan: run a turn with prompt "Reply with the single word ok." on cheapModel, maxTurns 1, timeout 60 s; success -> lastError=null; failure -> lastError=message
```

## 12. Adapter event mapping

| Harness line | TurnEvent |
|---|---|
| Claude `{"type":"system","subtype":"init",...}` | init (session_id, model, tools, mcp_servers) |
| Claude `stream_event` with `content_block_delta` text_delta | text_delta |
| Claude `assistant` message with text block (final) | text_final |
| Claude `assistant` with `tool_use` block | tool_call (id, name, input) |
| Claude `user` with `tool_result` | tool_result (ok = !is_error) |
| Claude `system` subtype `api_retry` | status ("Waiting for capacity" when error=rate_limit) |
| Claude `result` | result (is_error, session_id, usage.input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens, total_cost_usd) |
| Codex `thread.started` | init (thread_id as session id) |
| Codex `item.*` with agent message text delta / completed | text_delta / text_final |
| Codex `item.*` command or mcp tool call started/completed | tool_call / tool_result |
| Codex `turn.completed` | result (usage if present, else estimated) |
| Gemini `init` | init (session id if present) |
| Gemini `message` (assistant, partial) | text_delta; final `message` -> text_final |
| Gemini `tool_use` / `tool_result` | tool_call / tool_result |
| Gemini `result` | result (stats -> usage) |
| Grok streaming-json `session/update` with `agent_message_chunk` | text_delta; turn end -> text_final |
| Grok tool events (names to verify) | tool_call / tool_result |
| Grok final object | result |

Unknown lines are ignored but counted; more than 50 unknown lines in one turn logs a warning "adapter drift".

## 13. Group thread turn selection (Phase 2)

```
onUserMessage(thread):
  mentions = names after '@' matched case-insensitively against agent participants
  targets = mentions.length ? mentions : [thread.lead_agent_id]
  for agent in targets: enqueueTurn(agent, thread, user_message, msg.id, chainId=new)
  for other agents: message is delivered as context on their next turn (pending inbound), no turn now
```

## 14. Web push (Phase 1)
`sendPush(userId, {title, body, url})`: for each device kind=web_push send with `web-push` (VAPID); on 404/410 delete the device. Quiet hours skip except `kind in (approval, timer)`.
