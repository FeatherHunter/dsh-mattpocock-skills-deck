/**
 * src/client/kernel/locale-labels.js — 内核模块（#621 标签配色弹窗的中英词条；#622 加进「复制推荐配色 prompt」的文案）
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
 *   lc.copy* (#622) 「复制推荐配色 prompt」这一按钮的全部文字：按钮与悬停提示、两套文案的开头与结尾、
 *            表格的两个表头、复制成没成两种反馈。两套文案的真实仓库名与工作区文件夹名由界面用
 *            {repo} / {ws} 填进去（读了才填、填不到就不用那一句，见 labelColorErrors.js 的 lcCopyPlanOf）。
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
        'lc.copy': '复制推荐配色 prompt',
        'lc.copyTip': '把当前这些标签和颜色拼成一段话复制走，粘到 AI 会话里请它出一套配色。只写剪贴板，不会往会话里发任何东西。',
        'lc.copyRepoLine': '这个仓库是 {repo}。',
        'lc.copyWsLine': '这个工作区文件夹是「{ws}」。',
        'lc.copyOpenRemote': '我要给这个仓库的标签换一套协调的配色，请你先出一套方案。下面是从后端读到的当前全部标签与它们的颜色（颜色是不带井号的六位十六进制；空着表示这个标签还没有颜色）：',
        'lc.copyOpenFile': '我要给这个工作区里的标签换一套协调的配色，请你先出一套方案。这个后端的标签颜色存在工作区里的 docs/agents/label-colors.json 这个文件里（键写标签名原样，值是不带井号的六位十六进制颜色；空着表示这个标签还没有颜色）。下面是从后端读到的当前全部标签与它们的颜色（不带井号的六位十六进制）：',
        'lc.copyColName': '标签名',
        'lc.copyColColor': '当前颜色',
        'lc.copyCloseRemote': '请先只给方案，不要动任何标签：给每个标签一个新颜色（六位十六进制，不带井号），并说明这一套放在一起为什么协调、每个标签为什么给这个颜色。等我回复「按这个改」以后，你再用 `gh label edit <标签名> --color <六位十六进制> --repo {repo}` 逐个改上去，改完用 `gh label list --repo {repo}` 复查一遍，把改后的清单发给我核对。',
        'lc.copyCloseRemoteNoRepo': '请先只给方案，不要动任何标签：给每个标签一个新颜色（六位十六进制，不带井号），并说明这一套放在一起为什么协调、每个标签为什么给这个颜色。等我回复「按这个改」以后，你再用 `gh label edit <标签名> --color <六位十六进制>` 逐个改上去（这条命令要在你要改的那个仓库的目录里跑），改完用 `gh label list` 复查一遍，把改后的清单发给我核对。',
        'lc.copyCloseFile': '请先只给方案，不要动任何文件：给每个标签一个新颜色（六位十六进制，不带井号），并说明这一套放在一起为什么协调、每个标签为什么给这个颜色。等我回复「按这个改」以后，你再把 docs/agents/label-colors.json 里每个标签对应的色值改成这套新颜色，还没进这个文件的标签就补上一行（键写标签名原样），改完把文件内容读回来发给我核对。',
        'lc.copied': '已复制',
        'lc.copyFailed': '复制失败，请手动选中复制。下面这段就是要复制的文字，用鼠标选中后按 Ctrl+C（点一下框再全选也行）。',
        'lc.copyNoBackend': '这次没读到当前后端的信息（不知道它的标签颜色存在哪里），所以没有拼这段文字。请关掉弹窗、刷新一次面板再打开。',
        'lc.copyNoOpenMode': '这次没读到这个后端的开仓方式（界面不知道该让你到仓库里改、还是改工作区里的文件），所以没有生成方案。请先关掉弹窗、刷新一次面板再打开；如果每次打开都是这一句，说明这个后端没有声明开仓方式，请把这句话告诉插件维护者。',
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
        'lc.copy': 'Copy a color-scheme prompt',
        'lc.copyTip': 'Copy the current labels and colors as one prompt you can paste into an AI session to ask for a matching color scheme. This only writes the clipboard; nothing is sent into any session.',
        'lc.copyRepoLine': 'This repository is {repo}.',
        'lc.copyWsLine': 'This workspace folder is "{ws}".',
        'lc.copyOpenRemote': 'I want to give this repository\'s labels one matching color scheme, and I would like you to propose it first. Below are all the labels this backend returned and their current colors (colors are 6-digit hex without the # sign; an empty cell means that label has no color yet):',
        'lc.copyOpenFile': 'I want to give the labels in this workspace one matching color scheme, and I would like you to propose it first. This backend keeps label colors in the workspace file docs/agents/label-colors.json (the key is the label name as-is, the value is a 6-digit hex color without the # sign; an empty cell means that label has no color yet). Below are all the labels this backend returned and their current colors (6-digit hex without the # sign):',
        'lc.copyColName': 'Label',
        'lc.copyColColor': 'Current color',
        'lc.copyCloseRemote': 'Please propose the scheme only and do not touch any label yet: give every label a new color (6-digit hex, no #), explain why the set works together and why each label gets its color. After I reply to approve it, change them one by one with `gh label edit <label> --color <6-digit hex> --repo {repo}`, then check the result with `gh label list --repo {repo}` and send me the updated list to verify.',
        'lc.copyCloseRemoteNoRepo': 'Please propose the scheme only and do not touch any label yet: give every label a new color (6-digit hex, no #), explain why the set works together and why each label gets its color. After I reply to approve it, change them one by one with `gh label edit <label> --color <6-digit hex>` (run it inside the repository you are changing), then check the result with `gh label list` and send me the updated list to verify.',
        'lc.copyCloseFile': 'Please propose the scheme only and do not change any file yet: give every label a new color (6-digit hex, no #), explain why the set works together and why each label gets its color. After I reply to approve it, change the value of every label in docs/agents/label-colors.json to its new color, add a row for any label that is not in that file yet (the key is the label name as-is), then read the file back and send me its contents to verify.',
        'lc.copied': 'Copied',
        'lc.copyFailed': 'Copy failed — select the text manually to copy it. The text is in the box below; click the box and press Ctrl+C (select all also works).',
        'lc.copyNoBackend': 'The plugin could not read which backend this is (so it does not know where that backend keeps label colors), so this text was not put together. Close the dialog, refresh the panel once and open it again.',
        'lc.copyNoOpenMode': 'The plugin could not read how this backend opens its repository, so it cannot tell whether you should change colors in the repository or in a workspace file, and no prompt was put together. Close the dialog and refresh the panel once, then open it again; if this message shows up every time, this backend does not declare how its repository opens — please tell the plugin maintainers.',
      },
    }
