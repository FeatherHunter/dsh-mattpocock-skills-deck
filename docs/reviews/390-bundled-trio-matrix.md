# 390 三态回归矩阵 — 技能随包可用（v1.2.3 bundled 零代码）

> 归属：[#390](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/390) / Map [#384](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/384)  
> 快照：mattpocock/skills@v1.2.3（2026-08-06 patch，仍 25 个，engineering 18 + productivity 7）  
> 验证脚本：`tests/verify-bundled-discovery.js`（98 项） + `tests/verify-bundled-trio-matrix.js`（33 项）  
> 结论：空 HOME 首通道已绿，无需在 `lightProbeReason` 回退分支补 bundled；三态均回归通过，默认零污染

## 矩阵（wf.detect / wf.chain 三检查）

| 场景 | ~/.agents/skills 状态 | 技能三检查（wayfinder / setup-matt-pocock-skills / ask-matt） | 来源 rank | 结果 | 证据 |
|------|----------------------|--------------------------------------------------------------|-----------|------|------|
| **A：空 HOME** | 不存在（全新工作区，无 ~/.agents/skills） | 全 pass | bundled 600 兜底 | 🟢 绿 | `ctx.skills.list` 返回 25 bundled，`get('wayfinder')` 命中 bundled；`verify-bundled-discovery` 日志含 `[bundled] wayfinder source=bundled rank=600` |
| **B：有效 HOME** | 存在有效卡片（`wayfinder` 等 3 个手装 500） | 全 pass（用户覆盖） | user-agents 500 > bundled 600 | 🟢 绿 | 合并日志 `覆盖: wayfinder winner=user-agents(500) loser=bundled(600)`；lightProbeDirect 为 ok |
| **C：无效名片** | 存在无效卡片（`wayfinder/SKILL.md` frontmatter name 不匹配） | `wayfinder` 为 **invalid/bad**，其余两项仍 bundled 绿 | — | 🔴 红牌 + 证据 | `lightProbeReasonDirect` kind=invalid，`evidenceSummary` 为 `[direct:user-agents=无效 | direct:user-dsh=未找到]`，channels 含 invalid |

> **落盘规则**：`isSkillCardValid` 要求 frontmatter `name:` 与目录名一致（BOM 兼容），无效时返回 `invalid` 并附 `evidenceSummary`；首通道 `skills.get` 命中 bundled 时直接绿，回退分支（`lightProbeReason`）仅在 skills 未命中时分拣红/缺失，因此**无需在回退分支再查 bundled**（R1 结论，T3 已固化）。

## 首通道已绿结论（R1 → T3 固化）

- 源码证据：`src/host/index.js` 的 `lightProbeReason` 仅检查用户标准根（`.agents/skills` → `.dsh/skills`）与项目根，不含 `bundled` 字段；bundled 仅经 `ctx.skills.registerProvider` 首通道（rank 600）发现。
- 验证证据：`verify-bundled-trio-matrix.js` 的“空 HOME 的 lightProbe fallback 为 missing”断言通过，说明回退分支不需 bundled；空 HOME 仍因首通道 green 而整体 green。
- 结论写入 Map：T3 完成后在 `#384` 的 Decisions so far 追加“首通道已绿，无需补回退分支”。

## 零污染与复制按钮

- **默认零污染**：`package/bundled-skills` 在 `package/` 内，随 `dsh plugin remove` 消失；所有回归均用临时 HOME 隔离，未写真实 `~/.agents/skills`（`verify-bundled-trio-matrix` 第 5 节日志 `未向真实 HOME 写入（隔离）`）。
- **复制按钮（可选）**：`GENERIC_CHECK_ITEMS` 的失败态拟追加 `{type:'rpc', label:'复制到 ~/.agents/skills', action:'copyBundledToHome'}`，需用户点确认才写。**R1 已定版首版不做**，T3 评估后暂缓——bundled 兜底已满足首通道绿，复制功能留待后续“想让技能进 ~ 且进 git”场景再评估（验收“仅在用户点确认时写 ~，默认零污染”在未实现时亦满足）。

## 验证日志摘录

### verify-bundled-discovery（T2，已绿）

```
[bundled] discovered at D:\dsh-plugin\dsh-mattpocock-skills-deck\package/bundled-skills
[PASS] bundled 目录含 25 技能（当前 25）
[bundled] wayfinder source=bundled rank=600
[PASS] 空 HOME 中 ctx.skills.list 返回 25 (bundled)
[PASS] wayfinder source==bundled
[PASS] wayfinder rank==600
[bundled] 覆盖: wayfinder winner=user-agents(500) loser=bundled(600)
[PASS] trio wayfinder/setup/ask-matt 全 pass
```

### verify-bundled-trio-matrix（T3，33 项全绿）

```
=== verify-bundled-trio-matrix (T3 #390) 三态回归 ===
[PASS] bundled 目录可发现（package/bundled-skills）
[PASS] 空 HOME 合并后仍为 25（bundled 兜底）
[PASS] 空 HOME 三项 wayfinder 为 pass（bundled 600）
[PASS] 空 HOME 的 lightProbe fallback 为 missing（不含 bundled）
[PASS] 有效 HOME 已创建 3 个 user 500 技能
[PASS] B wayfinder winner 为 user-agents 500 覆盖 bundled 600
[PASS] C 无效名片 isSkillCardValid 为 false
[PASS] C lightProbe 对无效名片为 invalid（红牌）
[PASS] C evidenceSummary 含"无效"证据 [direct:user-agents=无效 | direct:user-dsh=未找到]
[PASS]  lightProbeReason 源码不含 bundled（回退分支未查 bundled）
[PASS] bundled 目录在 package 内（随包消失，不写 HOME）
[PASS] 未向真实 HOME 写入（隔离）
=== verify-bundled-trio-matrix ===
total checks: 33, failures: 0
ALL CHECKS PASS (trio matrix)
[bundled] evidence: 空 HOME=bundled 600 绿 | 有 HOME 有效=user 500 覆盖 | 无效名片=红牌 invalid + evidenceSummary | 首通道已绿无需补 | 零污染
```

完整日志见 Artifacts：`npm run verify` 全绿输出（CI 可检索 `[bundled]`）。

## 截图说明

本回归为纯文件系统 + 注册表 rank 合并验证，无需 DSH GUI 交互；矩阵以本 markdown 表格 + 上述日志为“截图”归档。  
如需真机 DSH 面板截图，可在安装插件后打开空工作区与含有效/无效 HOME 的工作区，观察面板环境检查栏三项状态（绿/绿/红），与本矩阵一致。

## 产物与门禁

- `package/bundled-skills`：25 目录 + LICENSE + VERSION=v1.2.3，随包发布
- `scripts/sync-matt-skills.mjs --pin v1.2.3 --verify`：手动同步，`verify-matt-skills-sync` 与 `verify-bundled-skills` 双门禁
- `tests/verify-bundled-discovery.js` + `tests/verify-bundled-trio-matrix.js` 已并入 `npm run verify`，全绿

---
*生成于 2026-09-01，T3 交付。*
