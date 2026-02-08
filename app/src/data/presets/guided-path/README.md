# Guided Path Arrangement Library

This folder is where you place the **official Guided Path arrangements** that ship with the app (so everyone in the beta sees the same learning path).

## What you do

1. Create an arrangement in **Create mode**.
2. Use your existing **Export JSON** feature.
3. Save the exported `.json` file into the correct stage folder below.

## Folder structure

- `stage-1-first-steps/`
- `stage-2-finding-your-part/`
- `stage-3-three-part-harmony/`
- `stage-4-four-part-harmony/`
- `stage-5-extended-harmony/`
- `stage-6-full-ensemble/`

Each stage folder contains a `.gitkeep` file so Git tracks the folder even when it's empty.

## File naming rules (recommended)

Use **kebab-case** file names so imports are predictable.

Examples:
- `unison-warmup.json`
- `parallel-thirds.json`
- `call-and-response.json`

## Important notes

- Keep arrangement `id` values **unique** across all stages.
- If you change an arrangement and re-export it, overwrite the JSON file in this folder.
- These files are intended to be committed to Git, so the guided path is consistent for all beta users.
