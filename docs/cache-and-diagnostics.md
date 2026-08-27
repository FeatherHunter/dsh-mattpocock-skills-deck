# MattSkillsDeck 磁盘缓存 · 排查与修复全记录（T9 · v1.6.17 更名 waystation → MattSkillsDeck）

> 2026-08-16 · 从「秒开不生效」到根因定位与修复的完整复盘。
> 目的：沉淀「缓存机制设计 + DSH fs 服务沙箱特性 + 运行时诊断方法」，避免未来重踩。

## 1. 目标

T9 数据架构 v2 要求：**重启 DSH 打开面板秒出数据**（磁盘缓存），刷新后动态更新 UI。

## 2. 现象

- 用户完全重启 DSH 后，打开面板**不是秒开**：空列表 + loading 遮罩，等网络加载完成才显示。
- 多次重启复现；`~/.dsh/waystation-cache/`（旧名，v1.6.17 已更名为 `~/.dsh/mattskillsdeck-cache/` 概念，对应 `<cwd>/.dsh-mattskillsdeck-cache/`）目录**从未出现**。

## 3. 排查链路（按序，每步都有结论）

| # | 假设 | 验证方法 | 结论 |
|---|---|---|---|
| 1 | inject 缺 fs 声明 | 读 DSH host runner 源码 missingServices 逻辑 | fs 服务名确认是 "fs"（super(ctx,"fs")）；inject 加 fs 无害但非根因 |
| 2 | writeText API 契约错 | 读 fs-local 源码 | **确认**：writeText(target,...) 要求 resolve() 返回的 {targetKey,displayPath} 对象，不能传路径字符串 → 修复 |
| 3 | 加载的不是改的文件 | dev_plugin_status 列 loader entries | **确认加载的是** profiles/web/node_modules/dsh-mattpocock-skills-deck/lib/index.js（我们覆盖的文件） // 旧名 dsh-waystation 已于 v1.7.1 归档|
| 4 | host 半没 apply | dev 诊断工具探测 | **确认 fs 能拿到**（ctx.get('fs')=object），host 在工作（RPC 正常）|
| 5 | **fs 沙箱拒绝写 ~/.dsh** | staging 工具实测写入 | **★ 真根因**：file access denied under workspace-write mode —— fs 沙箱只允许 process.cwd() 下写入 |

## 4. 真根因（运行时探测证实）

DSH 的 fs 服务处于 **workspace-write 沙箱模式**：
- **只允许写入 process.cwd()（DSH 进程工作目录）下的路径**
- `~/.dsh/waystation-cache/`（旧名，现为 `~/.dsh/mattskillsdeck-cache` 概念）/ `~/.dsh/mattskillsdeck-cache/`（用户主目录）在沙箱外 → fs.writeText 抛 file access denied → 被 catch 静默吞掉 → 缓存永不写入

**为什么之前的代码「看起来对」**：readDiskCache/writeDiskCache 的 try-catch 吞掉了所有错误，没有任何可见信号 —— 静默失败是最难排查的错误形态。

## 5. 修复

**缓存目录从 `~/.dsh/waystation-cache/` 改为 `<DSH 进程 cwd>/.dsh-waystation-cache/`（T9），v1.6.17 更名为 `<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/`**（实测该路径写入成功）：

```js
async function getCacheDir() {
  if (cacheDirResolved) return cacheDirResolved
  const cwd0 = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : DEFAULT_CWD
  if (!cwd0) return null
  cacheDirResolved = cwd0 + '/.dsh-mattskillsdeck-cache' // v1.6.17 更名 waystation → MattSkillsDeck
  ...
}
```

配套修复（排查中发现一并落地）：
- **writeDiskCache 传 resolve 对象**：fs.resolve(path) → fs.writeText(target, ...)
- **inject 加 'fs'**：确保服务注入

## 6. 验证结果

- 缓存文件生成：`<cwd>/.dsh-mattskillsdeck-cache/FeatherHunter__SKILLS.json`（216KB，含 6 张 map；旧路径 `.dsh-waystation-cache/` 已废弃）
- readDiskCache 实测：resolve + readText 返回合法数据（ok=true, maps=6）
- 用户确认：再重启后**秒开** ✓

## 7. 可复用经验（DSH 插件开发）

### 7.1 fs 服务的真实契约
- ctx.get('fs') 能拿到服务对象（Cordis Service，名 "fs"）
- **方法签名**：
  - resolve(path, opts?) → { targetKey, displayPath }（相对路径需 {cwd}）
  - readText(target) / writeText(target, content) —— **target 必须是 resolve() 的返回值对象**，不是路径字符串
  - **没有 mkdir 方法**（父目录由 writeText 内部自动 mkdir recursive 创建）
- **沙箱**：workspace-write 模式只允许 process.cwd() 下写入；workspace 外路径（~/.dsh、%APPDATA% 等）被拒

### 7.2 静默失败的教训
- **所有 try-catch 吞掉错误的 IO 代码都是隐患**：成功/失败完全不可见
- 排查这类问题：先加**可见的诊断输出**（写日志/console），确认「代码真的跑了、真的失败了」，而不是猜
- **运行时探测 > 静态推断**：用 staging 工具（dev_stage_add/call）在真实 DSH 环境里实测 fs 行为，比读源码猜更快更准

### 7.3 诊断工具模式（本次实战有效）
```js
// 挂后侧诊断工具（dev_stage_add）
execute: function (args, ctx) {
  var fsSvc = ctx.get('fs')
  // 返回字符串（避免对象序列化变 [object Object]）
  return fsSvc.resolve(path).then(...).then(...)
}
// dev_stage_call 调用 → 看真实输出
```
要点：返回**字符串**而非对象（框架会序列化对象成 [object Object]）；异步用 Promise 链。

### 7.4 DSH 插件加载路径（排查确认）
- profile 配置：profiles/web/cordis.patch.yml → insert dsh-mattpocock-skills-deck // 旧名 dsh-waystation（v1.7.1 前）
- 包位置：profiles/web/node_modules/dsh-mattpocock-skills-deck/lib/index.js（nodeLinker: hoisted，实际以真实目录存在） // 旧路径 dsh-waystation 已归档
- 验证加载：dev_plugin_status 列出 loader entries（entry 路径即真实加载文件）

## 8. 已知局限 / 后续改进（不阻塞，待拍板）

1. **缓存目录依赖 DSH 进程 cwd**：换启动方式（如手动 dsh web）会变 cwd → 缓存目录变 → 缓存静默失效。正解是用 DSH storage 服务（不受沙箱限制），但探测时 ctx.get('storage') 方法为 undefined（RPC 壳），需进一步调研。
2. **AppData 是系统可清理区**：磁盘清理可能删缓存（无害，只是重新全量加载一次）。
3. **版本对齐**：profile package.json 声明 dsh-mattpocock-skills-deck: 1.7.1，实际内容一致 —— 若声明仍为 dsh-waystation: 1.3.2 且内容为旧 v1.5，属迁移前残留，执行 `dsh plugin --profile web add dsh-mattpocock-skills-deck@latest --registry https://registry.npmjs.org` 对齐。

## 9. 相关 commit

- 17158102 · inject 加 fs
- b154abd3 · writeDiskCache resolve 契约修复
- ea0b59dd · 缓存目录改 DSH 进程 cwd + 移除诊断