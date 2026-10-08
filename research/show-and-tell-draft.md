# Show and tell 初稿（给 #913，英文在前、中文在后）

> 状态：初稿 + humanizer 自查完成，待 #914 渲染预览与发布。
> 英文 345 词（上限 350），中文约 530 字（区间 500–700）。
> 图片限宽 600，放在对应段落旁边。英文段用 3 张英文图，中文段沿用 02/03/05/07 中文图。

## 英文段（直接粘贴）

MattSkillsDeck: a task board inside DSH for working with Matt's skills

Hi, I use Matt's skills every day through DSH (DeepSeek Harness, the chat front end where an AI agent does the work). Two frictions kept coming back. I had to remember each slash command and type it by hand. The state of my work, which tasks were ready and which were blocked, lived on the GitHub page a context switch away. So I made MattSkillsDeck, a personal plugin that turns the skills and their issues into a panel next to the chat. This is my own side project and has no official connection with Matt. I would like to hear if it fits the way you work.

The main view is a task board. It lists every issue in the repo with filters for all, open, blocked and closed. Map rows stay pinned. Each row carries a button that already knows the next step: diagnose, fix, discuss, or execute. Clicking fills the prepared command into the input box, and I confirm before anything runs.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E5%8F%B3%E4%BE%A7%E9%9D%A2%E6%9D%BF-%E6%95%B4%E4%BD%93%E9%A2%84%E8%A7%88-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Task board panel in English">

(The card titles in this shot are my own Chinese backlog; the panel around them is English.)

Under each input box sits a capsule with live counts: ready, bugs, triage, handoff, environment checks. Each segment jumps to the matching panel page and back, so checking status never breaks the session.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E7%8A%B6%E6%80%81%E8%83%B6%E5%9B%8A-%E5%AF%B9%E8%AF%9D%E6%A1%86-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Status capsule under the input box">

Opening a row shows the description, labels, assignee and comments, with a reply box right there. New session opens a clean session with the follow-up command already filled in. A backend switcher moves between GitHub, local Markdown files and GitLab without losing data. Sessions rename themselves as work takes shape, long sessions hand over through a generated doc, and all 27 skills are one click away in the Skills tab.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E8%83%B6%E5%9B%8A%E7%8A%B6%E6%80%81%E6%A0%8F-issue%E5%A4%84%E7%90%86%E8%B7%AF%E5%BE%84-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Session activity in English">

Install, after DSH is present:

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

Then restart that DSH entry. Desktop app users replace --profile web with --profile desktop. Repo: https://github.com/FeatherHunter/dsh-mattpocock-skills-deck

Thanks to Matt for the skills. If you try it, tell me which part helped and which part got in the way.

## 中文段（直接粘贴）

MattSkillsDeck：在 DSH 里给 Matt 的技能配一块任务板

我每天在 DSH（DeepSeek Harness，一个我打字、AI 干活的聊天前端）里用 Matt 的技能。有两个小麻烦一直没走：每个斜杠指令都要自己记住、亲手敲；手头活的状态（哪些能接、哪些被卡住）躺在 GitHub 网页上，看一眼就要切出去。所以我做了 MattSkillsDeck，一个把技能和工单变成侧边面板的个人插件，和 Matt 没有官方关系。想听听它跟你的干活方式合不合。

主视图是一块任务板，列出仓库里所有工单，能按全部、开放、被阻塞、已关闭筛。地图行置顶，已关闭的工单收成一行，不占地方。每行有个按钮，上面已经写好下一步：没分流的给诊断，缺陷给修复，要商量的给讨论，普通任务给执行。点一下，写好的指令填进输入框，人确认后再发。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/02-task-board-list.png" width="600" alt="任务板列表">

每个输入框下面有一条胶囊，挂着实时数字：可接、缺陷、分流、交接、环境检查，数字和面板里看到的任务对得上，不用自己数。点每段跳到对应面板页，看完回来，正在聊的会话不断。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/03-statusbar-capsule.png" width="600" alt="底部任务栏胶囊">

点开一行，描述、标签、认领人、评论排好版，底下直接回话。网络不好时页面会明说失败并给重试，不会一片空白。新会话按钮另起干净会话，跟进指令已经预填。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/05-new-session-prefilled.png" width="600" alt="新会话预填指令">

设置页能换跑道：GitHub、本地 Markdown 文件、GitLab，数据不丢。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/07-backend-switch.png" width="600" alt="多后端切换">

会话标题随着进展自己改名，长会话靠交接文档续上。27 个技能在技能页一点即用，顶部还会按当前打开的地图推荐一个。我现在每天先看一眼胶囊再开工。

安装（先装好 DSH）：

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

装完重启一次对应入口就生效，不用额外配置。桌面应用用户把 --profile web 换成 --profile desktop。仓库：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck

谢谢 Matt 的技能让我有东西可搭。如果你装上试了，告诉我哪块省了事、哪块碍了事。

## humanizer 自查记录（2026-10-08，技能版本 3.1.0）

- 全文读一遍标出的痕迹：初稿里有一处“不是…而是…”式对比、一处三并列收尾、一处破折号解释，已逐处改成直接陈述。
- 修字数时顺手又压掉一批修饰：full、at the top、corresponding 等只加重量的词，没有动事实。
- 结构检查：没有加粗小标题，没有 staged 开场，没有每段重复的一句话收尾；结尾邀反馈是票里定好的功能，不是装饰。
- 事实核对：27 个技能、两行安装命令、仓库链接、三张英文图与 02/03/05/07 中文图，均与备料清单一致，没有新增数字与断言。
- 大声读一遍：句子长短错开，英文没有连续三句同一开头，中文没有连续排比。
