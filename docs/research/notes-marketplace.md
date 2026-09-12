# Research notes: Marketplace, plugins, connectors

## Marketplace modal (sidebar button "Marketplace")
- Header "Marketplace" with tab toggle **Plugins | Bots** (top right), close X.
- Row of installed-plugin icons + "6 installed >" -> "Your plugins" page.
- Search field "Search plugins"; category chips: All / Featured / Agent Orchestration / Canvas / Customer Support / More v.
- Sections: "Featured" (Gmail ✓Added, Google Calendar ✓Added, Google Drive [Add], Granola [Add], Notion [Add] "Notion Skills + Notion MCP server", Slack [Add] "Slack MCP server"), "Agent Orchestration" (Arize, Atlan, AWS Agents, AWS SageMaker, Bird, Browserbase, ... "View all").
- Each card: icon, name, one-line description, Add / ✓Added.

## Your plugins page
- "< Back to Marketplace", search.
- **Installed**: Gmail (1 connector, Connected), Google Calendar (1 connector, Connected), Outlook Calendar (1 connector, Connected), clickup (1 connector, Connected) [marketplace one], Outlook (1 connector, Connected), ClickUp (1 connector) [the official MCP Linh added by URL; no Connected label].
- **Private**: "No private skills yet. Ask your Bot to create one for you." => private skills (created by bots) live here too.

## Plugin detail page (Outlook)
- Header: icon, name "Outlook", "View Source ↗" link, "Copy link to this plugin", buttons **Share** and **Uninstall**. Description "Search, read, and send Microsoft Outlook email, and look up contacts."
- **Accounts**: `middelkamp@live.nl` [edit icon] "Connected" + "+ Add Another Account" => multi-account per plugin.
- **Tools**: collapsible "10 of 13 enabled" -> list of tools each with an on/off switch (AX titles "Disable <tool>" when on / "Enable <tool>" when off):
  - ON: Get me, Get next page, List mail messages, Get mail message, List mail folders, Move mail message, Delete mail message, Update mail message, List contacts, Get contact
  - OFF: Send mail, Reply to mail message, Forward mail message
  - OBSERVATION: Jop disabled all outbound-send tools, but "Delete mail message" and "Move mail message" are still ON. For a true read+draft-only posture those should be OFF too (flag in findings). There is no explicit "Create draft" tool in this connector; "Update mail message" is the closest.
- **Connectors**: collapsible "1 connector".
- => BUSINESS RULE: tool enablement is per plugin at ACCOUNT level (applies to all bots), toggled in the marketplace UI, enforced by the platform (the disabled tools are not offered to the model).

## Bots tab (bot template marketplace)
- "Featured" cards: creator name + bot name (e.g. "Lauren Tan's dr eggbot", "Lenny Rachitsky's Overheard", "Claire Vo's Tradbot", "Eric Zakariasson's Projects Manager") with generated blob avatars + creator photo badge.
- Search "Search by creator or Bot name"; chips: All / From Grok Bot Team / Sales / Marketing / Recruiting & People / Operations / More.
- Sections: "From Grok Bot Team" (dr eggbot "Designs high-quality Grok Bots. Asks a few pre...", Projects Manager, Outbound Prospecting, SEO & AEO Desk, Haggle Bot, Recruiting Coordinator), "Sales" ... each with "View all".
- **Bot template detail page**: avatar, name, "By <creator>", description, **Import Bot** button, "Copy link to this Bot", three tabs on the left:
  - **Instructions** - "How this Bot should work" (system prompt text)
  - **Skills** - "Playbooks it can run" (named skills with descriptions, e.g. "Grok Bot project ops: Use this when creating or running a Grok Bot project: Notion Projects and Tasks, staffing, sidebar Projects placement, bots claiming work, and pinging the user when blocked ...")
  - **Integrations** - "Tools it can use" (required plugins, e.g. Notion "Notion Skills + Notion MCP server packaged as a Cursor plugin.", Slack "Slack MCP server ...")
- => TEMPLATE MODEL = instructions + skills[] + integrations[] (+ memories when exported by a user, see Niek). Import creates a new bot in the sidebar.

## New chat / group chat flow (sidebar "+" or "New chat")
- Opens an empty conversation with a **"To:" recipient field** ("Search or create Bots"). Typing shows a dropdown: "+ Create '<typed text>' Bot" (creates a brand-new bot with that name) and matching existing bots labelled "New chat".
- Selecting a bot adds a **chip** (avatar + name + x "Remove Linh"); the field stays open so more bots can be added => multi-bot GROUP CHAT. While creating, the sidebar shows "Linh, Jop Middelkamp - Creating..." (participants list incl. the human).
- After creation the sidebar shows a separate conversation "Linh" with a stacked group avatar, distinct from the bot's main 1:1 chat (which keeps the label badge). => conversations are separate THREAD objects; a bot can be in many threads.
- Composer placeholder becomes "Message Linh"; header shows stacked avatars + title; an (i) button opens details.
- INCIDENT (2026-09-12 10:45): during exploration a keystroke intended for the To-field went to the composer and sent the single character "N" to this new chat. This was unintended; reported to Jop.

## Account menu (sidebar bottom, "Jop Middelkamp")
- Items: "SuperGrok  25% >" (subscription name + usage meter, drill-down), "Get Grok Bot for mobile", "Support >", "Settings", "Add account", "Log out".
- => Requirements: usage meter visible to the user; multi-account; mobile app entry point.

## Group chat thread rendering (observed after the accidental message)
- Thread title = comma list of bot names; stacked avatars in header and sidebar; each bot message in a group shows a sender label with the bot's name and a small avatar; clicking the name opens the bot's own chat ("Open Linh's chat").
- The bot in the group thread has the SAME memory/context as in its 1:1 chat: Linh answered the stray "N" as if it were "Nee" (No) to the Compact question from her 1:1 chat ("Nee tot Compact nu, dus eerst de Bunq-sync via Thijs?"). => bot state is per bot, not per thread; threads are views onto the same agent.
- Header buttons in a bot chat: "View conversation details" (name/avatar click), share/export icon, "Template actions" popup (export/publish template), "Grok Bot's Computer" (live screen). Composer: "+" Attach file popup, text area, mic "Start voice input".
