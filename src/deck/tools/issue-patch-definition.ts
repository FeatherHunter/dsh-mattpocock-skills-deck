// src/deck/tools/issue-patch-definition.ts —— deck_issue_patch 的工具定义（#1495 加关闭原因后从 issue-patch.ts 搬出）
//
// 为什么单独一份：issues-patch.ts 的有效行一直贴着每文件 350 行的上限（tests/verify-file-granularity.ts）。
// #1495 给 deck_issue_patch 加「关闭原因」参数之后，那份文件到了 359 有效行、门禁判红；搬走的第一块
// 就挑最纯的这份工具定义——它只是一段数据（名字、给 AI 看的说明、参数表），与运行逻辑没有耦合，
// 搬走不改任何行为。文件头注释里原先那句「工具定义（唯一事实）」仍然成立，只是真源换了位置。
import { MD_SCOPE_LOCATE } from './md-scope.js'

/** 工具定义（唯一事实）：路由、参数名与给 AI 看的那句话都从这里出，别在别处再抄一份。 */
export const definition = {
  name: 'deck_issue_patch',
  description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，只处理当前 workspace 对应的 repo；动 ISSUE 前先调用 deck_context 确认 workspace 与 backend，若它说没 backend 就停下。改一个 ISSUE：评论、label、assignee、关闭、标题正文、progress 区、维护者原话区，一次只动点名的那些；重开不在这个工具上（只由人在后端做），关规格要先在这一次调用里带收口核对评论、且实施票已全关。本地后端认领会写进票里的 Assignees 行。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '要改的那张票' },
      comment: { type: 'string', description: '要发的评论正文' },
      addLabels: { type: 'array', items: { type: 'string' }, description: '要加的标签' },
      removeLabels: { type: 'array', items: { type: 'string' }, description: '要摘掉的标签' },
      assignees: { type: 'array', items: { type: 'string' }, description: '认领人（整批替换；给空数组就是取掉认领）' },
      title: { type: 'string', description: '新的标题' },
      body: { type: 'string', description: '新的正文（整段替换）：要先用 deck_issue_get(body=\'full\') 读出全文与指纹，把读到的指纹放在 bodyDigest 里一起传，否则这次正文不动。只改进度或原话不传整段正文时不用它。' },
      bodyDigest: { type: 'string', description: '写整段正文时的乐观锁：上一次用 body=\'full\' 读到的正文指纹（data.body.digest）。工具先读当前正文算指纹，对不上就一个字不动地拒绝，防止把别人的改动覆盖掉。' },
      originalWords: {
        type: 'object',
        description: '追加一条维护者原话到正文的「## 维护者原话」区（紧跟「## 目的」，没有目的区就放正文最前）：{text, source}，source 必填。原话一字不改（不润色、不改标点、不翻译、不摘要），只追加、不编辑不删除不排序；同一段原话 + 同一出处已经写过时幂等跳过。三个后端都写进票的正文，不进评论。正文超过 60KB 时拒绝写入、一个字节不动。',
        properties: {
          text: { type: 'string', description: '维护者的原话正文，一字不改；可以多行，空行原样保留' },
          source: { type: 'string', description: '出处，必填：票面写完整链接，本会话答复写「本会话（时间）」，文件写「路径:行号」，提交写短哈希' },
        },
        required: ['text', 'source'],
        additionalProperties: false,
      },
      progress: {
        type: 'object',
        description: '写一条进度记录：{percent, note}（#1090 起不再收一段自由文字）。工具自动盖当前时间、把这条加到「## 进度」区最上面，旧记录原样保留；正文超过 60KB 时拒绝写入、一个字节不动。',
        properties: {
          percent: { type: 'integer', description: '进度百分比，0..100 的整数' },
          note: { type: 'string', description: '做到哪一步了的说明，必填，一句话（不能换行）' },
        },
        required: ['percent', 'note'],
        additionalProperties: false,
      },
      close: { type: 'boolean', description: 'true 关闭这张票；关规格时必须在同一次调用里带 comment（逐张核对结论），且实施票全关，否则关闭会被拒绝。重开只能由人在后端做，这个工具不支持 false' },
      closeReason: { type: 'string', description: '关闭原因：和 close:true 一起用，告诉后端这次为什么关。地图子票的原因写进正文的 Answer 段，还会在地图的 Decisions so far 里补一条指针；实施票的原因按原文追加成一条评论；旧布局票写 Close reason 行；规格与地图容器只记状态，原因忽略。只带 closeReason、不带 close:true 时整笔拒绝，一个字都不动。' },
      workRouteDetail: { type: 'string', enum: ['core', 'standard'], description: '成功后回执里在办表（data.workRoute）带多细：core 只带票号、会话、时间（缺省，最多 20 条），standard 再加标题与动作（全部条目）' },
      ...MD_SCOPE_LOCATE,
    },
    required: ['key'],
    additionalProperties: false,
  },
}
