# Research notes: Nico chat (Dining Scout)

## Screen 1 (Yesterday 11:51 AM)
- First item in the chat: event "2 messages with Linh" [Open exchange with Linh] => creation briefing from Linh is the first thing in a child agent's chat.
- (12:14 PM) Jop uploads a photo: "His name is Nico" -> "Got it - that's Nico. Setting him as my picture now." -> event "Renamed to Nico" -> "Done. I'm Nico now - picture's up. Standing by when you want a place or want to log tastes." => the agent was created nameless/with a default name; user names it in its own chat; agent sets its own avatar from a photo.
- (1:41 PM) Jop: "Can you interview me about the food me an Linh like?" -> "Yep. I already know Linh's into Pizza 4P's Bao Khanh - we'll build from there. I'll go in short rounds. Answer for both of you when you can; flag where you disagree."
- Multi-select card "Which cuisines do you and Linh both actually like (not just tolerate)?" A Vietnamese / B Italian-pizza / C Japanese / D Thai / E Korean / F French-European ... (all checked so far)

## Screens 2-3 - Taste interview
- Cuisines: all 6 checked -> "All of those are in. Broad palate - good."
- Card "How much spice ...?" answered in free text; card "Any hard dietary limits or allergies?" free text (no allergies; Jop's seafood = salmon/prawn/lobster; Linh not into Indian, Jop loves it) -> "Logged: ... Indian is a Jop-yes / Linh-soft-no - I'll skip it for shared nights unless you say otherwise." => preference memory with per-person nuance.
- Card "What's a normal budget for dinner for two?" -> "A Casual (~EUR20-40 / d300-600k for 2)"; Jop typed "ho A & B" -> agent: "Reading that as both casual and mid ..." => agent interprets letter answers typed in chat.
- Card "Drinks" multi: A Wine with dinner + C Beer/craft beer. Card "What vibe ...?" answered "A, C, D, F" (typed letters). Card "Anything you actively avoid?" -> "A, B, C" -> "Avoid list locked: tourist traps, loud/clubby, slow or chaotic service."
- "Last round - any other places you both loved (or hated) besides Pizza 4P's Bao Khanh? City + name is enough. Or say 'that's it' and I'll wrap the profile."
- (2:10 PM) Jop: "Namaste, Hanoi - Loved by both (one of the few Indian restaurants Linh likes, and likes a lot)"

## Screens 4-5 - Bulk preferences, profile
- Jop pasted a long list of restaurants (Hanoi, Hoi An, Da Nang) with per-person notes. UI: long user message is truncated with a **"Show more"** expander.
- Agent: "Goldmine - logging the hits, misses, and the Jop/Linh splits now." -> "Profile's live. Quick map:" with sections Both like / Budget / Avoid / Splits / Booked (Pizza 4P's Trang Tien, Sun 27 Sep 2026 19:00 · Hanoi ~20 Sep) / "Say when you want picks (city + night), or correct anything." => the agent knows the booking made in Linh's chat (shared memory across agents, or relayed by Linh).
- Jop: "Choong Man Chicken, Da Nang - ..." -> "Logged: ..." => incremental preference logging.

## Screens 6-7 - Live recommendation request
- More logging: Ravens Wine Bar (Hoi An) -> "Logged ... Fits your wine-with-dinner lean."
- (3:32 PM) Jop (Dutch): ideas for tonight, somewhere new, well-reviewed, no tourist trap, watch fake reviews.
- Agent (Dutch mirror): "Vanavond - top. Eerst even checken waar jullie zitten; daarna zoek ik iets nieuws (geen tourist trap, reviews goed gefilterd)." -> card "Waar zitten jullie vanavond?" -> "A Hoi An" -> "Hoi An, vanavond, voor jullie twee - iets nieuws, geen tourist trap, reviews sceptisch bekeken. Ik ga zoeken." -> "Bezig - ik filter op lokale plekken die jullie nog niet hebben gedaan." (interim status)
- Result: "Locatie aangenomen: Hoi An ... Hier 4 nieuwe picks (geen plekken die jullie al deden). Reviews gewogen op concrete first-hand details + gidsen; sterren/TripAdvisor-topjes afgezwakt." then numbered picks: name - area (mijn top), description, price band, opening hours, phone, "Trust: <evidence sources>; generieke 5-star-blurb genegeerd." + "Skip voor vanavond: ..." => domain-specific output template with trust/evidence line per pick (fake-review filter as designed).

## Screens 8-9 - Q&A, wine label photos
- Card "Zal ik ergens voor jullie reserveren?" -> Dismissed; Jop: "D wil gewoon even wat tips" -> "Prima - dan blijven de tips staan ..."
- (5:50 PM) General food Q&A (curry types) answered in the agent's domain voice, tailored to the couple's profile.
- (7:16 PM) Jop uploads 5 wine bottle photos (+2 overflow) "We really liked these wines" -> "Nice - logging these as wine hits. Reading the labels now." -> "Logged. Here's what I took from the bottles: Reds (bold lane) ..." => vision on photos -> structured preference entries.

## Screens 10-11 - Wine list photo, negative feedback loop
- Jop photographs a wine-by-the-glass list: "Which one would you recommend?" -> agent reads the menu photo and recommends with rationale tied to the couple's profile and tonight's food. Runner-up included.
- Jop: negative feedback on both wines -> "Logged - Belleville Rouge out, Terroir Rouge out (bitter finish for Jop). Won't push those again. ... How's the food?" => agent asks for feedback proactively (closed loop learning).
- (8:35 PM) Jop: long negative review of Hidden Tiger (cold appetizer, slow service, off-taste dishes) "So that one you should never have to recommend again." -> Agent: "Got it - Hidden Thaiger is a hard miss. Never recommending it again." (continues)

## Screens 12-13 - Learning from a miss, award legitimacy research
- Agent: "Got it - Hidden Thaiger is a hard miss. Never recommending it again. Logged: ... Sorry that one landed badly - my #3 was wrong for you." / "Next Hoi An night I'll stick closer to tok. / Allee Gatto and skip PR-award Thai." => admits error, updates policy.
- Jop: awards can be bought; do background research on awards next time. -> "Fair point ... I'll treat restaurant awards as suspect until I've checked who runs them, whether you can buy/entry-pay your way in, and if independent critics actually back them. Paid plaques don't count as trust." => user feedback becomes a standing heuristic.
- Jop: research whether "Gourmet Vietnam Awards" is legit -> "Op het - ik check ..." -> Verdict report: "not a serious independent award" with Who runs it / How you get in / What it's not / Bottom line. => web research with structured verdict.
- Jop: "And don't forget to do the research next time correctly, please" -> "Will do - first-hand patterns and real sources first; awards only after I check they're legit. No shortcut next time."
- (Today 9:47 AM) event "2 messages with Linh" (workflow broadcast). END of Nico chat.
