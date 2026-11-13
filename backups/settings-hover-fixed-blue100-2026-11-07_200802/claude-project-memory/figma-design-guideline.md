---
name: figma-design-guideline
description: "NemoLINK design source of truth is now the Figma frames \"Colors (Variables)\" 266:5251 and \"Text Styles\" 266:5757 (file 9RLGs34yUehEGb2KRSC68o); user's rules for using them"
metadata:
  node_type: memory
  type: feedback
  originSessionId: f91ba543-dc48-49e8-9bb4-6abb415c01d6
  modified: 2026-11-04T17:33:42.486Z
---

Figma file 9RLGs34yUehEGb2KRSC68o, nodes 266-5251 (colours) and 266-5757 (text styles) supersede the v1.0 PDF guide (2026-11-02).

Rules the user stated:
- Primary brand blue #363ADD is **Blue/800** (the "blue/900" label in Figma is a typo).
- Accent/100 = #E003AC (external-source marker; not a Figma variable, but required).
- Hidden rows in the colours frame (hover, disabled grey/100 grey/400, informative, icon) are NOT valid.
- Hover states: do not touch the currently designed ones; they'll be designed together later.
- Page ground: Blue/400 #E0E1E6 behind white content; front page (port-call overview) ground under the cards is Blue/350 #EEEFF1, same as the search field (briefly Blue/300, back to Blue/350 2026-11-02); the cards and lists themselves stay white.
- Pop-ups (user 2026-11-04, supersedes the earlier opaque / see-through exceptions): EVERY pop-up has the dark see-through dimmed backdrop (rgba ink 40%), never opaque, the Set schedule picker included. Pop-ups keep Quasar's default open animation (a genie animation from the click point was tried and undone 2026-11-04); Set schedule opens instantly. Only its Close closes a pop-up — no outside click, no Esc, no phone swipe (q-dialog persistent + no-shake).
- Approaching deadlines/urgency = red, not orange. Orange = pending pills and missing fields.
- Figma text-style letter-spacing is mostly % of font size (1 → 0.14px at 14px; uppercase Heading/20 = 4px); Heading/12 is 0.6px. Use the px values get_design_context exports. Where Figma line height says 100, use auto (normal).
- Heading/20 medium (front-page subtitle under Display/58) is not a token.
- Don't touch the opened port-call card heading — that design is being redone.
- When designing, use only guideline colours unless the user explicitly asks for something else.
- The user may ask for a font size that isn't in the text-style tokens (e.g. the 20px Medium help link under the front-page title, 2026-11-02; the "Port calls" title itself is now Display/58 with line-height normal). Use exactly what they ask for, and never "snap" such a user-requested size back to a token in later token/cleanup passes — leave it and mention it at most.
- Don't change button sizes; only button label text (16px → Heading/14).
- Step/progress rows (e.g. Ship forms): never give passed steps an inactive look (no fading, no greying); passed steps look like the steps ahead, only the current one stands out (user 2026-11-02). The Figma "dots joined by lines" step row was undone back to chevron pills the same day.
- List/table cells: text always vertically centred in the cell (user 2026-11-06).
- List/table column heads (FIELD, TO NEMO, FROM …) always SemiBold, in every list (user 2026-11-06).
- Send to NEMO forms: the From column stays on one line; text that does not fit ends in … and shows whole in a hover pop-up (user 2026-11-06).
- All call-to-action button labels are 14px everywhere, including the v1.0-styled areas (opened card, Ship forms) (user 2026-11-02).

**Why:** user's explicit answers when reviewing the Figma frames.
**How to apply:** check these before any UI/design work; back up first per [[before-figma-tokens-backup]].
