# Research notes: Niek chat (Business Coach)

## Screen 1 (Yesterday 2:28 PM)
- First item: event "Message from Linh" -> Niek: "Got Linh's setup note - loading the business-coach skill now so I'm ready when you ask." -> "Ready. Business-coach library is loaded - ask whatever's stuck (growth, offer, hiring, pricing, ops) and I'll diagnose before prescribing." => agent created from a SKILL package (zip) loads the skill library at startup and announces readiness. Name+title were given at creation ("agent called Niek with title Business Coach"), so no rename step.
- Jop uploads image "Your avatar!" -> "On it - setting that as my picture." / "Done - that's my face now." -> event "Messaged Linh" (child reports to parent that it's set up).
- Jop: "Can you analyse https://beansapp.com as this is one of my businesses. More businesses coming soon. I also want to clone the Arlington Bagle concept a weekend news letter and do this for Zwolle like Zwols Kaasblokje. Can you make a profile of both of these companies and remember that these profiles are important to me."
- Agent: "On it - pulling Beansapp + the Arlington Bagel model, then I'll write both profiles and **lock them in memory**." -> "Research is running on Beansapp and the Arlington Bagel model for Zwols Kaasblokje. I'll come back with both profiles and **save them to memory**." -> "Both profiles are ready. Saving them to memory, then I'll send the brief." => explicit long-term MEMORY primitive that the agent can write to on request.
- Brief starts with "**SHORT ANSWER**" section (coach skill output format).

## Screens 2-3 - Coach brief format, TEMPLATE EXPORT (agent anatomy)
- Coach brief format: SHORT ANSWER / <Company> - profile (ICP, Stage signals, Pattern, Open questions) / <Concept> (Reference, draft) / BEST MOVES (numbered) / CONSTRAINTS / BEST OPTION / closing question. Cites facts and marks unverified claims ("company claims, not verified").
- (3:01 PM) Jop: "Create a template of yourself that I can share with somebody else."
- Agent: "On it - pulling the **export-bot skill** so I can package a shareable template of me."
- Agent inventory of itself (verbatim):
  - "Just went through my **memories**: 3 profile facts (your businesses) plus 1 log note. All personal to you - I'll leave those out of a public share."
  - "**Skills**: no shared workflow skills in the library, but my business-coach operating system is on this bot - that's the one worth packing."
  - "**Routines**: none yet."
  - "**Plugins**: Gmail, Google Calendar, Google Drive, Outlook Calendar, and Slack are installed on your account, but I haven't used them for coaching in this chat - leaving them out of the ..." (continues)
- => AGENT ANATOMY = identity (name, title/label, avatar, description) + system/operating instructions (skill package) + memories (facts + log notes) + skills (workflow skills library) + routines + plugins (account-level connectors, per-agent usage). Export strips personal memories.
- => Plugins are installed at ACCOUNT level and shared by all agents (Gmail, Google Calendar, Google Drive, Outlook Calendar, Slack listed as of yesterday 3 PM; ClickUp + Outlook added today).

## Screens 4-5 - Template review card, size cap, skill archive
- "Keeping the business-coach operating skill plus one reusable coaching convention; leaving out your private company memories, empty routines, and unused plugins."
- **Template review card in chat**: title "Niek", status badge "• Unpublished", placeholder avatar (generic smiley), description "World-class business coach powered by frameworks from ~100 classic business books. Diagnoses befo...", buttons **Publish** and **View Details**. => a bot TEMPLATE object exists; can be published (to Marketplace) or inspected.
- Agent: "Review card's up - confirm when it looks right. One caveat: the template packs the coach operating system, not the full ~100-book reference library that lives only on this bot."
- Jop: "Then it's not interesting to share as that is the knowledgeabse" -> "Fair. Digging into the full knowledge base now so the next version actually includes it." -> "Got the full library (~590KB across index, lookups, frameworks, playbooks, stages, samples, and all book deep-dives). Restaging the share with that packed in." -> "Restaging now ... I'll ping you when the new review card is ready." -> "**Blocked on the share packer: one template caps at ~100k characters**, and the coach knowledge base alone is ~670k. So I can't put the real library into a single public bot share."
- File attachment: "business-coach-skill.tar.gz 222kB" -> "Here's the full knowledge base as business-coach-skill.tar.gz (**SKILL.md + all references/books**) - that's what actually makes this coach worth sharing. Options from here: 1. Hand someone that archive + a short 'drop this on the bot / import as skill' note. 2. I still publish a thin public 'Niek' shell (method only, under the 100k cap) that tells importers to load this library. 3. Wait for a higher share-size limit / multi-file templates - not available to me right now. Want the thin shell anyway, or is the archive enough?"
- => SKILL FORMAT = SKILL.md + references/ folder (same shape as Anthropic Agent Skills). Agents can be created FROM such an archive (zip) and can EXPORT one. Template share has a ~100k char cap (platform limit).
- Jop: "What can you help me with business wise?" -> "Quick pull of the coach playbook list so I answer with the real menu." -> menu of coaching topics.

## Screen 6 - Coaching menu, end
- Menu answer: general topics; "For you specifically (what I already know)" with the 3 remembered profiles; "Structured deep-dives I can run on demand: ..."; "Not for: formal scored audits, legal/tax advice, or coding the product itself." => skill defines scope + out-of-scope.
- (Today 9:47 AM) event "2 messages with Linh" (workflow broadcast). END of Niek chat.

## Template details modal (View Details)
- Modal: avatar, name "Niek", "By Jop Middelkamp", description; row "Context - Instructions and memories >"; button "Publish".
- Context page: **Instructions** (text box = "World-class business coach powered by frameworks from ~100 classic business books. Diagnoses before prescribing on strategy, hiring, pricing, sales, marketing, culture, scaling, ops, and leadership.") and **Memories** (list of entries, each opens a detail page with "Content").
- Memory entry example (verbatim): "When the user asks you to build company profiles, treat them as important durable context - save them and use them in coaching." => memories are short natural-language notes; the template packs the non-personal ones.
- => TEMPLATE = {name, author, avatar, description/instructions, memories[]} (+ skill package). Published templates appear in the Marketplace (to verify).
