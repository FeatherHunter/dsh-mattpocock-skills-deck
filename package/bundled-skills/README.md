# Bundled Skills (mattpocock/skills v1.3.2)

本目录由 `scripts/sync-matt-skills.mts --pin v1.3.2` 从 https://github.com/mattpocock/skills 同步而来，含 27 个技能（engineering 20 + productivity 7）。

- 单源：`src/shared/matt-skills.ts` 的 27 项（MATT_SKILL_PROBE_NAMES）为真源，与本目录双向差集为 0。
- 产物：`package/bundled-skills/<name>/SKILL.md`（frontmatter name: 与目录名一致，符合 dsh-skill-filesystem 的 discoverRoot 校验）。
- 版本：`VERSION` 溯源 pin，`LICENSE` 保留上游 MIT 声明（Copyright (c) 2026 Matt Pocock）。
- 同步：纯手动 `pnpm run sync:matt`（`node scripts/sync-matt-skills.mts --pin v1.3.2 --verify`），不挂 prepare/prebuild。
- 中文译文：不在本目录，统一放在兄弟目录 `package/bundled-skills-zh/`，按技能名与文件路径镜像。

本目录只放上游原文：同步脚本会先删除整个目录再按上游重建，任何本地新增文件（包括旧版放在技能目录里的 `SKILL.zh.md`）都会被抹掉。中文译文、术语表与译文校验门禁见 `package/bundled-skills-zh/README.md`；`tests/verify-bundled-skills-upstream.ts` 会判红任何留在本目录里的本地译文。
