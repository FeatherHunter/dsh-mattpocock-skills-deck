# 新建会话必为 PTC 的可判定门禁

2026-09-01 定版 · #362 讨论定版，承接 #359 研究与 #360 幽灵盘点，阻塞 #363/#364 落地与 #365 验收。

DSH 底座对 `code` 已抛 `UnknownPresetError` 且 `turn/start` 后抛 `PresetLockedError` 创后不可改，而 `api.js:476` 仍依赖 `defaultId` 漂移且 `378-408 reuseSid` 未过滤，导致旧 `code` 空壳可被任何 `cwd` 复活跨工作区污染。决定以三判据合取（入参显式 `agentPreset:'ptc'` + 落盘可观测为 `ptc` 且非 `broken` + 同次原子化）为可判定证明，并以双轨四门禁承载：静态源码扫与沙箱单测进 `npm run verify` 硬阻断，headless 快照警告留痕，ui_drive 真机截图为发布慢门。门禁不硬编码字面 `code`，以 `presets.list()` 实时 `broken` 为准，未来合法新增预设自动放行。

版本与效力：本决策 2026-09-01 生效。凡与本条之后定版内容冲突，以更新日期者为准；后续任何讨论若改动本决策，以未来版本为准。
