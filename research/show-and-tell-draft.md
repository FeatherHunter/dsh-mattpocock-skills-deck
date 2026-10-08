# Show and tell 初稿（给 #913，英文在前、中文在后）

> 状态：初稿 + humanizer 自查完成，待 #914 渲染预览与发布。
> 英文 338 词（上限 350），中文 513 字（用户全文替换，已超 500–700 区间，待确认）。
> 图片限宽 600，放在对应段落旁边。英文段用 3 张英文图，中文段沿用 02/03/05/07 中文图。

## 英文段（直接粘贴）

MattSkillsDeck: a task board inside DSH for working with Matt's skills

I use DSH (DeepSeek Harness), and I use Matt's skills. Over time two things kept bothering me: with so many skills, I never knew which one the moment called for; and even when I did, each call needed the same boilerplate, like pasting the issue URL after /wayfinder. It wore me down. So I built MattSkillsDeck, a panel in the DSH sidebar that holds both the skills and the tasks. It is my own project, with no official connection to Matt, and I would like to hear from anyone who tries it whether it feels right.

The main view is a task board. It lists every issue in the repo with filters for all, open, blocked and closed. Map rows stay pinned. Each row carries a button that already knows the next step: diagnose, fix, discuss, or execute. Clicking fills the prepared command into the input box, and I confirm before anything runs.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E5%8F%B3%E4%BE%A7%E9%9D%A2%E6%9D%BF-%E6%95%B4%E4%BD%93%E9%A2%84%E8%A7%88-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Task board panel in English">

(The card titles in this shot are my own Chinese backlog; the panel around them is English.)

Under each input box sits a capsule with live counts: ready, bugs, triage, handoff, environment checks. Each segment jumps to the matching panel page and back, so checking status never breaks the session.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E7%8A%B6%E6%80%81%E8%83%B6%E5%9B%8A-%E5%AF%B9%E8%AF%9D%E6%A1%86-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Status capsule under the input box">

Opening a row shows the description, labels, assignee and comments, with a reply box right there. New session opens a clean session with the follow-up command already filled in. Sessions rename themselves as work takes shape, long sessions hand over through a generated doc, and all 27 skills are one click away in the Skills tab.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E8%83%B6%E5%9B%8A%E7%8A%B6%E6%80%81%E6%A0%8F-issue%E5%A4%84%E7%90%86%E8%B7%AF%E5%BE%84-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Session activity in English">

Install, after DSH is present:

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

Then restart that DSH entry. Desktop app users replace --profile web with --profile desktop. Repo: https://github.com/FeatherHunter/dsh-mattpocock-skills-deck

This panel only exists because Matt published these skills. Thank you, Matt. Everything above is what I figured out on my own, so it is probably wrong somewhere. If you spot one, file an issue and I'll take care of it.

## 中文段（直接粘贴）

MattSkillsDeck：用于DSH的mattskillspock skills 配套插件。

我在 DSH（DeepSeek Harness）中使用skills套件。发现两个痛点：一是在27个skill中什么时候该用哪一个并不能知道该用哪一个；二是就算知道用哪个，每次也要写一堆模板话、做重复动作，比如每次都是 /wayfinder+ issue url。所以我做了 MattSkillsDeck插件，第一是第一时间更新最新的Mattskillspocock技能，第二是提供大量便捷操作提高开发体验，降低新手使用门槛。

侧边栏面板打开就是一块任务板，列出仓库里所有issue，能按全部、开放、被阻塞、已关闭筛选。地图行置顶。每个map和issue都有个按钮，上面提供了当前issue所在状态对应的推荐操作：没分流的点诊断，报上来的缺陷点修复，要商量的点讨论，普通任务点执行。点一下，写好的指令填进输入框，人确认后再发送。帮助新人知道implement、triage、handoff、wayfinder、implement-spec等技能的使用场景。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E5%8F%B3%E4%BE%A7%E9%9D%A2%E6%9D%BF-%E6%95%B4%E4%BD%93%E9%A2%84%E8%A7%88-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="任务板（英文界面）">

状态胶囊
每个输入框上面有一条胶囊，上面是实时数字：可接、缺陷、分流、交接、环境检查。点一下就跳到对应面板，非常便捷。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E7%8A%B6%E6%80%81%E8%83%B6%E5%9B%8A-%E5%AF%B9%E8%AF%9D%E6%A1%86-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="状态胶囊（英文界面）">

issue活动列表：
将当前session在处理什么issue和轨迹进行展示，在多个session中快速切换时，不用再去翻聊天记录才能知道当前session在处理哪个issue。

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E8%83%B6%E5%9B%8A%E7%8A%B6%E6%80%81%E6%A0%8F-issue%E5%A4%84%E7%90%86%E8%B7%AF%E5%BE%84-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="会话动态（英文界面）">



会话动态
因该插件创建的新会话去执行某个issue	icket 任务时，会话会自动重命名，看的很清爽。不用一个会话一个会话重命名。现在在规划阶段结束后，一般会在30秒内同时20~30个session并发开发，光重命名session都是一个很枯燥的任务。

安装（先装好 DSH）：

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

装完把 DSH 重启一次就生效，不用另外配置。桌面应用用户把 --profile web 换成 --profile desktop。仓库：https://github.com/FeatherHunter/dsh-mattpocock-skills-deck

谢谢 Mattpocock 提供的伟大的skills。该插件对skills的用法都是我自己摸索的，肯定有不对的地方。如果愿意，提交issue，我看到就会去解决。

## humanizer 自查记录（2026-10-08，技能版本 3.1.0）

- 全文读一遍标出的痕迹：初稿里有一处“不是…而是…”式对比、一处三并列收尾、一处破折号解释，已逐处改成直接陈述。
- 修字数时顺手又压掉一批修饰：full、at the top、corresponding 等只加重量的词，没有动事实。
- 结构检查：没有加粗小标题，没有 staged 开场，没有每段重复的一句话收尾；结尾邀反馈是票里定好的功能，不是装饰。
- 事实核对：27 个技能、两行安装命令、仓库链接、三张英文图与 02/03/05/07 中文图，均与备料清单一致，没有新增数字与断言。
- 大声读一遍：句子长短错开，英文没有连续三句同一开头，中文没有连续排比。
- 2026-10-08 第二轮（用户反馈中文有 AI 味）：8 组改法——去掉说明书名词（主视图、挂着、配跑道、一点即用），拆散三并列节奏，删掉编造的个人习惯句，结尾换成自然邀约；事实零增删，字数 524→556。
