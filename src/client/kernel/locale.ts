/**
 * src/client/kernel/locale.ts —— 九个词表片段的中英合并器（原来是手写 JavaScript，
 * 按动到哪里转到哪里转成 TypeScript，真源是这份，同名 JavaScript 是构建产物）。
 *
 * 为什么合并器要单独占一份文件：九个片段各自只管自己那一摊词条，界面只认合并后的
 * L（zh 与 en 各一份大表）。合并逻辑收在一处，改了任何一片段的键，漏并或重名都会
 * 在这一处露出来，而不是散在九个界面调用点里。
 *
 * 转写只加类型标注与环境声明，合并的片段名单与顺序一字未动：
 * 新增片段必须同时把 zh 与 en 两处名单补上，只补一处会让中英两份表的键数对不上，
 * 这条由 tests/verify-locale-completeness 按每键恰出现两次钉住。
 */
declare const L_PANEL: any;
declare const L_FLOW: any;
declare const L_WORD: any;
declare const L_LABELS: any;
declare const L_PAGES: any;
declare const L_VCWRITE: any;
declare const L_SKILLDESC: any;
declare const L_SKILLDETAIL: any;
declare const L_CARDS: any;
    export const L = {
      zh: Object.assign({}, L_PANEL.zh, L_FLOW.zh, L_WORD.zh, L_LABELS.zh, L_PAGES.zh, L_VCWRITE.zh, L_SKILLDESC.zh, L_SKILLDETAIL.zh, L_CARDS.zh),
      en: Object.assign({}, L_PANEL.en, L_FLOW.en, L_WORD.en, L_LABELS.en, L_PAGES.en, L_VCWRITE.en, L_SKILLDESC.en, L_SKILLDETAIL.en, L_CARDS.en),
    }
