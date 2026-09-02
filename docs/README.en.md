<h1 align="center">dsh-mattpocock-skills-deck</h1>

<div align="center">

[中文](../README.md) · **English**

**Part the fog of war, see the end — MattSkillsDeck handles the rest.**  
A playable task board for [mattpocock/skills](https://github.com/mattpocock/skills) in DSH — visible, dispatchable, trackable.

*Your ⭐ is the brightest star in my night sky.*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE) [![npm](https://img.shields.io/npm/v/dsh-mattpocock-skills-deck)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck) [![dsh-plugin](https://img.shields.io/badge/dsh-plugin-orange.svg)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck) [![skills](https://img.shields.io/badge/skills-mattpocock%2Fskills-9D7CD8)](https://github.com/mattpocock/skills)

<img src="../assets/panel-list-zh.png" width="640" alt="MattSkillsDeck panel: mission list, progress rings, one-click actions">

<strong>A mission board you can see, and act on.</strong>

**Install in 30 seconds.**

</div>

<h2 align="center"><sub>INSTALL</sub><br>Install</h2>

<div align="center">

One prerequisite: [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) (DeepSeek Harness, an AI coding desktop). You give instructions, the AI does the work — and MattSkillsDeck turns that work into missions on a panel.

</div>

```bash
# ① Install the DSH CLI (skip if already installed)
npm install -g @deepseek-ai/dsh

# ② Install MattSkillsDeck — --profile is required: target the profile matching the DSH
#    entry you actually use (a wrong profile = the plugin never loads, restarts won't help)
dsh plugin --profile desktop add dsh-mattpocock-skills-deck   # DSH Desktop app (most users)
# dsh plugin --profile web add dsh-mattpocock-skills-deck     # self-started web server (dsh web)
# Pin to latest for extra stability (currently 1.7.12):
# dsh plugin --profile desktop add dsh-mattpocock-skills-deck@1.7.12 --registry https://registry.npmjs.org

# ③ Better on narrow screens (optional): install better-sidebar into the SAME profile
dsh plugin --profile desktop add dsh-better-sidebar
```

<div align="center">

One restart of the matching DSH entry and it works — zero config. Desktop app: fully quit and reopen DSH Desktop. Web server: restart dsh web, then refresh the page.

</div>

<details>
<summary>Better on narrow screens: pair it with better-sidebar</summary>

We recommend pairing with better-sidebar: view the list and details side by side in a VSCode-style sidebar for the best experience. Install it into the SAME profile as the plugin (example below targets the desktop app; web-server users: use --profile web).

```bash
dsh plugin --profile desktop add dsh-better-sidebar
```

</details>

<details>
<summary>Let your AI install it for you</summary>

Paste this to your AI — it will read the repo, check the environment, and install what's missing:

```text
Please install the DeepSeek Harness plugin dsh-mattpocock-skills-deck (MattSkillsDeck).
Read the repo README first: https://github.com/FeatherHunter/dsh-mattpocock-skills-deck
First figure out which profile matches the DSH entry I actually use (DSH Desktop app → desktop; self-started web server → web) and install into that profile.
Then check the environment and install as needed (skip what's already installed), and report back briefly.
```

</details>

<details>
<summary>No global install / when updates don't take effect</summary>

The examples below use the web profile — DSH Desktop app users: replace every `--profile web` with `--profile desktop`.

```bash
# Install a pinned version
dsh plugin --profile web add dsh-mattpocock-skills-deck@1.7.12 --registry https://registry.npmjs.org

# No global install (pin a version like above for extra safety)
npx --yes @deepseek-ai/dsh plugin --profile web add dsh-mattpocock-skills-deck

# When an update is silently skipped, point at the official registry
dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org
```

</details>

Upgrade · uninstall (desktop-profile users: replace `--profile web` with `--profile desktop`):

```bash
dsh plugin --profile web update dsh-mattpocock-skills-deck   # upgrade
dsh plugin --profile web remove dsh-mattpocock-skills-deck   # uninstall
```

<h2 align="center"><sub>WHY</sub><br>Why MattSkillsDeck</h2>

<div align="center">

Matt Pocock's [skills](https://github.com/mattpocock/skills) are excellent: wayfinder draws a map and walks you through the fog to the goal. But once the map is drawn — **how do you walk each step under your feet?**

MattSkillsDeck adds a mission system on top of that map:

**A mission board you can see** — repo ISSUES stop being a flat log. MattSkillsDeck moves them into the DSH sidebar: open, blocked, closed in their own lanes, progress rings right where you glance.

**A workbench that acts** — every mission card is a button: diagnose, fix, run, new session. One click and the AI goes to work; how far it got, where it stalled, all written on the card.

The map owns the goal. MattSkillsDeck owns the steps.

<img src="../assets/statusbar-zh.png" width="720" alt="DSH bottom task bar">

<strong>The task bar lives at the bottom of DSH: open, blocked, archived, handed off — one strip.</strong>

</div>

<h2 align="center"><sub>IN ACTION</sub><br>In action</h2>

<div align="center">

<img src="../assets/issue-detail-zh.png" width="640" alt="ISSUE detail view">

<strong>Open an issue: description, author, one-click new session.</strong>

<img src="../assets/issue-comment-zh.png" width="560" alt="Comment right in the panel">

<strong>Never touch the terminal: comment, respond to issues, run diagnostics in the panel.</strong>

<img src="../assets/statusbar-skills-menu-zh.png" width="480" alt="Task bar quick entry">

<strong>Far right of the task bar: every Matt skill, one click away.</strong>

Matt's official skills site (docs and tutorials): [aihero.dev/skills](https://www.aihero.dev/skills)

</div>

<h2 align="center"><sub>FAQ</sub><br>FAQ</h2>

<details open>
<summary>Still on the old version after updating?</summary>

That's the pnpm supply-chain policy (`minimumReleaseAge`) in the DSH desktop app: freshly published versions are silently skipped by `dsh plugin update` and the marketplace's update button for a few hours. Fully quit DSH and reopen, then hard-refresh with Ctrl+F5. If it still hasn't updated, install explicitly from the official registry:

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org
```

</details>

<details>
<summary>Can I use it on a narrow window without better-sidebar?</summary>

Yes. The mission list lives in the main panel and details open in the right column; install better-sidebar later if you want them side by side.

</details>

<h2 align="center"><sub>ARCHITECTURE</sub><br>Architecture</h2>

<div align="center">

Want to see how the code is put together? This interactive diagram was generated by AI — it lays out the overall structure, data flow and key states, with dark and light themes and image export.

[Open online (recommended)](https://featherhunter.github.io/dsh-mattpocock-skills-deck/architecture/MattSkills-architecture.html) · or just open [`architecture/MattSkills-architecture.html`](architecture/MattSkills-architecture.html) locally in your browser — no server needed. The source data lives next to it as `mattskills.architecture.json`, with more write-ups in the `*.md` files in the same folder.

</div>

<h2 align="center"><sub>DEVELOPMENT</sub><br>Development</h2>

Edit `src/` only — `client.js`, `host.js` at the repo root and `package/lib/` are build artifacts, don't touch them.

```bash
node scripts/build.mjs      # build
npm run test:smoke          # smoke tests
npm run verify              # contract checks
bash scripts/build.sh       # build + sync into an installed DSH
```

The full build / verify / sync / publish workflow lives in [DEV-WORKFLOW.md](../DEV-WORKFLOW.md).

<h2 align="center"><sub>MORE</sub><br>More from the author</h2>

<div align="center">

If you like this plugin, these might help too:

**[dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette)** — 34 classic opencode themes for DSH, one click, persisted across restarts

**[dsh-prompt](https://github.com/FeatherHunter/dsh-prompt)** — A prompt toolbox: 24 deep templates a click away, stop copy-pasting

**[dsh-chinese-skill-patch](https://github.com/FeatherHunter/dsh-chinese-skill-patch)** — Use Chinese skill names in DSH directly: type /私 to reach 私家大厨, no English renaming needed

---

Questions or ideas? [Open an issue](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues) or start a thread in [discussions](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions)

A personal project, not affiliated with [mattpocock/skills](https://github.com/mattpocock/skills).
MIT © FeatherHunter

</div>

<h2 align="center"><sub>THANKS</sub><br>Thanks</h2>

<div align="left">

Thanks to everyone who opened an issue, sent a PR, or joined a discussion — you made this plugin better bit by bit.

[@pioneerAlone](https://github.com/pioneerAlone) — reported #298 (duplicate details/better-sidebar with clear repro), #274, #234 and landed PRs #273, #316 — thanks for making the reinstall experience smooth again 🌹

[@Shimmernight](https://github.com/Shimmernight) — filed #277 and PRs #287, #275, #106

[@21967201](https://github.com/21967201) — opened PR #321 (triage + wayfinder labels docs)

[@angenet](https://github.com/angenet) — reported #295, #262 on macOS checks

[@hyperion2144](https://github.com/hyperion2144) — reported #110 and more

And thanks to everyone who left thoughts in comments and discussions. If you hit a problem or have an idea, feel free to open an issue or start a discussion.

</div>

<h2 align="center"><sub>CONNECT</sub><br>Connect</h2>

<div align="center">

Scan to join the topic group — QR code never expires. Casual chat in the group, bugs and feature requests via Issues for better traceability.

<img src="../assets/qr-topic-group.png" width="280" alt="Scan to join topic group, dsh-mattpocock-skills">
<br>
<strong>Join topic group</strong>
<br>
<sub>dsh-mattpocock-skills · permanent QR code</sub>

</div>

<div align="center">

<a href="https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-dark.svg?v=20260902" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20260902" />
    <img alt="Star History Chart" src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20260902" />
  </picture>
</a>

</div>