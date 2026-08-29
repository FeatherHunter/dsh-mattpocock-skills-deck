# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's tracker.

For the **local Markdown backend** this file is also the **label palette**: a ticket's `Labels:` line writes only label *names* (for example `Labels: wayfinder:grilling, bug`); the panel colors each name from this table. Default colors are pre-filled here from the local backend's own palette, and to change a label's color you edit the matching row's Color value in this table; a name missing from the table renders grey.

## Label palette

| Color | Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- | --- |
| `#fbca04` | needs-triage | `needs-triage` | Maintainer needs to evaluate this issue |
| `#5319e7` | needs-info | `needs-info` | Waiting on reporter for more information |
| `#0e8a16` | ready-for-agent | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `#b60205` | ready-for-human | `ready-for-human` | Requires human implementation |
| `#ffffff` | wontfix | `wontfix` | Will not be actioned |
| `#d73a4a` | — | `bug` | Something is broken (drives the fix action / BUG filter) |
| `#8b5cf6` | — | `wayfinder:map` | A wayfinder effort's map issue (child issues hang off it) |
| `#0ea5e9` | — | `wayfinder:research` | Research ticket (AFK) |
| `#f59e0b` | — | `wayfinder:prototype` | Prototype ticket (HITL) |
| `#9d7cd8` | — | `wayfinder:grilling` | Grilling / discussion ticket (HITL) |
| `#10b981` | — | `wayfinder:task` | Task ticket (HITL or AFK) |

Add any custom label as a new row here; this table is the local Markdown backend's own label palette (defaults pre-filled; edits here override).

When a skill mentions a role (for example "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Mandatory label set

This repo's deck uses a mandatory label set alongside the triage roles. These three labels must exist, and every new issue carries at least one of them:

- `bug` — something is broken (drives the fix action / BUG filter)
- `needs-triage` — unexamined issue awaiting diagnosis (drives the diagnose action / TRIAGE filter; this is also the canonical `needs-triage` role above)
- `wayfinder:grilling` — an open decision/discussion ticket (drives the discuss action; wayfinder's `grilling` ticket type)

Edit the right-hand column to match whatever vocabulary you actually use.