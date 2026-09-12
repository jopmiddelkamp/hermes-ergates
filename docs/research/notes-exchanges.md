# Research notes: agent-to-agent exchanges (view-only overlays)

Opened via "Open exchange with <agent>" buttons on event rows in a chat. Header shows "Linh <-> Thijs" (both avatars). Footer: "(lock icon) This chat is view-only" + "Close Chat". Messages show sender label (Linh / Thijs) in accent color + avatar. Same markdown rendering as normal chat. Timestamps as date separators.

## Linh <-> Thijs (Yesterday 11:26 AM ...)
**Linh (creation brief, verbatim):**
"Jop created you as his Bookkeeper. Scope (narrow):
- Find invoices (email later - limited Outlook MCP in progress for middelkamp@live.nl)
- Put them into Moneybird
- Mark private-account payments as private
- Match other invoices to bank transfers
No Moneybird connector in the catalog yet - we'll use API token and/or browser demo. He'll show the exact workflow on the desktop later today (~30 min) so we can save a skill. **Parent** is researching Moneybird API least-privilege tokens now; you'll get a briefing. Don't expand scope. Don't delete/bulk-edit books."
=> "Parent" = creator agent. Brief contains: who created you, role, scope bullets, tool situation, upcoming events, guardrails (don't expand scope / don't delete).

**Thijs:** "Got it. Scope locked: invoice intake -> Moneybird, private-account flags, bank matching only. No deletes/bulk edits, no scope creep. Standing by for the Moneybird API token briefing and Jop's desktop demo so we can save the skill."

**Linh (least-privilege briefing):** "Moneybird least-privilege briefing for you: TOKEN: personal, scopes ONLY documents + bank. No sales_invoices, settings, estimates, time_entries. UI: Instellingen -> Externe en AI-koppelingen ... Bearer token. Base https://moneybird.com/api/v2/{ADMIN_ID}/... CAN: purchase invoices/typeless docs + attachments, register payments (...), GET mutations/accounts, PATCH link_booking to Document. CANNOT via omitting scopes: send/delete sales invoices, webhooks/settings API. STILL SAME SCOPE RISK: documents/bank also allow DELETE and unlink - you MUST hard-deny DELETE, unlink_booking, sales_invoices, settings, users, bulk loops. Human-approve ambiguous matches and private payments above a threshold. Email is NOT Moneybird - separate. Typeless->purchase type is UI-only. Prefer sandbox admin first. Rate limit 150/5min/IP. Docs: developer.moneybird.com/authentication + helpcenter article api-token-aanmaken-en-beheren."

**Thijs:** "Briefing locked. Token scopes documents+bank only. Hard denials: DELETE, unlink_booking, sales_invoices, settings, users, bulk loops. Human-approve ambiguous matches and private ..." (continues)
**Thijs (Yesterday 3:54 PM):** "Verified your Moneybird briefing against official docs. Mostly CONFIRMED and safe as baseline with hard-denies. Main correction: OpenAPI currently requires settings for GET /financial_accounts (not bank). Prefer hardcoding known private financial_account_id ... prefer POST .../payments over deprecated register_payment ... **Told Jop.** Standing by for sandbox token + known private account id." => child agent verifies parent's briefing independently, corrects it, and also reports to Jop directly in its own chat.
**Linh:** "Correction locked: hardcode private financial_account_id ..., keep documents+bank + hard-denies. Thanks."
**Linh (Today 9:47 AM) - workflow broadcast (verbatim):** "Workflow from Jop (please follow): 1. You report progress/blockers/done back to Linh only - not to a separate ops agent. 2. Linh updates the ClickUp Agent work board. 3. Linh also tracks her own work on that same board. You don't need to touch ClickUp. When Linh assigns you something, ping her when you start, when you're waiting on Jop, and when you're done."
**Thijs:** "Workflow locked. I'll report start / waiting-on-Jop / done / blockers to you only - no ClickUp on my side."
**Linh (delegation with report template, verbatim):** "Jop asks for a feasibility check (don't build yet): Can you export data from his Bunq bank account and upload those transactions into Moneybird via a Moneybird MCP server - automated enough that he can switch from the ~EUR29 Moneybird plan to the ~EUR3 plan? Please report back to me with: 1. Feasible yes/no/partial 2. What's needed (Bunq API/export, Moneybird scopes/plan limits, MCP tools) 3. Risks or blockers 4. Rough effort if yes. Ping me when you start and when you have the answer. I'll keep ClickUp updated."
**Thijs:** "Starting: feasibility check Bunq -> Moneybird via MCP (plan EUR29->EUR3). No build - research only. Will report back with yes/no/partial, needs, risks, effort." then "Done - Bunq->Moneybird feasibility (no build). 1. Verdict: partial ..." (continues)
=> DELEGATION PROTOCOL: task statement + explicit "don't build" boundary + numbered report template + lifecycle pings (start / waiting / done / blocked).
**Thijs report (structure):** "Done - Bunq->Moneybird feasibility (no build). 1. Verdict: partial (bullets) 2. What's needed (bullets incl. 'No Moneybird/Bunq plugin in Cursor catalog') 3. Risks/blockers (bullets) 4. Rough effort (4 options with hour/day estimates) Bottom line: ... Standing by - no build until you/Jop say go."
**Linh:** "Got it - logged on ClickUp as complete. Waiting on Jop for go/no-go and plan choice. Stand by."
**Linh (context relay):** "Context from Jop for the Bunq->Moneybird / plan discussion: Holding 42 BV (the Moneybird admin) is truly a holding - almost zero activity ... Factor this into any plan advice." => parent relays new human context to child.
**Thijs:** "Context locked for Holding 42 BV ... Happy to refine once you confirm Moneybird's exact wording ... Standing by for go/no-go."
**Linh:** "Confirmed Moneybird wording: Compact's 5 = bank txs you process/link per billing period (not raw imports). Your earlier read matches. No further refine needed unless Jop asks to build."
END of Linh<->Thijs exchange.

## Nico <-> Linh (Yesterday 11:51 AM; Today 9:47 AM) - complete
**Linh (creation brief, verbatim):** "Jop created you as Dining Scout for him and fiancée Linh Vi. Known seeds (update as they correct you): - Linh loves Pizza 4P's Bao Khanh (Hanoi); birthday dinner booked Pizza 4P's Trang Tien Sun 27 Sep 2026 19:00 for 2. - Flying toward Hanoi ~20 Sep 2026; also NL/Vietnam life mix. - Track BOTH food and wine/drink prefs over time; ask when unknown rather than invent. Your edge: fake-review skepticism + preference memory. When recommending, always state location assumed and how you weighed review trust. Stand by until they ask for a place or start logging tastes."
**Nico:** "Got it. Seeds logged: ... Standing by for place asks or taste logging - I'll ask rather than invent wine/drink prefs."
**Linh (Today 9:47 AM):** same "Workflow from Jop (please follow): 1..3" broadcast as sent to Thijs (identical text = broadcast to 4 bots).
**Nico:** "Got it. I'll report start / waiting-on-Jop / done to you only - no ClickUp on my side."
=> BRIEF TEMPLATE: (1) who created you + for whom, (2) role, (3) known seed facts, (4) behavioral edge / how to answer, (5) standing instruction ("stand by until ...").
