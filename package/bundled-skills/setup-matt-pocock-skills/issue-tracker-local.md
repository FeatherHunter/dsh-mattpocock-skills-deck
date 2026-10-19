# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is a **spec ticket**: one file at `.scratch/<feature-slug>/issues/<NN>-<slug>.md` whose header carries the line `<!-- DSH-ISSUE-KIND: spec -->` and whose `<!-- parentKey: ... -->` line points at the feature's exploration map ticket (`00`). Do not create a separate `spec.md` file: the spec is itself a ticket and the container that implementation tickets hang under.
- Implementation tickets are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered after the highest number already in that directory (the spec ticket used one), never a single combined tickets file. Each starts with `<!-- DSH-ISSUE-KIND: ticket -->` and `<!-- parentKey: <spec ticket number> -->`.
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

For a spec, create a spec ticket through the deck tools (`deck_issue_create` with `kind=spec`, `parentKey` set to the exploration map ticket) rather than writing a file by hand. For an implementation ticket, create the ticket file under `.scratch/<feature-slug>/issues/` with the header comments and field lines described above.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`. Texts meant to be a spec or an implementation ticket also carry the matching `<!-- DSH-ISSUE-KIND: spec -->` / `<!-- DSH-ISSUE-KIND: ticket -->` marker line in the file header (before the `#` title).
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed`, add an `Assignees: <your name>` line with the name you claim under, and save before any work. The name is read back verbatim — there is no logged-in user locally, so the ticket file is the only place it can live. (Before #1174 the claim only wrote the status, and reading it back showed the placeholder `@me`.)
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
