# NemoLINK — rules for AI design and UI work

Before any UI or design change, follow the project's design rules. They are loaded here so every session sees them:

@app/DESIGN_RULES.md

The one rule never to break: every table is the standard table (`app/src/components/StandardTable.vue` + `StandardCell.vue`, section "Standard table" above). Missing values are filled directly in their cell; no separate missing-fields list on desktop.
