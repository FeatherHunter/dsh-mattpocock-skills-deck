/**
 * src/client/kernel/locale-pages.js — 内核模块（#690 历史票按需翻页的中英词条）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 *
 * 为什么单独一份：locale-flow.js 已经贴着「单文件不超 350 行」这条门禁（#621 给标签配色
 * 加词条时就是这么做的，见 locale-labels.js），这一票的五条文案放不下，于是照同一做法自成一片。
 * 片段真源：locale-panel.js / locale-flow.js / locale-word.js / locale-labels.js / 本文件，
 * 由 locale.js 的合并器一起并进 L。
 *
 * 这五条说的是同一件事的不同情形（规格第 7.4、9、10 节）：翻页翻到多少了、后端不支持时去哪看、
 * 翻页位置失效了怎么办、没取到怎么办、内存里腾了旧页怎么办。中英各一份，键名与占位符两边一致。
 */
    export const L_PAGES = {
      zh: {
        'list.pageLoaded': '已加载 {x} / 共 {n}',
        'list.pageAllOnWeb': '这个后端不能在这里翻页，去它的网页上看全部',
        'list.pageStale': '翻页位置已失效，已从最近的一页重新开始',
        'list.pageFail': '历史票没取到，稍后再试',
        'list.pageTrimmed': '更早的页已从内存腾出，再往上滚会重新加载',
      },
      en: {
        'list.pageLoaded': '{x} loaded / {n} total',
        'list.pageAllOnWeb': 'This backend cannot page here — see everything on its web page',
        'list.pageStale': 'The page position expired; restarted from the most recent page',
        'list.pageFail': 'Could not load more history; try again shortly',
        'list.pageTrimmed': 'Older pages were dropped from memory; scrolling back up reloads them',
      },
    }
