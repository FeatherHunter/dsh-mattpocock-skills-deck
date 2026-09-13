/**
 * src/client/kernel/locale-labels.js — 内核模块（#621 标签配色弹窗的中英词条）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与其它 locale 片段同模式，一源两物，src 零复制。
 *
 * 为什么单独一个片段、不并进 locale-panel/flow/word：那三份都已经在 350 行上限附近，
 * 这一票要加四十多条键（中英各一份），塞进任何一份都会把文件顶过上限。
 * 合并器 kernel/locale.js 里把本片段与三份老片段一起并进 L，界面只认 tr('lc.*')。
 *
 * 命名口径（键名一律小写点分段，不用连字符；两段以上的键名带层级含义）：
 *   lc.      本功能全部键的前缀，避免与老片段撞名；
 *   lc.err.* 契约里八个错误档位各一条人话（档位名见 src/host/tracker/contract.js 的 ERROR_KIND）；
 *   lc.kind.* 只用于「这个档位叫什么」的短名，供界面在密排小字里用。
 *
 * 谁负责这些文案：#617 交接口径明确「错误档位到人话的文案归 #621 负责，中英两份」。
 * 写这些句子时守两条硬要求：
 *   一、本地 Markdown 后端给一个还没进配色文件的标签上色会被后端拒绝（报 not-found），
 *       所以 notFound 那句必须写清「怎么做才能成功」，否则用户会以为功能坏了；
 *   二、沙箱拒绝（可能落在 env 档）绝不许写成「你的文件夹没有写权限」——那是插件自己的限制。
 */
    export const L_LABELS = {
      zh: {
        'lc.entryTip': '标签配色：给这个后端的标签配颜色',
        'lc.title': '标签配色',
        'lc.close': '关闭',
        'lc.loading': '正在读取标签清单…',
        'lc.loadFailTitle': '读不到标签清单',
        'lc.retry': '重试',
        'lc.unsupportedTitle': '这个后端暂时做不到',
        'lc.emptyTitle': '这个后端还没有标签',
        'lc.emptyDesc': '请先到标签管理里建好标签，再回来配色。',
        'lc.uncolored': '未配色',
        'lc.draftHint': '有未保存的改动',
        'lc.colorValue': '颜色值',
        'lc.swatchTip': '点色块打开系统取色盘',
        'lc.hexFormat': '要填 6 位十六进制颜色，例如 #8b5cf6',
        'lc.save': '保存',
        'lc.saving': '保存中…',
        'lc.saveNone': '没有要保存的改动',
        'lc.savedSome': '保存完成：{a} 个改好了，{f} 个没改成功。改好的按后端刚返回的颜色显示，没改成功的保留下面的说明和你的输入，方便重试。',
        'lc.savedAll': '保存完成：{a} 个标签的颜色都改好了，列表已按后端刚返回的颜色刷新。',
        'lc.savedNone': '保存完成：这 {f} 个标签一个也没改成功，原因写在各自那一行；你的输入都留着，方便重试。',
        'lc.rowFailed': '这一条没保存成功。',
        'lc.backendSaid': '后端原话：{msg}',
        'lc.err.env': '插件这边的环境问题：这一步没能写成。可能是工作区里缺了要用的工具，也可能是这次会话不允许插件写文件——那是插件自己的沙箱限制，不是你文件夹的权限问题。',
        'lc.err.auth': '这个后端没有通过身份验证：先登录，或者换一个对这个仓库有写权限的账号，再来保存。',
        'lc.err.rateLimit': '被这个后端限速了：等一会儿再点保存，不要连着点。',
        'lc.err.conflict': '这次写入和后端上正在发生的另一处改动撞上了：稍等片刻再重试。',
        'lc.err.unsupported': '这个后端暂时还不支持查看与修改标签颜色，等后端接上以后这个弹窗就能用了。',
        'lc.err.notFound': '这个标签没在这个后端的配色清单里，所以改不了它的颜色。本地 Markdown 后端请先在 docs/agents/label-colors.json 里给它加一行（键写标签名原样，值写不带井号的六位十六进制颜色），再回来改色；GitHub 后端请先在这个仓库里建一个同名标签。',
        'lc.err.network': '网络不通或者超时了：检查网络连接，再重试。',
        'lc.err.parse': '颜色写法不合法：要填 6 位十六进制，例如 #8b5cf6。',
        'lc.err.unknown': '后端没有说清这一步为什么失败。请把下面那行原文发给插件维护者。',
      },
      en: {
        'lc.entryTip': 'Label colors: set a color for each label this backend has',
        'lc.title': 'Label colors',
        'lc.close': 'Close',
        'lc.loading': 'Reading the label list…',
        'lc.loadFailTitle': 'Could not read the label list',
        'lc.retry': 'Retry',
        'lc.unsupportedTitle': 'This backend cannot do it yet',
        'lc.emptyTitle': 'This backend has no labels yet',
        'lc.emptyDesc': 'Create labels in your label manager first, then come back to give them colors.',
        'lc.uncolored': 'No color',
        'lc.draftHint': 'Unsaved changes',
        'lc.colorValue': 'Color value',
        'lc.swatchTip': 'Click the swatch to open the system color picker',
        'lc.hexFormat': 'Enter a 6-digit hex color such as #8b5cf6',
        'lc.save': 'Save',
        'lc.saving': 'Saving…',
        'lc.saveNone': 'No changes to save',
        'lc.savedSome': 'Save finished: {a} labels were changed and {f} were not. Changed rows show the color the backend just returned; failed rows keep the reason and what you typed, so you can retry.',
        'lc.savedAll': 'Save finished: all {a} labels were changed. The list now shows the colors the backend just returned.',
        'lc.savedNone': 'Save finished: none of the {f} labels were changed. The reason is written on each row, and what you typed is kept so you can retry.',
        'lc.rowFailed': 'This row was not saved.',
        'lc.backendSaid': 'The backend said: {msg}',
        'lc.err.env': 'This is the plugin side of the environment: the write did not go through. The workspace may be missing a tool, or this session may not allow the plugin to write files — that is the plugin\'s own sandbox limit, not a problem with your folder permissions.',
        'lc.err.auth': 'This backend did not accept the sign-in: sign in first, or use an account that can write to this repository, then save again.',
        'lc.err.rateLimit': 'This backend is rate-limiting requests: wait a moment before saving again, and do not click repeatedly.',
        'lc.err.conflict': 'This write collided with another change that is happening on the backend right now: try again in a moment.',
        'lc.err.unsupported': 'This backend does not support viewing or changing label colors yet; this dialog will work once it does.',
        'lc.err.notFound': 'This label is not in this backend\'s color list, so its color cannot change. For the local Markdown backend, add a row for it in docs/agents/label-colors.json first (the key is the label name as-is, the value is a 6-digit hex color without the # sign), then come back; for the GitHub backend, create a label with the same name in this repository first.',
        'lc.err.network': 'The network is unreachable or timed out: check the connection and try again.',
        'lc.err.parse': 'The color is not valid: enter a 6-digit hex value such as #8b5cf6.',
        'lc.err.unknown': 'The backend did not say why this step failed. Please send the raw line below to the plugin maintainers.',
      },
    }
