MattSkillsDeck: a companion plugin for mattpocock/skills on DSH

I use the skills suite inside DSH (DeepSeek Harness). Two pain points kept hitting me: with 27 skills, I never knew which one the moment called for; and even when I did, each call needed the same boilerplate again, like /wayfinder plus the issue URL every time. So I built the MattSkillsDeck plugin. First, it keeps the bundled skills up to date with the latest releases. Second, it adds a pile of shortcuts that make development smoother and lower the bar for newcomers.

The sidebar panel opens onto a task board listing every issue in the repo, filterable by all, open, blocked and closed, with map rows pinned. Every map and issue carries a button with the recommended action for its state: diagnose the untriaged, fix reported bugs, discuss the ones under discussion, execute plain tasks. One click fills the prepared command into the input box to confirm. It shows newcomers when to reach for implement, triage, handoff, wayfinder, implement-spec and the rest.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E5%8F%B3%E4%BE%A7%E9%9D%A2%E6%9D%BF-%E6%95%B4%E4%BD%93%E9%A2%84%E8%A7%88-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Task board panel in English">

(The card titles in this shot are my own Chinese backlog; the panel around them is English.)

Status capsule. Above every input box sits a capsule with live numbers: ready, bugs, triage, handoff, environment checks. One click jumps to the matching panel.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E7%8A%B6%E6%80%81%E8%83%B6%E5%9B%8A-%E5%AF%B9%E8%AF%9D%E6%A1%86-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Status capsule under the input box">

Issue activity. It shows what each session is working on and its trail, so jumping between sessions no longer means digging through chat history to tell which issue a session is handling.

<img src="https://raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/main/assets/readme/%E8%83%B6%E5%9B%8A%E7%8A%B6%E6%80%81%E6%A0%8F-issue%E5%A4%84%E7%90%86%E8%B7%AF%E5%BE%84-%E8%8B%B1%E6%96%87%E7%89%88.png" width="600" alt="Session activity in English">

Session updates. Sessions the plugin creates to run an issue/ticket rename themselves automatically, which reads clean, with no renaming one by one. After planning, 20 to 30 sessions often develop concurrently within 30 seconds, and renaming alone is dull work.

Install, after DSH is present:

```bash
dsh plugin --profile web add dsh-mattpocock-skills-deck
```

Then restart that DSH entry. Desktop app users replace --profile web with --profile desktop. Repo: https://github.com/FeatherHunter/dsh-mattpocock-skills-deck

Thanks to Matt for the great skills. How this plugin uses them is all my own figuring out; something is bound to be off. File an issue if you like and I'll get it solved.

---

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
