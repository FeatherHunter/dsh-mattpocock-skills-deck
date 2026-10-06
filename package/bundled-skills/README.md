# Bundled Skills (mattpocock/skills v1.3.1)

本目录由 `scripts/sync-matt-skills.mjs --pin v1.3.1` 从 https://github.com/mattpocock/skills 同步而来，含 27 个技能（engineering 20 + productivity 7）。

- 单源：`src/shared/matt-skills.js` 的 27 项（MATT_SKILL_PROBE_NAMES）为真源，与本目录双向差集为 0。
- 产物：`package/bundled-skills/<name>/SKILL.md`（frontmatter name: 与目录名一致，符合 dsh-skill-filesystem 的 discoverRoot 校验）。
- 版本：`VERSION` 溯源 pin，`LICENSE` 保留上游 MIT 声明（Copyright (c) 2026 Matt Pocock）。
- 同步：纯手动 `pnpm run sync:matt`（`node scripts/sync-matt-skills.mjs --pin v1.3.1 --verify`），不挂 prepare/prebuild。
