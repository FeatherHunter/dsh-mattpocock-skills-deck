# 研究：host 侧会话治理能力盘点（增量于 #206）

## 结论摘要

host 进程当下无法独立完成『枚举 → 计算名字 → 改名』闭环：缺会话服务、缺 LLM 通道，这两处是硬缺口；定时与持久化条件齐备。推荐形态为「host 常驻任务持状态 + Web 侧代执行改名」的混合结构。

## 能力矩阵

| 能力 | 可行性 | 证据位置 |
|---|---|---|
| host 枚举全部会话 | ✗ 无现成 API | host ctx 注入面仅 connection/subprocess/timer/fs/trackerRegistry(+platform)（src/host/index.js:22-28）；sessions 服务只在 Web 半可见（api.js:197 ctx.get('sessions')） |
| host 直接 rename | ✗ 未证实存在 | 唯一实证链路是 Web face.rename → DSH 落 pinned 标题可覆盖可重试（#206 结论 3 + api.js:284-287）；host 半无等价符号 |
| 常驻定时 | ✓ | ctx.get('timer') 提供 timeout(ms) Promise 原语（index.js:26,230,392）；timeout 自递归即可构成常驻环；生命周期挂 cordis apply/dispose。注意 index.js:10 注释所称『60s 轮询』实为懒命中缓存（1508 行），并非真轮询——别照抄注释 |
| LLM 调用通道 | ✗ 零基础设施 | src/host 全目录 grep llm/provider/apiKey/completions 均零命中。可行替代：(a) 复用插件既有的 prompt 注入动作模式让活跃 agent 产出标题（setup/handoff 同款，零新依赖）；(b) 宿主是否向插件暴露 model 服务待向 DSH 侧求证；(c) 无 LLM 时退化为启发式 |
| 跨重启持久化 | ✓ 有先例 | .dsh-mattskillsdeck-cache/*.json（repoKey/git-root 缓存，index.js:427 起，经 ctx.get('fs') 写盘）；另有 workspaceStore(ttl)。watcher 跟踪态照此目录落 JSON 即可 |

## 缺口清单

- G1 会话枚举与改名 API 在 host 半缺失——或者推动 DSH 向 cordis 插件注入 sessions 服务，或者接受『host 定计划、Web 代执行』分工（面板任意一次渲染即可清账）。
- G2 LLM 通道从零起步；最小接入门是注入式（借会话内 agent），直接 HTTP 调模型则需要密钥管理，超出插件现有能力面。
- G3 历史：e98f636 重构删 #211 watcher 时未留任何标记或回归测试，tests 里也没有守卫该能力的断言——落地票应附防回归测试。

## 对契约票 #260 的输入建议

- 分级命名的每一级都应有明确的『谁发现触发』（host 扫描 vs Web 渲染钩子）与『谁执行 rename』（目前只能 Web）字段，避免再次写出无人执行的设计。
- 建议契约直接规定跟踪态的持久化 schema（占位 sid / 创建时间戳 / 当前阶段 / 手改标记），落到 .dsh-mattskillsdeck-cache，使重启可续。