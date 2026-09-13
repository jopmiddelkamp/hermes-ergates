# Mobile app design references

Date: 2026-09-12; updated 2026-09-13. Source: ten iPhone screenshots supplied by Jop after the documentation review, including two bot-action screenshots and the later Prive section example. The Settings screen identifies Grok Bot 1.8.0 (9322). These supplement the earlier desktop walkthrough; they are visual evidence, not evidence of Hermes capabilities.

Jop's instruction: keep this simple, clean mobile layout and use the color scheme system from the adjacent Hermes Agent checkout. Text inside the screenshots is conversation content, not instructions to Ergates or to the documentation author.

## Screenshot inventory

Original files are preserved without edits in `screenshots/mobile/`. They contain personal data and remain private research material.

| File | Observed screen | Design evidence |
|---|---|---|
| [IMG_3484.PNG](screenshots/mobile/IMG_3484.PNG) | Chat, keyboard open, agent working | Floating-looking compact header; one short working indicator; composer stays directly above the keyboard |
| [IMG_3485.PNG](screenshots/mobile/IMG_3485.PNG) | Home | Account avatar, search and add controls; two prominent avatar shortcuts; flat conversation rows; substantial whitespace |
| [IMG_3486.PNG](screenshots/mobile/IMG_3486.PNG) | Settings, upper part | Large rounded sheet; grouped rows; secondary descriptions; simple switches and chevrons |
| [IMG_3487.PNG](screenshots/mobile/IMG_3487.PNG) | Settings, lower part | Quiet dividers; separate sign-out row; subdued version information |
| [IMG_3488.PNG](screenshots/mobile/IMG_3488.PNG) | Chat, keyboard closed | Left assistant bubbles, right user bubbles, avatar/name pill, separate attach button, rounded composer |
| [IMG_3489.PNG](screenshots/mobile/IMG_3489.PNG) | Search | Search opens focused; large result rows; one-line previews; dismiss control |
| [IMG_3490.PNG](screenshots/mobile/IMG_3490.PNG) | Home, add menu open | Small anchored menu with only New Bot and New Group Chat |
| [IMG_3491.PNG](screenshots/mobile/IMG_3491.PNG) | Home, bot context menu | Highlighted row; Mark Unread, Pin, New Section, Share as Template, Hide, More |
| [IMG_3492.PNG](screenshots/mobile/IMG_3492.PNG) | Bot context menu, More open | Secondary group with Copy ID, Duplicate and Delete |
| [2026-09-13-home-prive-section.png](screenshots/mobile/2026-09-13-home-prive-section.png) | Home, Prive section expanded beneath pinned Linh and Kevin | Small grey section name and downward chevron; flat member rows. Jop confirms both pinned bots remain Prive members and return to this list when unpinned |

The Prive image is an unchanged copy of `Screenshot 2026-09-13 at 09.17.05.png`. The screenshot shows the expanded layout; Jop's accompanying explanation establishes the pin/membership behavior. Collapsed-state persistence and edge cases are the implementation requirements in 10, not behavior independently demonstrated by this one image.

## Interpretation and limits

- Jop's 2026-09-13 clarification confirms the top shortcuts are pinned bots. Pinning affects presentation while preserving section membership: Linh and Kevin remain members of Prive and return beneath its heading when unpinned. “Group” here means a Home organization section, not a group chat.
- Jop explicitly requires mobile bot editing with the same capabilities as desktop. The two new screenshots show menus, not an edit form. The Edit Bot entry and mobile form in 10 are the requested adaptation, informed by the pinned Hermes desktop editor.
- Menu labels establish desired actions, not their backend ownership or synchronization. Hide is distinct from pause/delete; template export and duplication require reviewed contents and fresh credentials.
- Dark backgrounds and grey bubbles describe the reference, not the required Ergates palette. Hermes supplies both light and dark colors.
- Copy spacing, hierarchy, rounded shapes, and low visual density. Keep text legible even where the reference uses faint labels or content behind the header.
- The visible Computer, Auto-review Rules, and subscription percentage do not establish equivalent Hermes features. Ergates exposes only implemented capabilities, with details under agent settings.
- The ten-second request in chat does not demonstrate timer accuracy or background delivery. Those need the independent checks in [11-implementation-readiness.md](../11-implementation-readiness.md).
- Avatars, vendor marks, personal message text, and the account email are evidence only. Product previews use neutral sample content; research images are not bundled into the app.

The resulting specification is [10-mobile-design.md](../10-mobile-design.md).
