# Salesforce OrgStudio — IDE + Inspector (v2.0.0)

A single Chrome/Edge extension merging **OrgStudio** (in-browser IDE) with the full
**Salesforce Inspector Re-Designed** toolset, plus **one-click GitHub version control**.

## SOQL Export — matches Salesforce Inspector
- **Context-aware autocomplete** (Inspector-style):
  - Right after `FROM` → suggests **sObjects**.
  - In the SELECT list / WHERE / ORDER BY → suggests the object's **fields**,
    **relationships**, and SOQL **keywords/functions**.
  - **Dot-notation traversal** — type `Account.` to drill into the parent object's
    fields (multi-hop supported, e.g. `Owner.Manager.Name`).
- **Inspector-style output** — parent relationship fields flatten into **dotted
  columns** (e.g. `Account.Name`), child sub-queries show as **`[N rows]`**.
- All existing options preserved: History, Favorites, Format Query, Export Query,
  Query-all pages, Copy Excel/CSV/JSON, Download CSV, result filter, Delete Selected,
  and Id hover actions (Show all data / Query record / View in Salesforce / Copy Id / Edit).

*(Only the SOQL suggestion and output logic changed in this update — no UI/layout changes.)*

## Also included
- **Data Import** and **Show All Data** (full Inspector functionality).
- **⚙ Gear Settings** with extra options (line-height, line numbers, delete-confirm,
  default Query-all, auto-push to GitHub after deploy, and all original settings).
- **GitHub button** beside the API indicator — sign in with a token, then Push active
  file / Push all code (single commit) / Pull from repo.
- **Editor alignment fix** — gutter and code share an integer-pixel line box.

## Install
1. Unzip → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (Reload if updating).

## Connect
- Salesforce: log into your org in another tab → **Connect to your open org**.
- GitHub: click the **⑂ GitHub** button → paste a token with **repo** scope → Save.
