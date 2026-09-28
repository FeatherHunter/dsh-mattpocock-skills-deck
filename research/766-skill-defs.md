# #766 研究结论：ready-for-human 与 needs-info 何时出现、期望如何推进

## ready-for-human
- 出现条件：诊断确认这件事需要人动手做时转入（修复→agent、需人动手→human、缺关键信息→needs-info、不做→wontfix；无理由不许停在 needs-triage）。（`src/client/kernel/prompts.js:13` tpl.diagnose 分流句；`research/642-aihero-workflows.md:55`；`research/642-parts/04-upkeep.md:102`）
- 推进期望：贴与 agent brief 同结构的一份说明，并写明为什么不能委托出去（判断类决策、外部权限、设计决策、需要人工测试），然后由人实施；诊断阶段只切标签，不改业务代码、不关单、不开始修复。（`package/bundled-skills/triage/SKILL.md:80`；`research/642-parts/04-upkeep.md:102`；`src/client/kernel/prompts.js:13` 禁止三件句）

## needs-info
- 出现条件：缺关键信息（例如按报告人步骤复现不出来）时挂起等报告人回话。（`src/client/kernel/prompts.js:13` 缺关键信息→needs-info 句与暂留 needs-triage 仅当缺信息到无法分流且写明缺什么句；`research/642-aihero-workflows.md:55`；`research/642-parts/04-upkeep.md:102`）
- 推进期望：按模板贴分诊记录（已确立事项 + 向报告人提具体可回答的问题），报告人一回复就回到 needs-triage 重新评估；带报告人新活动的 needs-info 列入待关注桶。（`package/bundled-skills/triage/SKILL.md:45,62,92-108`；`research/642-aihero-workflows.md:55`）
