// src/deck/tools/issue-create-parts.ts —— deck_issue_create 的工具定义（参数表与给 AI 看的那段话）
//
// 为什么单独拆：这份参数表是纯数据，三十多行只描述「这个工具收哪些参数、每个参数是什么意思」，
// 与执行逻辑没有关系；留在 issue-create.ts 里会把那份文件顶过 tests/verify-file-granularity.ts
// 的 350 行有效行上限。拆出来只搬位置、不改一个字符：参数名、枚举值、描述文案、required 与
// additionalProperties 全部原样，所以模型看到的工具面与拆之前完全一致。
//
// 不能改的约定：
//   1. 这里是这张票参数的唯一一份答复，别的文件不许再抄一份 —— 抄两份必然漂移，
//      模型会按旧的那一份填参数，而门禁只看功能不看文案。
//   2. 描述文案是提示词成本：改字等于改模型看到的东西，不属于「拆文件」的范围。
//   3. 工具名 deck_issue_create 由这里出，改名要同时改装配层、门禁与文档，不在本文件自留地里做。
/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_issue_create',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。建一张票：kind 必填，六值 map / map-ticket / spec / spec-ticket / bug / issue；map 与 spec 是顶层容器，地图工单挂探索地图、实施票挂规格，用 parentKey，工单要 label。自动补 label 与进度；规格与实施票写类型标记；originalWords 照抄；blockedBy 写成依赖边。本地后端编号与文件头标记由工具写，不要手写票文件。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '票的标题' },
      body: { type: 'string', description: '正文；缺省时按种类补最小骨架' },
      originalWords: {
        type: 'object',
        description: '建票时顺便追加一条维护者原话到正文的「## 维护者原话」区（紧跟「## 目的」，没有目的区就放正文最前）：{text, source}，source 必填。原话一字不改（不润色、不改标点、不翻译、不摘要），只追加、不编辑不删除不排序。三个后端都写进票的正文，不进评论；正文超过 60KB 时拒绝建票、一个字节不动。',
        properties: {
          text: { type: 'string', description: '维护者的原话正文，一字不改；可以多行，空行原样保留' },
          source: { type: 'string', description: '出处，必填：票面写完整链接，本会话答复写「本会话（时间）」，文件写「路径:行号」，提交写短哈希' },
        },
        required: ['text', 'source'],
        additionalProperties: false,
      },
      kind: { type: 'string', enum: ['map', 'map-ticket', 'spec', 'spec-ticket', 'bug', 'issue'], description: '票的位置，必填：map（探索地图）/ map-ticket（地图下的工单）/ spec（规格）/ spec-ticket（规格下的实施票）/ bug（缺陷）/ issue（普通票，万能兜底）。旧的 task / ticket 不再接受：task 改 map-ticket 并给 label，ticket 改 spec-ticket。' },
      label: { type: 'string', enum: ['wayfinder:research', 'wayfinder:prototype', 'wayfinder:grilling', 'wayfinder:task'], description: '只有 kind=map-ticket 才收且必填：wayfinder:research / wayfinder:prototype / wayfinder:grilling / wayfinder:task，四选一。类型标签由它决定，别再放进 labels。' },
      parentKey: { type: 'string', description: '父票：map-ticket 必填，父必须是探索地图；spec-ticket 必填，父必须是规格；map 与 spec 是顶层容器，不收 parentKey；bug 与 issue 可选，给了就必须是探索地图或规格。' },
      blockedBy: { type: 'array', items: { type: 'string' }, description: '这张票建成后被哪些票阻塞（票号或 key 的数组，整批替换；只认本仓库的票，不许写别的仓库的票号）' },
      labels: { type: 'array', items: { type: 'string' }, description: '要带的标签，会在必备标签之外追加；除 issue 外不要再放类型标签（wayfinder:map / wayfinder:research / wayfinder:prototype / wayfinder:grilling / wayfinder:task / bug），类型标签由 kind 与 label 决定。' },
      assignees: { type: 'array', items: { type: 'string' }, description: '认领人' },
      idempotencyKey: { type: 'string', description: '这一批写的幂等锚，重试时带同一个值' },
      workRouteDetail: { type: 'string', enum: ['core', 'standard'], description: '成功后回执里在办表（data.workRoute）带多细：core 只带票号、会话、时间（缺省，最多 20 条），standard 再加标题与动作（全部条目）' },
      effortId: { type: 'string', description: '只有本地后端需要填，填票所在的目录名，根目录的不填' },
    },
    required: ['title', 'kind'],
    additionalProperties: false,
  },
}
