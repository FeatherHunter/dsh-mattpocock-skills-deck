#!/usr/bin/env node
// scripts/generate-1586-capability-ledger.mts --- 版本管理页能力账本的生成器（#1737 票 T02 立，规格 #1586）
//
// 生成什么：src/shared/version-control/src/capability-ledger.ts --- 规格第 11 节 162 条能力矩阵的
// 单一数据源。界面渲染、命令面板、覆盖验收与测试都从这份账本读，不在别处再抄一份 id、名称、
// 命令原文或统计数字。
//
// 为什么由生成器写出、而不是直接手写账本：账本是「规格矩阵 + 原型数据 + 页面/版本/替代路径三张
// 对照表」拼出来的派生文件。手写会漏、会飘，改一条要同时改五处；放在生成器里，数据表改一行，
// 重跑一次就对。门禁 tests/verify-1586-capability-ledger.ts 会跑 --check，对不上就是红。
//
// 数据从哪来（没有外部文件可读，生成器自带这几张表；改规格时两边一起改并重跑）：
//   · LAYOUT：逐字抄自规格 #1586 第 11 节「能力矩阵（162 条逐条落点）」的表格，列 =
//     能力号 | 能力 | git 命令（原文） | 级别 | 落点 | 终局 | 主入口 | 研究依据；级别与落点取
//     #1590 原型数据，名称、命令原文、终局、主入口、研究依据取规格矩阵。
//   · VERSION_NOTES：规格第 6 节「版本适配」的已知最低版本与面板降级/隐藏策略；
//   · PANEL_PATHS：规格第 11 节之后那段「面板替代路径」的五行说明；
//   · DOMAINS / PAGES：14 个域的中文名与 16 个页面的登记表（页面按界面结构分页签 / 管理分区 /
//     二级页 / 全局面）。
//
// 用法（在仓库根目录跑）：
//   node scripts/generate-1586-capability-ledger.mts            按数据表重写账本；
//   node scripts/generate-1586-capability-ledger.mts --check    只比对不写；对不上退出码 1，
//       门禁与 npm run typecheck 都靠它看门。
//
// 域票扩展点（#1738 起的实施票）：账本只描述「有哪些能力、落在哪、要什么版本」；具体写命令的
// 判定与解析在 rules.ts / parse-*.ts。给某条能力补实现时不要在这里加行为字段——这里只登记
// 规格矩阵里确实有的列；新增能力必须先改规格矩阵，再改本文件的 LAYOUT 并重跑。
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const ROOT: string = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const LEDGER_REL: string = 'src/shared/version-control/src/capability-ledger.ts'
const GENERATOR_REL: string = 'scripts/generate-1586-capability-ledger.mts'
const OUT_PATH: string = path.join(ROOT, LEDGER_REL)

// 14 个域的中文名：域号就是能力号的前半段，页面与命令面板按这个分组。
const DOMAINS: Record<number, string> = {
  1: '工作区与暂存',
  2: '提交',
  3: '历史查看',
  4: '引用与标签',
  5: '历史改写',
  6: '合并、变基与冲突',
  7: '贮藏',
  8: '远端与同步',
  9: '工作树与多开',
  10: '子模组',
  11: '仓库维护与迁移',
  12: '配置与钩子',
  13: '调试与底层',
  14: '托管平台与邮件边界',
}

// 16 个页面：id | 中文名 | 类型 | 这个页面对应的主入口。每个主入口恰好一个页面，不许有页面没人去。
const PAGES: Array<[string, string, string, string]> = [
  ['changes', '改动页', '页签', '改动页'],
  ['commits', '提交历史页', '页签', '提交历史页'],
  ['worktrees', '工作树页', '页签', '工作树页'],
  ['stash', '贮藏页', '页签', '贮藏页'],
  ['branch-tags', '管理·分支与标签', '管理分区', '分支与管理'],
  ['remote', '管理·远端与同步', '管理分区', '远端与同步'],
  ['submodules', '管理·子模组', '管理分区', '管理·子模组'],
  ['maintenance', '管理·维护', '管理分区', '管理·维护'],
  ['migrate', '管理·迁移', '管理分区', '管理·迁移'],
  ['config', '管理·配置', '管理分区', '管理·配置'],
  ['hooks', '管理·钩子', '管理分区', '管理·钩子'],
  ['diagnostics', '管理·诊断', '管理分区', '管理·诊断'],
  ['platform', '管理·平台与边界', '管理分区', '管理·平台与边界'],
  ['rebase', '变基待办', '二级页', '变基待办'],
  ['conflicts', '冲突向导', '二级页', '冲突向导'],
  ['search', '全库搜索', '全局面', '全库搜索'],
]

// 规格第 6 节「版本适配」的已知最低版本与降级/隐藏策略：能力号 -> [最低版本, 策略, 低版本时的替代说明]。
// 表里没有的能力一律按 2.11 硬底线处理。策略只有两种：degrade（给替代做法）、hide（藏起来）。
const VERSION_NOTES: Record<string, [string, string, string]> = {
  '1.5': ['2.23', 'degrade', '2.23 以下改用 git reset HEAD -- <路径> 撤回暂存'],
  '1.6': ['2.23', 'degrade', '2.23 以下改用 git checkout -- <路径> 丢弃这一个文件的未暂存改动'],
  '1.7': ['2.23', 'degrade', '2.23 以下改用 git checkout -- . 丢弃全部未暂存改动'],
  '4.2': ['2.23', 'degrade', '2.23 以下改用 git checkout -b 新建并切换分支'],
  '4.3': ['2.23', 'degrade', '2.23 以下改用 git checkout 切换分支'],
  '4.4': ['2.23', 'degrade', '2.23 以下改用 git checkout <提交号> 切到某个提交'],
  '5.9': ['2.38', 'hide', '面板不做：交互变基时逐个分支挪指针'],
  '6.10': ['2.38', 'hide', '不预演直接合并，冲突交给冲突向导处理'],
  '7.3': ['2.35', 'hide', '先做一次全量贮藏，再恢复未暂存的部分'],
  '8.12': ['2.30', 'degrade', '2.11 到 2.29 的租约强推可用，但少一道 --force-if-includes 保护'],
  '9.4': ['2.17', 'hide', '2.17 以下在终端删除目录，再用清除失效登记收尾'],
  '9.5': ['2.31', 'hide', '2.31 以下读不到失效登记，在终端跑 git worktree prune'],
  '9.6': ['2.31', 'degrade', '2.31 以下读不到锁定标记，按未知显示，锁定动作照常'],
  '9.7': ['2.17', 'hide', '2.17 以下在终端移动目录，再跑 git worktree repair'],
  '9.8': ['2.25', 'hide', '2.25 以下在终端使用 git sparse-checkout'],
  '11.8': ['2.30', 'hide', '2.30 以下用垃圾回收代替自动维护'],
  '11.9': ['2.18', 'hide', '2.18 以下在终端查看提交图'],
  '11.10': ['2.21', 'hide', '2.21 以下在终端查看多包索引'],
  '12.6': ['2.36', 'hide', '2.36 以下在终端直接执行钩子文件'],
}

// 规格第 11 节之后的面板替代路径说明：能力号 -> 面板里的替代做法（这几条不推外部工具）。
const PANEL_PATHS: Record<string, string> = {
  '2.7': '用面板内多行编辑写提交说明，不推外部编辑器',
  '5.11': '用 filter-repo 五张结构化表单；filter-branch 本体只读',
  '6.7': '用冲突向导的多行编辑处理冲突，不推外部编辑器',
  '6.9': '用冲突向导的面板冲突视图，不调用 mergetool',
  '13.14': '用提交历史页的图形化视图，不调用 gitk；管理 › 平台与边界页只放一条说明指回历史页',
}

// 能力矩阵：逐行抄自规格 #1586（162 条，一条不能少）。
const LAYOUT: string = String.raw`
1.1 | 看工作区状态 | git status --porcelain=v2 --branch -z | 读 | 直 | 操作 | 改动页 | 1588 §2-域1
1.2 | 逐块暂存 | git add -p（面板等价于读 diff 后 apply --cached） | 写 | 折 | 操作 | 改动页 | 1588 §2-域1
1.3 | 暂存单个文件 | git add -- <path> | 写 | 直 | 操作 | 改动页 | 1588 §2-域1
1.4 | 暂存全部 | git add -A | 写 | 直 | 操作 | 改动页 | 1588 §2-域1
1.5 | 撤回暂存 | git restore --staged -- <path> | 写 | 直 | 操作 | 改动页 | 1588 §2-域1
1.6 | 丢弃单个文件的未暂存改动 | git restore -- <path> | 毁 | 直 | 操作 | 改动页 | 1588 §2-域1
1.7 | 丢弃全部未暂存改动 | git restore -- . | 毁 | 直 | 操作 | 改动页 | 1588 §2-域1
1.8 | 删除未跟踪文件 | git clean -fd -- <path> | 毁 | 直 | 操作 | 改动页 | 1588 §2-域1
1.9 | 删除已跟踪文件 | git rm -- <path> | 写 | 直 | 操作 | 改动页 | 1588 §2-域1
1.10 | 只停止跟踪、保留磁盘文件 | git rm --cached -- <path> | 写 | 折 | 操作 | 改动页 | 1588 §2-域1
1.11 | 重命名或移动 | git mv <old> <new> | 写 | 折 | 操作 | 改动页 | 1588 §2-域1
1.12 | 加进忽略清单 | gitignore + git check-ignore -v | 写 | 直 | 操作 | 改动页 | 1588 §2-域1
1.13 | 查这条路径为什么被忽略 | git check-ignore -v | 读 | 诊 | 只读 | 改动页 | 1588 §2-域1
2.1 | 提交已暂存内容 | git commit -m | 写 | 直 | 操作 | 改动页 | 1588 §2-域2
2.2 | 提交全部已跟踪改动 | git commit -a -m | 写 | 折 | 操作 | 改动页 | 1588 §2-域2
2.3 | 修订上一条提交 | git commit --amend（可只改说明） | 改写 | 直 | 操作 | 改动页 | 1588 §2-域2
2.4 | 生成 fixup / squash 提交 | git commit --fixup / --squash | 写 | 折 | 操作 | 改动页 | 1588 §2-域2
2.5 | 跳过提交钩子 | git commit --no-verify | 写 | 折 | 操作 | 改动页 | 1588 §2-域2
2.6 | 签名提交 / 追加签名行 | git commit -S / -s | 写 | 折 | 操作 | 改动页 | 1588 §2-域2
2.7 | 用编辑器写完整说明 | git commit（不带 -m） | 写 | 外 | 操作 | 改动页 | 1588 §2-域2；1593
2.8 | 套用提交说明模板 | git commit 的 commit.template | 写 | 折 | 操作 | 改动页 | 1588 §2-域2
3.1 | 提交列表 | git log | 读 | 直 | 操作 | 提交历史页 | 1588 §2-域3
3.2 | 单条提交详情 | git show | 读 | 直 | 操作 | 提交历史页 | 1588 §2-域3
3.3 | 提交内逐文件差异 | git show <oid> -- <path>（根提交加 --root） | 读 | 折 | 操作 | 提交历史页 | 1588 §2-域3
3.4 | 单文件历史 | git log --follow -- <path> | 读 | 折 | 操作 | 提交历史页 | 1588 §2-域3
3.5 | 行级追溯 | git blame -L | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域3
3.6 | 按说明搜提交 | git log --grep -i | 读 | 折 | 操作 | 提交历史页 | 1588 §2-域3
3.7 | 按代码变化搜提交 | git log -S / -G | 读 | 折 | 操作 | 提交历史页 | 1588 §2-域3
3.8 | 比较两个引用 | git diff a..b / a...b | 读 | 折 | 操作 | 提交历史页 | 1588 §2-域3
3.9 | 两组提交对照 | git range-diff | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域3
3.10 | 版本名 | git describe --tags --dirty --always | 读 | 直 | 操作 | 提交历史页 | 1588 §2-域3
3.11 | 引用日志 | git reflog show | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域3
3.12 | 提交备注 | git notes show | 读 | 折 | 操作 | 提交历史页 | 1588 §2-域3
3.13 | 取某版本的文件内容 | git show <rev>:<path> | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域3
4.1 | 分支列表 | git branch -vv / git for-each-ref | 读 | 直 | 操作 | 分支与管理 | 1588 §2-域4
4.2 | 新建并切换 | git switch -c | 写 | 直 | 操作 | 分支与管理 | 1588 §2-域4
4.3 | 切换分支 | git switch | 写 | 直 | 操作 | 分支与管理 | 1588 §2-域4
4.4 | 切到某提交（分离头指针） | git switch --detach | 写 | 折 | 操作 | 分支与管理 | 1588 §2-域4
4.5 | 重命名分支 | git branch -m | 写 | 直 | 操作 | 分支与管理 | 1588 §2-域4
4.6 | 删除分支 | git branch -d / -D | 改写 | 直 | 操作 | 分支与管理 | 1588 §2-域4
4.7 | 设置或取消上游 | git branch -u / --unset-upstream | 写 | 直 | 操作 | 分支与管理 | 1588 §2-域4
4.8 | 哪些分支已并入 | git branch --merged / --no-merged | 读 | 诊 | 只读 | 分支与管理 | 1588 §2-域4
4.9 | 标签列表 | git tag -l | 读 | 折 | 操作 | 分支与管理 | 1588 §2-域4
4.10 | 建标签 | git tag（轻量）/ -a（附注）/ -s（签名） | 写 | 折 | 操作 | 分支与管理 | 1588 §2-域4
4.11 | 删标签 | git tag -d | 毁 | 折 | 操作 | 分支与管理 | 1588 §2-域4
4.12 | 验签 | git verify-commit / git verify-tag | 读 | 诊 | 只读 | 分支与管理 | 1588 §2-域4
4.13 | 分支说明 | git branch --edit-description | 写 | 外 | 操作 | 分支与管理 | 1588 §2-域4；1593
5.1 | 撤销上一条提交、改动回到「已暂存」 | git reset --soft HEAD~1 | 改写 | 直 | 操作 | 变基待办 | 1588 §2-域5
5.2 | 撤销提交并取消暂存 | git reset HEAD~1 | 改写 | 折 | 操作 | 变基待办 | 1588 §2-域5
5.3 | 硬重置到某提交 | git reset --hard | 毁 | 折 | 操作 | 变基待办 | 1588 §2-域5
5.4 | 还原提交 | git revert | 写 | 直 | 操作 | 变基待办 | 1588 §2-域5
5.5 | 拣选提交 | git cherry-pick | 写 | 直 | 操作 | 变基待办 | 1588 §2-域5
5.6 | 交互式变基（最小集：改说明、压缩、丢弃、重排） | git rebase -i | 改写 | 折 | 操作 | 变基待办 | 1588 §2-域5
5.7 | 换基座 | git rebase --onto | 改写 | 折 | 操作 | 变基待办 | 1588 §2-域5
5.8 | 自动吸收 fixup / squash | git rebase -i --autosquash | 改写 | 折 | 操作 | 变基待办 | 1588 §2-域5
5.9 | 同步其他分支指针 | git rebase --update-refs | 改写 | 折 | 说明 | 管理·平台与边界 | 1588 §2-域5；1593
5.10 | 保留合并结构 | git rebase --rebase-merges | 改写 | 折 | 操作 | 变基待办 | 1588 §2-域5
5.11 | 批量重写历史 | git filter-branch | 毁 | 外 | 操作 | 管理·维护 | 1588 §2-域5；1593
5.12 | 替换对象 | git replace | 改写 | 外 | 操作 | 管理·诊断 | 1588 §2-域5；1593
5.13 | 导出 / 导入历史 | git fast-export / git fast-import | 毁 | 外 | 操作 | 管理·迁移 | 1588 §2-域5；1593
6.1 | 合并分支 | git merge | 写 | 直 | 操作 | 冲突向导 | 1588 §2-域6
6.2 | 只允许快进 | git merge --ff-only | 写 | 直 | 操作 | 冲突向导 | 1588 §2-域6
6.3 | 禁止快进 | git merge --no-ff | 写 | 折 | 操作 | 冲突向导 | 1588 §2-域6
6.4 | 挤压合并 | git merge --squash | 写 | 折 | 操作 | 冲突向导 | 1588 §2-域6
6.5 | 冲突文件清单 | git status / git diff --diff-filter=U | 读 | 直 | 操作 | 冲突向导 | 1588 §2-域6
6.6 | 整文件选一边 | git checkout --ours / --theirs | 写 | 折 | 操作 | 冲突向导 | 1588 §2-域6
6.7 | 手工编辑冲突 | 外部编辑器 | 写 | 外 | 操作 | 冲突向导 | 1588 §2-域6；1593
6.8 | 标记已解决 | git add -- <path> | 写 | 直 | 操作 | 冲突向导 | 1588 §2-域6
6.9 | 外部合并工具 | git mergetool | 写 | 外 | 操作 | 冲突向导 | 1588 §2-域6；1593
6.10 | 预演合并 | git merge-tree --write-tree | 读 | 诊 | 只读 | 冲突向导 | 1588 §2-域6
6.11 | 继续 | --continue（merge / rebase / cherry-pick / revert / am 共用） | 写 | 直 | 操作 | 冲突向导 | 1588 §2-域6
6.12 | 跳过这一步 | --skip | 写 | 折 | 操作 | 冲突向导 | 1588 §2-域6
6.13 | 中止 | --abort | 写 | 直 | 操作 | 冲突向导 | 1588 §2-域6
6.14 | 复用冲突解法 | git rerere | 读 | 诊 | 只读 | 冲突向导 | 1588 §2-域6
6.15 | 提交前查残留标记 | git diff --check | 读 | 诊 | 只读 | 冲突向导 | 1588 §2-域6
7.1 | 把当前改动贮藏起来 | git stash push -m | 写 | 直 | 操作 | 贮藏页 | 1588 §2-域7
7.2 | 连未跟踪文件一起贮藏 | git stash push -u | 写 | 折 | 操作 | 贮藏页 | 1588 §2-域7
7.3 | 只贮藏已暂存的文件 | git stash push --staged | 写 | 折 | 操作 | 贮藏页 | 1588 §2-域7
7.4 | 列出 | git stash list | 读 | 直 | 操作 | 贮藏页 | 1588 §2-域7
7.5 | 看内容 | git stash show -p | 读 | 折 | 操作 | 贮藏页 | 1588 §2-域7
7.6 | 应用并保留记录 | git stash apply | 写 | 直 | 操作 | 贮藏页 | 1588 §2-域7
7.7 | 应用并删记录 | git stash pop | 写 | 直 | 操作 | 贮藏页 | 1588 §2-域7
7.8 | 从贮藏建分支 | git stash branch | 写 | 折 | 操作 | 贮藏页 | 1588 §2-域7
7.9 | 删记录 | git stash drop | 毁 | 直 | 操作 | 贮藏页 | 1588 §2-域7
7.10 | 全清 | git stash clear | 毁 | 折 | 操作 | 贮藏页 | 1588 §2-域7
8.1 | 远端列表 | git remote -v | 读 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.2 | 新增 / 改名 / 删除远端 | git remote add / rename / remove | 写 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.3 | 改地址 | git remote set-url | 写 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.4 | 看远端分支与标签 | git ls-remote / git branch -r | 读 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.5 | 获取 | git fetch [--all] [--prune] [--tags] | 写 | 直 | 操作 | 远端与同步 | 1588 §2-域8
8.6 | 拉取并合并 | git pull | 写 | 直 | 操作 | 远端与同步 | 1588 §2-域8
8.7 | 拉取并变基 | git pull --rebase | 改写 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.8 | 只允许快进 | git pull --ff-only | 写 | 直 | 操作 | 远端与同步 | 1588 §2-域8
8.9 | 推送当前分支 | git push | 写 | 直 | 操作 | 远端与同步 | 1588 §2-域8
8.10 | 首次推送并设上游 | git push -u | 写 | 直 | 操作 | 远端与同步 | 1588 §2-域8
8.11 | 删远端分支 / 标签 | git push --delete | 毁 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.12 | 强推（带租约） | git push --force-with-lease | 毁 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.13 | 原子推送 | git push --atomic | 写 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.14 | 推送标签 | git push --follow-tags / --tags | 写 | 折 | 操作 | 远端与同步 | 1588 §2-域8
8.15 | 认证与凭据 | git credential / git-credential-cache / git-credential-store | 写 | 外 | 只读 | 管理·平台与边界 | 1588 §2-域8；1593
8.16 | 克隆 | git clone | 写 | 外 | 操作 | 管理·迁移 | 1588 §2-域8；1593
9.1 | 工作树列表 | git worktree list | 读 | 直 | 操作 | 工作树页 | 1588 §2-域9
9.2 | 新建工作树 | git worktree add | 写 | 折 | 操作 | 工作树页 | 1588 §2-域9
9.3 | 用已有分支建工作树 | git worktree add <path> <branch> | 写 | 折 | 操作 | 工作树页 | 1588 §2-域9
9.4 | 删除工作树 | git worktree remove | 毁 | 直 | 操作 | 工作树页 | 1588 §2-域9
9.5 | 清除失效登记 | git worktree prune | 写 | 直 | 操作 | 工作树页 | 1588 §2-域9
9.6 | 锁 / 解锁 | git worktree lock / unlock | 写 | 折 | 操作 | 工作树页 | 1588 §2-域9
9.7 | 移动工作树 | git worktree move | 写 | 折 | 操作 | 工作树页 | 1588 §2-域9
9.8 | 稀疏检出 | git sparse-checkout | 写 | 折 | 操作 | 工作树页 | 1588 §2-域9
10.1 | 列表与状态 | git submodule status | 读 | 折 | 操作 | 管理·子模组 | 1588 §2-域10
10.2 | 新增子模组 | git submodule add | 写 | 折 | 操作 | 管理·子模组 | 1588 §2-域10
10.3 | 初始化并检出 | git submodule update --init [--recursive] | 写 | 折 | 操作 | 管理·子模组 | 1588 §2-域10
10.4 | 批量执行 | git submodule foreach | 写 | 外 | 操作 | 管理·子模组 | 1588 §2-域10；1593
10.5 | 改地址 / 同步 | git submodule set-url / sync | 写 | 折 | 操作 | 管理·子模组 | 1588 §2-域10
10.6 | 改跟踪分支 | git submodule set-branch --branch | 写 | 折 | 操作 | 管理·子模组 | 1588 §2-域10
10.7 | 取消登记 | git submodule deinit | 毁 | 折 | 操作 | 管理·子模组 | 1588 §2-域10
10.8 | 吸收子模组的 .git | git submodule absorbgitdirs | 写 | 诊 | 操作 | 管理·子模组 | 1588 §2-域10；本次裁决改为受控写
11.1 | 初始化仓库 | git init [--bare] | 写 | 外 | 操作 | 管理·迁移 | 1588 §2-域11；1593
11.2 | 检查完整性 | git fsck | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域11
11.3 | 找还能捞回来的对象 | git fsck --unreachable / --lost-found | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域11
11.4 | 统计对象与体积 | git count-objects -vH | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域11
11.5 | 垃圾回收 | git gc | 写 | 折 | 操作 | 管理·维护 | 1588 §2-域11
11.6 | 清除不可达对象 | git prune | 毁 | 折 | 操作 | 管理·维护 | 1588 §2-域11
11.7 | 重新打包 | git repack | 写 | 诊 | 只读 | 管理·维护 | 1588 §2-域11
11.8 | 自动维护 | git maintenance run / start / stop / register | 写 | 外 | 操作 | 管理·维护 | 1588 §2-域11；1593
11.9 | 提交图 | git commit-graph | 写 | 诊 | 只读 | 管理·维护 | 1588 §2-域11
11.10 | 多包索引 | git multi-pack-index | 写 | 诊 | 只读 | 管理·维护 | 1588 §2-域11
11.11 | 打包引用 | git pack-refs | 写 | 诊 | 只读 | 管理·维护 | 1588 §2-域11
11.12 | 归档导出 | git archive | 写 | 外 | 操作 | 管理·迁移 | 1588 §2-域11；1593
11.13 | 离线包 | git bundle create / verify / unbundle | 写 | 外 | 操作 | 管理·迁移 | 1588 §2-域11；1593
11.14 | 引用存储格式迁移 | git refs migrate | 毁 | 外 | 只读 | 管理·维护 | 1588 §2-域11；1593
11.15 | 大仓库工具 | scalar | 写 | 外 | 只读 | 管理·维护 | 1588 §2-域11；1593
12.1 | 读配置 | git config --list --show-origin | 读 | 诊 | 只读 | 管理·配置 | 1588 §2-域12
12.2 | 写配置 | git config set | 写 | 折 | 操作 | 管理·配置 | 1588 §2-域12
12.3 | 删配置 | git config unset | 写 | 折 | 操作 | 管理·配置 | 1588 §2-域12
12.4 | 身份 | git config user.name / user.email | 写 | 折 | 操作 | 管理·配置 | 1588 §2-域12
12.5 | 钩子清单 | githooks + core.hooksPath | 读 | 诊 | 只读 | 管理·钩子 | 1588 §2-域12
12.6 | 手动跑一个钩子 | git hook run | 写 | 折 | 操作 | 管理·钩子 | 1588 §2-域12
12.7 | 属性规则 | git check-attr / gitattributes | 读 | 诊 | 只读 | 管理·配置 | 1588 §2-域12
12.8 | 邮件映射 | git check-mailmap / gitmailmap | 读 | 诊 | 只读 | 管理·配置 | 1588 §2-域12
13.1 | 二分查找 | git bisect start / bad / good / skip / reset | 写 | 折 | 操作 | 管理·诊断 | 1588 §2-域13
13.2 | 二分可视化 / 重放 | git bisect visualize / replay | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.3 | 按内容搜工作区 | git grep | 读 | 折 | 操作 | 全库搜索 | 1588 §2-域13
13.4 | 按条件列文件 | git ls-files | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.5 | 看对象内容 | git cat-file -p / -t | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.6 | 看树 | git ls-tree | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.7 | 解析引用与路径 | git rev-parse | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.8 | 枚举引用 | git for-each-ref | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.9 | 包含关系 | git merge-base --is-ancestor | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.10 | 补丁等价 | git cherry / git patch-id | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.11 | 计数与左右差 | git rev-list --count / --left-right | 读 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.12 | 应用补丁 | git apply --check / --3way | 写 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.13 | 尾部签名 | git interpret-trailers | 写 | 诊 | 只读 | 管理·诊断 | 1588 §2-域13
13.14 | 图形历史浏览器 | gitk | 读 | 外 | 操作 | 提交历史页 | 1588 §2-域13；1593
14.1 | 生成补丁邮件 | git format-patch | 写 | 外 | 操作 | 管理·迁移 | 1588 §2-域14；1593
14.2 | 发补丁邮件 | git send-email | 写 | 外 | 说明 | 管理·平台与边界 | 1588 §2-域14；1593
14.3 | 请求拉取的说明 | git request-pull | 读 | 诊 | 只读 | 管理·平台与边界 | 1588 §2-域14
14.4 | PR / Issue / Release |  | 非 git | 外 | 说明 | 管理·平台与边界 | 1588 §2-域14；1593
14.5 | Actions / CI 状态 |  | 非 git | 外 | 说明 | 管理·平台与边界 | 1588 §2-域14；1593
14.6 | 账号与权限 |  | 非 git | 外 | 说明 | 管理·平台与边界 | 1588 §2-域14；1593
14.7 | 分支保护 / 禁止强推 |  | 非 git | 外 | 说明 | 管理·平台与边界 | 1588 §2-域14；1593
14.8 | 仓库转移 / 归档 |  | 非 git | 外 | 说明 | 管理·平台与边界 | 1588 §2-域14；1593
`

interface LedgerRow {
  id: string
  name: string
  command: string
  level: string
  placement: string
  finalForm: string
  primaryEntry: string
  basis: string
}

interface Capability {
  id: string
  domain: number
  domainName: string
  name: string
  command: string
  level: string
  placement: string
  finalForm: string
  primaryEntry: string
  page: string
  panelPath: string | null
  minVersion: string
  versionPolicy: string | null
  versionAlternative: string | null
  researchBasis: string
}

const LEVELS: string[] = ['读', '写', '毁', '改写', '非 git']
const PLACEMENTS: string[] = ['直', '折', '诊', '外']
const FINAL_FORMS: string[] = ['操作', '只读', '说明']
const FLOOR: string = '2.11'
const EXPECTED_LEVEL: Record<string, number> = { '读': 48, '写': 83, '毁': 15, '改写': 11, '非 git': 5 }
const EXPECTED_PLACEMENT: Record<string, number> = { '直': 42, '折': 62, '诊': 34, '外': 24 }
const EXPECTED_FINAL_FORM: Record<string, number> = { '操作': 119, '只读': 36, '说明': 7 }

const PAGE_BY_ENTRY: Record<string, string> = {}
for (const page of PAGES) PAGE_BY_ENTRY[page[3]] = page[0]

function parseLayout(text: string): LedgerRow[] {
  const rows: LedgerRow[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const cells = line.split(' | ')
    if (cells.length !== 8) throw new Error('LAYOUT 行字段数不是 8：' + line)
    rows.push({ id: cells[0], name: cells[1], command: cells[2], level: cells[3], placement: cells[4], finalForm: cells[5], primaryEntry: cells[6], basis: cells[7] })
  }
  return rows
}

function countBy(list: Capability[], pick: (cap: Capability) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const cap of list) {
    const key = pick(cap)
    out[key] = (out[key] || 0) + 1
  }
  return out
}

function sameCounts(got: Record<string, number>, expected: Record<string, number>): boolean {
  const names = Object.keys(expected)
  if (Object.keys(got).length !== names.length) return false
  for (const name of names) if (got[name] !== expected[name]) return false
  return true
}

function buildCapabilities(rows: LedgerRow[]): Capability[] {
  return rows.map((row) => {
    const domain = Number(row.id.split('.')[0])
    const page = PAGE_BY_ENTRY[row.primaryEntry]
    if (!page) throw new Error('主入口没有登记页面：' + row.primaryEntry)
    const note = VERSION_NOTES[row.id]
    return {
      id: row.id,
      domain,
      domainName: DOMAINS[domain],
      name: row.name,
      command: row.command,
      level: row.level,
      placement: row.placement,
      finalForm: row.finalForm,
      primaryEntry: row.primaryEntry,
      page,
      panelPath: PANEL_PATHS[row.id] || null,
      minVersion: note ? note[0] : FLOOR,
      versionPolicy: note ? note[1] : null,
      versionAlternative: note ? note[2] : null,
      researchBasis: row.basis,
    }
  })
}

function validate(rows: LedgerRow[], caps: Capability[]): void {
  if (rows.length !== 162) throw new Error('能力矩阵不是 162 条：' + rows.length)
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('能力号有重复')
  if (caps.length !== 162) throw new Error('能力表不是 162 条：' + caps.length)
  for (const row of rows) {
    const idParts = row.id.split('.')
    if (idParts.length !== 2 || idParts[1] === '0' || String(Number(idParts[1])) !== idParts[1]) throw new Error('能力号形状不对：' + row.id)
    if (!DOMAINS[Number(idParts[0])]) throw new Error('能力号指向没登记的域：' + row.id)
    if (LEVELS.indexOf(row.level) < 0) throw new Error('级别不在允许值里：' + row.id)
    if (PLACEMENTS.indexOf(row.placement) < 0) throw new Error('落点不在允许值里：' + row.id)
    if (FINAL_FORMS.indexOf(row.finalForm) < 0) throw new Error('终局不在允许值里：' + row.id)
  }
  if (!sameCounts(countBy(caps, (cap) => cap.level), EXPECTED_LEVEL)) throw new Error('级别分布与规格数不一致')
  if (!sameCounts(countBy(caps, (cap) => cap.placement), EXPECTED_PLACEMENT)) throw new Error('落点分布与规格数不一致')
  if (!sameCounts(countBy(caps, (cap) => cap.finalForm), EXPECTED_FINAL_FORM)) throw new Error('终局计数与规格数不一致')
}

function capabilityBlock(cap: Capability): string {
  return [
    '  {',
    '    id: ' + JSON.stringify(cap.id) + ',',
    '    domain: ' + String(cap.domain) + ',',
    '    domainName: ' + JSON.stringify(cap.domainName) + ',',
    '    name: ' + JSON.stringify(cap.name) + ',',
    '    command: ' + JSON.stringify(cap.command) + ',',
    '    level: ' + JSON.stringify(cap.level) + ',',
    '    placement: ' + JSON.stringify(cap.placement) + ',',
    '    finalForm: ' + JSON.stringify(cap.finalForm) + ',',
    '    primaryEntry: ' + JSON.stringify(cap.primaryEntry) + ',',
    '    page: ' + JSON.stringify(cap.page) + ',',
    '    panelPath: ' + (cap.panelPath === null ? 'null' : JSON.stringify(cap.panelPath)) + ',',
    '    minVersion: ' + JSON.stringify(cap.minVersion) + ',',
    '    versionPolicy: ' + (cap.versionPolicy === null ? 'null' : JSON.stringify(cap.versionPolicy)) + ',',
    '    versionAlternative: ' + (cap.versionAlternative === null ? 'null' : JSON.stringify(cap.versionAlternative)) + ',',
    '    researchBasis: ' + JSON.stringify(cap.researchBasis) + ',',
    '  },',
  ].join('\n')
}

export function renderLedger(): string {
  const rows = parseLayout(LAYOUT)
  const caps = buildCapabilities(rows)
  validate(rows, caps)
  const lines: string[] = []
  lines.push('// AUTO-GENERATED。来源脚本：scripts/generate-1586-capability-ledger.mts（数据来自规格 #1586 第 11 节 162 条能力矩阵、第 6 节版本条款与 #1590 原型数据）。')
  lines.push('// 不要手改本文件：要改账本先改生成器里的数据表，再重跑生成器；门禁 tests/verify-1586-capability-ledger.ts 会 --check 对账。')
  lines.push('//');
  lines.push('// 这是版本管理页的能力账本，全规格只有这一份数据源：界面渲染、命令面板、覆盖验收与测试都从这里读，');
  lines.push('// 谁在别处再抄一份 id、名称、命令原文或统计数字，门禁会判红。');
  lines.push('//');
  lines.push('// 字段口径（逐条对齐规格 #1586 第 11 节矩阵与第 6 节版本条款）：');
  lines.push('//   id：规格矩阵的能力号（域号.序号），改动记录与票据引用的就是它；');
  lines.push('//   level：读 / 写 / 毁 / 改写 / 非 git，按这个动作对仓库的破坏力分；');
  lines.push('//   placement：直（直接执行）/ 折（收进折叠菜单）/ 诊（诊断读用）/ 外（面板不做，只给说明或替代路径）；');
  lines.push('//   finalForm：操作（面板真能做）/ 只读（面板只显示）/ 说明（面板只解释，命令列为空）；');
  lines.push('//   page：能力落在哪个页面，见 PAGE_SURFACES，命令面板据此带「去这里」；');
  lines.push('//   panelPath：面板替代路径，非空表示这条能力不推外部工具、面板里有对应做法；');
  lines.push('//   minVersion：这条能力要求的最低 git 版本，低于它按 versionPolicy 降级或隐藏；');
  lines.push('//   versionPolicy：degrade（低版本给替代做法）/ hide（低版本藏起来）/ null（2.11 底线内都能用）；');
  lines.push('//   researchBasis：研究依据（1588 第 2 章哪一域，1593 是补充结论）。');
  lines.push('');
  lines.push('export type CapabilityLevel = "读" | "写" | "毁" | "改写" | "非 git"')
  lines.push('export type CapabilityPlacement = "直" | "折" | "诊" | "外"')
  lines.push('export type CapabilityFinalForm = "操作" | "只读" | "说明"')
  lines.push('export type CapabilityVersionPolicy = "degrade" | "hide"')
  lines.push('export type CapabilityPageKind = "页签" | "管理分区" | "二级页" | "全局面"')
  lines.push('export type CapabilityPageId = "changes" | "commits" | "worktrees" | "stash" | "branch-tags" | "remote" | "submodules" | "maintenance" | "migrate" | "config" | "hooks" | "diagnostics" | "platform" | "rebase" | "conflicts" | "search"')
  lines.push('export type PrimaryEntry = "改动页" | "提交历史页" | "工作树页" | "贮藏页" | "分支与管理" | "远端与同步" | "管理·子模组" | "管理·维护" | "管理·迁移" | "管理·配置" | "管理·钩子" | "管理·诊断" | "管理·平台与边界" | "变基待办" | "冲突向导" | "全库搜索"')
  lines.push('');
  lines.push('export interface CapabilityPage {')
  lines.push('  id: CapabilityPageId')
  lines.push('  name: string')
  lines.push('  kind: CapabilityPageKind')
  lines.push('  primaryEntry: PrimaryEntry')
  lines.push('}')
  lines.push('');
  lines.push('export interface Capability {')
  lines.push('  id: string')
  lines.push('  domain: number')
  lines.push('  domainName: string')
  lines.push('  name: string')
  lines.push('  command: string')
  lines.push('  level: CapabilityLevel')
  lines.push('  placement: CapabilityPlacement')
  lines.push('  finalForm: CapabilityFinalForm')
  lines.push('  primaryEntry: PrimaryEntry')
  lines.push('  page: CapabilityPageId')
  lines.push('  panelPath: string | null')
  lines.push('  minVersion: string')
  lines.push('  versionPolicy: CapabilityVersionPolicy | null')
  lines.push('  versionAlternative: string | null')
  lines.push('  researchBasis: string')
  lines.push('}')
  lines.push('');
  lines.push('export const CAPABILITY_TOTAL = 162')
  lines.push('');
  lines.push('export const DOMAIN_NAMES: Record<number, string> = {')
  for (const key of Object.keys(DOMAINS)) lines.push('  ' + key + ': ' + JSON.stringify(DOMAINS[Number(key)]) + ',')
  lines.push('}')
  lines.push('');
  lines.push('export const PAGE_SURFACES: CapabilityPage[] = [')
  for (const page of PAGES) lines.push('  { id: ' + JSON.stringify(page[0]) + ', name: ' + JSON.stringify(page[1]) + ', kind: ' + JSON.stringify(page[2]) + ', primaryEntry: ' + JSON.stringify(page[3]) + ' },')
  lines.push(']')
  lines.push('');
  lines.push('export const PRIMARY_ENTRY_PAGE: Record<PrimaryEntry, CapabilityPageId> = {')
  for (const page of PAGES) lines.push('  ' + JSON.stringify(page[3]) + ': ' + JSON.stringify(page[0]) + ',')
  lines.push('}')
  lines.push('');
  const levelCounts = countBy(caps, (cap) => cap.level)
  const placementCounts = countBy(caps, (cap) => cap.placement)
  const finalFormCounts = countBy(caps, (cap) => cap.finalForm)
  const pageCounts = countBy(caps, (cap) => cap.page)
  lines.push('export const LEVEL_COUNTS: Record<CapabilityLevel, number> = {')
  for (const level of LEVELS) lines.push('  ' + JSON.stringify(level) + ': ' + String(levelCounts[level] || 0) + ',')
  lines.push('}')
  lines.push('');
  lines.push('export const PLACEMENT_COUNTS: Record<CapabilityPlacement, number> = {')
  for (const placement of PLACEMENTS) lines.push('  ' + JSON.stringify(placement) + ': ' + String(placementCounts[placement] || 0) + ',')
  lines.push('}')
  lines.push('');
  lines.push('export const FINAL_FORM_COUNTS: Record<CapabilityFinalForm, number> = {')
  for (const form of FINAL_FORMS) lines.push('  ' + JSON.stringify(form) + ': ' + String(finalFormCounts[form] || 0) + ',')
  lines.push('}')
  lines.push('');
  lines.push('export const PAGE_COUNTS: Record<CapabilityPageId, number> = {')
  for (const page of PAGES) lines.push('  ' + JSON.stringify(page[0]) + ': ' + String(pageCounts[page[0]] || 0) + ',')
  lines.push('}')
  lines.push('');
  const gated = caps.filter((cap) => cap.minVersion !== FLOOR).map((cap) => cap.id)
  lines.push('export const VERSION_GATED_IDS: string[] = [' + gated.map((id) => JSON.stringify(id)).join(', ') + ']')
  lines.push('');
  lines.push('// 162 条能力：界面、命令面板与验收都从这份数组读，别处不再抄一份。')
  lines.push('export const CAPABILITIES: Capability[] = [')
  for (const cap of caps) lines.push(capabilityBlock(cap))
  lines.push(']')
  lines.push('');
  lines.push('export const CAPABILITY_LEDGER_SOURCE = "src/shared/version-control/src/capability-ledger.ts"')
  return lines.join('\n') + '\n'
}

function main(): void {
  const checkOnly = process.argv.slice(2).indexOf('--check') >= 0
  const text = renderLedger()
  if (checkOnly) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error('FAIL 账本还没生成：请先跑 node ' + GENERATOR_REL)
      process.exit(1)
    }
    const current = fs.readFileSync(OUT_PATH, 'utf8')
    if (current !== text) {
      console.error('FAIL 生成源码与生成器数据表对不上：请先跑生成器，命令 node ' + GENERATOR_REL)
      process.exit(1)
    }
    console.log('OK 账本与生成器数据表一致（' + GENERATOR_REL + '）')
    return
  }
  fs.writeFileSync(OUT_PATH, text)
  console.log('已写出 ' + LEDGER_REL)
}

const entry = process.argv[1] ? url.pathToFileURL(process.argv[1]).href : ''
if (entry === import.meta.url) main()
