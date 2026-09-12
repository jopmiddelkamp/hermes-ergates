# Research notes: Linh chat (Assistant / Fiancee)

Source: Grok Bot app, window walkthrough on 2026-09-12. Only Jop's messages and agent messages. Internal agent-to-agent exchanges marked as such.

## Screen 1 (Thu Sep 10, 5:32 PM) - Onboarding interview
- Agent opens: "Hey Jop - good to meet you. I'm here to take real work off your plate. What's the main thing you want help with first?"
- UI pattern: **choice card** inside chat. Title "What's the main thing you want help with first?" with selectable options (letters A/B/C...). Selected: "C Tasks & follow-ups" (checkmark).
- Agent: "Got it - I'll help you keep tasks and follow-ups from slipping. Where do those live for you right now?"
- Choice card: "Where do your tasks live today?" -> selected "F Somewhere else".
- Agent: "Cool - where do they live? App name, notes file, spreadsheet, sticky notes, whatever it actually is."
- Jop: "iCloud notes but I can tell you them here"
- Agent: "Perfect - dump whatever's open or overdue here (bullets, messy notes, all fine). I'll turn it into a clean list and help you keep follow-ups from slipping."
- Jop pasted a plain-text TODO list (3 items).
- Agent: cleaned list, numbered, with due date inferred ("due tomorrow (Fri Sep 11)"). "I'll keep these. Setting a reminder for the packing one tomorrow morning."
- **System event row** (centered, small): "Created routine  (clock icon) Pak maken bruiloft reminder" -> clickable "Open routine ..." button. => Agents can create ROUTINES (scheduled reminders/jobs) and the chat shows an event card.
- Agent: "Reminder set for tomorrow at 8:00 AM (your time) for packing. Want me to dig into doorsturen info or Linh's verblijfsvergunning next, or leave those until you say?"
- Jop: "This is fine I need to go now!" / "Talk later!"
- Agent: "Later - packing nudge's set for 8am."

## Screen 2 (Thu Sep 10, 8:07 PM) - Avatar from photos
- Jop uploaded 5 photos (gallery shows 3 thumbnails + "+3" overflow badge) with message "Can you create a nice avatar of my fiancee Linh and use it as your avatar?"
- Agent: "On it - I'll make a clean avatar from one of these photos of Linh and set it as mine." / "Picked a clean Paris crop - setting it as my avatar now." -> shows the cropped image inline -> "Done - that's me now. Want a different shot (...) instead?"
- => Agent can change its OWN avatar (self-management of profile). Images sent by agent appear as inline image bubbles with "Open image full screen".
- (Thu Sep 10, 8:57 PM) Jop sent one image "Use this please" -> Agent: "Swapping it in now." / "Done - that's one's live."

## Screen 3 (Thu Sep 10, 9:26 PM) - Interview
- Jop: "Can you interview me to find out what you can help me to ease my life?"
- Agent: "Love that. I'll keep it light - one question at a time." then a series of choice cards:
  - (option seen) "E Remembering stuff"
  - (Thu Sep 10 9:49 PM) "That's a lot on one plate - fair. If I could take one off your shoulders this week, which would help most?" -> card "Which one should I take first this week?" -> "A Admin & paperwork"
  - "Admin first - got it. Is Linh's verblijfsvergunning the main open item, or is there a bigger pile behind it?" -> card "How big is the admin pile?" -> "A Mostly that permit"
  - "Okay - narrow and clear. Where are you with Linh's verblijfsvergunning right now?" -> card "Where are you with the permit?" -> "A Not started - need a plan"
  - "Perfect - then we'll build the plan from scratch. Which country is the permit for?" -> card -> "A Netherlands"
  - "Netherlands - noted. What's the basis for Linh's application?" -> card "What's the basis for her application?" -> "E Not sure yet"
  - "Then we'll map the route properly. ..."

## Screens 4-7 - Interview continues, research task
- Multi-select choice card: "What's draining you most right now?" A Admin & paperwork / B Messages & email / C Planning & decisions / D Work overload / E Remembering stuff -> ALL checked (multi-select supported).
- Single-select cards continue: status in NL (Dutch citizen), Linh's nationality (Vietnamese), where living (Vietnam).
- Agent: "She's applying from Vietnam then - so likely MVV + residence permit together. Are you already married, or still engaged?"
- Choice card "What's your relationship status for the application?" shows badge **"Dismissed"** -> Jop answered in free text instead of picking; card is greyed and marked Dismissed.
- Jop wrote a long free-text (voice-to-text) explanation of the wedding plan (ceremony in Vietnam, legal marriage in NL, notary in Raalte, future living plans).
- Agent: "Got the full picture - ... I'm looking up: (1) marry/register in NL vs Vietnam, (2) docs Linh needs from Vietnam, (3) how long she can stay outside NL once she has a verblijfsvergunning (I'm reading that as the permit, not a literal birthday - yell if wrong)."
- Agent: "Digging through IND and marriage rules now - I'll come back with a plain-language plan and the travel-abroad limits." => async research; agent posts follow-up messages later.
- Jop asks clarification; agent apologizes, explains it suspected a voice-to-text mix-up, asks what was meant.
- Agent posts research result as several bubbles: "Here's what I found (not legal advice - verify with ...)". Structured with bold lead-ins: "Your plan works:", "For the NL wedding, Linh usually needs from Vietnam:", "Book a 'free desk day' only after ...", "Permit vs living in Vietnam - the hard part:", "Safer split: ...", ends with question "Want me to turn this into a concrete next-30-days checklist (...), or dig into one piece first?"
- **Reply-to-message feature**: Jop's message shows a quoted line above it "(reply icon) Sorry - that was confusing. In your last message it looked like..." with an AX button "Jump to replied message". The agent's answer also quotes the message it replies to. => threaded quote-replies exist for both user and agent.

## Screens 8-10 - IND research, one-thing-at-a-time, Outlook access discussion
- Agent pulls exact IND wording with an inline hyperlink ("main residency page (updated 20 Jul 2026)") -> markdown links rendered in bubbles. Uses numbered lists, bullets, blockquote, bold, italics.
- Jop (replying to a specific agent paragraph via quote-reply): asks about inburgering exam validity + "please give me the whole checklist thing".
- Jop: "Wacht, we zijn nu twee, veel dingen tegelijk ... één ding even klaarmaken en dan naar de volgende" -> Agent: "Helemaal mee eens - één ding tegelijk." => agent adapts working style on request (one topic at a time).
- Agent answers in Dutch when Jop writes Dutch (language mirroring).
- Choice card "Hoe staat Linh's examenuitslag?" -> Dismissed; Jop instead uploaded a phone screenshot image. Agent read the image (OCR/vision): "Helder - Linh Vi, uitslag 7 mei 2026. Geldig tot 7 mei 2027..." => vision on uploaded images.
- Choice card "Wat is de volgende stap?" -> "B Gemeente / trouwen NL".
- Agent: "Oké - trouwen in NL. Eerste vraag: in welke gemeente willen jullie trouwen?" -> Jop: "Olst wijhe" -> Agent: "Olst-Wijhe - ik zoek hun trouwen-pagina en documentenlijst op." then a result with phone numbers shown as inline code, "Volgende stap (één ding): bel ...". => web research per municipality.
- Jop: "Ik zal je morgen even toegang geven tot mijn e-mail ... alleen lees toegang ... eventueel toegang om een draft hiernaar te stellen, maar verder niks. Ik gebruik Outlook."
- Agent: "Ik zoek uit hoe je in Outlook alleen lezen (+ eventueel drafts) kunt geven - niets meer."
- Agent: "Oké - Outlook even kort: morgen connecten we de Outlook-connector; Microsoft vraagt vaak meer rechten dan 'alleen lezen', maar ik gebruik alleen zoeken/lezen (+ draft als jij dat wilt). Versturen doe ik niet zonder jouw oké."
- Jop (quote-reply): "Nee, ik wil wel echt graag dat je gewoon op een veilige manier je echt alleen toegang kan geven om alleen te lezen of een draftie me op te stellen. Als het moet, dan moeten we misschien eventjes een custom MCP opzetten of zo, die je dan kunt gebruiken, waarbij ik misschien een token kan genereren, waarbij je minder toegang hebt ... Denk even buiten de box."
- **KEY BUSINESS REQUIREMENT**: least-privilege tool access enforced technically (scoped token / custom MCP), not by agent promise.

## Screens 11-13 - Custom MCP plan, file output, routines, browser booking
- Agent (quote-reply): "Snap ik - geen 'ik beloof het', maar écht technische afbakening." Then a structured option list: Entra app registration with Mail.Read + Mail.ReadWrite, no Mail.Send; "kleine custom MCP die alleen search/read/draft tools heeft. Token = wat jij genereert/vernieuwt." Options: stricter (Mail.Read only) / simple interim (forward PDFs).
- Choice card "Welke veilige mail-route wil je?" -> "A Custom MCP: lezen + draft".
- Agent asks account type; card "Welk type Outlook-account?" -> Dismissed (Jop answered free text).
- System event: "Created routine  Outlook limited MCP setup" => routines are also used as TASK/PROJECT trackers, not only reminders.
- Jop: is the outlook MCP open source? fork it, strip write tools, use with limited token. Gives email address.
- Agent: "Ja - die route is precies goed. ... Laag 1 fork + strip send/delete/move; Laag 2 token without Mail.Send. Beide lagen samen = echt veilig." Confirms spelling of email.
- Jop: asks agent to write instructions/prompt so he can build it with ChatGPT/Claude because "ik heb niet zo'n hoog Grok token budget" (token budget constraint!). Wants professional dev prompt with acceptance criteria, scope.
- Agent: "Ik schrijf één strakke development-prompt ..." -> event "Updated routine  Outlook limited MCP setup" -> Agent delivers summary + **file attachment card**: "outlook-limited-mcp-prompt.md 6.3kB" with download icon and "Open outlook-limited-mcp-prompt.md" button. => agent can create files and share them as attachments in chat.
- Jop: "Herinner me morgen vroeg nog even met de prompt om 08:00" -> Agent: "Morgen 8:00 herinner ik je met die MCP-prompt." -> event "Updated routine  MCP-prompt herinnering 8:00" -> "Staat - 11 sep, 8:00, met de prompt erbij." => routine can carry an attachment/context.
- Jop: gives both birthdays + asks reservation at Pizza 4P's Bao Khanh 19:00 (Hanoi) -> Agent infers date (Sat 27 Sep, Linh's birthday) and asks confirmation via choice card "Confirm the Pizza 4P's night?" -> "A Linh's birthday - 27 Sep".
- Agent: "Booking Pizza 4P's Bao Khanh - Sat 27 Sep 2026, 19:00, for 2. Checking availability now." -> "Browser booking got blocked by a safety check - retrying so you can approve it if needed." => **agent has a browser (Grok Bot's Computer)**; risky actions hit a SAFETY CHECK that requires user approval.

## Screens 14-15 - Auto-review block, open choice card, routine lifecycle
- Agent: "Blocked on my side: the desktop booking step keeps getting stopped by **Auto-review**, so I can't click through TableCheck from here right now." Gives booking summary, direct link (markdown link), alt phone. "Want me to retry (you may see an approval card), or will you lock it in yourself?"
- **Open choice card** (not yet answered): "How should we finish the Pizza 4P's booking?" with X close button, options A Retry booking here / B I'll book it myself / C Remind me tomorrow morning. Unanswered cards stay open with a close (X) affordance.
- Jop: do it tomorrow morning; open everything on your computer until the human check, then I finish. => "human check" = approval handoff.
- Agent: "Top - morgen vroeg: eerst de MCP-prompt, daarna open ik Pizza 4P's ... tot de human check. Jij rondt af." -> event "Updated routine  Ochtend: MCP-prompt + Pizza 4P's" => two reminders MERGED into one morning routine.
- Jop: reverse order -> Agent: "Ja, beter - ..." -> "Updated routine  Ochtend: Pizza 4P's + MCP-prompt".
- Jop: also keep the to-do list -> Agent: "Later - morgen 8:00 pizza klaarzetten + prompt. De open to-do-lijst bewaar ik tot dan." (agent memory of open todos)
- **Yesterday 8:20 AM**: event "Deleted routine  Pak maken bruiloft reminder" + agent message "Morgencheck: vandaag pak maken voor de bruiloft." => one-shot routine fires -> posts message -> routine auto-deleted.
- **Yesterday 8:44 AM**: "Deleted routine  Ochtend: Pizza 4P's + MCP-prompt" + "Created routine  Pizza 4P's Bao Khanh retry" + status message "Goedemorgen - even de stand: ... nog niet geboekt. TableCheck laat nu alleen tot ~24 sep toe ... Ik probeer automatisch opnieuw ma 14 sep 08:00 ... Of wil je nu een andere vestiging?" + 2 browser screenshots attached (image gallery from agent). => routines can self-reschedule; agent attaches screenshots of its browser work as evidence.

## Screens 16-17 - Routine result, evidence screenshots, Jop books himself, AGENT CREATES AGENT
- Routine result message includes 2 screenshots (image gallery) of the agent's browser session (TableCheck calendar, pizza4ps locations).
- Choice card "Hoe wil je de pizza-avond aanpakken?" -> Dismissed.
- (Yesterday 9:17 AM) Jop: "damn yesterday it was still available?" -> Agent explains honestly it could not check live yesterday because browser booking was blocked; re-attaches the MCP prompt file (same file re-shared).
- Jop uploads a screenshot of a "BOOKING SUMMARY" (he booked Trang Tien himself). Agent reads the image: "Nice - locked in: Pizza 4P's Trang Tien, zo 27 sep, 19:00, 2 pax, note for Linh's birthday. Ik zet de Bao Khanh-retry van maandag uit." -> event "Deleted routine  Pizza 4P's Bao Khanh retry". => agent cancels routines when obsolete.
- Jop: "Nee die lijkt al volgeboekt.." -> "Dan is Trang Tien de goeie call - 27 sep staat."
- **AGENT CREATION FROM UPLOAD**: Jop uploads "training-system.zip 57kB" + "Ik wil nu dat je even een personal trainer agent toevoegd aangezien ik zo ga trainen. En dit is de configuratie die ik uit een ander project heb. Zou mooi zijn als je deze even als basis kunt hanteren. Dan optimaliseren we het later wel wat meer!"
- Agent: "Ik pak je trainer-config uit en zet de agent klaar." -> event row (right-aligned) "Messaged (avatar) Kevin" with button "Open exchange with Kevin" => Linh created a NEW AGENT (Kevin / Trainer) and sent it a message. Unzip + read config + create agent + brief it.
- Agent: "Personal Trainer staat klaar - je hele training-system zit erin als basis (safety, ..." (continues next screen)

## Screens 18-19 - More agents created by Linh; inter-agent exchange rows
- (Yesterday 10:08 AM) Jop: "It's raining so we stuck for a bit. Any tips on what to pick up next?" -> Agent proposes next items from the open todo list (MCP prompt, call municipality). Proactive prioritization from memory.
- (Yesterday 11:26 AM) Jop (long voice message): "can you set up a new bookkeeper agent? ... research on how I can give access to the agent to only do specific things ... it just sends my email, finds all the invoices puts them into the system, marks the thing that I pay with my private account ... connects the other invoices to certain bank transfers ... I think I can take over the machine for a little bit, show how it's done, so you can create a skill out of it. I'm using Moneybird ... research in the background ... how the tokens can be generated, what the permissions can be on each token ..."
- Agent: "Setting up a Bookkeeper agent and digging into Moneybird API tokens/permissions so we're ready when you're home (~30 min). Later you can show the flow on my computer and I'll turn it into a skill."
- Event row: "Messaged (avatar) Thijs" [button "Open exchange with Thijs"] => Linh CREATED Thijs (Boekhouder) and briefed him.
- Agent: "**Bookkeeper** is live. No Moneybird connector in the catalog, so we'll use a tight API token and/or your desktop demo. I'm researching Moneybird token permissions in the background. When you're home: show the flow once on my computer -> I'll turn it into a skill. Train well - talk in ~30."
- Event row: "Message from (avatar) Thijs" [Open exchange with Thijs] => inbound agent-to-agent message shown as event.
- Agent relays: "Moneybird API research is ready - here's the tight setup: Token: personal API token with only Documenten + Bank scopes ... What that enables ... What it still can't stop alone: delete/unlink live in the same scopes - so the Bookkeeper agent will hard-deny DELETE, unlink, sales invoices, settings. Gaps: email is separate (your Outlook MCP) ..."
- Event row: "2 messages with (avatar) Thijs" => exchanges are grouped/counted.
- Agent: "Bookkeeper's briefed too. Ping me when you're home."
- Jop: "Can you set up one agent that keeps track of our food preferences and that is highly specialized in researching and finding good restaurants in the area that we stay at, and is also highly specialized in filtering out like fake reviews ... keep track of our food preferences and our preferences of wine ..."
- Agent: "Setting up a dining scout that tracks your tastes and hunts real reviews - not fake-star noise." -> Event "Messaged (avatar) Nico" -> "**Dining Scout** is ready - preferences + wine, trip-local picks, and a hard filter on sketchy reviews."
- KEY CONCEPTS: catalog/marketplace of connectors; "skill" learned from a screen demonstration; agent-level hard-deny rules; concierge agent (Linh) spawns specialist agents and names them.

## Screens 20-22 - Rename, Niek from zip, screenshot-to-reminder
- Jop: "Your name is Linh" -> Agent: "Got it - I'm Linh now." -> centered event "Renamed to Linh" => agent renames ITSELF on request (agent self-management of identity; before this the agent had a default name).
- Jop: "Thank you I go train now with Kevin!" -> "Go crush it with Kevin." (agent knows sibling agents by name)
- Nico: "Dining Scout is ready ... Open that chat anytime (or tell me the city) and it'll start building your taste profile. Pizza 4P's Bao Khanh is already seeded as a Linh favorite." -> event "Message from Nico" => Linh passed known context (favorite restaurant) to the new agent = shared memory hand-off at creation.
- (Yesterday 2:27 PM) Jop uploads "business-coach.zip 318kB": "Can you create a agent called Niek with title Business Coach that are based on this skill!" -> Agent: "Unpacking the skill and spinning up Niek as Business Coach." -> event "Messaged Niek" -> "Niek is up - title Business Coach, full skill library loaded (SKILL + ~100 book refs, playbooks, stages). Open his chat when you want strategy/coaching; he'll diagnose first and cite for real." -> event "Message from Niek".
- => Agent spec format = a ZIP containing a SKILL (SKILL.md style?) + reference library. Name + title given by user. Concierge agent unpacks and instantiates.
- (Yesterday 2:57 PM) Jop uploads a screenshot of a Slack thread + "Herinner mij hier later nog even aan!" -> Agent reads image: "Notulen AVA Beans IP BV + Baseflow - ik ping je later vanmiddag." / "Staat - 17:00 vandaag: notulen tekenen + Baseflow." => reminder created from image content, agent picks a sensible time itself.
- (Yesterday 3:54 PM) event "2 messages with Thijs" with no relayed text => background agent-to-agent traffic is visible as a compact event only.
- (Yesterday 5:02 PM) event "Deleted routine  Notulen Beans IP tekenen" + "Vanmiddag-reminder: Notulen AVA 2024 Beans IP BV tekenen (Wouter), en Baseflow ook even vragen - nodig voor de jaarrekening."
- (Yesterday 6:56 PM) Jop: "My visa ends the 2nd of October" (continues)
- (gap filled) Linh after creating Kevin: "Personal Trainer staat klaar - je hele training-system zit erin als basis (safety, knie/schouder, programma, logs). Ik heb 'm gepingd: vandaag = Lower, knie-hold (geen progressie op leg press/extension). Open die chat voor de 4 check-in-vragen en ga trainen. Later optimaliseren we." -> event "Message from Kevin". => new agent gets an initial briefing message AND replies to its creator.

## Screens 23-25 - Visa reminder, flight search via browser
- Jop: "My visa ends the 2nd of October" -> Agent: "Noted - visa ends Fri 2 Oct 2026. I'll keep that on the radar. Want a reminder ~a week before (e.g. 25 Sep) to extend or leave? And is this Vietnam?" -> card "Visa reminder?" -> "C Remind earlier" -> (7:15 PM) "Oké - welke datum/tijd moet de visa-reminder?" (no answer given by Jop)
- (7:47 PM) Jop asks cheapest round trip Hoi An -> Chiang Mai for two, incl. budget carriers ("prijsvechters").
- Agent: "Ik zoek de goedkoopste heen-en-terug Hoi An -> Chiang Mai ... Eerst even data checken - wanneer ongeveer?" -> **choice card with free-text**: "Wanneer heen-en-terug DAD <-> CNX?" options A Flexibel / B Na Hanoi (~20 sep) / C Ik geef exacte data / D Weekend-trip ergens + text input "Type your own answer" + X "Dismiss question".
- (8:06 PM) Jop gives dates in free text -> Agent: "Helder: heen vr 2 okt 2026, terug zo 11 okt 2026, DAD <-> CNX, 2 pax, goedkoopste. (Visa eindigt diezelfde 2 okt - check of uitreizen die dag nog mag.)" => cross-references earlier facts (visa date) proactively.
- "Browser zoekt live prijzen - ik kom terug met de topopties zodra die binnen zijn." => async browser task, interim status message.
- Result: Google Flights options list with prices, warnings (emoji), routing, and "Mijn tip".
- Card "Welke vlucht wil je?" -> answered with FREE TEXT (shown inside the card as the selected answer, greyed): "Geen lange ... overstapshit. Voorkeur heeft altijd directe vluchten ... overstap ... ongeveer vier uur, maar liever ook niet meer".
- (8:42 PM) Agent re-searches with constraints: "Bezig - filter op nonstop / korte overstap." -> new list; attaches 2 browser screenshots as evidence.

## Screens 26-27 - ClickUp MCP connector flow (KEY)
- Card "Welke AirAsia-route?" -> free text "We denken er nog even over na" -> (Today 9:00 AM) "Prima - zeg het als jullie eruit zijn."
- Jop: "Hey, ik heb net een klik-app plug-in toegevoegd. Kun je checken of je erbij kan of dat ik nog iets moet authenticeren en zo?" (Jop installed ClickUp from the Marketplace)
- Agent: "Ik check ClickUp - of de connector er is en of auth nog moet." -> "ClickUp staat als **geïnstalleerd**, maar de connector laadt hier niet (geen tools, niet in de auth-lijst). Waarschijnlijk nog niet goed gekoppeld. Mag ik 'm opnieuw installeren zodat het connect-kaartje verschijnt om te authenticeren?" => agent can introspect its own connector/tool list and auth state.
- Card "ClickUp opnieuw installeren voor auth?" -> "A Ja, opnieuw installeren" -> "Bezig - ClickUp opnieuw installeren."
- Agent: "De marketplace-install registreert de connector hier niet. Officiële ClickUp-MCP is `https://mcp.clickup.com/mcp` - mag ik die direct toevoegen zodat je OAuth-kaartje verschijnt?" -> Card "Officiële ClickUp MCP toevoegen?" -> "A Ja, officiële MCP toevoegen" -> "Toevoegen - daarna verschijnt het auth-kaartje."
- **Connector card in chat**: [ClickUp logo] "ClickUp" / "Connect Cursor to your ClickUp workspace - manage tasks, track time, and..." / "58 tools" / green badge "✓ Added". (Text says "Connect Cursor" -> the app is built on Cursor/Anysphere infrastructure; bundle id com.anysphere.sand.)
- Agent: "ClickUp staat klaar - tik het **connect-kaartje** aan om in te loggen. Daarna check ik of de tools werken." -> (after Jop OAuth) "ClickUp is connected - tools are live. What do you want to do first (list spaces, open a list, make a task...)?" -> "Bevestigd: **58 ClickUp-tools** actief."
- => BUSINESS RULES: (1) agent can ADD a remote MCP server by URL with user consent; (2) OAuth is done by the USER via a card in chat; (3) tool count is surfaced; (4) agent verifies tools after auth.
- (Today) Jop: "I want you to create an agent task tracker. The point of this agent is to look at what other agents are doing. If, for example, I have my invoice agent going and scraping emails and drafting some invoices, I want to be able to see what it is doing. We're going to connect this to ..." (continues)

## Screens 28-29 - Task Tracker agent + ClickUp board (KEY: observability of agents)
- Jop: "I want you to create an agent task tracker. The point of this agent is to look at what other agents are doing. If, for example, I have my invoice agent going and scraping emails and drafting some invoices, I want to be able to see what it is doing. We're going to connect this to a click-up board, which is going to be used as a task management tracker. Come up with a plan in order to make this as organized as possible so I can always see what my agents are doing. Keep it simple! And please make sure you do it in such a way that it's also comprehensible for humans and so it's easy to read, understand and follow for me if I jump in."
- Agent plan (verbatim structure):
  - "Simple plan for **Task Tracker** + ClickUp:"
  - "**One board, one list** - 'Agent work'"
  - "Statuses humans can skim: `Queued` -> `In progress` -> `Waiting on Jop` -> `Done` (plus `Blocked` if stuck)."
  - "**One ClickUp task = one job** an agent is doing (not every tiny tool call)."
  - "Title format: `[Agent] short verb + object` e.g. `[Thijs] Match Moneybird invoices` · `[Kevin] Friday Lower session`"
  - "**Description (fixed template, always the same):** Agent / Goal / Started / Last update / Next step / waiting on"
  - "**Comments** = progress beats ('found 12 mails', 'draft ready', 'blocked on auth')."
  - "**Rule:** agents (or I) create/update the task when work starts, when something meaningful happens, and when it finishes. No spam every second."
  - "I'll create the **Task Tracker** agent with that playbook. Want me to also create the ClickUp Space/List now?"
- Event "Messaged (purple generic avatar) Task Tracker" => a 6th agent "Task Tracker" was created (NOT visible in sidebar now -> check later whether it was deleted/merged).
- Card "ClickUp-bord voor Task Tracker aanmaken?" -> "A Ja, maak ClickUp-bord nu" -> event "Message from Task Tracker" -> "Ik maak het Agent-work bord in ClickUp." / "Folder + list staan. Ik zet nog een voorbeeldtaak klaar en geef Task Tracker de IDs." -> event "Messaged Task Tracker"
- Result: "Klaar. **Agent Ops -> Agent work** staat live: https://app.clickup.com/90122053933/v/li/li/901222063620. Er staat één voorbeeldtaak `[Linh] Example - delete me`. Huidige statuses op de lijst: `to do | in progress | complete`. De afgesproken set (Queued / Waiting on Jop / Blocked enz.) moet je één keer in ClickUp zelf toevoegen; tot die tijd mapt Task Tracker daarop. Task Tracker heeft de IDs al."
- => Agents use MCP tools (ClickUp) to do real work; Linh delegates + passes IDs to the specialist agent (context hand-off).

## Screens 30-31 - Board view preference, naming the tracker agent
- Jop: "I alwasy prefer the board view" -> Agent: "Board view, altijd. Ik sla dat op en kijk of ClickUp die view als default kan zetten." => explicit PREFERENCE MEMORY ("Ik sla dat op").
- Event "Messaged Task Tracker" -> "Opgeslagen. Via de API kan ik de default view niet forceren - open dit board-linkje voortaan: https://app.clickup.com/90122053933/v/b/li/901222063620. Task Tracker deelt die board-URL ook." -> event "Message from Task Tracker". => honest about API limits.
- Jop: wants a better name than "task tracker"; "scrum agent" not right either.
- Agent: "Klopt, scrum is te zwaar. Die agent is meer een ops-desk: houdt zichtbaar wat iedereen doet op het bord. Een paar opties die beter passen:" -> **rich choice card**: title "Welke naam voor de board-agent?" subtitle "Of typ zelf iets anders." options with title + description: A Floor (Nederlandse naam + 'floor manager' vibe - past bij Kevin/Thijs/Nico) / B Radar / C Desk / D Pulse / E Cas / F Hub + free text field. (Still open; X dismiss.)
- Jop: "Sorry, ik bedoelde niet de naam, maar ik bedoelde meer de titel. De naam weet ik al. De naam gaat zijn Dennis. Maar we moeten even een goede titel vinden voor Dennis" => agent model = NAME (person-like) + TITLE (role label shown as badge in sidebar).
- Agent: "Ah, titel - niet de voornaam. `Dennis` zet ik alvast; hier een paar titels die bij die ops-rol passen:" (continues)

## Screens 32-33 - Title, avatar, ORG MODEL decision, Dennis removed
- Card "Welke titel voor Dennis?" -> "A Ops Desk" -> "Ops Desk. Ik zet die titel nu bij Dennis." -> "Klaar - **Dennis**, titel **Ops Desk**. Profile en ClickUp-conventies zijn bijgewerkt." -> event "2 messages with Dennis". => Linh can EDIT ANOTHER AGENT's profile (name/title) and brief it.
- Jop uploads a new avatar image "Dit is jou nieuwe avatar! :)" -> "Nice - headset en al. Ik zet 'm nu." / "Staat."
- Jop: "Oké, is iedereen nu op de hoogte van Dennis en zijn taak, en hoe iedereen met hem moet communiceren en dergelijk?"
- Agent: "Nee - alleen Dennis zelf is bijgepraat. Kevin, Thijs, Nico en Niek weten nog niks van hem of hoe ze jobs moeten melden." -> card "Zal ik die vier kort briefen over Dennis (Ops Desk) en hoe ze werk bij hem melden?" A Ja, brief ze / B Nee, later (left open).
- **ORG MODEL (Jop's decision, verbatim)**: "Weet je wat, ik denk dat we dat nou helemaal niet nodig zijn. Ik denk dat ik gewoon met jou wil lullen en dat jij gewoon mensen aan het werk zet voor mij. Dat ze daarover bij jou terugkomen en dat jij het dan wel even op het bord kunt updaten. Dan zijn we dit helemaal niet nodig"
- Agent: "Helder. Jij praat met mij; ik zet mensen aan het werk; zij rapporteren aan mij; ik update het ClickUp-bord. Geen rondje briefing nodig." -> event "Messaged Dennis".
- Card "Dennis zelf nog houden als idle agent, of weggooien?" -> "B Ik verwijder hem zelf" => Jop deleted Dennis via the UI (agent deletion is a user action; explains why Dennis is not in the sidebar).
- => HUB-AND-SPOKE model: one concierge agent (Linh) is the single human interface; specialists report to the concierge; concierge maintains the board.

## Screens 34-35 - Outlook connector via marketplace, mailbox search
- Event "Message from Dennis" -> "Prima. Bord blijft staan; ik update 'm zelf als er werk loopt."
- Jop: "All right can you add the Outlook plugin for me so you can read my email, etc.?"
- Agent: "Ik zoek de Outlook-connector en zet 'm klaar om te koppelen." -> "Gevonden: de Outlook-connector (zoeken, lezen, versturen, contacten). Jouw `middelkamp@live.nl` - ik stuur nooit iets zonder jouw OK." -> card "Outlook-connector toevoegen?" -> "A Ja, toevoegen" -> "Ik voeg Outlook toe; daarna verschijnt de login-kaart."
- **Connector card**: [Outlook logo] "Outlook" / "Search, read, and send Microsoft Outlook email, and look up contacts." / "10 tools" / "✓ Added".
- "Outlook staat erop. Log in via de connect-kaart hierboven (middelkamp@live.nl). Zodra dat klaar is, ga ik verder." -> "Outlook is gekoppeld. Wat wil je als eerste doen - zoeken naar die oude Vietnam-legalisatie mail, Olst-Wijhe/huwelijk, of iets anders?"
- => Agent can add a connector from the catalog by itself (with consent). (Jop said in the task prompt that he later DISABLED the send tools in the marketplace plugin settings -> verify in Marketplace.)
- Jop: "ja zoek maar even op wat we precies hebben gecommuniceerd."
- Agent: "Ik doorzoek je Outlook op Vietnam-legalisatie, Olst-Wijhe en huwelijksmails." -> "Ik zie vooral mail met Olst-Wijhe over 'Gratis trouwen' (aug-sep 2025) en doorstuur van Henny (De Verbeelding Wijhe). Ik lees die nu." -> long structured summary of the mail thread by date (Mei 2025 checklist bullets, 29 aug 2025, 1 sep, 11 sep), "Wat ik niet zie" section, ends with a question offering 2 next actions (draft follow-up or check Drive folder).

## Screens 36-37 - Link preview, zip processing, self-tracking rule, broadcast to 4 bots
- Jop: "toon me de link van google drive" -> agent returns a **link preview card** (favicon, title "Documenten Gemeente - Google Drive", domain drive.google.com).
- Jop uploads "drive-download-20....zip 14.8MB" -> Agent: "Ik open de zip en inventariseer wat erin zit." -> "11 HEIC-foto's van 11 sep 2025. Ik zet ze om naar leesbare previews." => file pipeline: receive -> unzip -> inventory -> convert HEIC -> read/analyze.
- Jop: "Ik zie trouwens niks van wat jij aan het doen bent op het clickerboard. Dus geldt het niet alleen voor alle andere agentsen. Je moet ook je eigen werk daar even opzetten en bijhouden!" => RULE: the concierge tracks her own jobs on the board too.
- Agent: "Klopt, mijn werk ook. Ik zet nu wat er loopt op het Agent work-bord." -> "Staat erop. In progress: `[Linh] Review Olst-Wijhe marriage docs zip`. Board: <link>. Voortaan zet ik mijn eigen werk ook meteen op het bord. Voorbeeldtaak is op complete gezet. Kort over die zip (11 foto's): geboorteakte VN + Engelse vertaling + notariële certificaten + consulaire legalisatie (3 aug 2025), én ongehuwdheidsverklaring (9 jul 2025) met vertaling. Dat dekt de zware document-eisen uit de checklist; paspoorten/getuigen/digitale melding zie ik hier niet. Wil je dat ik de checklist-check netjes afrond op die taak?" => document understanding of photographed legal docs, cross-check against checklist.
- Jop: "Zeker dat dat voor iedereen helder is hoe we hier nou mee omgaan. Iedereen bij jou rapporteert en dat jij het bord update? Maar dat je dit dus zelf ook altijd even doet?"
- Agent: "Helder. Regel: iedereen rapporteert aan mij, ik update het bord, en mijn eigen werk zet ik er ook altijd op. Ik brief Kevin, Thijs, Nico en Niek nu." -> event **"Messaged [4 stacked avatars] 4 Bots"** => BROADCAST message to multiple agents in one action. -> "Ja - precies zo. Kevin, Thijs, Nico en Niek zijn gebrieft; de list-beschrijving op ClickUp staat ook zo. Kort: jij <-> mij; zij <-> mij; bord = mijn verantwoordelijkheid (ook voor mijn eigen werk)." -> event "4 messages with 4 Bots".

## Screens 38-39 - Delegation to Thijs, checklist result
- Agent: "Alle vier bevestigd: Kevin, Thijs, Nico en Niek rapporteren alleen aan mij." (the "4 Bots" event is an AXPopUpButton -> clicking shows the list of bots)
- Jop (quote-reply to the board message): continue the checklist; and ask Thijs whether exporting Bunq bank data and uploading transactions to Moneybird via a Moneybird MCP server is feasible, so he can downgrade his Moneybird plan (EUR 3 instead of EUR 29). Wants it automated by Thijs.
- Agent: "Ik rond de Olst-Wijhe-checklist af en vraag Thijs tegelijk of Bunq -> Moneybird via MCP haalbaar is." -> event "2 messages with Thijs" => parallel delegation while continuing own task.
- Agent: "Thijs is aan de Bunq->Moneybird-check; staat op het bord." + "**Checklist Olst-Wijhe vs jouw zip**" with sections Aanwezig / Belangrijk (single-status declaration valid 6 months -> expired ~jan 2026, must redo) / Nog niet in de zip / "Taak op complete: https://app.clickup.com/t/869f10xex" / "Zodra Thijs terugkomt over Bunq, zet ik het hier."
- Event "Message from Thijs" -> Linh relays: "Thijs is klaar. Korte versie: Automatiseren Bunq -> Moneybird: ja ... Naar EUR 3 Compact: meestal nee ... Technisch: MT940/API sync werkt beter dan 'alleen MCP'; officiële MCP is meer human-in-the-loop. Geen build tot jij 'go' zegt. Wil je dat Thijs een API-sync bouwt, of eerst checken welk Moneybird-plan bij jouw volume past?"
- => Pattern: specialist does research -> reports to concierge -> concierge relays a SHORT version to the human and asks for a go/no-go. "Geen build tot jij 'go' zegt" = explicit approval gate before building.

## Screens 40-41 - Communication style rule, Compact plan question
- Event "Messaged Thijs" -> Linh: "Bord: https://app.clickup.com/t/869f10zzj" (a bare board-link message).
- Jop: (1) postpone the single-status declaration until needed; (2) **communication rule**: "Ik heb niet elke keer van die bordlinkjes te zien. Hou dit gewoon even bij normale communicatie hierin. Maar ja, als ik de update van het bord wil zien, dan wil ik voor wat dan ook op het bord zelf ... een linkje ... Maar we doen niet behaaflijk slap berichtje met bord: dubbele punt en dan het bord of taak op compleet ... gewoon natuurlijke taal"
- Agent: "Helder op beide. ... En over het bord: ik houd 't stil bij. Updates hier in gewone taal; link alleen als jij 't bord wilt zien of als we iets concreets moeten openen." => user-defined style rules are absorbed as standing instructions.
- Jop uploads a screenshot of the Moneybird pricing page + question about what "5 banktransacties" means for the Holding BV -> Agent: "Ik zoek even wat Moneybird precies telt onder die 5 banktransacties, en geef Thijs door dat Holding bijna stilstaat." -> event "2 messages with Thijs" -> explanation of Compact limits (seen at start: 5 processed bank lines/month, 1 sales invoice, 3 incoming docs, no e-BTW, no Ponto link) -> Jop: "Kunnen we dan nu al met compact beginnen, en als het nodig is, om op te hogen?" -> Agent (10:04 AM today, last message): "Ja - Compact nu, later omhoog als het knelt ... Wil je dat Thijs eerst de sync bouwt, of wil je Compact alvast omzetten?"
- END of Linh chat (as of 2026-09-12 10:04 AM).
