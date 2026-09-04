# 236-239 列表与地图节点作者显示现状审计与空态口径

> 票 #239，研究前端列表作者显示现状盘点与空态口径

## 1 审计范围

- 已读：src/client/views/ListTab.js:1-345, TicketRow.js:7-41, IssueDetail.js:150-154/199-212, chips.js, locale.js, shape.js, capability.js, queries.js, normalize.js, store.js:522-539, styles.js, tagsFit.js:9-31, MapDetail.js
- 缺失输入已跳过，已用 #237/#238 结论补全

## 2 核心结论

1. 列表与地图节点均未消费 author（ListTab/TicketRow/MapDetail grep 0，唯一消费 IssueDetail.js:150-154）
2. 协议层已就绪 shape.js:132 author?: Actor 能力字段，MISSING=省略
3. GitHub 新链路已透传 queries.js:23, normalize.js:206-209，旧链路断点 src/host/index.js:828/888
4. 空态 MISSING/EMPTY 均不渲染，仅 login 可渲染 @login+person 图标，列表默认不显头像（详情保留）
5. 候选布局：A 标题同行徽标（ListTab.js:239 与圆环间）、B 子信息行复用 dsws-tt-sub（推荐，灰 author/蓝 assignee/橙 blocked 分层）、C 右侧固定列（成本高）

## 3 现状盘点

### 3.1 ListTab — 主列表

- 两行卡片：行1 idcol竖排+标题 dsws-tt-wrap 限2行+圆环 ringOf 188-201；行2 dsws-tags 单行贪心折叠 + 按钮组
- 护栏 MAP_ROW_GUARD_NARROW=320, WIDE=440 (ListTab.js:6-7)，fitMapRows 8-27 仅 map 行，ResizeObserver 观测 panel/body/aggrow 46-52，指纹跳过 34-38
- 标签行 dsws-tags flex, chip 背景 hexA 0.18, +N 虚线, blocked 红 chip, tagsFit.js 9-31 最少1个
- 按钮组 mkRowAction 四选一 + 新会话 + 复制/外链，被阻塞时隐藏主动作
- KPI 行可接/阻塞/已关闭，口径 store.js:522-539

是否消费 author：0 命中

### 3.2 TicketRow — 地图详情子票行

- L7-L41，仅 #number + claimedBy(#58a6ff) + blocked(#f0883e) + CLOSED(#3fb950) + tStatusBadge/tProgressBar，无 author

### 3.3 IssueDetail — 详情页

- L150-154 已消费：src.author && login ? h('span', [avatarUrl ? img : Ic(person), '@'+login]) : null
- 评论段 L200 login || 'ghost', L206 authorAssociation chip

### 3.4 样式基座

- styles.js:43-52 dsws-tt, 140-149 dsws-tags, 148-149 dsws-more
- 无障碍：色不作唯一区分，保留图标

## 4 空态口径

| 输入 | 渲染 |
|------|------|
| MISSING (!('author' in issue)) | 不渲染，不占位 |
| EMPTY (author.login === '') | 不渲染 |
| 仅 login | 渲染 @login + person 图标 |
| 有 avatarUrl | 列表不显头像（文本优先，头像仅详情），kind 仅 aria-label |

## 5 三候选布局（文字描述）

- A 标题同行徽标：ListTab.js:239 与圆环间 flex:none，需处理标题限2行挤压
- B 子信息行复用 dsws-tt-sub（推荐）：行1与行2间新增 dsws-tt-sub，复用 TicketRow.js:24 语义，灰author/蓝assignee/橙blocked 分层，窄屏时 author 置护栏外，不进 dsws-tags
- C 右侧固定列：110-130px，窄屏回退成本高

## 6 窄屏/无障碍

- 护栏 320/440 + fitMapRows 仅 map 行，dsws-tags 不换行，narrow-icon 20×20，author 不进 tags，保留 person/lock 图标，aria-label 补 kind

来源：ListTab.js:6-7/8-27/34-38/184-345/243-251, TicketRow.js:7-41/24-30, MapDetail.js:67-103, IssueDetail.js:150-154/200/206, tagsFit.js:9-31, styles.js:43-52/140-149, store.js:522-539, shape.js:132, queries.js:23, normalize.js:206-209, host/index.js:828/888
