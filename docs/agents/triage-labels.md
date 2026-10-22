# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's tracker.

Label colours are **not** kept in this file. On the **local Markdown backend** the colours live in the workspace file `docs/agents/label-colors.json`, which the plugin places there and you can edit by hand or through the deck's re-colour dialog in the panel; on GitHub the colours are the repository's own label colours. This file only answers "which label string does a role map to".

## Label set

| Label | Meaning |
| --- | --- |
| wayfinder:map | The map issue of a wayfinder effort |
| wayfinder:research | Research ticket (AFK) |
| wayfinder:prototype | Prototype ticket (HITL) |
| wayfinder:grilling | Grilling / discussion ticket (HITL) |
| wayfinder:task | Task ticket (HITL or AFK) |
| bug | Something is broken (fix action / BUG filter) |
| needs-triage | Unexamined issue awaiting diagnosis |
| needs-info | Waiting on reporter for more information |
| ready-for-agent | Fully specified, ready for an AFK agent |
| ready-for-human | Requires human implementation |
| wontfix | Will not be actioned |

Add any custom label you use as a new row here. A row added here only records the label's name and meaning — it does not give the label a colour; colours come from `docs/agents/label-colors.json` (local Markdown backend) or from the repository's own labels (GitHub).

When a skill mentions a role (for example "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Mandatory label set

This repo's deck uses a mandatory label set alongside the triage roles. These three labels must exist, and every new issue carries at least one of them:

- `bug` — something is broken (drives the fix action / BUG filter)
- `needs-triage` — unexamined issue awaiting diagnosis (drives the diagnose action / TRIAGE filter; this is also the canonical `needs-triage` role above)
- `wayfinder:grilling` — an open decision/discussion ticket (drives the discuss action; wayfinder's `grilling` ticket type)

## Wayfinder label set

The `/wayfinder` skill requires all five wayfinder labels to exist. Every wayfinder child ticket carries exactly one of them:

- `wayfinder:map` — the parent map issue (Notes / Decisions-so-far / Fog)
- `wayfinder:research` — research ticket
- `wayfinder:prototype` — prototype ticket
- `wayfinder:grilling` — grilling/discussion ticket
- `wayfinder:task` — implementation task ticket

Edit the `Label` column to match whatever label strings you actually use.
