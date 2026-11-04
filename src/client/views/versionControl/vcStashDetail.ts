/**
 * src/client/views/versionControl/vcStashDetail.ts —— 贮藏记录下面那片文件清单怎么画（#1860 D8）
 *
 * 为什么单独成叶：贮藏页正文已经贴着每文件 350 有效行的上限，而 D8 要把「记录行挂出来就自动读文件清单」
 * 这件事的那几种状态（正在读 / 读失败带重试 / 读到了）都画在同一块位置，还要保留「排在自动读取范围之外」
 * 时的原样提示。四块画法收进这里，正文只负责按详情读数挑一块。
 *
 * 四种块与它们出现的时机：
 *   · vcStashPathsBlockOf     读到了：文件清单、差异正文、截断说明、收起按钮；
 *   · vcStashPathsPendingOf   正在读或读失败：一句状态话；失败时补一颗重试按钮。安静动作（查看、建分支）照旧挂着；
 *   · vcStashPathsHintNode    还没读过、也不在自动读取范围里：说清「点查看内容才给」；
 *   · vcStashDetailFallbackBlockOf  记录已经从列表消失而详情还在：铺在列表之后，别让人找不到刚看过的内容。
 *
 * 可见文字全部走 t(词条)，词条真源 config/copy/vcstash.yaml；本文件不写可见字面量。
 */

// 同层叶子与共享层的名字由构建拼进同一个闭包，这里只声明形状（类型检查按单文件跑）。

/** 一条记录的文件清单、差异、截断说明与收起按钮（读到了才画）。 */
export const vcStashPathsBlockOf = function (h: any, t: any, detail: any, ctx: any): any {
  const files = Array.isArray(detail.files) ? detail.files : []
  const kids: any[] = [
    h('p', { key: 'note', className: 'stash-paths-note' }, t('vc.stash.pathsNote')),
    h('ul', { key: 'files', className: 'stash-path-list', 'data-vc-stash-detail-files': '1' }, files.map(function (file: string): any {
      return h('li', { key: file, className: 'stash-path mono', 'aria-label': file, title: file, 'data-vc-stash-file': file }, file)
    })),
    h('pre', { key: 'patch', className: 'stash-patch mono', 'data-vc-stash-patch': '1' }, String(detail.patch)),
  ]
  if (detail.truncated) kids.push(h('p', { key: 'trunc', className: 'stash-truncated', 'data-vc-stash-truncated': '1' }, t('vc.stash.detail.truncated')))
  kids.push(h('button', {
    key: 'close', type: 'button', className: 'btn btn-ghost btn-sm',
    'data-vc-stash-detail-close': '1', 'data-press': 'button', 'data-log': 'vc.stash.detail-close',
    onClick: function () { ctx.closeDetail(String(detail.selector || '')) },
  }, [h('span', { key: 'label', className: 'btn-label' }, t('vc.stash.detail.close'))]))
  return h('div', { key: 'paths', className: 'stash-paths', 'data-vc-stash-detail': String(detail.selector) }, kids)
}

/** 正在读或读失败：一句状态话贴在这条记录下面；失败补一颗重试，安静动作照旧挂着。 */
export const vcStashPathsPendingOf = function (h: any, t: any, detail: any, ctx: any, quietActions: any[]): any {
  const failed: boolean = String(detail.state || '') === 'err'
  const kids: any[] = [h('p', {
    key: 'note', className: 'stash-paths-note' + (failed ? ' is-error' : ''),
    'data-vc-stash-detail-pending': failed ? 'err' : 'loading',
    role: failed ? 'alert' : 'status',
  }, t(failed ? 'vc.stash.detail.error' : 'vc.stash.detail.loading'))]
  if (failed) {
    kids.push(h('button', {
      key: 'retry', type: 'button', className: 'btn btn-ghost btn-sm',
      'data-vc-stash-detail-retry': String(detail.selector || ''),
      'data-press': 'button', 'data-log': 'vc.stash.detail-retry',
      onClick: function () { ctx.act({ op: 'show', selector: String(detail.selector || '') }) },
    }, [h('span', { key: 'label', className: 'btn-label' }, t('vc.stash.detail.retry'))]))
  }
  if (quietActions.length > 0) kids.push(h('div', { key: 'acts', className: 'stash-paths-acts' }, quietActions))
  return h('div', { key: 'paths', className: 'stash-paths', 'data-vc-stash-detail': String(detail.selector) }, kids)
}

/** 没看过、也不在自动读取范围里的那一条：只说清文件清单在哪一步出现；安静动作放在这里。 */
export const vcStashPathsHintNode = function (h: any, t: any, quietActions: any[]): any {
  return h('div', { key: 'paths', className: 'stash-paths' }, [
    h('p', { key: 'note', className: 'stash-paths-note' }, t('vc.stash.pathsHint')),
    quietActions.length > 0 ? h('div', { key: 'acts', className: 'stash-paths-acts' }, quietActions) : null,
  ])
}

/** 兜底详情：记录已经从列表里消失而详情还在状态里时，铺在列表之后，别让人看不到刚查看的内容。 */
export const vcStashDetailFallbackBlockOf = function (h: any, t: any, detail: any, ctx: any): any {
  const files = Array.isArray(detail.files) ? detail.files : []
  return h('section', { key: 'detail-fallback', className: 'stash-paths', 'data-vc-stash-detail': String(detail.selector) }, [
    h('p', { key: 'note', className: 'stash-paths-note' }, t('vc.stash.pathsNote')),
    h('ul', { key: 'files', className: 'stash-path-list', 'data-vc-stash-detail-files': '1' }, files.map(function (file: string): any {
      return h('li', { key: file, className: 'stash-path mono', 'aria-label': file, title: file, 'data-vc-stash-file': file }, file)
    })),
    h('pre', { key: 'patch', className: 'stash-patch mono', 'data-vc-stash-patch': '1' }, String(detail.patch)),
    detail.truncated ? h('p', { key: 'trunc', className: 'stash-truncated', 'data-vc-stash-truncated': '1' }, t('vc.stash.detail.truncated')) : null,
    h('button', {
      key: 'close', type: 'button', className: 'btn btn-ghost btn-sm', 'data-vc-stash-detail-close': '1',
      'data-press': 'button', 'data-log': 'vc.stash.detail-close',
      onClick: function () { ctx.closeDetail(String(detail.selector || '')) },
    }, [h('span', { key: 'label', className: 'btn-label' }, t('vc.stash.detail.close'))]),
  ])
}

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_STASH_DETAIL_SOURCE = 'src/client/views/versionControl/vcStashDetail.ts'
