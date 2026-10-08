# Show and tell 初稿（给 #913，英文在前、中文在后）

> 状态：初稿 + humanizer 自查完成，待 #914 渲染预览与发布。
> 英文 349 词（上限 350），中文 583 字（区间 500–700）。
> 图片限宽 600，放在对应段落旁边。英文段用 3 张英文图，中文段沿用 02/03/05/07 中文图。

## 英文段（直接粘贴）

MattSkillsDeck: a task board inside DSH for working with Matt's skills

I use DSH (DeepSeek Harness), and I use Matt's skills. Over time two things kept bothering me: with so many skills, I never knew which one the moment called for; and even when I did, each call needed the same boilerplate, like pasting the issue URL after /wayfinder. It wore me down. So I built MattSkillsDeck, a panel in the DSH sidebar that holds both the skills and the tasks. It is my own project, with no official connection to Matt, and I would like to hear from anyone who tries it whether it feels right.

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

This panel only exists because Matt published these skills. Thank you, Matt. Everything above is what I figured out on my own, so it is probably wrong somewhere. If you spot it, reply and I will fix it.

## 中文段（直接粘贴）

MattSkillsDeck：在 DSH 里给 Matt 的技能配一块任务板

我用 DSH（DeepSeek Harness，一个聊天窗口指挥 AI 干活的工具），也用 Matt 的技能。时间一长，两个地方一直别扭：一是技能一多，什么时候该用哪一个，心里没谱；二是就算知道用哪个，每次也要写一堆模板话、做重复动作，比如叫出 /wayfinder 还要再贴一遍工单地址，累。所以我做了 MattSkillsDeck，把技能和任务都收进 DSH 侧边的一块面板里（个人作品，和 Matt 没有官方关系）。

面板打开就是一块任务板，列出仓库里所有工单，能按全部、开放、被阻塞、已关闭筛。地图行置顶，已关闭的工单收成一行，不占地方。每行都有个按钮，上面写好了这一步该干什么：没分流的点诊断，报上来的缺陷点修复，要商量的点讨论，普通任务点执行。点一下，写好的指令填进输入框，人确认后再发。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/02-task-board-list.png" width="600" alt="任务板列表">

每个输入框下面有一条胶囊，上面是实时数字：可接、缺陷、分流、交接、环境检查，数字和面板里的任务对得上，不用自己数。点一下就跳到对应面板，看完回来，刚才聊的不丢。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/03-statusbar-capsule.png" width="600" alt="底部任务栏胶囊">

点开任意一行，描述、标签、认领人、评论都在，底下就能回话。网络不好会明确告诉你失败了，点重试就行，不会只剩一片空白。点新会话会另开一个干净会话，跟进的指令已经填好在里面。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/05-new-session-prefilled.png" width="600" alt="新会话预填指令">

任务可以存在三个地方，设置页里切换：GitHub、本地 Markdown 文件、GitLab，换来换去数据不丢。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/07-backend-switch.png" width="600" alt="多后端切换">

会话标题会跟着进展自己改名；聊得很长的会话，一份交接文档就能带到新会话接着聊。27 个技能都在技能页里，点一下就能用，顶部还会按当前打开的地图推荐一个。

安装（先装好 DSH）：

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

装完把 DSH 重启一次就生效，不用另外配置。桌面应用用户把 --profile web 换成 --profile desktop。仓库：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck

我是站在 Matt 公开的这些技能上，才搭出这块面板的，谢谢 Matt。用法都是我自己摸索的，肯定有不对的地方。如果愿意，回帖里指出来，我看到就改。

## humanizer 自查记录（2026-10-08，技能版本 3.1.0）

- 全文读一遍标出的痕迹：初稿里有一处“不是…而是…”式对比、一处三并列收尾、一处破折号解释，已逐处改成直接陈述。
- 修字数时顺手又压掉一批修饰：full、at the top、corresponding 等只加重量的词，没有动事实。
- 结构检查：没有加粗小标题，没有 staged 开场，没有每段重复的一句话收尾；结尾邀反馈是票里定好的功能，不是装饰。
- 事实核对：27 个技能、两行安装命令、仓库链接、三张英文图与 02/03/05/07 中文图，均与备料清单一致，没有新增数字与断言。
- 大声读一遍：句子长短错开，英文没有连续三句同一开头，中文没有连续排比。
- 2026-10-08 第二轮（用户反馈中文有 AI 味）：8 组改法——去掉说明书名词（主视图、挂着、配跑道、一点即用），拆散三并列节奏，删掉编造的个人习惯句，结尾换成自然邀约；事实零增删，字数 524→556。
