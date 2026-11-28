# Draft issue：支持 Gitea / tea 作为 issue tracker 后端（handoff 迁移副本，原稿在 jap_data_analysis 仓库 docs/）

目标仓库：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck
版本依据：dsh-mattpocock-skills-deck 1.9.0-beta.33
状态更新：2026-11-09 已把根因分析作为评论提交到上游已有 issue #1875（https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1875#issuecomment-6737611150）；本 fork（https://github.com/zhaolj/dsh-mattpocock-skills-deck.git）用于自行实现 PR。

---

## Issue 标题

**Feature request: Gitea backend (tea CLI) — "Other" prose trackers from upstream mattpocock/skills are silently unsupported**

## Issue 正文

### Summary

Upstream [mattpocock/skills](https://github.com/mattpocock/skills) explicitly supports "Other" issue trackers via freeform prose in `docs/agents/issue-tracker.md` — its own docs cite a user-built **Gitea CLI (`tea`) workflow** as a working example (docs/engineering/setup-matt-pocock-skills.md:49). The skills themselves read that prose and work fine with Gitea.

The DSH plugin, however, replaces that open prose mechanism with a compiled room registry, and Gitea is not in it. The result: a repo that follows the upstream skill's own documented Gitea setup gets `deck_context` → `no-backend`, and the deck tools refuse to activate.

### Reproduction

1. Configure a repo per the upstream skill's "Other" path, with `docs/agents/issue-tracker.md` titled `# Issue tracker: Gitea (tea CLI)` and a full tea-CLI workflow in the body.
2. Add a git remote pointing at a Gitea instance (e.g. `https://gitea.example.com/owner/repo.git`).
3. Run `deck_context`.

Result: `{"reason":"no-backend"}`. The panel offers only GitHub / Markdown / GitLab.

### Root cause (verified against installed 1.9.0-beta.33 source)

1. **Hardcoded room whitelist** — `tracker/registry/builtins.js:2`:
   ```js
   const BUILTIN_ROOM_IDS = ["github", "markdown", "gitlab"];
   ```
   `tracker/rooms/` contains only `github/`, `gitlab/`, `markdown/` — there is no gitea room.
2. **Declaration parser has no gitea branch** — `tracker/kernel/issue-tracker-declaration.js` (`parseIssueTracker`):
   ```js
   const titleGithub  = /^#\s*issue\s*tracker\s*:\s*github/im.test(text);
   const titleGitlab  = /^#\s*issue\s*tracker\s*:\s*gitlab/im.test(text);
   const titleMarkdown= /^#\s*issue\s*tracker\s*:\s*(markdown|local)/im.test(text);
   // …keyword fallback only checks /gitlab/i and /github/i
   ```
   `# Issue tracker: Gitea (tea CLI)` matches none of these → `reason: "no-keyword"` → `backendDecision.js` resolves to `no-backend`.
3. **No remote-based detection** — `tracker/detection/` never reads git remotes, so pointing `origin` at a Gitea host does not help either.
4. The tie-break order (`tracker/detection/backendDecision.js:4`, `MULTI_CLAIM_ORDER`) and the README's backend list (README.md:113) are also limited to the same three.

Note this is a structural gap, not a missing dependency: the upstream design treats "any prose" as a tracker, the plugin narrows it to "only registered rooms exist". Every prose-based tracker other than the three built-ins is silently invisible.

### Proposal

Add a first-class **Gitea room** backed by the official [`tea` CLI](https://gitea.com/gitea/tea), mirroring the GitLab room's shape:

1. `tracker/rooms/gitea/` — command vocabulary `{ cli: "tea", cliBrand: "Gitea" }` (cf. `tracker/rooms/gitlab/index.js:156` which uses `{ cli: "glab", cliBrand: "GitLab" }`), preflight (`tea whoami` / `tea repo view`), error classification, and contract/capability fixtures under `tracker/contract/`.
2. Register the id: add `"gitea"` to `BUILTIN_ROOM_IDS` and to `MULTI_CLAIM_ORDER`.
3. Extend the declaration parser: a `# issue tracker: gitea` title rule (and, ideally, a generic keyword fallback) so upstream-style prose trackers can declare it.
4. Optional / complementary: when the declaration parses to an unknown backend but is a *valid prose workflow*, surface a distinct verdict (e.g. `prose-tracker-unsupported`) instead of plain `no-backend`, so users learn the plugin (not their setup) is the limitation.

Detection hints that would fit the existing evidence-layer design: a git remote whose host matches the `tea`-configured login URLs (`tea logins list --output json`), or presence of `docs/agents/issue-tracker.md` titled `gitea`.

Relevant command surface for the room (already proven to work against Gitea via tea):
`tea issues create / list / <n> / comments / close`, `tea issues edit --add-labels/--add-assignees`, `tea labels create/list` — one index space shared with PRs.

### Environment

- dsh-mattpocock-skills-deck 1.9.0-beta.33 (DSH desktop plugin)
- tea 0.16.0, logged in against a self-hosted Gitea (gitea.vvmath.com:8443)
- Repo configured per upstream skill conventions (`docs/agents/issue-tracker.md` prose + `docs/agents/workspace.yaml` absent)

---

## PR 草稿（如直接动手实现）

### 标题

`feat(tracker): add Gitea backend (tea CLI) to builtin rooms`

### 概要

- **改动点 1**：新增 `tracker/rooms/gitea/index.js`（+ preflight / error-class / fixtures），`commandVocabulary: { cli: "tea", cliBrand: "Gitea" }`，命令词汇表与 GitLab room 对齐（`tea issues …`、`tea labels …`）。
- **改动点 2**：`tracker/registry/builtins.js` — `BUILTIN_ROOM_IDS` 加入 `"gitea"` 并补 import。
- **改动点 3**：`tracker/detection/backendDecision.js` — `MULTI_CLAIM_ORDER` 加入 `"gitea"`。
- **改动点 4**：`src/tracker/kernel/issue-tracker-declaration.ts`（生成物 `issue-tracker-declaration.js` 随 build 更新）— 增加 `titleGitea = /^#\s*issue\s*tracker\s*:\s*gitea/im` 与 `keywordGitea = /gitea|\btea\b/i` 回落。
- **改动点 5**：README 后端清单补 Gitea/tea。
- **测试**：仿 gitlab room 的 contract fixture，覆盖 `# Issue tracker: Gitea (tea CLI)` 声明解析、preflight（tea 登录/仓库可达）、issue CRUD 与标签命令映射。
- **不改**：`docs/agents/workspace.yaml` 格式与面板选择流程（gitea 会作为第四个选项自然出现）。

> 实现前建议先开 issue 确认作者对新增第四后端的态度与 room 接口是否稳定（仓库为 auto-generated build 管线 `scripts/build.mts`，需从 `src/` 改起）。
