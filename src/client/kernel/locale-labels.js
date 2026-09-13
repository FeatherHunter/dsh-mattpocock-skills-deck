/**
 * src/client/kernel/locale-labels.js — 内核模块（#621 标签配色弹窗的中英词条；#622 加进「复制配色提示词」的文案）
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
 *   lc.copy* (#622) 「复制配色提示词」这一按钮的全部文字：按钮与悬停提示、两套文案的开头与结尾、
 *            表格的两个表头、复制成没成两种反馈。两套文案的真实仓库名与工作区文件夹名由界面用
 *            {repo} / {ws} 填进去（读了才填、填不到就不用那一句，见 labelColorErrors.js 的 lcCopyPlanOf）。
 *   lc.exit (#630) 底部「退出」按钮的文字；lc.closeUnsaved (#630 起、#632 起三条路共用) 有未保存改动时
 *             第一次触发关闭要摆的那句提示——它的措辞不点名某一颗按钮，因为底部「退出」、右上角的 ×、
 *             点弹窗外的空白处这三条路共用它，第二次点哪一处都真关。
 *
 * 谁负责这些文案：#617 交接口径明确「错误档位到人话的文案归 #621 负责，中英两份」。
 * 写这些句子时守两条硬要求：
 *   一、本地 Markdown 后端给一个还没进配色文件的标签上色会被后端拒绝（报 not-found），
 *       所以「怎么做才能成功」必须让用户读得到，否则他会以为功能坏了。#633 起这件事交给后端返回的说明：
 *       后端对「配色文件还没生成」与「文件里没有这一行」各给了一句带做法的说明
 *       （src/host/tracker/backends/markdown/label-colors-ops.js 第 188、192 行），界面把它原样显示在
 *       同一行的「后端返回的说明」框里。notFound 那一档自己不再列举成因——列举等于替后端猜
 *       （同一个档位还可能是「认不出这个工作区属于哪个仓库」），而「去 docs/agents/label-colors.json
 *       里补一行」这种话在文件还没生成时会让用户去找一份不存在的文件（文件由选定后端或首次打开本弹窗
 *       这两步放置，见 markdown/label-colors.js 的 ensureLabelColors）。
 *   二、沙箱拒绝（可能落在 env 档）绝不许写成「你的文件夹没有写权限」——那是插件自己的限制。
 */
    export const L_LABELS = {
      zh: {
        'lc.entryTip': '标签配色：给这个后端的标签配颜色',
        'lc.title': '标签配色',
        'lc.close': '关闭',
        'lc.loading': '正在读取标签清单…',
        'lc.loadFailTitle': '读取标签清单失败',
        'lc.retry': '重试',
        'lc.unsupportedTitle': '这个后端不支持这个操作',
        'lc.emptyTitle': '这个后端还没有标签',
        'lc.emptyDesc': '这个后端还没有标签。请先在这个后端那一侧新建标签（GitHub 后端在仓库的标签页新建；本地 Markdown 后端在 docs/agents/label-colors.json 里补一行），再回到本弹窗设定颜色。',
        'lc.uncolored': '未配色',
        'lc.draftHint': '有未保存的改动',
        'lc.colorValue': '颜色值',
        'lc.swatchTip': '点色块打开系统取色盘',
        'lc.hexFormat': '请填 6 位十六进制颜色，例如 #8b5cf6。',
        'lc.save': '保存',
        'lc.saving': '保存中…',
        'lc.exit': '退出',
        'lc.closeUnsaved': '有未保存的改动：底部「退出」、右上角的 ×、弹窗外区域，三处点哪一处都是再点一次就关闭。未保存的改动不写入后端，关闭后无法找回；关闭前若又改了内容，需重新确认。',
        'lc.saveNone': '没有可保存的改动。',
        'lc.savedSome': '保存结束：{a} 个标签已保存，{f} 个未保存。未保存的行保留该行的结果说明和填写的颜色，便于重新保存。',
        'lc.savedAll': '保存结束：{a} 个标签的颜色都已保存。列表中显示的是后端返回的颜色。',
        'lc.savedNone': '保存失败：{f} 个标签都未保存成功。各行保留该行的结果说明和填写的颜色，便于重新保存。',
        'lc.rowFailed': '这一行未保存。',
        'lc.backendSaid': '后端返回的说明：{msg}',
        'lc.err.env': '这是插件运行环境的问题，不是你的操作有误。失败在哪一步、原因是什么，见「后端返回的说明」。若是这个会话不允许插件写入文件，那是插件自身的写入限制，改文件夹权限没有帮助。',
        'lc.err.auth': '这个后端未通过身份验证。请先登录，或换用对这个仓库有写权限的账号，然后重新保存。',
        'lc.err.rateLimit': '这个后端因请求过于频繁拒绝了这次请求。请稍后再保存，不要连续点击。',
        'lc.err.conflict': '这一次保存未生效，标签颜色没有改动。原因和下一步操作见「后端返回的说明」。',
        'lc.err.unsupported': '这个后端暂不支持改动标签颜色，现在无法在这里保存。',
        'lc.err.notFound': '这个后端找不到要改的目标，这一次保存未生效。「后端返回的说明」会写明是哪一种情况，按说明处理后回到本弹窗重新保存。',
        'lc.err.network': '网络连接不可用或请求超时，这一次请求没有改动标签颜色。请检查网络连接，然后点「重试」。',
        'lc.err.parse': '颜色未通过校验。「后端返回的说明」会写明是哪一种情况，按说明改好后重新保存。',
        'lc.err.unknown': '后端未说明这次失败的原因。请把本弹窗里这一段文字，连同你操作的工作区与标签名，交给插件维护者。',
        // #631 三、：光说「先去面板里选定后端」，用户在这个弹窗里没有任何能去的地方——这两条写明去哪儿选。
        'lc.errWherePick': '这个工作区使用哪个后端，在面板头部仓库名右边那颗按钮里选定（图标是两枚相对的箭头，悬停显示「切换后端」），选好后回到本弹窗点「重试」。面板头部没有这颗按钮时（这个工作区尚未绑定后端），点面板里「该工作区还没有设置 — 点击选择后端」即可选定后端。',
        'lc.actGoPick': '关闭本弹窗，去面板里选定后端',
        // #631 的 D1 补修：面板还在识别这个工作区用哪个后端（selection.pending）时，上面那句「去哪儿选」与
        // 那颗入口按钮都不摆——那时面板头部那颗「切换后端」按钮是禁用的，把用户支使过去点它只会白点一下。
        // 这一句与后端返回的说明是同一个意思：后端那边说识别尚未完成，让用户稍后重试。
        'lc.errWaitBackend': '插件正在识别这个工作区使用哪个后端，此时面板头部那颗「切换后端」按钮不可点击。请等识别完成后再点「重试」。',
        'lc.copy': '复制配色提示词',
        'lc.copyTip': '把当前这些标签和颜色拼成一段提示词，复制后粘贴到 AI 会话请它出配色方案。只写剪贴板，不会往会话里发任何东西。',
        'lc.copyRepoLine': '目标仓库：{repo}。',
        'lc.copyWsLine': '目标工作区文件夹：{ws}。',
        'lc.copyOpenRemote': '任务：为该仓库的标签设计一套协调的配色方案。\n\n下表是插件从该仓库读取到的全部标签及其当前颜色：颜色为不带井号的六位十六进制小写值，表中「当前颜色」一列为空表示该标签当前没有颜色。',
        'lc.copyOpenFile': '任务：为该工作区的标签设计一套协调的配色方案。\n\n下表是插件从该工作区读取到的全部标签及其当前颜色。该后端的标签颜色存放在工作区文件 docs/agents/label-colors.json 中，文件里以标签名（原样书写）为键、以不带井号的六位十六进制小写颜色为值；表中「当前颜色」一列为空，或该文件里这个标签对应的值为空，都表示该标签当前没有颜色。',
        'lc.copyColName': '标签名',
        'lc.copyColColor': '当前颜色',
        'lc.copyCloseRemote': '输出要求：\n- 先只输出方案，不要修改任何标签。\n- 为表中每个标签各指定一个新颜色，用不带井号的六位十六进制小写值表示，写法与表中现有颜色一致。\n- 方案只覆盖表中列出的标签：不新增标签，也不删除标签。\n- 方案内的颜色应互相区分，并保证该颜色作为标签背景色时标签文字清晰可读。\n- 标签名照表中原样引用，不翻译，也不改大小写。\n- 方案用与下表相同的两列格式给出：第一列标签名，第二列新颜色；解释写在表格后面。\n\n方案需说明整套颜色为什么协调，以及每个标签选用该颜色的理由。\n\n执行方式：在用户回复「按这个改」确认之后，再逐个执行 `gh label edit <标签名> --color <六位十六进制> --repo {repo}`；改完用 `gh label list --repo {repo}` 复查，并把改后的标签列表返回供核对。',
        'lc.copyCloseRemoteNoRepo': '输出要求：\n- 先只输出方案，不要修改任何标签。\n- 为表中每个标签各指定一个新颜色，用不带井号的六位十六进制小写值表示，写法与表中现有颜色一致。\n- 方案只覆盖表中列出的标签：不新增标签，也不删除标签。\n- 方案内的颜色应互相区分，并保证该颜色作为标签背景色时标签文字清晰可读。\n- 标签名照表中原样引用，不翻译，也不改大小写。\n- 方案用与下表相同的两列格式给出：第一列标签名，第二列新颜色；解释写在表格后面。\n\n方案需说明整套颜色为什么协调，以及每个标签选用该颜色的理由。\n\n执行方式：在用户回复「按这个改」确认之后，在目标仓库所在目录下逐个执行 `gh label edit <标签名> --color <六位十六进制>`；改完在该目录下执行 `gh label list` 复查，并把改后的标签列表返回供核对。',
        'lc.copyCloseFile': '输出要求：\n- 先只输出方案，不要修改任何文件。\n- 为表中每个标签各指定一个新颜色，用不带井号的六位十六进制小写值表示，写法与表中现有颜色一致。\n- 方案只覆盖表中列出的标签：不新增标签，也不删除标签。\n- 方案内的颜色应互相区分，并保证该颜色作为标签背景色时标签文字清晰可读。\n- 标签名照表中原样引用，不翻译，也不改大小写。\n- 方案用与下表相同的两列格式给出：第一列标签名，第二列新颜色；解释写在表格后面。\n\n方案需说明整套颜色为什么协调，以及每个标签选用该颜色的理由。\n\n执行方式：在用户回复「按这个改」确认之后，把 docs/agents/label-colors.json 中每个标签对应的色值改为方案中的新颜色。表中有、而该文件里还没有的标签，在文件里补写一行，键为标签名（原样书写）——补的是文件里的行，标签本身不新增。完成后读回文件内容并返回供核对。',
        'lc.copied': '已复制',
        'lc.copyFailed': '复制失败。请手动复制：下面框内即要复制的文字，点一下该框会选中全部文字，再按 Ctrl+C；也可以拖选一部分后复制。',
        'lc.copyNoBackend': '这一次未能读到这个后端的标签颜色存放在哪里，因此未生成提示词。请关闭本弹窗，点面板里的「更新」重新检查一次，再点面板头部那颗标签配色按钮重新打开本弹窗。本弹窗里尚未保存的改动会随关闭丢失。',
        'lc.copyNoOpenMode': '这一次未能读到这个后端把标签颜色放在仓库里还是工作区文件里，因此未生成提示词。请关闭本弹窗，点面板里的「更新」重新检查一次，再点面板头部那颗标签配色按钮重新打开本弹窗。若每次都出现这条提示，说明这个后端未声明颜色存在哪里，请把这条提示交给插件维护者。',
      },
      en: {
        'lc.entryTip': 'Label colors: choose a color for each label this backend has',
        'lc.title': 'Label colors',
        'lc.close': 'Close',
        'lc.loading': 'Reading the label list…',
        'lc.loadFailTitle': 'Could not read the label list',
        'lc.retry': 'Retry',
        'lc.unsupportedTitle': 'This backend does not support this operation',
        'lc.emptyTitle': 'This backend has no labels yet',
        'lc.emptyDesc': 'This backend has no labels yet. Create the labels on the backend side first (for the GitHub backend, in the repository\'s label page; for the local Markdown backend, add a row in docs/agents/label-colors.json), then come back to this dialog to set their colors.',
        'lc.uncolored': 'No color',
        'lc.draftHint': 'Unsaved changes',
        'lc.colorValue': 'Color value',
        'lc.swatchTip': 'Click the swatch to open the system color picker',
        'lc.hexFormat': 'Enter a 6-digit hex color, such as #8b5cf6.',
        'lc.save': 'Save',
        'lc.saving': 'Saving…',
        'lc.exit': 'Exit',
        'lc.closeUnsaved': 'There are unsaved changes: the Exit button at the bottom, the × at the top right, and the area outside the dialog — clicking any of the three once more closes it. The unsaved changes are not written to the backend and cannot be recovered after it closes. If you change anything else before closing, you must confirm again.',
        'lc.saveNone': 'No changes to save.',
        'lc.savedSome': 'Save finished: {a} labels were saved and {f} were not. Each unsaved row keeps its result message and the color that was typed, so it can be saved again.',
        'lc.savedAll': 'Save finished: all {a} label colors were saved. The list shows the colors the backend returned.',
        'lc.savedNone': 'The save failed: none of the {f} labels were saved. Each row keeps its result message and the color that was typed, so it can be saved again.',
        'lc.rowFailed': 'This row was not saved.',
        'lc.backendSaid': 'Message from the backend: {msg}',
        'lc.err.env': 'This is a problem with the plugin environment, not an error in your operation. Which step failed and why are in the message the backend returned. If this session does not allow the plugin to write files, that is the plugin\'s own write restriction; changing folder permissions will not help.',
        'lc.err.auth': 'This backend did not accept the account. Sign in first, or use an account that can write to this repository, then save again.',
        'lc.err.rateLimit': 'This backend refused the request because too many requests were sent. Wait a little, then save again, and do not click Save repeatedly.',
        'lc.err.conflict': 'This save did not take effect: no label color was changed. The reason and the next step are in the message the backend returned.',
        'lc.err.unsupported': 'This backend does not support changing label colors yet, so nothing can be saved here.',
        'lc.err.notFound': 'This backend cannot find what the change refers to, so this save did not take effect. The message the backend returned says which case this is; follow it, then save again in this dialog.',
        'lc.err.network': 'The network connection is unavailable or the request timed out; this request did not change any label color. Check the network connection, then click Retry.',
        'lc.err.parse': 'The color did not pass validation. The message the backend returned says which case this is; fix it as described, then save again.',
        'lc.err.unknown': 'The backend did not say why this failed. Send this message, together with the workspace and the label you were changing, to the plugin maintainers.',
        // #631 item 3: "pick the backend in the panel first" left the user with nowhere to go — these two say where.
        'lc.errWherePick': 'Which backend this workspace uses is chosen with the button to the right of the repository name in the panel header (two facing arrows; hovering shows "Switch backend"), then come back to this dialog and click Retry. If that button is not in the header (this workspace has no backend bound yet), click "this workspace is not set up yet — click to choose a backend" in the panel to choose one.',
        'lc.actGoPick': 'Close this dialog and choose the backend in the panel',
        // #631 item D1: while the plugin is still identifying this workspace's backend (selection.pending),
        // neither that sentence nor the entry button is shown — the "switch backend" button in the panel header
        // cannot be clicked yet, so pointing the user at it would be another wasted click.
        'lc.errWaitBackend': 'The plugin is still identifying which backend this workspace uses, so "Switch backend" in the panel header cannot be clicked yet. Wait for that to finish, then click Retry.',
        'lc.copy': 'Copy a color-scheme prompt',
        'lc.copyTip': 'Copy the current labels and colors as one prompt you can paste into an AI session to ask for a color scheme. This only writes the clipboard; nothing is sent into any session.',
        'lc.copyRepoLine': 'Target repository: {repo}.',
        'lc.copyWsLine': 'Target workspace folder: {ws}.',
        'lc.copyOpenRemote': 'Task: design one coordinated color scheme for the labels in this repository.\n\nThe table below lists every label in this repository and its current color, as read by the plugin: colors are lowercase 6-digit hex values without the # sign, and an empty "Current color" cell means that label currently has no color.',
        'lc.copyOpenFile': 'Task: design one coordinated color scheme for the labels in this workspace.\n\nThe table below lists every label in this workspace and its current color, as read by the plugin. This backend keeps label colors in the workspace file docs/agents/label-colors.json, where the key is the label name as-is and the value is a lowercase 6-digit hex color without the # sign; either an empty "Current color" cell or an empty matching value in that file means that label currently has no color.',
        'lc.copyColName': 'Label',
        'lc.copyColColor': 'Current color',
        'lc.copyCloseRemote': 'Output requirements:\n- Produce the scheme only; do not modify any label yet.\n- Assign one new color to every label in the table, written as a lowercase 6-digit hex value without the # sign, matching the format of the colors already in the table.\n- The scheme covers only the labels listed in the table: do not add labels and do not delete labels.\n- The colors in the scheme must be distinguishable from one another, and each color must keep the label text legible when used as the label\'s background color.\n- Quote every label name exactly as it appears in the table: do not translate it and do not change its letter case.\n- Give the scheme as the same two-column table as below, with the label name first and the new color second; put the explanation after the table.\n\nThe proposal must explain why the set works together and why each label receives its color.\n\nExecution: after the user confirms with the reply "Apply it", change the labels one by one with `gh label edit <label> --color <6-digit hex> --repo {repo}`; then check the result with `gh label list --repo {repo}` and return the updated label list for verification.',
        'lc.copyCloseRemoteNoRepo': 'Output requirements:\n- Produce the scheme only; do not modify any label yet.\n- Assign one new color to every label in the table, written as a lowercase 6-digit hex value without the # sign, matching the format of the colors already in the table.\n- The scheme covers only the labels listed in the table: do not add labels and do not delete labels.\n- The colors in the scheme must be distinguishable from one another, and each color must keep the label text legible when used as the label\'s background color.\n- Quote every label name exactly as it appears in the table: do not translate it and do not change its letter case.\n- Give the scheme as the same two-column table as below, with the label name first and the new color second; put the explanation after the table.\n\nThe proposal must explain why the set works together and why each label receives its color.\n\nExecution: after the user confirms with the reply "Apply it", run `gh label edit <label> --color <6-digit hex>` for each label inside the target repository directory; then run `gh label list` in that same directory and return the updated label list for verification.',
        'lc.copyCloseFile': 'Output requirements:\n- Produce the scheme only; do not modify any file yet.\n- Assign one new color to every label in the table, written as a lowercase 6-digit hex value without the # sign, matching the format of the colors already in the table.\n- The scheme covers only the labels listed in the table: do not add labels and do not delete labels.\n- The colors in the scheme must be distinguishable from one another, and each color must keep the label text legible when used as the label\'s background color.\n- Quote every label name exactly as it appears in the table: do not translate it and do not change its letter case.\n- Give the scheme as the same two-column table as below, with the label name first and the new color second; put the explanation after the table.\n\nThe proposal must explain why the set works together and why each label receives its color.\n\nExecution: after the user confirms with the reply "Apply it", change the value of every label in docs/agents/label-colors.json to its new color. For a label that is in the table but not yet in that file, add a row in the file with the label name as-is as the key — the row is added to the file, no label is created. Then read the file back and return its contents for verification.',
        'lc.copied': 'Copied',
        'lc.copyFailed': 'Copy failed. Copy it manually: the box below holds the text — clicking the box selects all of it, then press Ctrl+C; you can also drag to select part of it and copy that.',
        'lc.copyNoBackend': 'The plugin could not read where this backend keeps label colors, so no prompt was put together. Close this dialog, click Refresh in the panel, then open this dialog again from the Label colors button in the panel header. Unsaved changes in this dialog are lost when it closes.',
        'lc.copyNoOpenMode': 'The plugin could not read whether this backend keeps label colors in the repository or in a workspace file, so no prompt was put together. Close this dialog, click Refresh in the panel, then open this dialog again from the Label colors button in the panel header. If this appears every time, this backend does not declare where its colors live; send this message to the plugin maintainers.',
      },
    }
