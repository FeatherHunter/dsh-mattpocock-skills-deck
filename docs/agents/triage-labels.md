# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's tracker.

For the **local Markdown backend** this file is also the **label palette**: a ticket's `Labels:` line writes only label *names* (for example `Labels: wayfinder:grilling, bug`); the panel colors each name from this table. Default colors are pre-filled here from the local backend's own palette; to change a label's color, edit the matching row's `Color` value here; a name missing from the table renders grey.

## Label palette

| Label | Color | Meaning |
| --- | --- | --- |
| wayfinder:map | #8b5cf6 | The map issue of a wayfinder effort |
| wayfinder:research | #0ea5e9 | Research ticket (AFK) |
| wayfinder:prototype | #f59e0b | Prototype ticket (HITL) |
| wayfinder:grilling | #9d7cd8 | Grilling / discussion ticket (HITL) |
| wayfinder:task | #10b981 | Task ticket (HITL or AFK) |
| bug | #d73a4a | Something is broken (fix action / BUG filter) |
| needs-triage | #fbca04 | Unexamined issue awaiting diagnosis |
| needs-info | #5319e7 | Waiting on reporter for more information |
| ready-for-agent | #0e8a16 | Fully specified, ready for an AFK agent |
| ready-for-human | #b60205 | Requires human implementation |
| wontfix | #ffffff | Will not be actioned |

Add any custom label as a new row here; this table is the local Markdown backend's own label palette (defaults pre-filled; edits here override).

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

Edit the right-hand column to match whatever vocabulary you actually use.
