<h1 align="center">dsh-mattpocock-skills-deck</h1>

<div align="center">

[中文](../README.md) · **English**

**Part the fog of war, see the end — MattSkillsDeck handles the rest.**  
A playable task board for [mattpocock/skills](https://github.com/mattpocock/skills) in DSH — visible, dispatchable, trackable.

*Your ⭐ is the brightest star in my night sky.*

[![npm](https://img.shields.io/npm/v/dsh-mattpocock-skills-deck)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck) [![downloads](https://img.shields.io/npm/dm/dsh-mattpocock-skills-deck)](https://www.npmjs.com/package/dsh-mattpocock-skills-deck) [![last-commit](https://img.shields.io/github/last-commit/FeatherHunter/dsh-mattpocock-skills-deck?color=FE7D37)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/commits/main) [![commit-activity](https://img.shields.io/github/commit-activity/m/FeatherHunter/dsh-mattpocock-skills-deck?color=DFAB01)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/graphs/commit-activity) [![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey.svg)](../LICENSE) [![skills](https://img.shields.io/badge/skills-mattpocock%2Fskills-9D7CD8)](https://github.com/mattpocock/skills) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues) [![Roadmap](https://img.shields.io/badge/Roadmap-6f42c1.svg)](ROADMAP.md)

<strong>👇 A mission board you can see, and act on.</strong>

<img src="../assets/panel-list-zh.png" width="640" alt="MattSkillsDeck panel: mission list, progress rings, one-click actions">

**Install in 30 seconds.**

</div>

<h2 align="center"><sub>INSTALL</sub><br>Install</h2>

<div align="center">

One prerequisite: [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) (DeepSeek Harness, an AI coding desktop). You give instructions, the AI does the work — and MattSkillsDeck turns that work into missions on a panel.

The repo your task board is bound to needs write access: creating labels requires push access, and labeling tickets requires triage access or higher. With read-only access you can still create and read tickets, but label backfill, label flow, and wayfinder labels are unavailable.

</div>

```bash
# ① Install the DSH CLI (skip if already installed)
npm install -g @deepseek-ai/dsh

# ② Install MattSkillsDeck — --profile is required: target the profile matching the DSH
#    entry you actually use (a wrong profile = the plugin never loads, restarts won't help)
dsh plugin --profile desktop add dsh-mattpocock-skills-deck   # DSH Desktop app (most users)
# dsh plugin --profile web add dsh-mattpocock-skills-deck     # self-started web server (dsh web)
# Pin to latest for extra stability (currently 1.9.0-beta.22):
# dsh plugin --profile desktop add dsh-mattpocock-skills-deck@1.9.0-beta.22 --registry https://registry.npmjs.org

# ③ That's it — the panel opens in DSH's own right sidebar (no third-party plugin needed)
```

<div align="center">

One restart of the matching DSH entry and it works — zero config. Desktop app: fully quit and reopen DSH Desktop. Web server: restart dsh web, then refresh the page.

**Heavily optimized right-panel performance: click-to-visible content, 5075 ms down to 193 ms on a real machine — about 96.2% faster (about 26x).**

</div>

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
dsh plugin --profile web add dsh-mattpocock-skills-deck@1.9.0-beta.22 --registry https://registry.npmjs.org

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

<strong>👇 The task bar lives at the bottom of DSH: open, blocked, archived, handed off — one strip.</strong>

<img src="../assets/statusbar-zh.png" width="720" alt="DSH bottom task bar">

</div>

<h2 align="center"><sub>IN ACTION</sub><br>In action</h2>

<div align="center">

<strong>👇 Open an issue: description, author, one-click new session.</strong>

<img src="../assets/issue-detail-zh.png" width="640" alt="ISSUE detail view">

<strong>👇 Never touch the terminal: comment, respond to issues, run diagnostics in the panel.</strong>

<img src="../assets/issue-comment-zh.png" width="560" alt="Comment right in the panel">

<strong>👇 Far right of the task bar: every Matt skill, one click away.</strong>

<img src="../assets/statusbar-skills-menu-zh.png" width="480" alt="Task bar quick entry">

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
<summary>Update fails with "No matching version" pointing at a mirror registry?</summary>

The mirror registry has not synced the new release yet: the error URL names a mirror (for example `registry.npmmirror.com`), while the new version is already published on the official registry — nothing failed to publish. Updating works again once the mirror finishes syncing. If you need the new version right away, install explicitly from the official registry (keep the trailing registry parameter in the command below — dropping it sends you back to the mirror):

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org
```

Desktop app users: replace `--profile web` with `--profile desktop`.

</details>

<details>
<summary>Can I use it on a narrow window?</summary>

Yes. The panel opens in DSH's own right sidebar: the mission list is on the left of that column and the details open beside it.

</details>

<h2 align="center"><sub>ARCHITECTURE</sub><br>Architecture</h2>

<div align="center">

Want to see how the code is put together? This interactive diagram was generated by AI — it lays out the overall structure, data flow and key states, with dark and light themes and image export.

[Open online (recommended)](https://featherhunter.github.io/dsh-mattpocock-skills-deck/architecture/MattSkills-architecture.html) · or just open [`architecture/MattSkills-architecture.html`](architecture/MattSkills-architecture.html) locally in your browser — no server needed. The source data lives next to it as `mattskills.architecture.json`, with more write-ups in the `*.md` files in the same folder.

</div>

<h2 align="center"><sub>DEVELOPMENT</sub><br>Development</h2>

Edit `src/` only — `client.js`, `host.js` at the repo root and `package/lib/` are build artifacts, don't touch them.

```bash
node scripts/build.mjs      # build (repo artifacts only, never touches an installed DSH)
npm run test:smoke          # smoke tests
npm run verify              # contract checks
```

The full build / verify / sync / publish workflow lives in [DEV-WORKFLOW.md](workflow/DEV-WORKFLOW.md).

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

<!-- THANKS-TABLE-EN-START -->
| Contributor | Tribute | Contributions |
| --- | --- | --- |
| [@pioneerAlone](https://github.com/pioneerAlone) | 🌹🌹🌹🌹🌹🌹 | [#234](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/234) [#274](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/274) [#298](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/298) [#645](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/645) [#273](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/273) [#316](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/316) |
| [@zhengcookie](https://github.com/zhengcookie) | 🌹🌹🌹🌹🌹 | [#960](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/960) [#1003](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1003) [#1160](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1160) [#1291](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1291) [#1005](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions/1005) |
| [@Shimmernight](https://github.com/Shimmernight) | 🌹🌹🌹🌹 | [#277](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/277) [#106](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/106) [#275](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/275) [#287](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/287) |
| [@anupamme](https://github.com/anupamme) | 🌹🌹🌹 | [#727](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/727) [#728](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/728) [#1156](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/1156) |
| [@9agj](https://github.com/9agj) | 🌹🌹🌹 | [#992](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/992) [#993](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/993) [#994](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/994) |
| [@xingmulee](https://github.com/xingmulee) | 🌹🌹 | [#1421](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1421) [#1422](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1422) |
| [@776317107](https://github.com/776317107) | 🌹🌹 | [#1375](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1375) [#1376](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/1376) |
| [@gzy31007](https://github.com/gzy31007) | 🌹🌹 | [#1272](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1272) [#1273](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1273) |
| [@qq1393950873-bit](https://github.com/qq1393950873-bit) | 🌹🌹 | [#970](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/970) [#974](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/974) |
| [@hyperion2144](https://github.com/hyperion2144) | 🌹🌹 | [#110](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/110) [#646](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/646) |
| [@arnold117](https://github.com/arnold117) | 🌹🌹 | [#574](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/574) [#575](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/575) |
| [@xiSage](https://github.com/xiSage) | 🌹🌹 | [#435](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/435) [#436](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions/436) |
| [@angenet](https://github.com/angenet) | 🌹🌹 | [#262](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/262) [#295](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/295) |
| [@nolifeking0916](https://github.com/nolifeking0916) | 🌹 | [#1504](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1504) |
| [@ACGNnsj](https://github.com/ACGNnsj) | 🌹 | [#1498](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1498) |
| [@654970](https://github.com/654970) | 🌹 | [#1481](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1481) |
| [@GuanpengLu](https://github.com/GuanpengLu) | 🌹 | [#1478](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/1478) |
| [@zyf0625-990](https://github.com/zyf0625-990) | 🌹 | [#1476](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1476) |
| [@Lichxier](https://github.com/Lichxier) | 🌹 | [#1435](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1435) |
| [@mdc707](https://github.com/mdc707) | 🌹 | [#1394](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions/1394) |
| [@firewfly](https://github.com/firewfly) | 🌹 | [#1392](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1392) |
| [@lilincen](https://github.com/lilincen) | 🌹 | [#1301](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/discussions/1301) |
| [@WDXXZH](https://github.com/WDXXZH) | 🌹 | [#1137](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1137) |
| [@Drayee](https://github.com/Drayee) | 🌹 | [#1101](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1101) |
| [@30892096](https://github.com/30892096) | 🌹 | [#1100](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1100) |
| [@fishke22](https://github.com/fishke22) | 🌹 | [#1000](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/1000) |
| [@jack2jiehua](https://github.com/jack2jiehua) | 🌹 | [#930](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/930) |
| [@asesr](https://github.com/asesr) | 🌹 | [#926](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/926) |
| [@SKADI0718](https://github.com/SKADI0718) | 🌹 | [#856](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/856) |
| [@li873582595](https://github.com/li873582595) | 🌹 | [#835](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/835) |
| [@zerocodefast](https://github.com/zerocodefast) | 🌹 | [#823](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/823) |
| [@seameafst](https://github.com/seameafst) | 🌹 | [#793](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/793) |
| [@SbDonger](https://github.com/SbDonger) | 🌹 | [#640](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/640) |
| [@snmtg1008](https://github.com/snmtg1008) | 🌹 | [#476](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/476) |
| [@dis0neplay](https://github.com/dis0neplay) | 🌹 | [#493](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/493) |
| [@tafcear](https://github.com/tafcear) | 🌹 | [#422](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/422) |
| [@21967201](https://github.com/21967201) | 🌹 | [#321](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/pull/321) |
| [@271912980](https://github.com/271912980) | 🌹 | [#257](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/257) |
<!-- THANKS-TABLE-EN-END -->

And thanks to everyone who left thoughts in comments and discussions. If you hit a problem or have an idea, feel free to open an issue or start a discussion.

</div>

<h2 align="center"><sub>CONNECT</sub><br>Feedback and Contact</h2>

<div align="center">

👏Welcome PRs and issues. A single spark can start a prairie fire 🔥. Any suggestion, opinion, idea or rant — come join the group and talk.

<table align="center"><tr><td align="center"><b>Feishu Group (Main)</b></td><td align="center"><b>QQ Group (New)</b></td><td align="center"><b>WeChat Group (New)</b></td></tr><tr><td><img src="../assets/contact-feishu-permanent.png" width="260" alt="DSH plugin community group Feishu QR code" /></td><td><img src="../assets/contact-qq-permanent.jpg" width="260" alt="DSH plugin community group QQ QR code" /></td><td><img src="../assets/contact-wechat-weekly.png" width="260" alt="DSH plugin community group WeChat QR code" /></td></tr></table>

</div>

<div align="center">

<a href="https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-dark.svg?v=20261026" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261026" />
    <img alt="Star History Chart" src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/docs/star-history-light.svg?v=20261026" />
  </picture>
</a>

</div>
