/* 构建产物：由 scripts/build.ts 从 src/main.ts 打包，不要手改。 */
"use strict";
(() => {
  // docs/prototype/vc-redesign/src/data/copy.ts
  var COPY = {
    frame: {
      kicker: "Prototype: version-control page",
      title: "\u7248\u672C\u7BA1\u7406\u9875\u91CD\u6784\u539F\u578B",
      lede: "\u628A\u9876\u90E8\u4FE1\u606F\u3001\u6539\u52A8\u3001\u63D0\u4EA4\u5386\u53F2\u3001\u5DE5\u4F5C\u6811\u6536\u8FDB\u540C\u4E00\u5957\u9AA8\u67B6\uFF1A\u5148\u8BF4\u7ED3\u8BBA\uFF0C\u518D\u7ED9\u8BC1\u636E\uFF0C\u52A8\u4F5C\u548C\u7ED3\u679C\u8D34\u7740\u8BC1\u636E\u51FA\u73B0\u3002\u6570\u636E\u91C7\u81EA\u672C\u4ED3\u5E93\u771F\u5B9E\u7684 git \u8BB0\u5F55\uFF0C\u5199\u64CD\u4F5C\u5728\u672C\u5730\u6A21\u62DF\u3002",
      metaData: "\u6570\u636E\u6765\u81EA\u672C\u4ED3\u5E93\u771F\u5B9E git \u8BB0\u5F55",
      metaWidth: "\u9762\u677F\u5BBD\u5EA6 300 \u5230 520",
      metaSkin: "\u4E24\u5957\u76AE\u80A4\u5171\u7528\u4E00\u5957\u7ED3\u6784",
      width: "\u9762\u677F\u5BBD\u5EA6",
      theme: "\u76AE\u80A4",
      themeDark: "\u6DF1\u8272",
      themeLight: "\u6D45\u8272",
      toolsNote: "\u5199\u64CD\u4F5C\u53EA\u6539\u754C\u9762\u72B6\u6001\uFF0C\u4E0D\u4F1A\u6539\u52A8\u4ED3\u5E93",
      hint: "\u70B9\u9875\u7B7E\u5207\u6362\u89C6\u56FE\uFF0C\u70B9\u6587\u4EF6\u884C\u5C55\u5F00\u9010\u884C\u5DEE\u5F02",
      capturedAt: (when) => `\u6570\u636E\u91C7\u96C6\u4E8E ${when}`
    },
    views: {
      changes: "\u6539\u52A8",
      commits: "\u63D0\u4EA4\u5386\u53F2",
      worktrees: "\u5DE5\u4F5C\u6811",
      stash: "\u8D2E\u85CF"
    },
    units: {
      change: "\u6587\u4EF6",
      commit: "\u6761",
      worktree: "\u68F5",
      stash: "\u6761"
    },
    rail: {
      reload: "\u91CD\u65B0\u8BFB\u53D6",
      reloadBusy: "\u8BFB\u53D6\u4E2D\u2026",
      readAt: (when) => `\u8BFB\u53D6\u4E8E ${when}`,
      basisAt: (when) => `\u8FDC\u7AEF\u4F9D\u636E ${when}`,
      basisUnknown: "\u8FDC\u7AEF\u4F9D\u636E\u672A\u77E5",
      readHint: "\u672C\u5730\u6700\u8FD1\u4E00\u6B21\u8BFB\u53D6 git \u7684\u65F6\u95F4\uFF0C\u4E0D\u8054\u7F51",
      basisHint: "\u6700\u8FD1\u4E00\u6B21\u4ECE\u8FDC\u7AEF\u53D6\u56DE\u4FE1\u606F\u7684\u65F6\u95F4",
      nextHint: "\u6309\u5F53\u524D\u72B6\u6001\u7ED9\u51FA\u7684\u4E0B\u4E00\u6B65\u5EFA\u8BAE\uFF0C\u4E0D\u662F\u6309\u94AE",
      branchHint: "\u6253\u5F00\u5206\u652F\u5217\u8868\uFF0C\u53EF\u4EE5\u5207\u6362\u3001\u521B\u5EFA\u3001\u5408\u5E76\u3001\u91CD\u547D\u540D\u548C\u5220\u9664\u5206\u652F",
      syncHint: (label, value) => `${label} ${value} \u4E2A\u63D0\u4EA4`,
      copyRepoPath: "\u590D\u5236\u4ED3\u5E93\u8DEF\u5F84",
      copyWorktreePath: "\u590D\u5236\u5DE5\u4F5C\u6811\u8DEF\u5F84",
      pathCopied: "\u8DEF\u5F84\u5DF2\u590D\u5236",
      next: "\u4E0B\u4E00\u6B65",
      syncAhead: "\u8D85\u524D",
      syncBehind: "\u843D\u540E",
      noUpstream: "\u5C1A\u672A\u8BBE\u7F6E\u4E0A\u6E38",
      upstreamGone: "\u63A8\u9001\u76EE\u6807\u5DF2\u4E0D\u5B58\u5728",
      detached: "\u6E38\u79BB\u5934\u6307\u9488",
      syncUnknown: "\u540C\u6B65\u72B6\u6001\u8BFB\u4E0D\u5230",
      confirmTitle: "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u6539\u52A8\uFF0C\u4ECD\u8981\u62C9\u53D6\uFF1F",
      confirmBody: "\u53EA\u5FEB\u8FDB\u7684\u62C9\u53D6\u5728\u672C\u5730\u6539\u52A8\u4E0E\u8FDC\u7AEF\u65B0\u63D0\u4EA4\u4E0D\u76F8\u4EA4\u65F6\u80FD\u6210\u529F\uFF1B\u76F8\u4EA4\u65F6\u4F1A\u88AB\u62D2\u7EDD\u5E76\u70B9\u540D\u6587\u4EF6\u3002",
      confirmFiles: (n) => `\u6D89\u53CA ${n} \u4E2A\u6587\u4EF6`,
      confirmContinue: "\u7EE7\u7EED\u62C9\u53D6",
      confirmCancel: "\u53D6\u6D88"
    },
    actions: {
      pull: "\u62C9\u53D6",
      fetch: "\u66F4\u65B0",
      push: "\u63A8\u9001",
      commit: "\u63D0\u4EA4",
      stage: "\u6682\u5B58",
      unstage: "\u64A4\u56DE",
      stageAll: "\u5168\u90E8\u6682\u5B58",
      unstageAll: "\u5168\u90E8\u64A4\u56DE",
      back: "\u8FD4\u56DE\u63D0\u4EA4\u5386\u53F2",
      loadMore: "\u52A0\u8F7D\u66F4\u65E9\u7684\u63D0\u4EA4"
    },
    busy: {
      pull: "\u62C9\u53D6\u4E2D\u2026",
      fetch: "\u66F4\u65B0\u4E2D\u2026",
      push: "\u63A8\u9001\u4E2D\u2026",
      commit: "\u63D0\u4EA4\u4E2D\u2026",
      reload: "\u8BFB\u53D6\u4E2D\u2026"
    },
    /** 阻断原因：真实实现的标识符在 src/shared/version-control/src/rules.ts。 */
    block: {
      "nothing-staged": "\u6682\u5B58\u533A\u4E3A\u7A7A\uFF0C\u5148\u6682\u5B58\u8981\u63D0\u4EA4\u7684\u6587\u4EF6",
      "nothing-to-stage": "\u6CA1\u6709\u53EF\u6682\u5B58\u7684\u5185\u5BB9",
      "conflicts-unresolved": "\u5B58\u5728\u672A\u89E3\u51B3\u7684\u51B2\u7A81\u6587\u4EF6",
      "dirty-tree": "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8",
      "basis-unknown": "\u8FDC\u7AEF\u4F9D\u636E\u65F6\u95F4\u8BFB\u4E0D\u5230",
      "behind-remote": "\u843D\u540E\u8FDC\u7AEF\uFF0C\u5148\u62C9\u53D6\u518D\u63A8\u9001",
      "no-upstream": "\u5C1A\u672A\u8BBE\u7F6E\u4E0A\u6E38",
      "upstream-gone": "\u4E0A\u6E38\u5DF2\u5728\u8FDC\u7AEF\u5220\u9664",
      "detached-head": "\u5F53\u524D\u4E0D\u5728\u4EFB\u4F55\u5206\u652F\u4E0A",
      "mid-merge": "\u6709\u672A\u5B8C\u6210\u7684\u5408\u5E76",
      "mid-rebase": "\u6709\u672A\u5B8C\u6210\u7684\u53D8\u57FA",
      "mid-cherry-revert": "\u6709\u672A\u5B8C\u6210\u7684\u62E3\u9009\u6216\u56DE\u9000",
      "bare-repo": "\u88F8\u4ED3\u5E93\u6CA1\u6709\u5DE5\u4F5C\u533A",
      "unknown-operation": "\u8FD9\u4E00\u6B65\u5F53\u524D\u4E0D\u53EF\u7528",
      "nothing-to-push": "\u6CA1\u6709\u53EF\u63A8\u9001\u7684\u63D0\u4EA4"
    },
    warn: {
      "dirty-tree": "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8",
      "basis-unknown": "\u8FDC\u7AEF\u4F9D\u636E\u65F6\u95F4\u8BFB\u4E0D\u5230",
      "detached-head": "\u5F53\u524D\u4E0D\u5728\u4EFB\u4F55\u5206\u652F\u4E0A",
      "mid-merge": "\u6B63\u5728\u5408\u5E76",
      "mid-rebase": "\u6B63\u5728\u53D8\u57FA",
      "mid-cherry-revert": "\u6B63\u5728\u62E3\u9009\u6216\u56DE\u9000"
    },
    changes: {
      filterConflict: "\u51B2\u7A81",
      filterStaged: "\u5DF2\u6682\u5B58",
      filterUnstaged: "\u672A\u6682\u5B58",
      groupConflict: "\u5B58\u5728\u51B2\u7A81",
      groupStaged: "\u5DF2\u6682\u5B58",
      groupUnstaged: "\u672A\u6682\u5B58",
      groupEmptyConflict: "\u6CA1\u6709\u51B2\u7A81\u6587\u4EF6",
      groupEmptyStaged: "\u8FD8\u6CA1\u6709\u6682\u5B58\u4EFB\u4F55\u6587\u4EF6",
      groupEmptyUnstaged: "\u6CA1\u6709\u672A\u6682\u5B58\u7684\u6539\u52A8",
      patchTitle: "\u76F8\u5BF9\u4E0A\u4E00\u6B21\u63D0\u4EA4\u7684\u53D8\u66F4\uFF08\u542B\u5DF2\u6682\u5B58\u4E0E\u672A\u6682\u5B58\uFF09",
      patchNote: "\u539F\u578B\u53EA\u6F14\u793A\u9010\u884C\u5DEE\u5F02\u7684\u6392\u7248\uFF0C\u8FD9\u4E00\u5C0F\u6BB5\u662F\u793A\u4F8B\u8865\u4E01\uFF0C\u4E0D\u6765\u81EA\u4ED3\u5E93\u3002",
      messagePlaceholder: "\u5199\u4E00\u53E5\u63D0\u4EA4\u8BF4\u660E",
      messageHint: "\u4EC5\u63D0\u4EA4\u5DF2\u6682\u5B58\u7684\u5185\u5BB9\uFF0C\u672A\u6682\u5B58\u7684\u6587\u4EF6\u4E0D\u4F1A\u88AB\u63D0\u4EA4\u3002",
      commitLabel: (n) => `\u63D0\u4EA4 ${n} \u4E2A\u6587\u4EF6`,
      commitNoStaged: "\u6682\u5B58\u533A\u6CA1\u6709\u6587\u4EF6",
      commitNoMessage: "\u586B\u5199\u63D0\u4EA4\u8BF4\u660E\u540E\u5373\u53EF\u63D0\u4EA4",
      emptyTitle: "\u6CA1\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8",
      emptyHint: "\u5DE5\u4F5C\u6811\u4E0E\u6682\u5B58\u533A\u90FD\u662F\u5E72\u51C0\u7684\u3002",
      untracked: "\u672A\u8DDF\u8E2A",
      typeUnknown: "\u65E0\u6CD5\u5224\u5B9A\u53D8\u66F4\u7C7B\u578B",
      stagedBadge: "\u5DF2\u6682\u5B58",
      menuMore: "\u66F4\u591A\u64CD\u4F5C",
      menuDiscard: "\u4E22\u5F03\u4FEE\u6539",
      menuIgnore: "\u52A0\u5165 .gitignore",
      menuDelete: "\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6",
      menuResolveOurs: "\u7528\u5F53\u524D\u5206\u652F\u7684\u7248\u672C\u89E3\u51B3",
      menuResolveTheirs: "\u7528\u5BF9\u65B9\u7684\u7248\u672C\u89E3\u51B3",
      discardAll: "\u4E22\u5F03\u5168\u90E8",
      confirmCancel: "\u53D6\u6D88",
      confirmDiscard: "\u786E\u8BA4\u4E22\u5F03",
      confirmIgnore: "\u786E\u8BA4\u52A0\u5165",
      confirmDelete: "\u786E\u8BA4\u5220\u9664",
      confirmResolve: "\u786E\u8BA4\u89E3\u51B3",
      confirmDiscardTitle: (name) => `\u4E22\u5F03 ${name} \u7684\u6539\u52A8\uFF1F`,
      confirmDiscardBody: "\u6587\u4EF6\u4F1A\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF0C\u8FD9\u6B21\u672A\u6682\u5B58\u7684\u6539\u52A8\u6CA1\u6CD5\u4ECE\u9762\u677F\u64A4\u56DE\u3002",
      confirmDiscardAllTitle: (n) => `\u4E22\u5F03 ${n} \u4E2A\u6587\u4EF6\u7684\u6539\u52A8\uFF1F`,
      confirmDiscardAllBody: "\u8FD9\u4E9B\u6587\u4EF6\u90FD\u4F1A\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF0C\u672A\u6682\u5B58\u7684\u6539\u52A8\u6CA1\u6CD5\u4ECE\u9762\u677F\u64A4\u56DE\u3002",
      confirmDiscardAllMeta: (n) => `\u6D89\u53CA ${n} \u4E2A\u6587\u4EF6`,
      confirmIgnoreTitle: (name) => `\u628A ${name} \u52A0\u5165 .gitignore\uFF1F`,
      confirmIgnoreBody: "\u6587\u4EF6\u4ECD\u5728\u78C1\u76D8\u4E0A\uFF0Cgit \u4ECE\u4E0B\u4E00\u6B21\u8BFB\u53D6\u8D77\u4E0D\u518D\u8DDF\u8E2A\u5B83\uFF1B\u5DF2\u7ECF\u63D0\u4EA4\u8FDB\u5386\u53F2\u7684\u5185\u5BB9\u4E0D\u53D7\u5F71\u54CD\u3002",
      confirmDeleteTitle: (name) => `\u5220\u9664\u672A\u8DDF\u8E2A\u6587\u4EF6 ${name}\uFF1F`,
      confirmDeleteBody: "\u8FD9\u4E2A\u6587\u4EF6\u4ECE\u6765\u6CA1\u6709\u8FDB\u8FC7 git \u5386\u53F2\uFF0C\u5220\u9664\u4EE5\u540E\u6CA1\u6709\u4EFB\u4F55\u5730\u65B9\u80FD\u627E\u56DE\u3002",
      confirmResolveOursTitle: (name) => `\u7528\u5F53\u524D\u5206\u652F\u7684\u7248\u672C\u89E3\u51B3 ${name}\uFF1F`,
      confirmResolveOursBody: "\u5BF9\u65B9\u7684\u6539\u52A8\u4F1A\u88AB\u4E22\u6389\uFF0C\u6587\u4EF6\u4F1A\u76F4\u63A5\u53D8\u4E3A\u5DF2\u6682\u5B58\u3002",
      confirmResolveTheirsTitle: (name) => `\u7528\u5BF9\u65B9\u7684\u7248\u672C\u89E3\u51B3 ${name}\uFF1F`,
      confirmResolveTheirsBody: "\u5F53\u524D\u5206\u652F\u91CC\u7684\u6539\u52A8\u4F1A\u88AB\u4E22\u6389\uFF0C\u6587\u4EF6\u4F1A\u76F4\u63A5\u53D8\u4E3A\u5DF2\u6682\u5B58\u3002",
      ignoredNote: (n) => `\u5DF2\u5FFD\u7565 ${n} \u4E2A\u6587\u4EF6\uFF0Cgit \u4ECE\u4E0B\u4E00\u6B21\u8BFB\u53D6\u8D77\u4E0D\u518D\u8DDF\u8E2A\u5B83\u4EEC`,
      stashAction: "\u8D2E\u85CF\u8FD9\u4E9B\u6539\u52A8",
      stashHint: "\u8D2E\u85CF\u4F1A\u628A\u5DE5\u4F5C\u533A\u4E0E\u6682\u5B58\u533A\u4E00\u8D77\u6253\u5305\u5E26\u8D70\uFF0C\u5DE5\u4F5C\u533A\u6062\u590D\u6210\u4E0A\u6B21\u63D0\u4EA4\u65F6\u7684\u6837\u5B50\uFF1B\u4E4B\u540E\u53EF\u4EE5\u5E94\u7528\u6216\u5F39\u51FA\u62FF\u56DE\u6765\u3002",
      stashBlocked: "\u6709\u51B2\u7A81\u6587\u4EF6\u65F6\u4E0D\u80FD\u8D2E\u85CF\uFF0C\u5148\u89E3\u51B3\u51B2\u7A81\u3002",
      menuClose: "\u6536\u8D77\u83DC\u5355",
      menuOpen: "\u66F4\u591A\u64CD\u4F5C"
    },
    history: {
      searchPlaceholder: (loaded) => `\u5728\u5DF2\u52A0\u8F7D\u7684 ${loaded} \u6761\u63D0\u4EA4\u91CC\u7B5B\u9009`,
      mergeOnly: "\u53EA\u770B\u5408\u5E76",
      loadedCount: (loaded, total) => `\u5DF2\u52A0\u8F7D ${loaded} \u6761\uFF0C\u5171 ${total} \u6761`,
      empty: "\u5DF2\u52A0\u8F7D\u7684\u63D0\u4EA4\u91CC\u6CA1\u6709\u5339\u914D\u9879\u3002",
      groupToday: "\u4ECA\u5929",
      groupYesterday: "\u6628\u5929",
      groupDate: (month, day) => `${month} \u6708 ${day} \u65E5`,
      author: "\u4F5C\u8005",
      time: "\u63D0\u4EA4\u65F6\u95F4",
      hash: "\u63D0\u4EA4",
      parents: "\u7236\u63D0\u4EA4",
      changedFiles: (n) => `\u53D8\u66F4\u4E86 ${n} \u4E2A\u6587\u4EF6`,
      filesEmptyMerge: "\u8FD9\u662F\u4E00\u6B21\u5408\u5E76\u63D0\u4EA4\uFF1A\u5B83\u76F8\u5BF9\u7B2C\u4E00\u4E2A\u7236\u63D0\u4EA4\u6CA1\u6709\u53D8\u66F4\u6587\u4EF6\u3002",
      filesEmpty: "\u8BE5\u63D0\u4EA4\u672A\u4FEE\u6539\u4EFB\u4F55\u6587\u4EF6\u3002",
      fileTypeUnknown: "\u8BE5\u63D0\u4EA4\u53EA\u8FD4\u56DE\u8DEF\u5F84\u4E0E\u589E\u5220\u884C\u6570\uFF0C\u65E0\u6CD5\u5224\u5B9A\u53D8\u66F4\u7C7B\u578B",
      diffSampleNote: "\u539F\u578B\u53EA\u6F14\u793A\u9010\u884C\u5DEE\u5F02\u7684\u6392\u7248\uFF0C\u5C55\u5F00\u540E\u662F\u793A\u4F8B\u8865\u4E01\uFF0C\u4E0D\u6765\u81EA\u8BE5\u63D0\u4EA4\u3002",
      mergeChip: "\u5408\u5E76",
      menuOpen: "\u66F4\u591A\u64CD\u4F5C",
      menuRevert: "\u56DE\u9000\u8FD9\u6B21\u63D0\u4EA4",
      menuCherryPick: "\u62E3\u9009\u5230\u5F53\u524D\u5206\u652F",
      menuUndo: "\u64A4\u9500\u8FD9\u6B21\u63D0\u4EA4\uFF0C\u6539\u52A8\u7559\u5728\u6682\u5B58\u533A",
      menuUndoHint: "\u53EA\u80FD\u64A4\u9500\u6700\u65B0\u4E00\u6761\u63D0\u4EA4",
      menuCopy: "\u590D\u5236\u63D0\u4EA4 ID",
      menuClose: "\u6536\u8D77\u83DC\u5355",
      undoTitle: (subject) => `\u64A4\u9500\u63D0\u4EA4\u300C${subject}\u300D\uFF1F`,
      undoBody: "\u5206\u652F\u4F1A\u9000\u4E00\u6B65\uFF0C\u8FD9\u6B21\u63D0\u4EA4\u91CC\u7684\u6587\u4EF6\u56DE\u5230\u6682\u5B58\u533A\uFF0C\u63D0\u4EA4\u8BF4\u660E\u7559\u5728\u8F93\u5165\u6846\u91CC\uFF1B\u8FD9\u4E00\u6B65\u6539\u7684\u662F\u672C\u5730\u5386\u53F2\u3002",
      undoConfirm: "\u786E\u8BA4\u64A4\u9500",
      cancel: "\u53D6\u6D88",
      undoNote: "\u5386\u53F2\u91CC\u7684\u8FD9\u6761\u63D0\u4EA4\u6682\u65F6\u9690\u53BB\uFF0C\u6539\u52A8\u5728\u300C\u6539\u52A8\u300D\u9875\u7B7E\u7684\u5DF2\u6682\u5B58\u5206\u7EC4\u91CC\u3002"
    },
    branches: {
      title: "\u5206\u652F",
      newBranch: "\u65B0\u5EFA\u5206\u652F",
      searchPlaceholder: "\u6309\u5206\u652F\u540D\u7B5B\u9009",
      current: "\u5F53\u524D",
      noUpstream: "\u672A\u8BBE\u7F6E\u4E0A\u6E38",
      upstream: (name) => `\u4E0A\u6E38 ${name}`,
      ahead: (n) => `\u9886\u5148 ${n}`,
      behind: (n) => `\u843D\u540E ${n}`,
      merged: "\u5DF2\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F",
      notMerged: "\u5C1A\u672A\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F",
      latestCommit: "\u6700\u65B0\u63D0\u4EA4",
      switch: "\u5207\u6362\u5230\u6B64\u5206\u652F",
      switchCurrent: "\u5DF2\u5728\u5F53\u524D\u5206\u652F",
      merge: "\u5408\u5E76\u5230\u5F53\u524D\u5206\u652F",
      mergeHint: "\u628A\u8FD9\u6761\u5206\u652F\u7684\u63D0\u4EA4\u5E76\u8FDB\u5F53\u524D\u5206\u652F\uFF1B\u6709\u51B2\u7A81\u65F6\u4F1A\u505C\u4E0B\u7B49\u4F60\u5904\u7406\u3002",
      rename: "\u91CD\u547D\u540D",
      delete: "\u5220\u9664\u5206\u652F",
      deleteTitle: (name) => `\u5220\u9664\u5206\u652F ${name}\uFF1F`,
      deleteBody: "\u53EA\u5220\u672C\u5730\u8BB0\u5F55\uFF0C\u8FDC\u7AEF\u5206\u652F\u4E0D\u53D7\u5F71\u54CD\u3002\u8FD9\u6761\u5206\u652F\u72EC\u6709\u7684\u63D0\u4EA4\u4F1A\u4E00\u8D77\u4E22\u6389\uFF0C\u9762\u677F\u4E0D\u80FD\u6062\u590D\u3002",
      deleteConfirm: "\u786E\u8BA4\u5220\u9664",
      switchDirtyTitle: "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8\uFF0C\u4ECD\u8981\u5207\u6362\uFF1F",
      switchDirtyBody: "\u5207\u6362\u540E\u8FD9\u4E9B\u6539\u52A8\u4F1A\u8DDF\u7740\u5E26\u5230\u76EE\u6807\u5206\u652F\uFF1B\u4E24\u8FB9\u6539\u5230\u540C\u4E00\u5904\u65F6 git \u4F1A\u62D2\u7EDD\u5207\u6362\u5E76\u8BF4\u660E\u539F\u56E0\u3002",
      switchConfirm: "\u7EE7\u7EED\u5207\u6362",
      cancel: "\u53D6\u6D88",
      back: "\u8FD4\u56DE\u9762\u677F",
      backList: "\u8FD4\u56DE\u5217\u8868",
      listTitle: "\u672C\u5730\u5206\u652F",
      branchLabel: "\u5206\u652F\u540D",
      createTitle: "\u65B0\u5EFA\u5206\u652F",
      createFrom: (name) => `\u4ECE ${name} \u7684\u5F53\u524D\u63D0\u4EA4\u521B\u5EFA`,
      createPlaceholder: "\u5206\u652F\u540D\uFF0C\u4F8B\u5982 feature/version-control",
      nameHint: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002",
      create: "\u521B\u5EFA\u5206\u652F",
      renameTitle: "\u91CD\u547D\u540D\u5206\u652F",
      renamePlaceholder: "\u65B0\u7684\u5206\u652F\u540D",
      renameSubmit: "\u4FDD\u5B58\u65B0\u540D\u5B57",
      empty: "\u6CA1\u6709\u5339\u914D\u7684\u5206\u652F\u3002",
      detailEmpty: "\u8FD9\u6761\u5206\u652F\u5DF2\u7ECF\u4E0D\u5728\u5217\u8868\u91CC\u3002",
      resultCreated: (name) => `\u5DF2\u521B\u5EFA\u5206\u652F ${name}\uFF0C\u8FD8\u6CA1\u6709\u5207\u6362\u8FC7\u53BB\u3002`,
      resultSwitched: (name) => `\u5DF2\u5207\u6362\u5230\u5206\u652F ${name}\u3002`,
      resultMerged: (target, current, n) => `\u5DF2\u628A ${target} \u5408\u5E76\u8FDB ${current}\uFF0C\u63A5\u5165 ${n} \u4E2A\u63D0\u4EA4\u3002`,
      resultMergedClean: (target, current) => `\u5DF2\u628A ${target} \u5408\u5E76\u8FDB ${current}\uFF0C\u6CA1\u6709\u65B0\u63D0\u4EA4\u9700\u8981\u63A5\u5165\u3002`,
      resultRenamed: (from, to) => `\u5206\u652F ${from} \u5DF2\u6539\u540D\u4E3A ${to}\u3002`,
      resultDeleted: (name) => `\u5DF2\u5220\u9664\u5206\u652F ${name}\u3002`,
      invalidName: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002",
      duplicateName: (name) => `\u5206\u652F ${name} \u5DF2\u7ECF\u5B58\u5728\u3002`,
      cannotDeleteCurrent: "\u4E0D\u80FD\u5220\u9664\u5F53\u524D\u5206\u652F\uFF0C\u5148\u5207\u6362\u5230\u522B\u7684\u5206\u652F\u3002",
      cannotMergeCurrent: "\u4E0D\u80FD\u628A\u5F53\u524D\u5206\u652F\u5408\u5E76\u8FDB\u5B83\u81EA\u5DF1\u3002",
      rebase: "\u53D8\u57FA\u5230\u8FD9\u91CC",
      rebaseCurrent: "\u5F53\u524D\u5206\u652F\u5C31\u662F\u5B83\uFF0C\u4E0D\u80FD\u53D8\u57FA\u5230\u81EA\u5DF1\u3002",
      rebaseTitle: (current, target) => `\u628A ${current} \u53D8\u57FA\u5230 ${target} \u4E0A\uFF1F`,
      rebaseBody: "\u672C\u5730\u5386\u53F2\u4F1A\u88AB\u91CD\u5199\uFF1A\u5148\u653E\u5BF9\u65B9\u5206\u652F\u7684\u63D0\u4EA4\uFF0C\u518D\u63A5\u4E0A\u81EA\u5DF1\u7684\u63D0\u4EA4\u3002\u63D0\u4EA4\u53F7\u4F1A\u53D8\uFF1B\u5982\u679C\u8FD9\u6761\u5206\u652F\u5DF2\u7ECF\u63A8\u9001\u8FC7\uFF0C\u8FDC\u7AEF\u9700\u8981\u5F3A\u63A8\u624D\u80FD\u5BF9\u9F50\u3002",
      rebaseConfirm: "\u786E\u8BA4\u53D8\u57FA"
    },
    worktrees: {
      current: "\u5F53\u524D\u5DE5\u4F5C\u6811",
      others: (n) => `\u5176\u4ED6\u5DE5\u4F5C\u6811 ${n}`,
      empty: "\u4E0D\u5B58\u5728\u5176\u4ED6\u5DE5\u4F5C\u6811",
      emptyHint: "\u6BCF\u68F5\u5DE5\u4F5C\u6811\u90FD\u8981\u5355\u72EC\u68C0\u51FA\uFF1B\u5C55\u5F00\u4E00\u884C\u53EF\u4EE5\u89E3\u9501\u3001\u6E05\u7406\u8BB0\u5F55\u6216\u79FB\u9664\u3002",
      locked: "\u5DF2\u88AB\u5360\u7528",
      prunable: "\u76EE\u5F55\u4E0D\u5B58\u5728",
      lockUnknown: "\u65E0\u6CD5\u5224\u65AD",
      prunableUnknown: "\u65E0\u6CD5\u5224\u65AD",
      bare: "\u88F8\u4ED3\u5E93",
      noBranch: "\u65E0\u5206\u652F",
      copyPath: "\u590D\u5236\u8DEF\u5F84",
      scope: "\u8FD9\u91CC\u5217\u51FA\u5F53\u524D git \u8BB0\u5F55\u7684\u5176\u4ED6\u5DE5\u4F5C\u6811\uFF1B\u672A\u68C0\u51FA\u7684\u672C\u5730\u5206\u652F\u4E0D\u5728\u8FD9\u91CC\u3002",
      boundary: "\u5904\u7406\u52A8\u4F5C\u76F4\u63A5\u5728\u9762\u677F\u91CC\u6267\u884C\uFF0C\u4E0D\u518D\u628A\u547D\u4EE4\u4EA4\u7ED9\u4F60\u590D\u5236\u3002",
      noticeClose: "\u5173\u95ED\u8FD9\u6761\u8BF4\u660E",
      noticeOpen: "\u663E\u793A\u5DE5\u4F5C\u6811\u8303\u56F4\u8BF4\u660E",
      filterAll: "\u5168\u90E8",
      filterAbnormal: "\u9700\u8981\u5904\u7406",
      filterEmpty: "\u6CA1\u6709\u7B26\u5408\u7B5B\u9009\u6761\u4EF6\u7684\u5DE5\u4F5C\u6811\u3002",
      expand: "\u5C55\u5F00\u8BE6\u60C5",
      collapse: "\u6536\u8D77\u8BE6\u60C5",
      detailPath: "\u5B8C\u6574\u8DEF\u5F84",
      detailBranch: "\u5206\u652F",
      detailHead: "\u5F53\u524D\u63D0\u4EA4",
      detailState: "\u72B6\u6001\u8BF4\u660E",
      actionsHint: "\u8FD9\u4E9B\u64CD\u4F5C\u4F1A\u76F4\u63A5\u5728\u9762\u677F\u91CC\u6267\u884C\uFF0C\u4E0D\u518D\u8981\u6C42\u4F60\u53BB\u7EC8\u7AEF\u590D\u5236\u547D\u4EE4\u3002",
      unlock: "\u89E3\u9664\u9501\u5B9A",
      pruneRecord: "\u6E05\u7406\u8BB0\u5F55",
      remove: "\u79FB\u9664\u5DE5\u4F5C\u6811",
      unlockTitle: "\u89E3\u9664\u8FD9\u68F5\u5DE5\u4F5C\u6811\u7684\u5360\u7528\uFF1F",
      unlockBody: "\u89E3\u9501\u53EA\u6E05\u6389 git \u7684\u5360\u7528\u6807\u8BB0\uFF0C\u5DE5\u4F5C\u76EE\u5F55\u4E0E\u6539\u52A8\u90FD\u4E0D\u4F1A\u52A8\uFF1B\u5982\u679C\u6709\u7EC8\u7AEF\u6B63\u5728\u91CC\u9762\u8DD1\u4EFB\u52A1\uFF0C\u4E24\u8FB9\u53EF\u80FD\u4E92\u76F8\u6253\u65AD\u3002",
      unlockConfirm: "\u89E3\u9664\u5360\u7528",
      pruneTitle: "\u6E05\u7406\u8FD9\u6761\u5DF2\u7ECF\u4E0D\u5B58\u5728\u7684\u5DE5\u4F5C\u6811\u8BB0\u5F55\uFF1F",
      pruneBody: "\u53EA\u6E05\u6389 git \u8BB0\u5F55\uFF0C\u4E0D\u4F1A\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\uFF1B\u76EE\u5F55\u786E\u5B9E\u4E0D\u5B58\u5728\u65F6\u624D\u5E94\u8BE5\u70B9\u3002",
      pruneConfirm: "\u6E05\u7406\u8BB0\u5F55",
      removeTitle: (name) => `\u79FB\u9664\u5DE5\u4F5C\u6811 ${name}\uFF1F`,
      removeBody: "\u5220\u9664 git \u8BB0\u5F55\u4E0E\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u5206\u652F\u548C\u63D0\u4EA4\u90FD\u7559\u5728\u4ED3\u5E93\u91CC\uFF1B\u76EE\u5F55\u91CC\u6709\u672A\u63D0\u4EA4\u6539\u52A8\u65F6\u8FD9\u4E00\u6B65\u4F1A\u88AB\u62D2\u7EDD\u3002",
      removeConfirm: "\u786E\u8BA4\u79FB\u9664",
      cancel: "\u53D6\u6D88",
      resultUnlocked: (name) => `\u5DF2\u89E3\u9664\u5360\u7528\uFF1A${name}\u3002`,
      resultPruned: (name) => `\u5DF2\u6E05\u7406\u8BB0\u5F55\uFF1A${name}\u3002`,
      resultRemoved: (name) => `\u5DF2\u79FB\u9664\u5DE5\u4F5C\u6811\uFF1A${name}\u3002`,
      ai: "\u8BA9 AI \u5904\u7406\u5F02\u5E38\u5DE5\u4F5C\u6811"
    },
    /**
     * 贮藏页签：git stash 的完整生命周期。文案只说用户能看见的两件事——
     * 这条记录里放着什么、这一下是拿回来还是彻底丢掉。
     */
    stash: {
      title: "\u8D2E\u85CF",
      empty: "\u8FD8\u6CA1\u6709\u8D2E\u85CF\u8BB0\u5F55",
      emptyHint: "\u5728\u300C\u6539\u52A8\u300D\u9875\u7B7E\u91CC\u70B9\u300C\u8D2E\u85CF\u8FD9\u4E9B\u6539\u52A8\u300D\uFF0C\u5C31\u80FD\u628A\u5F53\u524D\u6539\u52A8\u6253\u5305\u6536\u8D77\u6765\u3002",
      entryMeta: (when, n) => `${when} \xB7 ${n} \u4E2A\u6587\u4EF6`,
      pathsNote: "\u8BB0\u5F55\u91CC\u4FDD\u5B58\u7684\u662F\u6539\u52A8\u53D1\u751F\u65F6\u7684\u6837\u5B50\uFF1B\u5E94\u7528\u4E4B\u540E\u9700\u8981\u91CD\u65B0\u6682\u5B58\u518D\u63D0\u4EA4\u3002",
      apply: "\u5E94\u7528",
      pop: "\u5F39\u51FA",
      drop: "\u4E22\u5F03",
      applyHint: "\u628A\u6539\u52A8\u653E\u56DE\u5DE5\u4F5C\u533A\uFF0C\u8FD9\u6761\u8BB0\u5F55\u4ECD\u7136\u4FDD\u7559",
      popHint: "\u628A\u6539\u52A8\u653E\u56DE\u5DE5\u4F5C\u533A\uFF0C\u5E76\u5220\u9664\u8FD9\u6761\u8BB0\u5F55",
      dropTitle: (id) => `\u4E22\u5F03\u8D2E\u85CF\u8BB0\u5F55 ${id}\uFF1F`,
      dropBody: "\u8BB0\u5F55\u91CC\u90A3\u4E9B\u6587\u4EF6\u5F53\u65F6\u7684\u6837\u5B50\u4F1A\u5F7B\u5E95\u6D88\u5931\uFF0C\u9762\u677F\u4E0D\u80FD\u6062\u590D\u3002",
      dropConfirm: "\u786E\u8BA4\u4E22\u5F03",
      cancel: "\u53D6\u6D88",
      showPaths: "\u770B\u770B\u8FD9\u6761\u8BB0\u5F55\u91CC\u6709\u54EA\u4E9B\u6587\u4EF6",
      hidePaths: "\u6536\u8D77\u6587\u4EF6\u6E05\u5355",
      boundary: "\u8D2E\u85CF\u53EA\u5728\u672C\u5730\uFF0C\u4E0D\u4F1A\u63A8\u9001\uFF1B\u5E94\u7528\u6216\u5F39\u51FA\u65F6\u6309\u8BB0\u5F55\u91CC\u7684\u987A\u5E8F\u653E\u56DE\u5DE5\u4F5C\u533A\u3002",
      restoreNote: (n) => `\u5E94\u7528\u540E\u4F1A\u653E\u56DE ${n} \u4E2A\u6587\u4EF6\uFF0C\u5DF2\u5B58\u5728\u7684\u540C\u540D\u6539\u52A8\u4F1A\u88AB\u5408\u5E76\u6216\u63D0\u793A\u51B2\u7A81\u3002`
    },
    /**
     * AI 交接的全部文案。入口上的那几句故意写成问句：它们要让人意识到
     * 「这件事可以不用自己硬扛」，而不是描述一个功能按钮。
     */
    ai: {
      kicker: "AI HANDOFF",
      copyLabel: "\u590D\u5236\u8FD9\u6BB5\u8BF4\u660E",
      copied: (n) => `\u5DF2\u590D\u5236 ${n} \u4E2A\u5B57\u7B26\uFF0C\u7C98\u8D34\u5230\u65B0\u5BF9\u8BDD\u91CC\u5C31\u80FD\u63A5\u7740\u8C08\u3002`,
      closeLabel: "\u5173\u95ED",
      closeTitle: "\u5173\u95ED\u8FD9\u4EFD\u8BF4\u660E",
      footNote: "\u8BF4\u660E\u91CC\u5305\u542B\u5B8C\u6574\u8DEF\u5F84\u4E0E\u6587\u4EF6\u6E05\u5355\uFF0C\u7C98\u8D34\u524D\u53EF\u4EE5\u5148\u5220\u6389\u4E0D\u60F3\u5916\u53D1\u7684\u90E8\u5206\u3002\u539F\u578B\u91CC\u4E0D\u4F1A\u771F\u7684\u6253\u5F00\u65B0\u5BF9\u8BDD\uFF1B\u63A5\u5165\u5BBF\u4E3B\u540E\uFF0C\u70B9\u4E00\u4E0B\u5C31\u76F4\u63A5\u8FDB\u5165\u65B0\u5BF9\u8BDD\u3002",
      railSub: "\u4E0D\u719F\u6089 Git \u4E5F\u6CA1\u5173\u7CFB\uFF1A\u4ED3\u5E93\u3001\u5206\u652F\u3001\u6539\u52A8\u3001\u5DE5\u4F5C\u6811\u4E00\u8D77\u5E26\u8FC7\u53BB",
      entryTitle: "\u4E0D\u60F3\u4EB2\u81EA\u5904\u7406\uFF1F\u4EA4\u7ED9 AI",
      cleanEntry: "\u60F3\u628A\u5DE5\u4F5C\u6811\u4ECE\u5934\u7406\u4E00\u904D\uFF1F\u4EA4\u7ED9 AI",
      entryAria: (label) => `${label}\uFF1A\u628A\u5F53\u524D\u7248\u672C\u7BA1\u7406\u9875\u7684\u5B8C\u6574\u72B6\u6001\u5E26\u8FDB\u65B0\u5BF9\u8BDD`
    },
    result: {
      committed: (n) => `\u63D0\u4EA4\u5B8C\u6210\uFF1A${n} \u4E2A\u6587\u4EF6\u5DF2\u8FDB\u5165\u5386\u53F2\u3002`,
      pushed: (n, upstream) => `\u63A8\u9001\u5B8C\u6210\uFF1A${n} \u7B14\u63D0\u4EA4\u5DF2\u5230\u8FBE ${upstream}\u3002`,
      nothingToPush: "\u8FDC\u7AEF\u5DF2\u662F\u6700\u65B0\uFF0C\u6CA1\u6709\u9700\u8981\u63A8\u9001\u7684\u63D0\u4EA4\u3002",
      pullUpToDate: "\u5DF2\u662F\u6700\u65B0\u72B6\u6001\u3002",
      pullFastForward: "\u5DF2\u5FEB\u8FDB\u81F3\u8FDC\u7AEF\u6700\u65B0\u3002",
      fetched: "\u66F4\u65B0\u5B8C\u6210\uFF1A\u8FDC\u7AEF\u4F9D\u636E\u5DF2\u5237\u65B0\u3002",
      reloaded: "\u5DF2\u91CD\u65B0\u8BFB\u53D6\u3002",
      aiWorktrees: "\u539F\u578B\u91CC AI \u4EA4\u63A5\u53EA\u505A\u63D0\u793A\uFF1B\u771F\u5B9E\u9875\u9762\u4F1A\u6253\u5F00\u672C\u673A DSH \u4F1A\u8BDD\uFF0C\u5E76\u5E26\u4E0A\u5F02\u5E38\u5DE5\u4F5C\u6811\u6E05\u5355\u3002",
      simulated: "\u539F\u578B\u6A21\u62DF"
    },
    changeLabel: {
      added: "\u65B0\u589E",
      modified: "\u4FEE\u6539",
      deleted: "\u5220\u9664",
      renamed: "\u91CD\u547D\u540D",
      typechange: "\u7C7B\u578B\u53D8\u66F4",
      untracked: "\u672A\u8DDF\u8E2A"
    }
  };

  // src/shared/version-control/src/state.ts
  function shortestUniqueSuffix(paths) {
    const segs = paths.map((p) => String(p).replace(/\\/g, "/").split("/").filter((s) => s !== ""));
    return segs.map((s, i) => {
      for (let n = 1; n <= s.length; n += 1) {
        const tail = s.slice(-n).join("/").toLowerCase();
        let clash = false;
        for (let j = 0; j < segs.length; j += 1) {
          if (j === i) continue;
          if (segs[j].slice(-n).join("/").toLowerCase() === tail) {
            clash = true;
            break;
          }
        }
        if (!clash) return n;
      }
      return s.length;
    });
  }
  function sameWorktreePath(a, b) {
    const norm = (p) => {
      const s = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
      const drive = /^([a-zA-Z]):/.exec(s);
      return drive ? s.charAt(0).toLowerCase() + s.slice(1) : s;
    };
    return norm(a) === norm(b);
  }
  function displayFor(path, keep) {
    const segs = String(path).replace(/\\/g, "/").split("/").filter((s) => s !== "");
    return segs.slice(-Math.max(1, keep)).join("/");
  }
  function describeTime(nowMs, tMs) {
    const diff = nowMs - tMs;
    if (diff >= 0 && diff < 7 * 24 * 3600 * 1e3) return { style: "relative", minutes: Math.max(0, Math.floor(diff / 6e4)) };
    return { style: "absolute", ms: tMs };
  }
  function toChange(e) {
    if (e.kind === "untracked") return { change: "untracked", conflict: false };
    if (e.kind === "unmerged") return { change: "modified", conflict: true };
    if (e.kind === "renamed") return { change: "renamed", conflict: false };
    if (e.kind === "ignored") return { change: "modified", conflict: false };
    if (e.x === "A" || e.y === "A") return { change: "added", conflict: false };
    if (e.x === "D" || e.y === "D") return { change: "deleted", conflict: false };
    if (e.x === "T" || e.y === "T") return { change: "typechange", conflict: false };
    return { change: "modified", conflict: false };
  }
  function rankFor(f) {
    if (f.staged) return 0;
    if (f.conflict) return 1;
    return 2;
  }
  function assemble(input) {
    if (input.bare) {
      const repo2 = { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: input.commits.length > 0, bare: true, tier: input.tier, autocrlf: input.autocrlf };
      const identity2 = { worktreeDisplay: "", worktreePath: input.repoRoot, branch: null, detached: false, oid: null, sync: "detached", ahead: 0, behind: 0, basisMs: null };
      return { ok: true, screen: { identity: identity2, staged: [], unstaged: [], stagedCount: 0, unstagedCount: 0, conflictCount: 0, otherWorktrees: [], branches: [], commits: [], repo: repo2 } };
    }
    const counts = /* @__PURE__ */ new Map();
    for (const d of input.diffFiles) counts.set(d.path, d);
    const files = [];
    for (const e of input.statusEntries) {
      if (e.kind === "ignored") continue;
      const { change, conflict } = toChange(e);
      const c = counts.get(e.path);
      files.push({
        path: e.path,
        origPath: e.origPath,
        // 冲突（unmerged）既不是已暂存也不是未暂存，是一个待处理状态：两个标记都置 false，
        // 免得同一个文件被同时算进两组（#819 复审 P0-2）；未跟踪就是未暂存的改动，unstaged 置真（P2-7）。
        staged: e.kind === "unmerged" ? false : e.x !== "." && e.x !== "?" && e.x !== "!",
        unstaged: e.kind === "unmerged" ? false : e.y !== "." && e.y !== "?" && e.y !== "!" || e.kind === "untracked",
        change,
        conflict,
        addedLines: c ? c.added : null,
        deletedLines: c ? c.deleted : null
      });
    }
    files.sort((a, b) => rankFor(a) - rankFor(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const staged = files.filter((f) => f.staged);
    const unstaged = files.filter((f) => f.unstaged || f.conflict);
    const allPaths = input.worktrees.map((w) => w.path);
    const keeps = shortestUniqueSuffix(allPaths.length > 0 ? allPaths : [input.repoRoot]);
    let currentPath = input.repoRoot;
    const byPath = input.worktrees.find((w) => sameWorktreePath(w.path, input.repoRoot));
    if (byPath) currentPath = byPath.path;
    else if (!input.statusDetached && input.statusHead) {
      const hit = input.worktrees.find((w) => w.branch === input.statusHead);
      if (hit) currentPath = hit.path;
    } else if (input.statusDetached && input.statusOid) {
      const hit = input.worktrees.find((w) => w.head === input.statusOid);
      if (hit) currentPath = hit.path;
    }
    let sync = "no-upstream";
    if (input.statusDetached) sync = "detached";
    else if (!input.statusUpstream) sync = "no-upstream";
    else {
      const ref = input.refs.find((r) => r.short === input.statusHead);
      if (ref && ref.upstreamGone) sync = "upstream-gone";
      else if (input.basisMs === null) sync = "tracked-unknown";
      else sync = "tracked-known";
    }
    const keepOf = (p) => {
      const i = input.worktrees.findIndex((w) => sameWorktreePath(w.path, p));
      return (i >= 0 ? keeps[i] : 1) || 1;
    };
    const identity = {
      worktreeDisplay: displayFor(currentPath, keepOf(currentPath)),
      worktreePath: currentPath,
      branch: input.statusDetached ? null : input.statusHead,
      detached: input.statusDetached,
      oid: input.statusOid,
      sync,
      ahead: input.statusAhead,
      behind: input.statusBehind,
      basisMs: input.basisMs
    };
    const others = input.worktrees.filter((w) => !sameWorktreePath(w.path, currentPath)).map((w) => ({
      path: w.path,
      display: displayFor(w.path, keepOf(w.path)),
      head: w.head || "",
      branch: w.branch,
      bare: w.bare,
      current: false,
      locked: w.locked,
      lockReason: w.lockReason,
      // 降级档（git 2.11–2.30）答不出「被锁定」与「目录还在不在」这两件事：答不出写成 unknown，
      // 绝不当成 false —— 否则界面会把一个目录已经不存在的工作树画成还能用（#819 复审 P1-5）。
      lockUnknown: input.tier !== "full" && !w.locked,
      prunable: w.prunable,
      prunableUnknown: input.tier !== "full" && !w.prunable
    }));
    const commits = input.commits.map((c) => ({
      oid: c.oid,
      short: c.short,
      author: c.author,
      email: c.email,
      authorDateMs: c.authorDateMs,
      commitDateMs: c.commitDateMs,
      subject: c.subject,
      parents: c.parents
    }));
    const branches = input.refs.map((r) => ({
      short: r.short,
      oid: r.oid,
      upstream: r.upstream,
      upstreamGone: r.upstreamGone,
      ahead: r.ahead,
      behind: r.behind,
      current: r.short === input.statusHead && !input.statusDetached
    }));
    const repo = {
      merging: input.merging,
      rebasing: input.rebasing,
      cherryPicking: input.cherryPicking,
      reverting: input.reverting,
      hasCommits: input.statusOid !== null || commits.length > 0,
      bare: false,
      tier: input.tier,
      autocrlf: input.autocrlf
    };
    return {
      ok: true,
      screen: {
        identity,
        staged,
        unstaged,
        stagedCount: files.filter((f) => f.staged).length,
        unstagedCount: files.filter((f) => f.unstaged).length,
        conflictCount: files.filter((f) => f.conflict).length,
        otherWorktrees: others,
        branches,
        commits,
        repo
      }
    };
  }

  // src/shared/version-control/src/rules.ts
  function midReasons(s) {
    const out = [];
    if (s.repo.merging) out.push("mid-merge");
    if (s.repo.rebasing) out.push("mid-rebase");
    if (s.repo.cherryPicking || s.repo.reverting) out.push("mid-cherry-revert");
    return out;
  }
  function judgeStage(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.unstagedCount === 0) return { verdict: "block", reasons: ["nothing-to-stage"] };
    const mid = midReasons(s);
    if (mid.length > 0) return { verdict: "warn", reasons: mid };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgeCommit(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.conflictCount > 0) return { verdict: "block", reasons: ["conflicts-unresolved"] };
    if (s.stagedCount === 0) return { verdict: "block", reasons: ["nothing-staged"] };
    const mid = midReasons(s);
    if (s.identity.detached) return { verdict: "warn", reasons: ["detached-head"].concat(mid) };
    if (mid.length > 0) return { verdict: "warn", reasons: mid };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgePull(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.identity.detached) return { verdict: "block", reasons: ["detached-head"] };
    if (s.identity.sync === "no-upstream") return { verdict: "block", reasons: ["no-upstream"] };
    if (s.identity.sync === "upstream-gone") return { verdict: "block", reasons: ["upstream-gone"] };
    if (s.conflictCount > 0) return { verdict: "block", reasons: ["conflicts-unresolved"] };
    const mid = midReasons(s);
    if (mid.length > 0) return { verdict: "block", reasons: mid };
    if (s.stagedCount > 0 || s.unstagedCount > 0) return { verdict: "warn", reasons: ["dirty-tree"] };
    if (s.identity.basisMs === null) return { verdict: "warn", reasons: ["basis-unknown"] };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgePush(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    if (s.identity.detached) return { verdict: "block", reasons: ["detached-head"] };
    if (s.identity.sync === "no-upstream") return { verdict: "block", reasons: ["no-upstream"] };
    if (s.identity.sync === "upstream-gone") return { verdict: "block", reasons: ["upstream-gone"] };
    if (s.conflictCount > 0) return { verdict: "block", reasons: ["conflicts-unresolved"] };
    const mid = midReasons(s);
    if (mid.length > 0) return { verdict: "block", reasons: mid };
    if (s.identity.behind > 0) return { verdict: "block", reasons: ["behind-remote"] };
    if (s.identity.basisMs === null) return { verdict: "warn", reasons: ["basis-unknown"] };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judgeFetch(s) {
    if (s.repo.bare) return { verdict: "block", reasons: ["bare-repo"] };
    return { verdict: "allow", reasons: ["ok"] };
  }
  function judge(screen, op) {
    switch (op) {
      case "stage":
        return judgeStage(screen);
      case "commit":
        return judgeCommit(screen);
      case "pull":
        return judgePull(screen);
      case "push":
        return judgePush(screen);
      case "fetch":
        return judgeFetch(screen);
      default:
        return { verdict: "block", reasons: ["unknown-operation"] };
    }
  }

  // docs/prototype/vc-redesign/src/data/format.ts
  function whenText(nowMs, ms) {
    const described = describeTime(nowMs, ms);
    if (described.style === "absolute") return clockText(described.ms, nowMs);
    const minutes = described.minutes;
    if (minutes < 1) return "\u521A\u521A";
    if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
    return `${Math.floor(hours / 24)} \u5929\u524D`;
  }
  function clockText(ms, nowMs) {
    const date = new Date(ms);
    const now = new Date(nowMs);
    const pad = (n) => String(n).padStart(2, "0");
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return date.getFullYear() === now.getFullYear() ? `${month} \u6708 ${day} \u65E5 ${time}` : `${date.getFullYear()} \u5E74 ${month} \u6708 ${day} \u65E5`;
  }
  function splitPath(path) {
    const normalized = path.replace(/\\/g, "/");
    const cut = normalized.lastIndexOf("/");
    if (cut < 0) return { dir: "", name: normalized };
    return { dir: normalized.slice(0, cut + 1), name: normalized.slice(cut + 1) };
  }
  function changeBadge(change) {
    switch (change) {
      case "added":
        return { letter: "A", tone: "add" };
      case "deleted":
        return { letter: "D", tone: "del" };
      case "renamed":
        return { letter: "R", tone: "rename" };
      case "typechange":
        return { letter: "T", tone: "type" };
      case "untracked":
        return { letter: "?", tone: "untracked" };
      default:
        return { letter: "M", tone: "mod" };
    }
  }
  function syncModel(sync, ahead, behind) {
    switch (sync) {
      case "tracked-known":
      case "tracked-unknown":
        return { kind: "counts", ahead, behind };
      case "no-upstream":
        return { kind: "text", text: "\u5C1A\u672A\u8BBE\u7F6E\u4E0A\u6E38", tone: "muted" };
      case "upstream-gone":
        return { kind: "text", text: "\u63A8\u9001\u76EE\u6807\u5DF2\u4E0D\u5B58\u5728", tone: "warn" };
      case "detached":
        return { kind: "text", text: "\u6E38\u79BB\u5934\u6307\u9488", tone: "muted" };
      default:
        return { kind: "text", text: "\u540C\u6B65\u72B6\u6001\u8BFB\u4E0D\u5230", tone: "warn" };
    }
  }
  function lineDelta(added, deleted) {
    return {
      added: added === null || added === 0 ? null : `+${added}`,
      deleted: deleted === null || deleted === 0 ? null : `\u2212${deleted}`
    };
  }
  function shortOid(oid) {
    return oid.slice(0, 7);
  }

  // docs/prototype/vc-redesign/src/data/repo.generated.ts
  var capturedRepoRoot = "D:\\dsh-plugin\\dsh-mattpocock-skills-deck";
  var capturedHead = "a65498e89293c36f3f0781e38ee986d30bfe2418";
  var capturedBranch = "main";
  var capturedCommits = [
    {
      "oid": "a65498e89293c36f3f0781e38ee986d30bfe2418",
      "short": "a65498e8",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793091381e3,
      "subject": "\u65B0\u4F1A\u8BDD\u51B3\u7B56\u94FE\u52A0\u5E38\u9A7B\u8BCA\u65AD\u65E5\u5FD7\uFF0C\u4E0B\u6B21\u590D\u53D1\u53EF\u76F4\u63A5\u67E5\u65E5\u5FD7\u5B9A\u4F4D",
      "parents": [
        "a1151f6bd3c57382a42d09384ddc91645bf75fdd"
      ],
      "files": [
        {
          "path": "research/489-appendix.md",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "scripts/generated/logKernel.derived.js",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/client/kernel/api-new-session.ts",
          "added": 21,
          "deleted": 7
        },
        {
          "path": "src/client/kernel/api-workspace.ts",
          "added": 14,
          "deleted": 7
        },
        {
          "path": "src/shared/log-event-list.ts",
          "added": 8,
          "deleted": 0
        },
        {
          "path": "tests/verify-log-count.ts",
          "added": 13,
          "deleted": 4
        },
        {
          "path": "tests/verify-log-fields.ts",
          "added": 14,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "a1151f6bd3c57382a42d09384ddc91645bf75fdd",
      "short": "a1151f6b",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179309132e4,
      "subject": "Merge branch 'main' of https://github.com/FeatherHunter/dsh-mattpocock-skills-deck",
      "parents": [
        "7ca4e016ed3a2b61c678a0daac39986baf3aa0eb",
        "2af91abb6447c7070c9747be55f1ac94f8205dcb"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "docs/README.en.md",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "docs/thanks-data.json",
          "added": 48,
          "deleted": 3
        },
        {
          "path": "package/README.md",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "src/client/kernel/ticket-label.ts",
          "added": 16,
          "deleted": 15
        },
        {
          "path": "src/client/views/shared/workRouteTable.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1082-work-route-table.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1511-ticket-label.ts",
          "added": 11,
          "deleted": 10
        },
        {
          "path": "tests/verify-1548-map-row-nav.ts",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "tests/verify-1565-workroute-first-col-browser.ts",
          "added": 12,
          "deleted": 5
        },
        {
          "path": "tests/verify-chain-capsule.ts",
          "added": 5,
          "deleted": 4
        }
      ]
    },
    {
      "oid": "7ca4e016ed3a2b61c678a0daac39986baf3aa0eb",
      "short": "7ca4e016",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793091277e3,
      "subject": "GitLab \u5DE5\u4F5C\u533A\u7684\u8865\u8EAB\u4EFD\u4E0D\u518D\u88AB\u300C\u53EA\u7ED9 GitHub \u95EE\u300D\u6321\u4F4F\uFF1A\u62BD\u51FA\u5171\u4EAB\u8865\u9F50\u5B9E\u73B0\u5E76\u8BA9\u5237\u65B0\u4E0E deck \u5DE5\u5177\u5171\u7528\uFF08#1583\uFF09",
      "parents": [
        "8400af7106bac3eb886c30093b8204669faa1beb"
      ],
      "files": [
        {
          "path": "src/deck/tools/tracker-session.ts",
          "added": 24,
          "deleted": 17
        },
        {
          "path": "src/refresh/rooms/host/session-opener.ts",
          "added": 38,
          "deleted": 30
        },
        {
          "path": "src/tracker/session/repo-ref.ts",
          "added": 175,
          "deleted": 0
        },
        {
          "path": "tests/gate-map.json",
          "added": 36,
          "deleted": 10
        },
        {
          "path": "tests/verify-1439-panel-accounting.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "tests/verify-1443-static-gate.ts",
          "added": 8,
          "deleted": 3
        },
        {
          "path": "tests/verify-1453-repo-locate-via-session.ts",
          "added": 6,
          "deleted": 1
        },
        {
          "path": "tests/verify-1583-repo-ref-fallback.ts",
          "added": 211,
          "deleted": 0
        },
        {
          "path": "tests/verify-deck-repo-resolve.ts",
          "added": 10,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "2af91abb6447c7070c9747be55f1ac94f8205dcb",
      "short": "2af91abb",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793091101e3,
      "subject": "\u5408\u5E76#1579\u7968\u53F7\u5FBD\u6807\u659C\u6760\u4FEE\u590D\u5230\u4E3B\u5206\u652F",
      "parents": [
        "94381254ee5415994abe04a5444511da8e2fabcd",
        "061b6f78806ca74f60c5732249c1de757a9fb86e"
      ],
      "files": [
        {
          "path": "src/client/kernel/ticket-label.ts",
          "added": 16,
          "deleted": 15
        },
        {
          "path": "src/client/views/shared/workRouteTable.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1082-work-route-table.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1511-ticket-label.ts",
          "added": 11,
          "deleted": 10
        },
        {
          "path": "tests/verify-1548-map-row-nav.ts",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "tests/verify-1565-workroute-first-col-browser.ts",
          "added": 12,
          "deleted": 5
        },
        {
          "path": "tests/verify-chain-capsule.ts",
          "added": 5,
          "deleted": 4
        }
      ]
    },
    {
      "oid": "061b6f78806ca74f60c5732249c1de757a9fb86e",
      "short": "061b6f78",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793090702e3,
      "subject": "\u4FEE\u590D\u672C\u5730\u540E\u7AEF\u7968\u53F7\u5FBD\u6807\u659C\u6760\u88AB\u7701\u7565\u7684\u95EE\u9898\uFF0C\u4E0A\u9650\u6536\u7A84\u523085\u50CF\u7D20\uFF08#1579\uFF09",
      "parents": [
        "8400af7106bac3eb886c30093b8204669faa1beb"
      ],
      "files": [
        {
          "path": "src/client/kernel/ticket-label.ts",
          "added": 16,
          "deleted": 15
        },
        {
          "path": "src/client/views/shared/workRouteTable.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1082-work-route-table.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1511-ticket-label.ts",
          "added": 11,
          "deleted": 10
        },
        {
          "path": "tests/verify-1548-map-row-nav.ts",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "tests/verify-1565-workroute-first-col-browser.ts",
          "added": 12,
          "deleted": 5
        },
        {
          "path": "tests/verify-chain-capsule.ts",
          "added": 5,
          "deleted": 4
        }
      ]
    },
    {
      "oid": "94381254ee5415994abe04a5444511da8e2fabcd",
      "short": "94381254",
      "author": "github-actions[bot]",
      "email": "github-actions[bot]@users.noreply.github.com",
      "authorDateMs": 1793089241e3,
      "subject": "\u81F4\u8C22\u8868\u81EA\u52A8\u66F4\u65B0\uFF1A\u628A\u65B0\u7F16\u53F7\u8D21\u732E\u5E76\u8FDB\u6765\uFF0C\u4E2D\u82F1\u4E24\u8868\u6309\u82B1\u6570\u4E0E\u6700\u540E\u6D3B\u8DC3\u91CD\u6392",
      "parents": [
        "8400af7106bac3eb886c30093b8204669faa1beb"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "docs/README.en.md",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "docs/thanks-data.json",
          "added": 48,
          "deleted": 3
        },
        {
          "path": "package/README.md",
          "added": 4,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "8400af7106bac3eb886c30093b8204669faa1beb",
      "short": "8400af71",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793088422e3,
      "subject": "\u5BF9\u9F50\u659C\u6760\u8FB9\u754C\u5230\u7968\u9762\u7EA6\u5B9A\uFF1A\u659C\u6760\u524D\u7684\u8FDE\u5B57\u7B26\u4E0D\u518D\u6321\u4F4F\u6280\u80FD\u540D\u5165\u53E3\uFF0C\u5E76\u7ED9\u8FDE\u5B57\u7B26\u8FB9\u754C\u52A0\u4E00\u9053\u6B63\u4F8B\u95E8\u7981\uFF08#1556\uFF09",
      "parents": [
        "34befb54d65a4d6114985aca4a008b1e82d8374f"
      ],
      "files": [
        {
          "path": "src/client/views/skillDetail/PixelMarkdown.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-skill-detail-stack.ts",
          "added": 4,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "34befb54d65a4d6114985aca4a008b1e82d8374f",
      "short": "34befb54",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179308831e4,
      "subject": "\u6280\u80FD\u8BE6\u60C5\u6B63\u6587\u652F\u6301\u666E\u901A\u6587\u5B57\u91CC\u7684\u6280\u80FD\u540D\u5165\u53E3\uFF1A\u666E\u901A\u6587\u5B57\u5C42\u65B0\u589E\u659C\u6760\u52A0\u540D\u5355\u67E5\u8868\u89C4\u5219\uFF0C\u590D\u7528\u5DF2\u6709\u5224\u5B9A\u4E0E\u5165\u53E3\u6784\u4EF6\uFF0C\u8BA9/implement\u91CC\u7684/tdd\u4E0E/code-review\u70B9\u5F97\u5F00\uFF08#1556\uFF09",
      "parents": [
        "f551c39bcf288088e6c6cd83eb2b872a38e6c737"
      ],
      "files": [
        {
          "path": "src/client/views/skillDetail/PixelMarkdown.ts",
          "added": 18,
          "deleted": 7
        },
        {
          "path": "tests/verify-skill-detail-stack.ts",
          "added": 88,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "f551c39bcf288088e6c6cd83eb2b872a38e6c737",
      "short": "f551c39b",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793088256e3,
      "subject": "Merge branch 'main' of https://github.com/FeatherHunter/dsh-mattpocock-skills-deck",
      "parents": [
        "a94c9be423578e2469212ecd5566473d15d5dbd1",
        "d76e93cc0fdbd3fe68837ad43d30e358430ad83d"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/README.en.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/star-history-dark.svg",
          "added": 15,
          "deleted": 15
        },
        {
          "path": "docs/star-history-light.svg",
          "added": 15,
          "deleted": 15
        },
        {
          "path": "docs/star-history.json",
          "added": 69,
          "deleted": 64
        }
      ]
    },
    {
      "oid": "a94c9be423578e2469212ecd5566473d15d5dbd1",
      "short": "a94c9be4",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793088232e3,
      "subject": "\u672C\u5730 Markdown \u5DE5\u4F5C\u533A\u7684\u7968\u8BE6\u60C5\u4E0D\u518D\u62A5 refId missing\uFF1A\u4F1A\u8BDD\u88C5\u914D\u6309\u6A21\u5757\u4F18\u5148\u8865\u9F50\u4E24\u6761\u5B9A\u4F4D\u53E3\uFF08#1581\uFF09",
      "parents": [
        "4d3153dca51ae55ed316a383ee7ee25a259d5569"
      ],
      "files": [
        {
          "path": "src/tracker/session/open-tracker.ts",
          "added": 21,
          "deleted": 3
        },
        {
          "path": "tests/gate-map.json",
          "added": 29,
          "deleted": 6
        },
        {
          "path": "tests/verify-1581-session-locators.ts",
          "added": 208,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "d76e93cc0fdbd3fe68837ad43d30e358430ad83d",
      "short": "d76e93cc",
      "author": "github-actions[bot]",
      "email": "github-actions[bot]@users.noreply.github.com",
      "authorDateMs": 1793087468e3,
      "subject": "\u6BCF\u65E5\u66F4\u65B0 Star History\uFF1A\u8FFD\u52A0\u62C9\u53D6\u5230\u7684\u661F\u6807\u6570\u636E\u5E76\u91CD\u65B0\u751F\u6210\u624B\u7ED8\u53CC\u4E3B\u9898\u56FE\u8868",
      "parents": [
        "4d3153dca51ae55ed316a383ee7ee25a259d5569"
      ],
      "files": [
        {
          "path": "README.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/README.en.md",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "docs/star-history-dark.svg",
          "added": 15,
          "deleted": 15
        },
        {
          "path": "docs/star-history-light.svg",
          "added": 15,
          "deleted": 15
        },
        {
          "path": "docs/star-history.json",
          "added": 69,
          "deleted": 64
        }
      ]
    },
    {
      "oid": "4d3153dca51ae55ed316a383ee7ee25a259d5569",
      "short": "4d3153dc",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793087054e3,
      "subject": "\u5BFC\u89C8\u6587\u6863\u5F15\u7528\u6309\u4ECA\u5929\u7684\u4EE3\u7801\u91CD\u65B0\u5BF9\u9F50\uFF1A\u4FEE\u6B63 296 \u884C\u8DEF\u5F84\u4E0E\u884C\u53F7\uFF08#1531\uFF09",
      "parents": [
        "560b8d7c5a1800e4e57505a3a166443153dfba4a"
      ],
      "files": [
        {
          "path": "docs/tour/deck-call-end-to-end.md",
          "added": 297,
          "deleted": 297
        }
      ]
    },
    {
      "oid": "560b8d7c5a1800e4e57505a3a166443153dfba4a",
      "short": "560b8d7c",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793085495e3,
      "subject": "\u628A\u7248\u672C\u53F7\u63A8\u8FDB\u5230 1.9.0-beta.27\uFF1Abeta.26 \u4E4B\u540E\u6536\u53E3\u7968\u9762\u5DE5\u5177\u65E0\u635F\u56DE\u6267\u3001\u5355\u7968\u8584\u8BFB\u4E0E\u5728\u529E\u8868\u72EC\u7ACB\u5DE5\u5177\u7B49\u6539\u52A8\uFF0C\u91CD\u53D1\u4E00\u7248\u8BA9\u5347\u7EA7\u751F\u6548",
      "parents": [
        "9bec100b95504e3970472ce1b68cf41f5b3da656"
      ],
      "files": [
        {
          "path": "CHANGELOG.md",
          "added": 66,
          "deleted": 0
        },
        {
          "path": "package.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "package/CHANGELOG.md",
          "added": 24,
          "deleted": 0
        },
        {
          "path": "package/README.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "package/package.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-config-store-package.ts",
          "added": 1,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "9bec100b95504e3970472ce1b68cf41f5b3da656",
      "short": "9bec100b",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793084574e3,
      "subject": "\u63A5\u624B\u4E0E\u8865\u5145\u63D0\u793A\u8BCD\u6539\u6302 triage \u6280\u80FD\u5E76\u8865\u9F50\u72B6\u6001\u5206\u652F\uFF08#1577\uFF09",
      "parents": [
        "a95b4fb567ebf7fc798c6a4c80dc0d7c5de0efdb"
      ],
      "files": [
        {
          "path": "config/prompts/ticket-action-templates.yaml",
          "added": 68,
          "deleted": 54
        },
        {
          "path": "tests/verify-1407-next-steps-reminders.ts",
          "added": 3,
          "deleted": 2
        },
        {
          "path": "tests/verify-prompts.ts",
          "added": 45,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "a95b4fb567ebf7fc798c6a4c80dc0d7c5de0efdb",
      "short": "a95b4fb5",
      "author": "\u738B\u8FB0\u6D69",
      "email": "975559549@qq.com",
      "authorDateMs": 1793081976e3,
      "subject": "Merge pull request #1575 from FeatherHunter/fix/1505-chain-env-selection",
      "parents": [
        "0918cf9cc500be97d18b53cdea87255d18bd8479",
        "e4122bb570906366f39df1f8005971835f76ab51"
      ],
      "files": [
        {
          "path": "src/refresh/rooms/host/check-chain-evaluation.ts",
          "added": 21,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 21,
          "deleted": 4
        },
        {
          "path": "tests/verify-1505-chain-env-selection.ts",
          "added": 243,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "e4122bb570906366f39df1f8005971835f76ab51",
      "short": "e4122bb5",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793081824e3,
      "subject": "\u628A\u8FDC\u7AEF main \u65B0\u5408\u5165\u7684 #1576 \u6539\u52A8\u5408\u8FDB #1505 \u5206\u652F\uFF0C\u95E8\u7981\u5F52\u5C5E\u8868\u6309\u5408\u5E76\u540E\u7684\u6811\u91CD\u65B0\u751F\u6210",
      "parents": [
        "55c64c9954675e4105b892d62f633fbdca4ae334",
        "0918cf9cc500be97d18b53cdea87255d18bd8479"
      ],
      "files": [
        {
          "path": "scripts/gate-map.mts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "src/refresh/rooms/host/chain-env-map.ts",
          "added": 67,
          "deleted": 8
        },
        {
          "path": "src/tracker/rooms/github/blocked-by-write.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/comment-paging.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/counts.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/github/deps-read.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/errors.ts",
          "added": 14,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/issues.ts",
          "added": 5,
          "deleted": 5
        },
        {
          "path": "src/tracker/rooms/github/page.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/github/sub-issues.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/fixtures/error-samples.ts",
          "added": 26,
          "deleted": 0
        },
        {
          "path": "tests/gate-map.json",
          "added": 21,
          "deleted": 5
        },
        {
          "path": "tests/verify-1187-gitlab-chain-predicates.ts",
          "added": 11,
          "deleted": 0
        },
        {
          "path": "tests/verify-1418-probe-cost-and-failure.ts",
          "added": 8,
          "deleted": 0
        },
        {
          "path": "tests/verify-1571-gh-flag-writing.ts",
          "added": 112,
          "deleted": 0
        },
        {
          "path": "tests/verify-916-ghauth-crosscheck.ts",
          "added": 41,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "0918cf9cc500be97d18b53cdea87255d18bd8479",
      "short": "0918cf9c",
      "author": "\u738B\u8FB0\u6D69",
      "email": "975559549@qq.com",
      "authorDateMs": 1793081678e3,
      "subject": "Merge pull request #1576 from FeatherHunter/ticket/1571-closure-small",
      "parents": [
        "0d50024bbaa4dbe650cd5ba405671b33ad1cb7d5",
        "89bde1d8fe3bbff221b4fa5233f558beb5c4a745"
      ],
      "files": [
        {
          "path": "scripts/gate-map.mts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "src/refresh/rooms/host/chain-env-map.ts",
          "added": 67,
          "deleted": 8
        },
        {
          "path": "src/tracker/rooms/github/blocked-by-write.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/comment-paging.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/counts.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/github/deps-read.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/errors.ts",
          "added": 14,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/issues.ts",
          "added": 5,
          "deleted": 5
        },
        {
          "path": "src/tracker/rooms/github/page.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/github/sub-issues.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/fixtures/error-samples.ts",
          "added": 26,
          "deleted": 0
        },
        {
          "path": "tests/gate-map.json",
          "added": 21,
          "deleted": 5
        },
        {
          "path": "tests/verify-1187-gitlab-chain-predicates.ts",
          "added": 11,
          "deleted": 0
        },
        {
          "path": "tests/verify-1418-probe-cost-and-failure.ts",
          "added": 8,
          "deleted": 0
        },
        {
          "path": "tests/verify-1571-gh-flag-writing.ts",
          "added": 112,
          "deleted": 0
        },
        {
          "path": "tests/verify-916-ghauth-crosscheck.ts",
          "added": 41,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "89bde1d8fe3bbff221b4fa5233f558beb5c4a745",
      "short": "89bde1d8",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793081633e3,
      "subject": "\u5408\u5E76 origin/main 0d50024b \u5230 #1571 \u4FEE\u590D\u5206\u652F\uFF0C\u91CD\u751F\u6210\u95E8\u7981\u5F52\u5C5E\u8868",
      "parents": [
        "179a06130223d8ad7b5b3fc9cf1119263bece34c",
        "0d50024bbaa4dbe650cd5ba405671b33ad1cb7d5"
      ],
      "files": [
        {
          "path": ".gitignore",
          "added": 4,
          "deleted": 0
        },
        {
          "path": "AGENTS.md",
          "added": 5,
          "deleted": 1
        },
        {
          "path": "GLOSSARY.md",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "docs/adr/20260921-tracker-choice-precedence.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 28,
          "deleted": 2
        },
        {
          "path": "docs/tour/deck-call-end-to-end.md",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "package/package.json",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "research/1555-triage-2026-10-26.md",
          "added": 56,
          "deleted": 0
        },
        {
          "path": "research/1566-triage-2026-10-27.md",
          "added": 108,
          "deleted": 0
        },
        {
          "path": "research/1568-npm-publish-manifest-diagnosis.md",
          "added": 26,
          "deleted": 0
        },
        {
          "path": "research/1572-triage-2026-10-27.md",
          "added": 125,
          "deleted": 0
        },
        {
          "path": "research/489-appendix.md",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "screenshots.json",
          "added": 1,
          "deleted": 3
        },
        {
          "path": "scripts/issue-emergency.ps1",
          "added": 188,
          "deleted": 0
        },
        {
          "path": "specs/1106-deck-tool-surface-spec.md",
          "added": 23,
          "deleted": 15
        },
        {
          "path": "src/client/kernel/ticket-label.ts",
          "added": 21,
          "deleted": 0
        },
        {
          "path": "src/client/statusbar/SessionChainCapsule.ts",
          "added": 10,
          "deleted": 8
        },
        {
          "path": "src/deck/registration/agent-row.ts",
          "added": 7,
          "deleted": 6
        },
        {
          "path": "src/deck/registration/host-assemble.ts",
          "added": 16,
          "deleted": 13
        },
        {
          "path": "src/deck/registration/host-delegate.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/rules/tool-order.ts",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "src/deck/shell/body-digest.ts",
          "added": 110,
          "deleted": 0
        },
        {
          "path": "src/deck/shell/work-path-record.ts",
          "added": 17,
          "deleted": 63
        },
        {
          "path": "src/deck/tools/context.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-create-parts.ts",
          "added": 0,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-create.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-get.ts",
          "added": 24,
          "deleted": 7
        },
        {
          "path": "src/deck/tools/issue-list.ts",
          "added": 15,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-patch-definition.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/issue-patch.ts",
          "added": 20,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/issue-report.ts",
          "added": 4,
          "deleted": 6
        },
        {
          "path": "src/deck/tools/map-link.ts",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/map-plan-create.ts",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/work-route.ts",
          "added": 218,
          "deleted": 0
        },
        {
          "path": "src/host/index.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/refresh/kernel/tool-call-budget.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "src/refresh/registry/deck-tool-bridge.ts",
          "added": 9,
          "deleted": 4
        },
        {
          "path": "src/refresh/rooms/host/chain-env-map.ts",
          "added": 45,
          "deleted": 0
        },
        {
          "path": "src/refresh/rooms/host/check-chain-evaluation.ts",
          "added": 21,
          "deleted": 8
        },
        {
          "path": "src/refresh/rooms/host/comment-thread-fetch.ts",
          "added": 15,
          "deleted": 5
        },
        {
          "path": "src/refresh/rooms/host/gh-queue-race.ts",
          "added": 7,
          "deleted": 10
        },
        {
          "path": "src/refresh/rooms/host/git-execution.ts",
          "added": 72,
          "deleted": 2
        },
        {
          "path": "src/refresh/rooms/host/session-decision.ts",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "src/tracker/contract/entities.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "src/tracker/contract/inputs.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/detection/backendDecision.ts",
          "added": 23,
          "deleted": 149
        },
        {
          "path": "src/tracker/detection/readEvidenceLayers.ts",
          "added": 197,
          "deleted": 0
        },
        {
          "path": "src/tracker/kernel/outbound-tiers.ts",
          "added": 18,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/client-support.ts",
          "added": 126,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/client.ts",
          "added": 76,
          "deleted": 116
        },
        {
          "path": "src/tracker/rooms/github/comment-paging.ts",
          "added": 6,
          "deleted": 4
        },
        {
          "path": "src/tracker/rooms/github/normalize.ts",
          "added": 10,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/queries.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/markdown/index.ts",
          "added": 15,
          "deleted": 3
        },
        {
          "path": "src/tracker/rooms/markdown/issues-read.ts",
          "added": 4,
          "deleted": 3
        },
        {
          "path": "tests/gate-map.json",
          "added": 51,
          "deleted": 17
        },
        {
          "path": "tests/lib/json-lossless.ts",
          "added": 95,
          "deleted": 0
        },
        {
          "path": "tests/same-layer-baseline.json",
          "added": 10,
          "deleted": 10
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/01-deck_context.golden.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/02-deck_issue_create.golden.json",
          "added": 1,
          "deleted": 15
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/04-deck_issue_get.golden.json",
          "added": 11,
          "deleted": 1
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/06-deck_map_plan_create.golden.json",
          "added": 2,
          "deleted": 26
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/07-deck_map_link.golden.json",
          "added": 2,
          "deleted": 27
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/08-deck_issue_patch.golden.json",
          "added": 2,
          "deleted": 26
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/10-deck_issue_report-without-progress.golden.json",
          "added": 3,
          "deleted": 27
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/11-deck_work_route.golden.json",
          "added": 99,
          "deleted": 0
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/two-room-shape.golden.json",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "tests/verify-1007-transport-cooldown.ts",
          "added": 3,
          "deleted": 1
        },
        {
          "path": "tests/verify-1039-rules-pure.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1082-work-route-table.ts",
          "added": 81,
          "deleted": 10
        },
        {
          "path": "tests/verify-1083-work-path-persist.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1091-original-words.ts",
          "added": 6,
          "deleted": 1
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 96,
          "deleted": 69
        },
        {
          "path": "tests/verify-1109-matches-timeout.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1129-markdown-claim.ts",
          "added": 39,
          "deleted": 0
        },
        {
          "path": "tests/verify-1150-plan-store-durable.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1195-budget-start.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "tests/verify-1261-work-route-receipt.ts",
          "added": 66,
          "deleted": 70
        },
        {
          "path": "tests/verify-1385-howto.ts",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "tests/verify-1444-chain.ts",
          "added": 70,
          "deleted": 1
        },
        {
          "path": "tests/verify-1444-comments.ts",
          "added": 25,
          "deleted": 1
        },
        {
          "path": "tests/verify-1482-graphql-accounting.ts",
          "added": 6,
          "deleted": 2
        },
        {
          "path": "tests/verify-1555-gitlab-claim-declaration.ts",
          "added": 16,
          "deleted": 2
        },
        {
          "path": "tests/verify-1555-session-uses-decision.ts",
          "added": 82,
          "deleted": 4
        },
        {
          "path": "tests/verify-1559-deck-output-lossless.ts",
          "added": 242,
          "deleted": 0
        },
        {
          "path": "tests/verify-1565-workroute-first-col-browser.ts",
          "added": 206,
          "deleted": 65
        },
        {
          "path": "tests/verify-907-chain-titles.ts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "tests/verify-969-tiered-timeout.ts",
          "added": 71,
          "deleted": 0
        },
        {
          "path": "tests/verify-chain-capsule.ts",
          "added": 58,
          "deleted": 5
        },
        {
          "path": "tests/verify-deck-thin-reads.ts",
          "added": 74,
          "deleted": 3
        },
        {
          "path": "tests/verify-deck-tools-agent-register.ts",
          "added": 30,
          "deleted": 28
        },
        {
          "path": "tests/verify-deck-tools-row-zero-dep.ts",
          "added": 6,
          "deleted": 5
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 62,
          "deleted": 27
        },
        {
          "path": "tests/verify-detection-evidence.ts",
          "added": 26,
          "deleted": 4
        },
        {
          "path": "tests/verify-github-gh-via.ts",
          "added": 6,
          "deleted": 2
        },
        {
          "path": "tests/verify-golden-receipts.ts",
          "added": 17,
          "deleted": 6
        },
        {
          "path": "tests/verify-log-fields.ts",
          "added": 5,
          "deleted": 1
        },
        {
          "path": "tests/verify-suggest-next-steps.ts",
          "added": 23,
          "deleted": 23
        },
        {
          "path": "tests/verify-t1-getrepokey.ts",
          "added": 65,
          "deleted": 4
        },
        {
          "path": "tests/verify-time-config.ts",
          "added": 5,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "55c64c9954675e4105b892d62f633fbdca4ae334",
      "short": "55c64c99",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793081386e3,
      "subject": "\u628A\u4E3B\u5206\u652F\u6700\u65B0\u6539\u52A8\u5408\u8FDB #1505 \u5206\u652F\uFF0C\u95E8\u7981\u5F52\u5C5E\u8868\u6309\u5408\u5E76\u540E\u7684\u6811\u91CD\u65B0\u751F\u6210",
      "parents": [
        "be464e504033ab2615ed7c9d9db75ef383b5bb4d",
        "0d50024bbaa4dbe650cd5ba405671b33ad1cb7d5"
      ],
      "files": [
        {
          "path": ".gitignore",
          "added": 4,
          "deleted": 0
        },
        {
          "path": "GLOSSARY.md",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "docs/tour/deck-call-end-to-end.md",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "research/1566-triage-2026-10-27.md",
          "added": 73,
          "deleted": 0
        },
        {
          "path": "research/1572-triage-2026-10-27.md",
          "added": 125,
          "deleted": 0
        },
        {
          "path": "research/489-appendix.md",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "specs/1106-deck-tool-surface-spec.md",
          "added": 23,
          "deleted": 15
        },
        {
          "path": "src/client/kernel/ticket-label.ts",
          "added": 21,
          "deleted": 0
        },
        {
          "path": "src/client/statusbar/SessionChainCapsule.ts",
          "added": 10,
          "deleted": 8
        },
        {
          "path": "src/deck/registration/agent-row.ts",
          "added": 7,
          "deleted": 6
        },
        {
          "path": "src/deck/registration/host-assemble.ts",
          "added": 16,
          "deleted": 13
        },
        {
          "path": "src/deck/registration/host-delegate.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/rules/tool-order.ts",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "src/deck/shell/work-path-record.ts",
          "added": 17,
          "deleted": 63
        },
        {
          "path": "src/deck/tools/context.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-create-parts.ts",
          "added": 0,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-create.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-patch-definition.ts",
          "added": 0,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-patch.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-report.ts",
          "added": 4,
          "deleted": 6
        },
        {
          "path": "src/deck/tools/map-link.ts",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/map-plan-create.ts",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/work-route.ts",
          "added": 218,
          "deleted": 0
        },
        {
          "path": "src/host/index.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/refresh/kernel/tool-call-budget.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "src/refresh/registry/deck-tool-bridge.ts",
          "added": 9,
          "deleted": 4
        },
        {
          "path": "src/refresh/rooms/host/chain-env-map.ts",
          "added": 45,
          "deleted": 0
        },
        {
          "path": "src/refresh/rooms/host/check-chain-evaluation.ts",
          "added": 21,
          "deleted": 8
        },
        {
          "path": "src/refresh/rooms/host/comment-thread-fetch.ts",
          "added": 15,
          "deleted": 5
        },
        {
          "path": "src/refresh/rooms/host/git-execution.ts",
          "added": 72,
          "deleted": 2
        },
        {
          "path": "src/tracker/detection/backendDecision.ts",
          "added": 23,
          "deleted": 149
        },
        {
          "path": "src/tracker/detection/readEvidenceLayers.ts",
          "added": 197,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/client-support.ts",
          "added": 126,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/client.ts",
          "added": 22,
          "deleted": 120
        },
        {
          "path": "src/tracker/rooms/markdown/index.ts",
          "added": 15,
          "deleted": 3
        },
        {
          "path": "tests/gate-map.json",
          "added": 22,
          "deleted": 11
        },
        {
          "path": "tests/same-layer-baseline.json",
          "added": 10,
          "deleted": 10
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/01-deck_context.golden.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/02-deck_issue_create.golden.json",
          "added": 1,
          "deleted": 15
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/06-deck_map_plan_create.golden.json",
          "added": 2,
          "deleted": 26
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/07-deck_map_link.golden.json",
          "added": 2,
          "deleted": 27
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/08-deck_issue_patch.golden.json",
          "added": 1,
          "deleted": 26
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/10-deck_issue_report-without-progress.golden.json",
          "added": 3,
          "deleted": 27
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/11-deck_work_route.golden.json",
          "added": 99,
          "deleted": 0
        },
        {
          "path": "tests/verify-1039-rules-pure.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1082-work-route-table.ts",
          "added": 81,
          "deleted": 10
        },
        {
          "path": "tests/verify-1083-work-path-persist.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1091-original-words.ts",
          "added": 6,
          "deleted": 1
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 85,
          "deleted": 64
        },
        {
          "path": "tests/verify-1109-matches-timeout.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1129-markdown-claim.ts",
          "added": 39,
          "deleted": 0
        },
        {
          "path": "tests/verify-1150-plan-store-durable.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1195-budget-start.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "tests/verify-1261-work-route-receipt.ts",
          "added": 66,
          "deleted": 70
        },
        {
          "path": "tests/verify-1385-howto.ts",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "tests/verify-1444-chain.ts",
          "added": 70,
          "deleted": 1
        },
        {
          "path": "tests/verify-1444-comments.ts",
          "added": 25,
          "deleted": 1
        },
        {
          "path": "tests/verify-1482-graphql-accounting.ts",
          "added": 6,
          "deleted": 2
        },
        {
          "path": "tests/verify-1555-gitlab-claim-declaration.ts",
          "added": 16,
          "deleted": 2
        },
        {
          "path": "tests/verify-907-chain-titles.ts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "tests/verify-969-tiered-timeout.ts",
          "added": 18,
          "deleted": 0
        },
        {
          "path": "tests/verify-chain-capsule.ts",
          "added": 58,
          "deleted": 5
        },
        {
          "path": "tests/verify-deck-tools-agent-register.ts",
          "added": 30,
          "deleted": 28
        },
        {
          "path": "tests/verify-deck-tools-row-zero-dep.ts",
          "added": 6,
          "deleted": 5
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 47,
          "deleted": 27
        },
        {
          "path": "tests/verify-detection-evidence.ts",
          "added": 26,
          "deleted": 4
        },
        {
          "path": "tests/verify-github-gh-via.ts",
          "added": 6,
          "deleted": 2
        },
        {
          "path": "tests/verify-golden-receipts.ts",
          "added": 10,
          "deleted": 6
        },
        {
          "path": "tests/verify-log-fields.ts",
          "added": 5,
          "deleted": 1
        },
        {
          "path": "tests/verify-suggest-next-steps.ts",
          "added": 23,
          "deleted": 23
        },
        {
          "path": "tests/verify-t1-getrepokey.ts",
          "added": 65,
          "deleted": 4
        },
        {
          "path": "tests/verify-time-config.ts",
          "added": 2,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "0d50024bbaa4dbe650cd5ba405671b33ad1cb7d5",
      "short": "0d50024b",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793080921e3,
      "subject": "\u91CD\u751F\u6210\u95E8\u7981\u5F52\u5C5E\u8868\uFF0C\u628A\u8FD9\u6B21\u62C6\u51FA\u6765\u7684\u4E24\u4E2A\u65B0\u6587\u4EF6\u767B\u8BB0\u8FDB\u53BB",
      "parents": [
        "ca612bb7efad1e644fd410bcaf9b29ba458d368d"
      ],
      "files": [
        {
          "path": "tests/gate-map.json",
          "added": 8,
          "deleted": 5
        }
      ]
    },
    {
      "oid": "ca612bb7efad1e644fd410bcaf9b29ba458d368d",
      "short": "ca612bb7",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793080916e3,
      "subject": "github \u623F\u628A gh \u5BA2\u6237\u7AEF\u7684\u5916\u56F4\u96F6\u4EF6\u62C6\u5230\u72EC\u7ACB\u6587\u4EF6\uFF0C\u4E09\u6247\u95E8\u7981\u8DDF\u7740\u6539\u8BFB\u65B0\u6587\u4EF6",
      "parents": [
        "b78825fa6b1c4976d756e33349e5e58c742976ac"
      ],
      "files": [
        {
          "path": "src/tracker/rooms/github/client-support.ts",
          "added": 126,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/client.ts",
          "added": 17,
          "deleted": 119
        },
        {
          "path": "tests/verify-1482-graphql-accounting.ts",
          "added": 6,
          "deleted": 2
        },
        {
          "path": "tests/verify-github-gh-via.ts",
          "added": 6,
          "deleted": 2
        },
        {
          "path": "tests/verify-log-fields.ts",
          "added": 5,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "b78825fa6b1c4976d756e33349e5e58c742976ac",
      "short": "b78825fa",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793080909e3,
      "subject": "\u68C0\u6D4B\u5C42\u628A\u4E24\u5C42\u8BC1\u636E\u7684\u8BFB\u6CD5\u62C6\u5230\u72EC\u7ACB\u6587\u4EF6\uFF0C\u8BA9 backendDecision.ts \u56DE\u5230\u6587\u4EF6\u7C92\u5EA6\u57FA\u7EBF\u4EE5\u91CC",
      "parents": [
        "7d695fbf275140fa4bf52fc2d5db1b56c6548195"
      ],
      "files": [
        {
          "path": "src/tracker/detection/backendDecision.ts",
          "added": 9,
          "deleted": 174
        },
        {
          "path": "src/tracker/detection/readEvidenceLayers.ts",
          "added": 197,
          "deleted": 0
        },
        {
          "path": "tests/same-layer-baseline.json",
          "added": 10,
          "deleted": 10
        }
      ]
    },
    {
      "oid": "7d695fbf275140fa4bf52fc2d5db1b56c6548195",
      "short": "7d695fbf",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793079864e3,
      "subject": "\u5408\u5165\u8FDC\u7AEF main \u7684 10 \u7B14\u6539\u52A8\uFF0C\u672C\u5730 6 \u7B14\u63D0\u4EA4\u4E0E\u5B83\u5206\u53C9\u540E\u7B2C\u4E00\u6B21\u5BF9\u9F50",
      "parents": [
        "d6889e378de81650c07202fff1c350f0afd8c498",
        "8b859463f4685ea7a78133f2e7ef0f3504a2b40a"
      ],
      "files": [
        {
          "path": "docs/adr/20260921-tracker-choice-precedence.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "research/1555-triage-2026-10-26.md",
          "added": 56,
          "deleted": 0
        },
        {
          "path": "screenshots.json",
          "added": 1,
          "deleted": 3
        },
        {
          "path": "src/deck/tools/issue-list.ts",
          "added": 15,
          "deleted": 1
        },
        {
          "path": "src/refresh/rooms/host/session-decision.ts",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 22,
          "deleted": 3
        },
        {
          "path": "tests/lib/json-lossless.ts",
          "added": 95,
          "deleted": 0
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 5,
          "deleted": 0
        },
        {
          "path": "tests/verify-1555-session-uses-decision.ts",
          "added": 82,
          "deleted": 4
        },
        {
          "path": "tests/verify-1559-deck-output-lossless.ts",
          "added": 242,
          "deleted": 0
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 15,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "d6889e378de81650c07202fff1c350f0afd8c498",
      "short": "d6889e37",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793079818e3,
      "subject": "\u628A\u5728\u529E\u8868\u7684\u8BFB\u53D6\u5DE5\u5177\u6309\u4E00\u6B21\u8BFB\u53D6\u8BA1\u5165\u5DE5\u5177\u9884\u7B97\uFF0C\u514D\u5F97\u5B83\u88AB\u9884\u7B97\u95E8\u7981\u5F53\u6210\u96F6\u6210\u672C\u7684\u8C03\u7528",
      "parents": [
        "a7bda971e9fd85e193daa4603aaf871407204584"
      ],
      "files": [
        {
          "path": "src/refresh/kernel/tool-call-budget.ts",
          "added": 2,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "a7bda971e9fd85e193daa4603aaf871407204584",
      "short": "a7bda971",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793079812e3,
      "subject": "\u6574\u6BB5\u6539\u5199\u6B63\u6587\u524D\u5148\u8BFB\u4E00\u6B21\u6B63\u6587\u6307\u7EB9\u5E76\u5E26\u4E0A bodyDigest\uFF0C\u8BA9 #1091 \u95E8\u7981\u8DDF\u4E0A\u6B63\u6587\u6307\u7EB9\u9501\u7684\u5951\u7EA6",
      "parents": [
        "2cb4a44624c69eb9a50723ee63627dca9c63caf3"
      ],
      "files": [
        {
          "path": "tests/verify-1091-original-words.ts",
          "added": 6,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "2cb4a44624c69eb9a50723ee63627dca9c63caf3",
      "short": "2cb4a446",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793079812e3,
      "subject": "\u5728\u529E\u8868\u56DE\u6267\u91CC\u7684\u4FDD\u7559\u671F\u3001\u5728\u529E\u7A97\u53E3\u4E0E\u5B58\u6863\u4E0A\u9650\u6539\u8BFB\u4E2D\u592E\u751F\u6210\u503C\uFF0C\u4E09\u4E2A\u6570\u4E0D\u518D\u624B\u5199\uFF1B\u65F6\u95F4\u914D\u7F6E\u95E8\u7981\u767B\u8BB0\u4E24\u5904\u5355\u4F4D\u6362\u7B97",
      "parents": [
        "cfccb8ecbe81a165732f33ea7c86043405d55ac3"
      ],
      "files": [
        {
          "path": "src/deck/tools/work-route.ts",
          "added": 13,
          "deleted": 3
        },
        {
          "path": "tests/verify-time-config.ts",
          "added": 2,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "cfccb8ecbe81a165732f33ea7c86043405d55ac3",
      "short": "cfccb8ec",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793079799e3,
      "subject": "\u80F6\u56CA\u6298\u53E0\u6807\u7B7E\u628A\u8BA9\u4F4D\u53F7\u53EA\u5199\u4E00\u4EFD\uFF0C\u5355\u6BB5\u4E0E\u4E24\u6BB5\u5171\u7528\u540C\u4E00\u5904\u6837\u5F0F\u5206\u53C9\uFF1B907 \u95E8\u7981\u8865\u4E0A\u6298\u53E0\u51FD\u6570\u7684\u5168\u5C40\u6CE8\u518C",
      "parents": [
        "44dbc7ca9137e5754f51f2e10a7cfd75fc44a63f"
      ],
      "files": [
        {
          "path": "src/client/kernel/ticket-label.ts",
          "added": 9,
          "deleted": 4
        },
        {
          "path": "tests/verify-907-chain-titles.ts",
          "added": 3,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "44dbc7ca9137e5754f51f2e10a7cfd75fc44a63f",
      "short": "44dbc7ca",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793079785e3,
      "subject": "\u628A\u635F\u574F\u7684 .wt-head \u4E34\u65F6\u5DE5\u4F5C\u6811\u76EE\u5F55\u52A0\u8FDB\u5FFD\u7565\u540D\u5355\uFF0C\u672C\u5730\u6B8B\u7559\u4E0D\u518D\u6DF7\u8FDB\u5F85\u63D0\u4EA4\u6E05\u5355",
      "parents": [
        "1ba5fefb06f9c272a121ef168f66c5e991fbf427"
      ],
      "files": [
        {
          "path": ".gitignore",
          "added": 4,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "1ba5fefb06f9c272a121ef168f66c5e991fbf427",
      "short": "1ba5fefb",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793078704e3,
      "subject": "\u628A\u5199\u56DE\u6267\u91CC\u7684\u5728\u529E\u8868\u642C\u8FDB\u72EC\u7ACB\u8BFB\u5DE5\u5177\u5E76\u5173\u95ED\u65E7\u53C2\u6570\uFF08#1561\uFF09",
      "parents": [
        "e2608670645da979d6b4fd8acfbf03582b464101"
      ],
      "files": [
        {
          "path": "GLOSSARY.md",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "docs/tour/deck-call-end-to-end.md",
          "added": 22,
          "deleted": 22
        },
        {
          "path": "specs/1106-deck-tool-surface-spec.md",
          "added": 23,
          "deleted": 15
        },
        {
          "path": "src/deck/registration/agent-row.ts",
          "added": 7,
          "deleted": 6
        },
        {
          "path": "src/deck/registration/host-assemble.ts",
          "added": 16,
          "deleted": 13
        },
        {
          "path": "src/deck/registration/host-delegate.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/rules/tool-order.ts",
          "added": 4,
          "deleted": 4
        },
        {
          "path": "src/deck/shell/work-path-record.ts",
          "added": 17,
          "deleted": 63
        },
        {
          "path": "src/deck/tools/context.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-create-parts.ts",
          "added": 0,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-create.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-patch-definition.ts",
          "added": 0,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-patch.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-report.ts",
          "added": 4,
          "deleted": 6
        },
        {
          "path": "src/deck/tools/map-link.ts",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/map-plan-create.ts",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "src/deck/tools/work-route.ts",
          "added": 208,
          "deleted": 0
        },
        {
          "path": "tests/gate-map.json",
          "added": 28,
          "deleted": 16
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/01-deck_context.golden.json",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/02-deck_issue_create.golden.json",
          "added": 1,
          "deleted": 15
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/06-deck_map_plan_create.golden.json",
          "added": 2,
          "deleted": 26
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/07-deck_map_link.golden.json",
          "added": 2,
          "deleted": 27
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/08-deck_issue_patch.golden.json",
          "added": 1,
          "deleted": 26
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/10-deck_issue_report-without-progress.golden.json",
          "added": 3,
          "deleted": 27
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/11-deck_work_route.golden.json",
          "added": 99,
          "deleted": 0
        },
        {
          "path": "tests/verify-1039-rules-pure.ts",
          "added": 3,
          "deleted": 3
        },
        {
          "path": "tests/verify-1082-work-route-table.ts",
          "added": 81,
          "deleted": 10
        },
        {
          "path": "tests/verify-1083-work-path-persist.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 86,
          "deleted": 64
        },
        {
          "path": "tests/verify-1109-matches-timeout.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1150-plan-store-durable.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/verify-1195-budget-start.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "tests/verify-1261-work-route-receipt.ts",
          "added": 66,
          "deleted": 70
        },
        {
          "path": "tests/verify-1385-howto.ts",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "tests/verify-deck-tools-agent-register.ts",
          "added": 30,
          "deleted": 28
        },
        {
          "path": "tests/verify-deck-tools-row-zero-dep.ts",
          "added": 6,
          "deleted": 5
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 47,
          "deleted": 27
        },
        {
          "path": "tests/verify-golden-receipts.ts",
          "added": 10,
          "deleted": 6
        },
        {
          "path": "tests/verify-suggest-next-steps.ts",
          "added": 23,
          "deleted": 23
        }
      ]
    },
    {
      "oid": "e2608670645da979d6b4fd8acfbf03582b464101",
      "short": "e2608670",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793078497e3,
      "subject": "\u4FEE\u590D #1566\uFF1A\u73AF\u5883\u68C0\u67E5\u8BA4\u5F97\u51FA\u7B2C\u4E8C remote \u4E0A\u7684 GitHub \u4ED3\u5E93\u8EAB\u4EFD",
      "parents": [
        "3e507aeb4583a2dd4b0124c29fd4a38d9e2e3a28"
      ],
      "files": [
        {
          "path": "research/1566-triage-2026-10-27.md",
          "added": 30,
          "deleted": 0
        },
        {
          "path": "src/host/index.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/refresh/rooms/host/chain-env-map.ts",
          "added": 45,
          "deleted": 0
        },
        {
          "path": "src/refresh/rooms/host/check-chain-evaluation.ts",
          "added": 21,
          "deleted": 8
        },
        {
          "path": "src/refresh/rooms/host/git-execution.ts",
          "added": 72,
          "deleted": 2
        },
        {
          "path": "tests/verify-1444-chain.ts",
          "added": 70,
          "deleted": 1
        },
        {
          "path": "tests/verify-t1-getrepokey.ts",
          "added": 65,
          "deleted": 4
        }
      ]
    },
    {
      "oid": "3e507aeb4583a2dd4b0124c29fd4a38d9e2e3a28",
      "short": "3e507aeb",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793077822e3,
      "subject": "\u4FEE\u590D Markdown \u8BA4\u9886\u4E0E\u5224\u5B9A\u5C42\u5BF9\u58F0\u660E\u53E3\u5F84\u4E0D\u4E00\u81F4\u7684\u95EE\u9898\uFF08#1572\uFF09",
      "parents": [
        "8bbbf727cbf27241e1aa9930531a8a3b7b63a8c6"
      ],
      "files": [
        {
          "path": "research/1572-triage-2026-10-27.md",
          "added": 125,
          "deleted": 0
        },
        {
          "path": "research/489-appendix.md",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/refresh/registry/deck-tool-bridge.ts",
          "added": 9,
          "deleted": 4
        },
        {
          "path": "src/refresh/rooms/host/comment-thread-fetch.ts",
          "added": 15,
          "deleted": 5
        },
        {
          "path": "src/tracker/detection/backendDecision.ts",
          "added": 51,
          "deleted": 12
        },
        {
          "path": "src/tracker/rooms/markdown/index.ts",
          "added": 15,
          "deleted": 3
        },
        {
          "path": "tests/verify-1129-markdown-claim.ts",
          "added": 39,
          "deleted": 0
        },
        {
          "path": "tests/verify-1444-comments.ts",
          "added": 25,
          "deleted": 1
        },
        {
          "path": "tests/verify-1555-gitlab-claim-declaration.ts",
          "added": 16,
          "deleted": 2
        },
        {
          "path": "tests/verify-detection-evidence.ts",
          "added": 26,
          "deleted": 4
        }
      ]
    },
    {
      "oid": "be464e504033ab2615ed7c9d9db75ef383b5bb4d",
      "short": "be464e50",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793077284e3,
      "subject": "\u8BA9\u73AF\u5883\u68C0\u67E5\u63A2\u9488\u5F00\u4F1A\u8BDD\u6CBF\u7528\u94FE\u6C42\u503C\u5B9A\u4E0B\u7684\u540E\u7AEF\uFF08#1505\uFF09",
      "parents": [
        "8b859463f4685ea7a78133f2e7ef0f3504a2b40a"
      ],
      "files": [
        {
          "path": "src/refresh/rooms/host/check-chain-evaluation.ts",
          "added": 21,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 21,
          "deleted": 4
        },
        {
          "path": "tests/verify-1505-chain-env-selection.ts",
          "added": 243,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "179a06130223d8ad7b5b3fc9cf1119263bece34c",
      "short": "179a0613",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793076658e3,
      "subject": "GitHub \u623F 20 \u5904 -F \u6539 -f\u3001GraphQL \u53D8\u91CF\u9519\u8BEF\u5224\u89E3\u6790\u3001env \u6587\u6848\u6309\u539F\u56E0\u5206\u6D41\uFF08#1571\uFF09",
      "parents": [
        "2d9dd650c4c9a050bb52fbef52d914f576061f88"
      ],
      "files": [
        {
          "path": "scripts/gate-map.mts",
          "added": 3,
          "deleted": 0
        },
        {
          "path": "src/refresh/rooms/host/chain-env-map.ts",
          "added": 67,
          "deleted": 8
        },
        {
          "path": "src/tracker/rooms/github/blocked-by-write.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/comment-paging.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/counts.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/github/deps-read.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/errors.ts",
          "added": 14,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/issues.ts",
          "added": 5,
          "deleted": 5
        },
        {
          "path": "src/tracker/rooms/github/page.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/github/sub-issues.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/fixtures/error-samples.ts",
          "added": 26,
          "deleted": 0
        },
        {
          "path": "tests/gate-map.json",
          "added": 21,
          "deleted": 5
        },
        {
          "path": "tests/verify-1187-gitlab-chain-predicates.ts",
          "added": 11,
          "deleted": 0
        },
        {
          "path": "tests/verify-1418-probe-cost-and-failure.ts",
          "added": 8,
          "deleted": 0
        },
        {
          "path": "tests/verify-1571-gh-flag-writing.ts",
          "added": 112,
          "deleted": 0
        },
        {
          "path": "tests/verify-916-ghauth-crosscheck.ts",
          "added": 41,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "8bbbf727cbf27241e1aa9930531a8a3b7b63a8c6",
      "short": "8bbbf727",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793076374e3,
      "subject": "\u4FEE\u590D #1563\uFF1A\u72B6\u6001\u680F\u80F6\u56CA\u7A84\u680F\u4E0B\u76EE\u5F55\u5148\u8BA9\u4F4D\uFF0C\u7F16\u53F7\u5C3E\u5DF4\u6C38\u4E0D\u7F29\u5C0F",
      "parents": [
        "3747b028cbba33ff0d841335af996e6d861267af"
      ],
      "files": [
        {
          "path": "src/client/kernel/ticket-label.ts",
          "added": 16,
          "deleted": 0
        },
        {
          "path": "src/client/statusbar/SessionChainCapsule.ts",
          "added": 10,
          "deleted": 8
        },
        {
          "path": "tests/verify-chain-capsule.ts",
          "added": 58,
          "deleted": 5
        }
      ]
    },
    {
      "oid": "3747b028cbba33ff0d841335af996e6d861267af",
      "short": "3747b028",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179307632e4,
      "subject": "\u56DE\u8BDD\u6309 Q3 \u5206\u5F00\u5199\u6392\u961F\u4E0E\u62FF\u5230\u540D\u989D\u540E\u4E24\u6BB5\uFF08#1560\uFF09",
      "parents": [
        "5ae173d424a6072f4b47762b6b982a1776c9d0c9"
      ],
      "files": [
        {
          "path": "src/tracker/rooms/github/client.ts",
          "added": 5,
          "deleted": 1
        },
        {
          "path": "tests/verify-969-tiered-timeout.ts",
          "added": 18,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "5ae173d424a6072f4b47762b6b982a1776c9d0c9",
      "short": "5ae173d4",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793076245e3,
      "subject": "\u8865\u5145 #1566 \u7B2C\u56DB\u8F6E\u5B9A\u7A3F\u7B14\u8BB0\uFF1A\u5BBF\u4E3B\u672C\u5730\u8EAB\u4EFD\u89E3\u6790\u6539\u626B\u5168\u90E8\u8FDC\u7AEF\uFF0C\u68C0\u67E5\u94FE\u4E0E\u9762\u677F\u5171\u7528\u8BC1\u636E",
      "parents": [
        "64d0f5aa668111685cc96e9021e0e817b16eb876"
      ],
      "files": [
        {
          "path": "research/1566-triage-2026-10-27.md",
          "added": 43,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "8b859463f4685ea7a78133f2e7ef0f3504a2b40a",
      "short": "8b859463",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793076085e3,
      "subject": "\u91CD\u751F\u6210\u95E8\u7981\u5F52\u5C5E\u8868\uFF1A\u7EB3\u5165\u5408\u5E76\u8FDB\u6765\u7684 issue-index-scan.ts\uFF08#1559\uFF09",
      "parents": [
        "cc25e2f95469bf7bfcedf25eed0f1dbcb1722ee5"
      ],
      "files": [
        {
          "path": "tests/gate-map.json",
          "added": 2,
          "deleted": 3
        }
      ]
    },
    {
      "oid": "cc25e2f95469bf7bfcedf25eed0f1dbcb1722ee5",
      "short": "cc25e2f9",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179307606e4,
      "subject": "Merge remote-tracking branch 'origin/main' into HEAD",
      "parents": [
        "14216443d02e6e973cd7226c1b09f41058823a8d",
        "3e9cdf05ad22e12a649fc3aef86e01bdf44bdd2d"
      ],
      "files": [
        {
          "path": "AGENTS.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 5,
          "deleted": 5
        },
        {
          "path": "package/package.json",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "research/1566-triage-2026-10-27.md",
          "added": 35,
          "deleted": 0
        },
        {
          "path": "research/1568-npm-publish-manifest-diagnosis.md",
          "added": 26,
          "deleted": 0
        },
        {
          "path": "scripts/issue-emergency.ps1",
          "added": 36,
          "deleted": 16
        },
        {
          "path": "src/refresh/rooms/host/gh-queue-race.ts",
          "added": 7,
          "deleted": 10
        },
        {
          "path": "src/tracker/kernel/outbound-tiers.ts",
          "added": 18,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/client.ts",
          "added": 64,
          "deleted": 6
        },
        {
          "path": "tests/verify-1007-transport-cooldown.ts",
          "added": 3,
          "deleted": 1
        },
        {
          "path": "tests/verify-969-tiered-timeout.ts",
          "added": 53,
          "deleted": 0
        },
        {
          "path": "tests/verify-time-config.ts",
          "added": 3,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "3e9cdf05ad22e12a649fc3aef86e01bdf44bdd2d",
      "short": "3e9cdf05",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793076046e3,
      "subject": "\u5408\u5E76\u8FDC\u7AEF main \u4E0E #1574 \u5BA1\u67E5\u4FEE\u590D\uFF08#1574\uFF09",
      "parents": [
        "64d0f5aa668111685cc96e9021e0e817b16eb876",
        "02beca352efe9bd82873b7f02f1a1bd4495624c6"
      ],
      "files": [
        {
          "path": "docs/adr/20260921-tracker-choice-precedence.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "research/1555-triage-2026-10-26.md",
          "added": 56,
          "deleted": 0
        },
        {
          "path": "screenshots.json",
          "added": 1,
          "deleted": 3
        },
        {
          "path": "src/deck/tools/issue-list.ts",
          "added": 15,
          "deleted": 1
        },
        {
          "path": "src/refresh/rooms/host/session-decision.ts",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 26,
          "deleted": 7
        },
        {
          "path": "tests/lib/json-lossless.ts",
          "added": 95,
          "deleted": 0
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 6,
          "deleted": 0
        },
        {
          "path": "tests/verify-1555-session-uses-decision.ts",
          "added": 82,
          "deleted": 4
        },
        {
          "path": "tests/verify-1559-deck-output-lossless.ts",
          "added": 194,
          "deleted": 0
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 6,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "14216443d02e6e973cd7226c1b09f41058823a8d",
      "short": "14216443",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793076041e3,
      "subject": "\u8865\u5F3A deck \u5DE5\u5177\u65E0\u635F\u95E8\u7981\uFF1A\u8986\u76D6\u964D\u7EA7\u5206\u652F\u4E0E\u6210\u529F\u65AD\u8A00\uFF0C\u5E76\u91CD\u751F\u6210\u5F52\u5C5E\u8868\uFF08#1559\uFF09",
      "parents": [
        "02beca352efe9bd82873b7f02f1a1bd4495624c6"
      ],
      "files": [
        {
          "path": "src/deck/tools/issue-list.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 10,
          "deleted": 5
        },
        {
          "path": "tests/verify-1559-deck-output-lossless.ts",
          "added": 50,
          "deleted": 2
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 12,
          "deleted": 3
        }
      ]
    },
    {
      "oid": "64d0f5aa668111685cc96e9021e0e817b16eb876",
      "short": "64d0f5aa",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793076025e3,
      "subject": "\u8865\u9F501574\u7684\u5BA1\u67E5\u610F\u89C1\uFF1A\u4FEE\u6B63\u6587\u6863\u8FB9\u754C\u4E0E\u5E94\u6025\u811A\u672C\u7684\u91CD\u8BD5\u8BFB\u56DE\uFF08#1574\uFF09",
      "parents": [
        "4731b2eb8dd39247733b688445ce854382d86f43"
      ],
      "files": [
        {
          "path": "AGENTS.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 5,
          "deleted": 5
        },
        {
          "path": "scripts/issue-emergency.ps1",
          "added": 36,
          "deleted": 16
        }
      ]
    },
    {
      "oid": "4731b2eb8dd39247733b688445ce854382d86f43",
      "short": "4731b2eb",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793075822e3,
      "subject": "\u4FEE\u590D #1560\uFF1A\u623F\u5185\u6392\u961F\u7B49\u540D\u989D\u53EA\u7B49\u4E0A\u9650\uFF0C\u4E0D\u518D\u5403\u6389\u6574\u6863\u9884\u7B97",
      "parents": [
        "7e565c2cda6c1d9d1534d6388a4771ed65cd3fb7"
      ],
      "files": [
        {
          "path": "src/refresh/rooms/host/gh-queue-race.ts",
          "added": 7,
          "deleted": 10
        },
        {
          "path": "src/tracker/kernel/outbound-tiers.ts",
          "added": 18,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/client.ts",
          "added": 64,
          "deleted": 6
        },
        {
          "path": "tests/verify-1007-transport-cooldown.ts",
          "added": 3,
          "deleted": 1
        },
        {
          "path": "tests/verify-969-tiered-timeout.ts",
          "added": 53,
          "deleted": 0
        },
        {
          "path": "tests/verify-time-config.ts",
          "added": 3,
          "deleted": 2
        }
      ]
    },
    {
      "oid": "02beca352efe9bd82873b7f02f1a1bd4495624c6",
      "short": "02beca35",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793074781e3,
      "subject": "\u5E02\u573A\u8BE6\u60C5\u9875\u622A\u56FE\u6536\u655B\u4E3A 6 \u5F20\uFF1A\u5BF9\u9F50\u5E02\u573A\u7AEF\u5C55\u793A\u4E0A\u9650\uFF0C\u53BB\u6389\u672B\u5C3E\u4E24\u5F20",
      "parents": [
        "459e15b3d12dbbbcbfaf4a10a19a02179c6bc1b3"
      ],
      "files": [
        {
          "path": "screenshots.json",
          "added": 1,
          "deleted": 3
        }
      ]
    },
    {
      "oid": "7e565c2cda6c1d9d1534d6388a4771ed65cd3fb7",
      "short": "7e565c2c",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179307314e4,
      "subject": "\u8865\u5145 #1566 \u7B2C\u4E09\u8F6E\u590D\u6838\u7B14\u8BB0\uFF1A\u671F\u671B\u5BF9\u7167\u4E0E\u9762\u677F\u8EAB\u4EFD\u540C\u6E90\u8DEF\u5F84",
      "parents": [
        "6909aff8e792b1db64c49aba0ab7f394018b387a"
      ],
      "files": [
        {
          "path": "research/1566-triage-2026-10-27.md",
          "added": 35,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "6909aff8e792b1db64c49aba0ab7f394018b387a",
      "short": "6909aff8",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793072404e3,
      "subject": "\u4FEE\u590D1568\uFF1A\u53D1\u5E03\u6E05\u5355\u7684\u6784\u5EFA\u94A9\u5B50\u6362\u6210\u53EA\u5728\u53D1\u5E03\u65F6\u8DD1\uFF0C\u7528\u6237\u5B89\u88C5\u4E0D\u518D\u88AB\u8981\u6784\u5EFA\u6388\u6743",
      "parents": [
        "c13904d7c77a1309866cda881157262e27eedae0"
      ],
      "files": [
        {
          "path": "package/package.json",
          "added": 1,
          "deleted": 2
        },
        {
          "path": "research/1568-npm-publish-manifest-diagnosis.md",
          "added": 26,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "459e15b3d12dbbbcbfaf4a10a19a02179c6bc1b3",
      "short": "459e15b3",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179307218e4,
      "subject": "\u5408\u5E76 origin/main \u5230 main\uFF1A\u8BA9\u7968\u9762\u5DE5\u5177\u6545\u969C\u8BF4\u660E\u4E0E\u5E94\u6025\u811A\u672C\u8DDF\u4E0A\u524D\u7AEF\u4FEE\u590D\uFF08#1574\uFF09",
      "parents": [
        "c13904d7c77a1309866cda881157262e27eedae0",
        "6d9f18f710d7bef459278e17a4d3b99119af97cd"
      ],
      "files": [
        {
          "path": "docs/adr/20260921-tracker-choice-precedence.md",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "research/1555-triage-2026-10-26.md",
          "added": 56,
          "deleted": 0
        },
        {
          "path": "src/deck/tools/issue-list.ts",
          "added": 15,
          "deleted": 1
        },
        {
          "path": "src/refresh/rooms/host/session-decision.ts",
          "added": 4,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 26,
          "deleted": 7
        },
        {
          "path": "tests/lib/json-lossless.ts",
          "added": 95,
          "deleted": 0
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 6,
          "deleted": 0
        },
        {
          "path": "tests/verify-1555-session-uses-decision.ts",
          "added": 82,
          "deleted": 4
        },
        {
          "path": "tests/verify-1559-deck-output-lossless.ts",
          "added": 194,
          "deleted": 0
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 6,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "6d9f18f710d7bef459278e17a4d3b99119af97cd",
      "short": "6d9f18f7",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 179307168e4,
      "subject": "\u4FEE\u590D deck_issue_list \u6210\u529F\u56DE\u6267\u4E0D\u662F\u65E0\u635F JSON\uFF1A\u7F3A\u7701\u952E\u4E0D\u51FA\u73B0\uFF0C\u5E76\u8865\u4E5D\u5DE5\u5177\u65E0\u635F\u95E8\u7981\uFF08#1559\uFF09",
      "parents": [
        "d153c80949bfddb7900cb59b9d4c3267226ac91b"
      ],
      "files": [
        {
          "path": "src/deck/tools/issue-list.ts",
          "added": 15,
          "deleted": 1
        },
        {
          "path": "tests/gate-map.json",
          "added": 23,
          "deleted": 6
        },
        {
          "path": "tests/lib/json-lossless.ts",
          "added": 95,
          "deleted": 0
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 6,
          "deleted": 0
        },
        {
          "path": "tests/verify-1559-deck-output-lossless.ts",
          "added": 194,
          "deleted": 0
        },
        {
          "path": "tests/verify-deck-tools.ts",
          "added": 6,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "c13904d7c77a1309866cda881157262e27eedae0",
      "short": "c13904d7",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793071614e3,
      "subject": "\u65B0\u589E\u7968\u9762\u5E94\u6025\u811A\u672C\uFF0C\u56DB\u4E2A\u52A8\u4F5C\u90FD\u5148\u8BFB\u56DE\u518D\u5199\u5E76\u6838\u5BF9",
      "parents": [
        "e55942f998337cd1f4bab255c6c1a061a1774766"
      ],
      "files": [
        {
          "path": "scripts/issue-emergency.ps1",
          "added": 168,
          "deleted": 0
        }
      ]
    },
    {
      "oid": "e55942f998337cd1f4bab255c6c1a061a1774766",
      "short": "e55942f9",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793071548e3,
      "subject": "\u7ED9\u7968\u9762\u5DE5\u5177\u6545\u969C\u8865\u4E0A\u5E94\u6025\u8DEF\u5F84\u8BF4\u660E\uFF0C\u5347\u7EA7\u540E\u5148\u81EA\u68C0\u518D\u5E72\u6D3B",
      "parents": [
        "fdd6fd6592a7b8d5e706a5d9d86d0816720f639d"
      ],
      "files": [
        {
          "path": "AGENTS.md",
          "added": 5,
          "deleted": 1
        },
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 17,
          "deleted": 1
        }
      ]
    },
    {
      "oid": "fdd6fd6592a7b8d5e706a5d9d86d0816720f639d",
      "short": "fdd6fd65",
      "author": "FeatherHunter",
      "email": "975559549@qq.com",
      "authorDateMs": 1793071403e3,
      "subject": "\u5B9E\u73B0\u5355\u7968\u8584\u8BFB\u4E0E\u6B63\u6587\u6307\u7EB9\u9501\uFF1A\u7F3A\u7701\u53EA\u56DE\u6458\u8981\u4E0E\u603B\u6570\uFF0C\u5168\u6587\u5206\u5757\u52A0\u6307\u7EB9\uFF0C\u5199\u56DE\u51ED\u6307\u7EB9\u9A8C\u65E7",
      "parents": [
        "7ad2628253510b3fff78ab05dee0303208138ec4"
      ],
      "files": [
        {
          "path": "docs/agents/issue-tracker.md",
          "added": 9,
          "deleted": 0
        },
        {
          "path": "src/deck/shell/body-digest.ts",
          "added": 110,
          "deleted": 0
        },
        {
          "path": "src/deck/tools/issue-get.ts",
          "added": 24,
          "deleted": 7
        },
        {
          "path": "src/deck/tools/issue-patch-definition.ts",
          "added": 2,
          "deleted": 1
        },
        {
          "path": "src/deck/tools/issue-patch.ts",
          "added": 19,
          "deleted": 1
        },
        {
          "path": "src/tracker/contract/entities.ts",
          "added": 2,
          "deleted": 0
        },
        {
          "path": "src/tracker/contract/inputs.ts",
          "added": 1,
          "deleted": 1
        },
        {
          "path": "src/tracker/rooms/github/comment-paging.ts",
          "added": 6,
          "deleted": 4
        },
        {
          "path": "src/tracker/rooms/github/normalize.ts",
          "added": 10,
          "deleted": 0
        },
        {
          "path": "src/tracker/rooms/github/queries.ts",
          "added": 2,
          "deleted": 2
        },
        {
          "path": "src/tracker/rooms/markdown/issues-read.ts",
          "added": 4,
          "deleted": 3
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/04-deck_issue_get.golden.json",
          "added": 11,
          "deleted": 1
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/08-deck_issue_patch.golden.json",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "tests/tracker-contract/fixtures/golden-receipts/two-room-shape.golden.json",
          "added": 1,
          "deleted": 0
        },
        {
          "path": "tests/verify-1106-deck-surface.ts",
          "added": 7,
          "deleted": 7
        },
        {
          "path": "tests/verify-deck-thin-reads.ts",
          "added": 74,
          "deleted": 3
        },
        {
          "path": "tests/verify-golden-receipts.ts",
          "added": 7,
          "deleted": 0
        }
      ]
    }
  ];
  var capturedWorktrees = [
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck",
      "head": "a65498e89293c36f3f0781e38ee986d30bfe2418",
      "branch": "main",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1006-quota-cooldown",
      "head": "d8f8e2d223a56bac48fa5a921b4609c25dd3e2db",
      "branch": "ticket/1006-quota-cooldown",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1008-failure-streak",
      "head": "6ccd0bfeda4798e3bee6c054610ea9d83d26f776",
      "branch": "fix/1008-failure-streak",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1114-timer-cleanup",
      "head": "7a21f12d82342bf572efdd301f8dc548bfdbc569",
      "branch": "ticket/1114-timer-cleanup",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1162-live-doc-drift",
      "head": "fc16fb28dee796b93100aa58607b5f1e791dff27",
      "branch": "ticket/1162-live-doc-drift",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1171-anchor-fallback",
      "head": "4f89823692a3d677ab0fc8026faf961adcdfea65",
      "branch": "fix/1171-anchor-lookup-retry",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1475-timeout-budget",
      "head": "617df28a49f6d9050b158eaa170a6ca135cb6815",
      "branch": "ticket/1475-predicate-budget",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1520-quoted-skill-refs",
      "head": "5d1f76864c6dc0a600a4e8a88583ac651e02cf90",
      "branch": "ticket/1520-quoted-skill-refs",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1521-zh-translations",
      "head": "0f849d1b97dfdf6393f26f3ae096e2d560ca52aa",
      "branch": "feat/1521-bundled-skills-zh",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1524-md-table",
      "head": "2aabd1c010d91c243292f15634cc47e70473e76e",
      "branch": "ticket/1524-md-table",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1526-suggest-replay-restore",
      "head": "51590957f21c130ff17772f31ee62fb3e29402c7",
      "branch": "ticket/1526-suggest-replay-restore",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1527-quota-floor",
      "head": "ae4d5046449d66cd7a6e5c32b2b64def133a4b3f",
      "branch": "ticket/1527-quota-floor",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1533-gitlab-remote-claim",
      "head": "634b0fe85e6cb2858f594fa4c15a8f431ee4e8b2",
      "branch": "fix/update-failure-settlement",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1555-session-decision",
      "head": "d153c80949bfddb7900cb59b9d4c3267226ac91b",
      "branch": "ticket/1555-session-decision",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    },
    {
      "path": "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/fix-main-granularity",
      "head": "08af050b126cef62b5a979528a70e9fe9660fcb9",
      "branch": "fix/main-granularity",
      "bare": false,
      "detached": false,
      "locked": false,
      "lockReason": null,
      "prunable": false
    }
  ];

  // docs/prototype/vc-redesign/src/data/screen.ts
  var WORKING_CHANGES = [
    { path: "src/client/views/shared/workRouteTable.ts", kind: "ordinary", x: ".", y: "M", added: 2, deleted: 2 },
    { path: "src/refresh/rooms/host/outbound-admission.ts", kind: "ordinary", x: ".", y: "M", added: 23, deleted: 1 },
    { path: "docs/review/20261025-spec-complete-prompt-review.html", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: "docs/design/md-env-check-chain.png", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: "docs/design/md-env-check-chain.svg", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: "tests/verify-1545-workroute-row-nav.ts", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/issue1518-body.md", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/issue1518-original-body.md", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/probe-spec-capsule.mjs", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/probe2.mjs", kind: "untracked", x: "?", y: "?", added: null, deleted: null },
    { path: ".scratch/temp/pr-1475-body.md", kind: "untracked", x: "?", y: "?", added: null, deleted: null }
  ];
  function branchSamples(nowMs, headShort) {
    const minute = 60 * 1e3;
    return [
      {
        name: capturedBranch,
        upstream: `origin/${capturedBranch}`,
        ahead: 2,
        behind: 0,
        oidShort: headShort,
        lastCommitMs: nowMs - 6 * minute,
        subject: "\u7248\u672C\u7BA1\u7406\u9875\u91CD\u6784\u539F\u578B\u6536\u5C3E\uFF0C\u5DE5\u4F5C\u6811\u52A8\u4F5C\u5168\u90E8\u6536\u8FDB\u9762\u677F",
        mergedIntoCurrent: true
      },
      {
        name: "release/2026-10",
        upstream: "origin/release/2026-10",
        ahead: 0,
        behind: 4,
        oidShort: "3b7c1d9",
        lastCommitMs: nowMs - 26 * 60 * minute,
        subject: "\u6574\u7406\u5341\u6708\u53D1\u5E03\u8BF4\u660E\u4E0E\u56DE\u6EDA\u6B65\u9AA4",
        mergedIntoCurrent: false
      },
      {
        name: "feature/version-control-redesign",
        upstream: "origin/feature/version-control-redesign",
        ahead: 3,
        behind: 0,
        oidShort: "9d2e4a1",
        lastCommitMs: nowMs - 3 * 60 * minute,
        subject: "\u5206\u652F\u9875\u4E0E\u52A8\u4F5C\u6A21\u578B\u63A5\u5165\u9762\u677F\u9AA8\u67B6",
        mergedIntoCurrent: false
      },
      {
        name: "fix/rail-tab-overflow",
        upstream: "origin/fix/rail-tab-overflow",
        ahead: 0,
        behind: 1,
        oidShort: "c41a7f2",
        lastCommitMs: nowMs - 2 * 24 * 60 * minute,
        subject: "\u7A84\u6863\u4E0B\u9875\u7B7E\u8BA1\u6570\u6362\u884C\u6324\u538B\u5185\u5BB9",
        mergedIntoCurrent: false
      },
      {
        name: "chore/docs-cleanup",
        upstream: null,
        ahead: 0,
        behind: 0,
        oidShort: "5e8b0c3",
        lastCommitMs: nowMs - 5 * 24 * 60 * minute,
        subject: "\u5220\u6389\u91CD\u590D\u7684\u8BBE\u8BA1\u7A3F\u622A\u56FE\u8BF4\u660E",
        mergedIntoCurrent: true
      },
      {
        name: "experiment/old-layout",
        upstream: null,
        ahead: 0,
        behind: 0,
        oidShort: "a06d3e8",
        lastCommitMs: nowMs - 12 * 24 * 60 * minute,
        subject: "\u65E7\u7248\u4E09\u680F\u5E03\u5C40\u7684\u8BD5\u9A8C\u5206\u652F\uFF0C\u7559\u7740\u5BF9\u7167",
        mergedIntoCurrent: true
      }
    ];
  }
  function worktreeRecords() {
    return capturedWorktrees.map((w) => ({
      path: w.path,
      head: w.head,
      branch: w.branch,
      bare: w.bare,
      detached: w.detached,
      locked: w.locked,
      lockReason: w.lockReason,
      prunable: w.prunable,
      prunableReason: null
    }));
  }
  function refRecords(basisMs) {
    return [
      {
        ref: `refs/heads/${capturedBranch}`,
        short: capturedBranch,
        oid: capturedHead,
        upstream: `origin/${capturedBranch}`,
        upstreamGone: false,
        ahead: 2,
        behind: 0,
        current: true,
        commitDateMs: basisMs
      }
    ];
  }
  function buildPrototypeData() {
    const nowMs = Date.now();
    const basisMs = nowMs - 12 * 60 * 1e3;
    const statusEntries = WORKING_CHANGES.map((c) => ({
      kind: c.kind,
      x: c.x,
      y: c.y,
      path: c.path,
      origPath: null
    }));
    const diffFiles = WORKING_CHANGES.filter((c) => c.added !== null && c.deleted !== null).map((c) => ({ path: c.path, origPath: null, added: c.added, deleted: c.deleted }));
    const input = {
      repoRoot: capturedRepoRoot,
      bare: false,
      statusHead: capturedBranch,
      statusDetached: false,
      statusOid: capturedHead,
      statusUpstream: `origin/${capturedBranch}`,
      statusAhead: 2,
      statusBehind: 0,
      statusEntries,
      worktrees: worktreeRecords(),
      refs: refRecords(basisMs),
      commits: capturedCommits.map((c) => ({
        oid: c.oid,
        short: c.short,
        author: c.author,
        email: c.email,
        authorDateMs: c.authorDateMs,
        commitDateMs: c.authorDateMs,
        subject: c.subject,
        parents: c.parents
      })),
      diffFiles,
      merging: false,
      rebasing: false,
      cherryPicking: false,
      reverting: false,
      tier: "full",
      autocrlf: null,
      nowMs,
      basisMs
    };
    const result = assemble(input);
    if (!result.ok) throw new Error(`\u771F\u5B9E\u7EC4\u88C5\u5668\u62D2\u7EDD\u4E86\u539F\u578B\u6570\u636E\uFF1A${result.detail}`);
    const commitFiles = /* @__PURE__ */ new Map();
    for (const c of capturedCommits) commitFiles.set(c.oid, c.files);
    return {
      screen: result.screen,
      commits: capturedCommits,
      commitFiles,
      branches: branchSamples(nowMs, capturedHead.slice(0, 7)),
      repoRoot: capturedRepoRoot,
      branch: capturedBranch,
      nowMs
    };
  }

  // docs/prototype/vc-redesign/src/domain/session.ts
  function createSessionState(base, nowMs) {
    const conflicts = [];
    const staged = [];
    const unstaged = [];
    const screen = base.screen;
    for (const entry of screen.staged) {
      if (entry.conflict) conflicts.push(entry.path);
      else if (entry.staged) staged.push(entry.path);
    }
    for (const entry of screen.unstaged) {
      if (entry.conflict) {
        if (!conflicts.includes(entry.path)) conflicts.push(entry.path);
      } else if (!unstaged.includes(entry.path)) {
        unstaged.push(entry.path);
      }
    }
    return {
      view: "changes",
      busy: null,
      reloading: false,
      result: null,
      confirmPull: null,
      staged,
      unstaged,
      conflicts,
      ahead: screen.identity.ahead,
      behind: screen.identity.behind,
      basisMs: screen.identity.basisMs,
      // 读取时刻就是页面打开、首屏到手的那一刻；远端依据是首屏数据里更早的基准。
      // 两个时钟必须分开：前者说明「这份界面什么时候读的盘」，后者说明「比较远端时用的是哪一刻的引用」。
      readAtMs: nowMs,
      changesFilter: "all",
      openFile: null,
      message: "",
      historyQuery: "",
      historyMergeOnly: false,
      historyOpenOid: null,
      historyOpenFile: null,
      localCommits: [],
      copiedPath: null,
      demoWorktrees: false,
      branchOpen: false,
      branchSub: "list",
      branchSelected: null,
      branchDraft: "",
      branchQuery: "",
      branchPending: null,
      branches: base.branches.map((row) => ({ ...row })),
      worktreePending: null,
      hiddenWorktrees: [],
      unlockedWorktrees: [],
      prunedWorktrees: [],
      changesPending: null,
      openMenuPath: null,
      ignored: [],
      stashes: [],
      stashPending: null,
      undoneOid: null
    };
  }
  function unique(paths) {
    return paths.filter((path, index) => paths.indexOf(path) === index);
  }
  function withResult(state, result) {
    return { ...state, result };
  }
  function enterBusy(state, op) {
    if (state.busy !== null || state.reloading) return state;
    return { ...state, busy: op, confirmPull: null, result: null };
  }
  function finishBusy(state, op, nowMs) {
    switch (op) {
      case "pull": {
        const fastForward = state.behind > 0;
        const next = {
          ...state,
          busy: null,
          behind: 0,
          basisMs: nowMs,
          readAtMs: nowMs
        };
        return withResult(next, {
          tone: fastForward ? "ok" : "info",
          text: fastForward ? "\u5DF2\u5FEB\u8FDB\u81F3\u8FDC\u7AEF\u6700\u65B0\u3002" : "\u5DF2\u662F\u6700\u65B0\u72B6\u6001\u3002",
          detail: fastForward ? "\u672C\u5730\u63D0\u4EA4\u6CA1\u6709\u88AB\u6539\u5199\uFF1B\u8FDC\u7AEF\u65B0\u63D0\u4EA4\u5DF2\u7ECF\u63A5\u5230\u5F53\u524D\u5206\u652F\u540E\u9762\u3002" : "\u8FDC\u7AEF\u6CA1\u6709\u65B0\u7684\u63D0\u4EA4\u9700\u8981\u6574\u5408\u3002",
          source: "sync"
        });
      }
      case "push": {
        const pushed = state.ahead;
        const next = { ...state, busy: null, ahead: 0 };
        if (pushed === 0) {
          return withResult(next, {
            tone: "info",
            text: "\u8FDC\u7AEF\u5DF2\u662F\u6700\u65B0\uFF0C\u6CA1\u6709\u9700\u8981\u63A8\u9001\u7684\u63D0\u4EA4\u3002",
            detail: null,
            source: "sync"
          });
        }
        return withResult(next, {
          tone: "ok",
          text: `\u63A8\u9001\u5B8C\u6210\uFF1A${pushed} \u7B14\u63D0\u4EA4\u5DF2\u5230\u8FBE\u8FDC\u7AEF\u3002`,
          detail: "\u63A8\u9001\u6210\u529F\u540E\u8FDC\u7AEF\u8DDF\u8E2A\u5F15\u7528\u5DF2\u7ECF\u5237\u65B0\uFF0C\u8D85\u524D\u4E0E\u843D\u540E\u90FD\u5F52\u96F6\u3002",
          source: "sync"
        });
      }
      case "fetch": {
        return withResult({ ...state, busy: null, basisMs: nowMs, readAtMs: nowMs }, {
          tone: "ok",
          text: "\u66F4\u65B0\u5B8C\u6210\uFF1A\u8FDC\u7AEF\u4F9D\u636E\u5DF2\u5237\u65B0\u3002",
          detail: unique(["\u8FDC\u7AEF\u8DDF\u8E2A\u5F15\u7528\u5DF2\u66F4\u65B0\uFF1B\u5DE5\u4F5C\u6811\u4E0E\u6682\u5B58\u533A\u6CA1\u6709\u53D8\u5316\u3002"]).join(""),
          source: "sync"
        });
      }
      default:
        return { ...state, busy: null };
    }
  }
  function shortOid2() {
    let out = "";
    for (let i = 0; i < 7; i += 1) out += "0123456789abcdef"[Math.floor(Math.random() * 16)];
    return out;
  }
  function reduce(state, action, base) {
    switch (action.type) {
      case "demo-worktrees":
        return { ...state, demoWorktrees: true };
      case "view":
        return { ...state, view: action.view };
      case "tick":
        return { ...state };
      case "stage": {
        if (state.busy !== null || state.reloading) return state;
        if (state.conflicts.includes(action.path)) return state;
        if (!state.unstaged.includes(action.path)) return state;
        return {
          ...state,
          unstaged: state.unstaged.filter((path) => path !== action.path),
          staged: unique([...state.staged, action.path])
        };
      }
      case "unstage": {
        if (state.busy !== null || state.reloading) return state;
        if (!state.staged.includes(action.path)) return state;
        return {
          ...state,
          staged: state.staged.filter((path) => path !== action.path),
          unstaged: unique([...state.unstaged, action.path])
        };
      }
      case "stage-all": {
        if (state.busy !== null || state.reloading) return state;
        if (state.conflicts.length > 0) return state;
        return { ...state, staged: unique([...state.staged, ...state.unstaged]), unstaged: [] };
      }
      case "unstage-all": {
        if (state.busy !== null || state.reloading) return state;
        return { ...state, unstaged: unique([...state.unstaged, ...state.staged]), staged: [] };
      }
      case "filter":
        return { ...state, changesFilter: action.filter };
      case "toggle-file":
        return { ...state, openFile: state.openFile === action.path ? null : action.path };
      case "message":
        return { ...state, message: action.value };
      case "commit-start":
        return enterBusy(state, "commit");
      case "commit-finish": {
        const staged = state.staged;
        const message = state.message.trim();
        if (staged.length === 0 || message === "") {
          return {
            ...state,
            busy: null,
            result: { tone: "error", text: staged.length === 0 ? "\u6682\u5B58\u533A\u4E3A\u7A7A\uFF0C\u5148\u6682\u5B58\u8981\u63D0\u4EA4\u7684\u6587\u4EF6\u3002" : "\u586B\u5199\u63D0\u4EA4\u8BF4\u660E\u540E\u5373\u53EF\u63D0\u4EA4\u3002", detail: null, source: "commit" }
          };
        }
        const files = staged.map((path) => {
          const meta = metadataOf(base, path);
          return { path, added: meta?.addedLines ?? 0, deleted: meta?.deletedLines ?? 0 };
        });
        const commit = {
          oid: shortOid2() + shortOid2() + shortOid2() + shortOid2() + shortOid2() + shortOid2(),
          short: shortOid2(),
          subject: message,
          author: "\u8FB0\u8FB0\u6D0B\u6D0B",
          authorDateMs: Date.now(),
          parents: [state.localCommits[0]?.oid ?? base.screen.commits[0]?.oid ?? ""],
          files
        };
        return {
          ...state,
          busy: null,
          staged: [],
          message: "",
          ahead: state.ahead + 1,
          localCommits: [commit, ...state.localCommits],
          result: {
            tone: "ok",
            text: `\u63D0\u4EA4\u5B8C\u6210\uFF1A${files.length} \u4E2A\u6587\u4EF6\u5DF2\u8FDB\u5165\u5386\u53F2\u3002`,
            detail: "\u8FD9\u6B21\u63D0\u4EA4\u53EA\u5305\u542B\u5DF2\u6682\u5B58\u7684\u6587\u4EF6\uFF1B\u6682\u5B58\u533A\u5DF2\u7ECF\u6E05\u7A7A\uFF0C\u53EF\u4EE5\u63A5\u7740\u6682\u5B58\u4E0B\u4E00\u6279\u3002",
            source: "commit"
          }
        };
      }
      case "op-start":
        return enterBusy(state, action.op);
      case "op-finish":
        if (state.busy !== action.op) return state;
        return finishBusy(state, action.op, action.nowMs);
      case "reload-start":
        if (state.busy !== null || state.reloading) return state;
        return { ...state, reloading: true, result: null };
      case "reload-finish":
        return {
          ...state,
          reloading: false,
          readAtMs: action.readAtMs,
          basisMs: action.basisMs,
          result: { tone: "info", text: "\u5DF2\u91CD\u65B0\u8BFB\u53D6\u3002", detail: "\u9996\u5C4F\u8BFB\u6570\u4E0E\u8FDC\u7AEF\u4F9D\u636E\u90FD\u5DF2\u5237\u65B0\uFF1B\u8FDC\u7AEF\u5F15\u7528\u6709\u6CA1\u6709\u53D8\u5316\u770B\u300C\u66F4\u65B0\u300D\u3002", source: "reload" }
        };
      case "pull-confirm-open":
        return { ...state, confirmPull: { dirtyCount: action.dirtyCount, files: action.files } };
      case "pull-confirm-close":
        return { ...state, confirmPull: null };
      case "history-query":
        return { ...state, historyQuery: action.value };
      case "history-merge-only":
        return { ...state, historyMergeOnly: !state.historyMergeOnly };
      case "history-open":
        return { ...state, historyOpenOid: action.oid, historyOpenFile: null };
      case "history-open-file":
        return { ...state, historyOpenFile: state.historyOpenFile === action.path ? null : action.path };
      case "history-back":
        return { ...state, historyOpenOid: null, historyOpenFile: null };
      case "result-clear":
        return state.result === null ? state : { ...state, result: null };
      case "copy":
        return withResult({ ...state, copiedPath: action.path }, {
          tone: "ok",
          text: `\u5DF2\u590D\u5236\uFF1A${action.path}`,
          detail: "\u590D\u5236\u8D70\u7684\u662F\u6D4F\u89C8\u5668\u7684\u526A\u8D34\u677F\uFF1B\u9762\u677F\u4E0D\u4F1A\u56E0\u6B64\u53D1\u8D77\u4EFB\u4F55 git \u64CD\u4F5C\u3002",
          source: "copy"
        });
      case "ai-worktrees":
        return withResult(state, {
          tone: "info",
          text: "\u539F\u578B\u91CC AI \u4EA4\u63A5\u53EA\u505A\u63D0\u793A\u3002",
          detail: "\u771F\u5B9E\u9875\u9762\u4F1A\u6253\u5F00\u672C\u673A DSH \u4F1A\u8BDD\uFF0C\u5E76\u5728\u63D0\u793A\u91CC\u5E26\u4E0A\u5F02\u5E38\u5DE5\u4F5C\u6811\u7684\u8DEF\u5F84\u4E0E\u72B6\u6001\u3002",
          source: "ai"
        });
      case "wt-pending":
        return { ...state, worktreePending: action.pending };
      case "wt-apply": {
        const pending = state.worktreePending;
        if (pending === null) return state;
        const hidden = state.hiddenWorktrees.includes(pending.path) ? state.hiddenWorktrees : [...state.hiddenWorktrees, pending.path];
        if (pending.kind === "unlock") {
          return withResult({
            ...state,
            worktreePending: null,
            unlockedWorktrees: unique([...state.unlockedWorktrees, pending.path])
          }, { tone: "ok", text: `\u5DF2\u89E3\u9664\u5360\u7528\uFF1A${pending.name}\u3002`, detail: "\u5DE5\u4F5C\u76EE\u5F55\u4E0E\u91CC\u9762\u7684\u6539\u52A8\u90FD\u6CA1\u6709\u52A8\uFF0C\u53EA\u662F\u53BB\u6389\u4E86 git \u7684\u5360\u7528\u6807\u8BB0\u3002", source: "worktree" });
        }
        if (pending.kind === "prune") {
          return withResult({
            ...state,
            worktreePending: null,
            hiddenWorktrees: hidden,
            prunedWorktrees: unique([...state.prunedWorktrees, pending.path])
          }, { tone: "ok", text: `\u5DF2\u6E05\u7406\u8BB0\u5F55\uFF1A${pending.name}\u3002`, detail: "\u8FD9\u6761\u8BB0\u5F55\u5BF9\u5E94\u7684\u76EE\u5F55\u672C\u6765\u5C31\u4E0D\u5B58\u5728\uFF0C\u6E05\u7406\u4E0D\u4F1A\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\u3002", source: "worktree" });
        }
        return withResult({
          ...state,
          worktreePending: null,
          hiddenWorktrees: hidden
        }, { tone: "ok", text: `\u5DF2\u79FB\u9664\u5DE5\u4F5C\u6811\uFF1A${pending.name}\u3002`, detail: "\u5206\u652F\u4E0E\u63D0\u4EA4\u90FD\u8FD8\u5728\u4ED3\u5E93\u91CC\uFF1B\u8FD9\u4E00\u6B65\u53EA\u5220\u6389\u4E86\u68C0\u51FA\u8BB0\u5F55\u4E0E\u5DE5\u4F5C\u76EE\u5F55\u3002", source: "worktree" });
      }
      case "changes-pending":
        return { ...state, changesPending: action.pending, openMenuPath: null };
      case "changes-open-menu":
        return { ...state, openMenuPath: action.path, changesPending: null };
      case "changes-apply": {
        const pending = state.changesPending;
        if (pending === null) return state;
        const cleared = { ...state, changesPending: null };
        const path = pending.path;
        const name = path === null ? "" : nameOfPath(path);
        switch (pending.kind) {
          case "discard": {
            if (path === null || !state.unstaged.includes(path)) return cleared;
            const lines = changeSummary(base, path);
            return withResult({
              ...cleared,
              unstaged: state.unstaged.filter((item) => item !== path)
            }, {
              tone: "warn",
              text: `\u5DF2\u4E22\u5F03 ${name} \u7684\u672A\u6682\u5B58\u6539\u52A8\u3002`,
              detail: lines === "" ? "\u6587\u4EF6\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF1B\u9762\u677F\u4E0D\u80FD\u64A4\u56DE\u8FD9\u4E00\u6B65\u3002" : `\u6587\u4EF6\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF0C${lines} \u4E00\u8D77\u4E22\u6389\u4E86\uFF1B\u9762\u677F\u4E0D\u80FD\u64A4\u56DE\u8FD9\u4E00\u6B65\u3002`,
              source: "changes"
            });
          }
          case "discard-all": {
            const count = state.unstaged.length;
            if (count === 0) return cleared;
            return withResult({ ...cleared, unstaged: [] }, {
              tone: "warn",
              text: `\u5DF2\u4E22\u5F03 ${count} \u4E2A\u6587\u4EF6\u7684\u672A\u6682\u5B58\u6539\u52A8\u3002`,
              detail: "\u8FD9\u4E9B\u6587\u4EF6\u90FD\u56DE\u5230\u4E0A\u4E00\u6B21\u63D0\u4EA4\u65F6\u7684\u5185\u5BB9\uFF1B\u9762\u677F\u4E0D\u80FD\u64A4\u56DE\u8FD9\u4E00\u6B65\u3002",
              source: "changes"
            });
          }
          case "ignore": {
            if (path === null || !state.unstaged.includes(path)) return cleared;
            return withResult({
              ...cleared,
              unstaged: state.unstaged.filter((item) => item !== path),
              ignored: unique([...state.ignored, path])
            }, {
              tone: "info",
              text: `\u5DF2\u628A ${name} \u52A0\u5165 .gitignore\u3002`,
              detail: "\u6587\u4EF6\u4ECD\u7136\u7559\u5728\u78C1\u76D8\u4E0A\uFF0Cgit \u4ECE\u4E0B\u4E00\u6B21\u8BFB\u53D6\u8D77\u4E0D\u518D\u8DDF\u8E2A\u5B83\uFF1B\u5DF2\u7ECF\u63D0\u4EA4\u8FDB\u5386\u53F2\u7684\u5185\u5BB9\u4E0D\u53D7\u5F71\u54CD\u3002\u539F\u578B\u4E0D\u4F1A\u771F\u7684\u6539 .gitignore\u3002",
              source: "changes"
            });
          }
          case "delete-untracked": {
            if (path === null || !state.unstaged.includes(path)) return cleared;
            return withResult({
              ...cleared,
              unstaged: state.unstaged.filter((item) => item !== path)
            }, {
              tone: "warn",
              text: `\u5DF2\u5220\u9664\u672A\u8DDF\u8E2A\u6587\u4EF6 ${name}\u3002`,
              detail: "\u5B83\u4ECE\u6765\u6CA1\u6709\u8FDB\u8FC7 git \u5386\u53F2\uFF0C\u5220\u9664\u4EE5\u540E\u6CA1\u6709\u4EFB\u4F55\u5730\u65B9\u80FD\u627E\u56DE\u3002\u539F\u578B\u4E0D\u4F1A\u771F\u7684\u5220\u78C1\u76D8\u4E0A\u7684\u6587\u4EF6\u3002",
              source: "changes"
            });
          }
          case "resolve-ours":
          case "resolve-theirs": {
            if (path === null || !state.conflicts.includes(path)) return cleared;
            const conflicts = state.conflicts.filter((item) => item !== path);
            const side = pending.kind === "resolve-ours" ? "\u5F53\u524D\u5206\u652F" : "\u5BF9\u65B9";
            return withResult({
              ...cleared,
              conflicts,
              staged: unique([...state.staged, path])
            }, {
              tone: "ok",
              text: `\u5DF2\u6309${side}\u7684\u7248\u672C\u89E3\u51B3 ${name}\uFF0C\u6587\u4EF6\u5DF2\u6682\u5B58\u3002`,
              detail: conflicts.length === 0 ? "\u51B2\u7A81\u5DF2\u7ECF\u5168\u90E8\u89E3\u51B3\uFF0C\u73B0\u5728\u53EF\u4EE5\u63D0\u4EA4\u8FD9\u6B21\u5408\u5E76\u7684\u7ED3\u679C\u3002" : `\u8FD8\u6709 ${conflicts.length} \u4E2A\u51B2\u7A81\u6587\u4EF6\u6CA1\u6709\u89E3\u51B3\u3002`,
              source: "changes"
            });
          }
          default:
            return cleared;
        }
      }
      case "demo-conflicts":
        return { ...state, conflicts: unique([...state.conflicts, "src/client/views/versionControl/vcWriteView.ts", "src/shared/version-control/src/rules.ts"]) };
      case "branch-open":
        return { ...state, branchOpen: true, branchSub: "list", branchSelected: null, branchDraft: "", branchPending: null };
      case "branch-close":
        return { ...state, branchOpen: false, branchPending: null, branchDraft: "" };
      case "branch-select":
        return { ...state, branchSelected: action.name, branchSub: "detail", branchPending: null, branchDraft: "" };
      case "branch-sub":
        return { ...state, branchSub: action.sub, branchDraft: "", branchPending: null };
      case "branch-draft":
        return { ...state, branchDraft: action.value };
      case "branch-query":
        return { ...state, branchQuery: action.value };
      case "branch-pending":
        return { ...state, branchPending: action.pending };
      case "branch-create": {
        if (state.busy !== null || state.reloading) return state;
        const name = state.branchDraft.trim();
        if (name === "" || /\s/.test(name)) {
          return withResult(state, { tone: "error", text: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002", detail: null, source: "branch" });
        }
        if (state.branches.some((row) => row.name === name)) {
          return withResult(state, { tone: "error", text: `\u5206\u652F ${name} \u5DF2\u7ECF\u5B58\u5728\u3002`, detail: null, source: "branch" });
        }
        const current = state.branches.find((row) => row.current);
        const created = {
          name,
          upstream: null,
          ahead: 0,
          behind: 0,
          oidShort: current === void 0 ? state.branches[0]?.oidShort ?? "" : current.oidShort,
          lastCommitMs: Date.now(),
          subject: current === void 0 ? "\u4ECE\u5F53\u524D\u63D0\u4EA4\u521B\u5EFA" : `\u4ECE ${current.name} \u7684\u5F53\u524D\u63D0\u4EA4\u521B\u5EFA`,
          mergedIntoCurrent: true,
          current: false
        };
        return withResult({
          ...state,
          branches: [...state.branches, created],
          branchSub: "detail",
          branchSelected: name,
          branchDraft: ""
        }, { tone: "ok", text: `\u5DF2\u521B\u5EFA\u5206\u652F ${name}\uFF0C\u8FD8\u6CA1\u6709\u5207\u6362\u8FC7\u53BB\u3002`, detail: "\u65B0\u5206\u652F\u6307\u5411\u5F53\u524D\u5206\u652F\u7684\u6700\u65B0\u63D0\u4EA4\uFF1B\u5207\u6362\u8FC7\u53BB\u4E4B\u540E\u624D\u4F1A\u5728\u5B83\u4E0A\u9762\u63D0\u4EA4\u3002", source: "branch" });
      }
      case "branch-rename": {
        if (state.busy !== null || state.reloading) return state;
        const name = state.branchDraft.trim();
        const from = action.name;
        if (name === "" || /\s/.test(name)) {
          return withResult(state, { tone: "error", text: "\u5206\u652F\u540D\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B\u7A7A\u683C\u3002", detail: null, source: "branch" });
        }
        if (name === from) return { ...state, branchSub: "detail", branchDraft: "" };
        if (state.branches.some((row) => row.name === name)) {
          return withResult(state, { tone: "error", text: `\u5206\u652F ${name} \u5DF2\u7ECF\u5B58\u5728\u3002`, detail: null, source: "branch" });
        }
        return withResult({
          ...state,
          branches: state.branches.map((row) => row.name === from ? { ...row, name } : row),
          branchSub: "detail",
          branchSelected: name,
          branchDraft: ""
        }, { tone: "ok", text: `\u5206\u652F ${from} \u5DF2\u6539\u540D\u4E3A ${name}\u3002`, detail: "\u53EA\u6539\u672C\u5730\u540D\u5B57\uFF1B\u4E0A\u6E38\u8DDF\u8E2A\u5F15\u7528\u4E0E\u8FDC\u7AEF\u5206\u652F\u540D\u90FD\u4E0D\u53D7\u5F71\u54CD\u3002", source: "branch" });
      }
      case "branch-switch": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        if (target === void 0 || target.current) return { ...state, branchPending: null };
        return withResult({
          ...state,
          branches: state.branches.map((row) => ({ ...row, current: row.name === action.name })),
          branchPending: null,
          branchSub: "detail",
          branchSelected: action.name,
          ahead: target.ahead,
          behind: target.behind
        }, { tone: "ok", text: `\u5DF2\u5207\u6362\u5230\u5206\u652F ${action.name}\u3002`, detail: "\u5DE6\u4FA7\u5DE5\u4F5C\u533A\u7684\u672A\u63D0\u4EA4\u6539\u52A8\u5DF2\u7ECF\u5E26\u8FC7\u6765\u4E86\uFF1B\u8BFB\u5199\u4E0E\u63D0\u4EA4\u90FD\u53D1\u751F\u5728\u65B0\u5206\u652F\u4E0A\u3002", source: "branch" });
      }
      case "branch-merge": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        const current = state.branches.find((row) => row.current);
        if (target === void 0 || current === void 0) return { ...state, branchPending: null };
        if (target.current) {
          return withResult(state, { tone: "error", text: "\u4E0D\u80FD\u628A\u5F53\u524D\u5206\u652F\u5408\u5E76\u8FDB\u5B83\u81EA\u5DF1\u3002", detail: null, source: "branch" });
        }
        const commits = target.ahead + 1;
        return withResult({
          ...state,
          branches: state.branches.map((row) => row.name === target.name ? { ...row, mergedIntoCurrent: true } : row),
          ahead: state.ahead + commits,
          branchPending: null
        }, {
          tone: "ok",
          text: `\u5DF2\u628A ${target.name} \u5408\u5E76\u8FDB ${current.name}\uFF0C\u63A5\u5165 ${commits} \u4E2A\u63D0\u4EA4\u3002`,
          detail: "\u8FD9\u6B21\u5408\u5E76\u6CA1\u6709\u51B2\u7A81\uFF1B\u5408\u5E76\u540E\u7684\u7ED3\u679C\u8FD8\u5728\u672C\u5730\uFF0C\u63A8\u9001\u4E4B\u540E\u8FDC\u7AEF\u624D\u770B\u5F97\u5230\u3002",
          source: "branch"
        });
      }
      case "branch-delete": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        if (target === void 0) return { ...state, branchPending: null };
        if (target.current) {
          return withResult(state, { tone: "error", text: "\u4E0D\u80FD\u5220\u9664\u5F53\u524D\u5206\u652F\uFF0C\u5148\u5207\u6362\u5230\u522B\u7684\u5206\u652F\u3002", detail: null, source: "branch" });
        }
        return withResult({
          ...state,
          branches: state.branches.filter((row) => row.name !== action.name),
          branchSub: "list",
          branchSelected: null,
          branchPending: null
        }, { tone: "ok", text: `\u5DF2\u5220\u9664\u5206\u652F ${action.name}\u3002`, detail: "\u53EA\u5220\u4E86\u672C\u5730\u8BB0\u5F55\uFF1B\u5982\u679C\u8FDC\u7AEF\u8FD8\u6709\u8FD9\u6761\u5206\u652F\uFF0C\u5B83\u4E0D\u53D7\u5F71\u54CD\u3002", source: "branch" });
      }
      case "branch-rebase": {
        if (state.busy !== null || state.reloading) return state;
        const target = state.branches.find((row) => row.name === action.name);
        const current = state.branches.find((row) => row.current);
        if (target === void 0 || current === void 0 || target.current) {
          return withResult(state, { tone: "error", text: "\u4E0D\u80FD\u628A\u5F53\u524D\u5206\u652F\u53D8\u57FA\u5230\u5B83\u81EA\u5DF1\u3002", detail: null, source: "branch" });
        }
        return withResult({
          ...state,
          branches: state.branches.map((row) => row.name === target.name ? { ...row, mergedIntoCurrent: true } : row),
          branchSub: "list",
          branchSelected: null
        }, {
          tone: "warn",
          text: `\u5DF2\u628A ${current.name} \u53D8\u57FA\u5230 ${target.name} \u4E0A\u3002`,
          detail: "\u672C\u5730\u5386\u53F2\u88AB\u91CD\u5199\u6210\u300C\u5148\u653E\u5BF9\u65B9\u5206\u652F\uFF0C\u518D\u63A5\u4E0A\u81EA\u5DF1\u7684\u63D0\u4EA4\u300D\uFF1B\u63D0\u4EA4\u53F7\u53D8\u4E86\uFF0C\u5982\u679C\u8FD9\u6761\u5206\u652F\u5DF2\u7ECF\u63A8\u9001\u8FC7\uFF0C\u8FDC\u7AEF\u9700\u8981\u5F3A\u63A8\u624D\u80FD\u5BF9\u9F50\u3002\u539F\u578B\u53EA\u6F14\u793A\u7ED3\u679C\u4E0E\u72B6\u6001\u53D8\u5316\uFF0C\u4E0D\u6539\u5199\u771F\u5B9E\u5386\u53F2\u3002",
          source: "branch"
        });
      }
      case "stash-create": {
        if (state.busy !== null || state.reloading) return state;
        if (state.conflicts.length > 0) {
          return withResult(state, { tone: "error", text: "\u6709\u51B2\u7A81\u6587\u4EF6\u65F6\u4E0D\u80FD\u8D2E\u85CF\u3002", detail: "\u8D2E\u85CF\u4F1A\u628A\u5DE5\u4F5C\u6811\u6062\u590D\u6210\u4E0A\u6B21\u63D0\u4EA4\u65F6\u7684\u6837\u5B50\uFF0C\u51B2\u7A81\u6587\u4EF6\u6CA1\u6709\u53EF\u4EE5\u5B89\u5168\u6062\u590D\u7684\u7248\u672C\uFF1B\u5148\u89E3\u51B3\u51B2\u7A81\uFF0C\u518D\u8D2E\u85CF\u5269\u4E0B\u7684\u6539\u52A8\u3002", source: "changes" });
        }
        const paths = unique([...state.staged, ...state.unstaged]);
        if (paths.length === 0) {
          return withResult(state, { tone: "info", text: "\u5DE5\u4F5C\u533A\u662F\u5E72\u51C0\u7684\uFF0C\u6CA1\u6709\u53EF\u8D2E\u85CF\u7684\u6539\u52A8\u3002", detail: null, source: "changes" });
        }
        const branchName = state.branches.find((row) => row.current)?.name ?? base.branch ?? "detached";
        const message = state.message.trim() === "" ? `WIP on ${branchName}` : state.message.trim();
        const entry = {
          id: `stash@{${state.stashes.length}}`,
          message,
          whenMs: Date.now(),
          paths
        };
        return withResult({
          ...state,
          stashes: [entry, ...state.stashes],
          staged: [],
          unstaged: [],
          message: ""
        }, {
          tone: "ok",
          text: `\u5DF2\u8D2E\u85CF ${paths.length} \u4E2A\u6587\u4EF6\u7684\u6539\u52A8\u3002`,
          detail: `\u8D2E\u85CF\u8BB0\u5F55 ${entry.id} \u91CC\u653E\u7740\u8FD9\u4E9B\u6587\u4EF6\uFF1B\u5DE5\u4F5C\u533A\u4E0E\u6682\u5B58\u533A\u90FD\u6062\u590D\u6210\u4E0A\u6B21\u63D0\u4EA4\u65F6\u7684\u6837\u5B50\uFF0C\u5E94\u7528\u6216\u5F39\u51FA\u90FD\u80FD\u628A\u5B83\u62FF\u56DE\u6765\u3002`,
          source: "changes"
        });
      }
      case "stash-apply":
      case "stash-pop": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.stashes.find((row) => row.id === action.id);
        if (entry === void 0) return state;
        const restored = entry.paths.filter((path) => !state.conflicts.includes(path));
        const before = state.stashes.length;
        const stashes = action.type === "stash-pop" ? state.stashes.filter((row) => row.id !== action.id) : state.stashes;
        return withResult({
          ...state,
          stashes,
          unstaged: unique([...state.unstaged, ...restored]),
          stashPending: null
        }, {
          tone: "ok",
          text: action.type === "stash-pop" ? `\u5DF2\u5F39\u51FA ${entry.id}\uFF0C${restored.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u5DE5\u4F5C\u533A\u3002` : `\u5DF2\u5E94\u7528 ${entry.id}\uFF0C${restored.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u5DE5\u4F5C\u533A\u3002`,
          detail: action.type === "stash-pop" ? `\u5F39\u51FA\u7B49\u4E8E\u300C\u5E94\u7528 + \u5220\u9664\u300D\uFF1A\u8FD9\u6761\u8D2E\u85CF\u5DF2\u7ECF\u4ECE\u6E05\u5355\u91CC\u79FB\u9664\uFF08\u539F\u6765 ${before} \u6761\uFF09\u3002\u6539\u52A8\u73B0\u5728\u5728\u672A\u6682\u5B58\u533A\uFF0C\u9700\u8981\u91CD\u65B0\u6682\u5B58\u518D\u63D0\u4EA4\u3002` : `\u5E94\u7528\u53EA\u628A\u6539\u52A8\u653E\u56DE\u5DE5\u4F5C\u533A\uFF0C\u8D2E\u85CF\u8BB0\u5F55\u4ECD\u7136\u4FDD\u7559\u5728\u6E05\u5355\u91CC\uFF08${before} \u6761\uFF09\uFF0C\u53EF\u4EE5\u518D\u5E94\u7528\u4E00\u6B21\u6216\u968F\u540E\u4E22\u5F03\u3002`,
          source: "stash"
        });
      }
      case "stash-pending":
        return { ...state, stashPending: action.pending };
      case "stash-drop": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.stashes.find((row) => row.id === action.id);
        if (entry === void 0) return { ...state, stashPending: null };
        return withResult({
          ...state,
          stashes: state.stashes.filter((row) => row.id !== action.id),
          stashPending: null
        }, {
          tone: "warn",
          text: `\u5DF2\u4E22\u5F03\u8D2E\u85CF\u8BB0\u5F55 ${entry.id}\u3002`,
          detail: `\u8BB0\u5F55\u91CC\u90A3 ${entry.paths.length} \u4E2A\u6587\u4EF6\u5F53\u65F6\u7684\u6837\u5B50\u5DF2\u7ECF\u4E0D\u5B58\u5728\uFF1B\u8FD9\u4E00\u6B65\u4E0D\u80FD\u64A4\u56DE\u3002`,
          source: "stash"
        });
      }
      case "commit-undo": {
        if (state.busy !== null || state.reloading) return state;
        const localHead = state.localCommits[0] ?? null;
        const capturedHead2 = base.screen.commits[0];
        const headOid = localHead !== null ? localHead.oid : capturedHead2?.oid ?? null;
        if (headOid === null || action.oid !== headOid) {
          return withResult(state, {
            tone: "error",
            text: "\u53EA\u80FD\u64A4\u9500\u6700\u65B0\u4E00\u6761\u63D0\u4EA4\u3002",
            detail: "\u64A4\u9500\u4F1A\u628A\u63D0\u4EA4\u91CC\u7684\u6539\u52A8\u653E\u56DE\u6682\u5B58\u533A\u3001\u5E76\u8BA9\u5206\u652F\u9000\u4E00\u6B65\uFF1B\u9009\u62E9\u66F4\u65E9\u7684\u63D0\u4EA4\u5C31\u5F97\u6539\u5199\u5B83\u540E\u9762\u7684\u5386\u53F2\uFF0C\u539F\u578B\u4E0D\u505A\u8FD9\u4E00\u6B65\u3002",
            source: "history"
          });
        }
        const files = localHead !== null ? localHead.files.map((file) => file.path) : (base.commitFiles.get(action.oid) ?? []).map((file) => file.path);
        const subject = localHead !== null ? localHead.subject : capturedHead2?.subject ?? "";
        const pushed = state.ahead === 0;
        return withResult({
          ...state,
          localCommits: localHead !== null ? state.localCommits.slice(1) : state.localCommits,
          undoneOid: localHead !== null ? state.undoneOid : action.oid,
          staged: unique([...state.staged, ...files]),
          message: state.message.trim() === "" ? subject : state.message,
          ahead: pushed ? state.ahead : Math.max(0, state.ahead - 1),
          behind: pushed ? state.behind + 1 : state.behind
        }, {
          tone: "warn",
          text: `\u5DF2\u64A4\u9500\u63D0\u4EA4 ${subject === "" ? action.oid.slice(0, 7) : subject}\u3002`,
          detail: pushed ? `\u63D0\u4EA4\u91CC\u7684 ${files.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u6682\u5B58\u533A\uFF0C\u63D0\u4EA4\u8BF4\u660E\u7559\u5728\u8F93\u5165\u6846\u91CC\uFF1B\u8FD9\u6761\u63D0\u4EA4\u5DF2\u7ECF\u63A8\u9001\u8FC7\uFF0C\u6240\u4EE5\u672C\u5730\u73B0\u5728\u6BD4\u8FDC\u7AEF\u5404\u5C11\u4E00\u6B65\uFF0C\u9700\u8981\u91CD\u65B0\u63D0\u4EA4\u540E\u518D\u63A8\u9001\u3002` : `\u63D0\u4EA4\u91CC\u7684 ${files.length} \u4E2A\u6587\u4EF6\u56DE\u5230\u6682\u5B58\u533A\uFF0C\u63D0\u4EA4\u8BF4\u660E\u7559\u5728\u8F93\u5165\u6846\u91CC\uFF1B\u53EF\u4EE5\u6539\u5B8C\u518D\u91CD\u65B0\u63D0\u4EA4\u3002`,
          source: "history"
        });
      }
      case "commit-revert": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.localCommits.find((row) => row.oid === action.oid) ?? base.screen.commits.find((row) => row.oid === action.oid);
        if (entry === void 0) return state;
        return withResult({ ...state, ahead: state.ahead + 1 }, {
          tone: "ok",
          text: `\u5DF2\u751F\u6210\u4E00\u6B21\u53CD\u5411\u63D0\u4EA4\uFF0C\u62B5\u6D88\u300C${entry.subject}\u300D\u3002`,
          detail: "\u56DE\u9000\u4E0D\u662F\u5220\u9664\u5386\u53F2\uFF1A\u539F\u63D0\u4EA4\u8FD8\u5728\uFF0C\u540E\u9762\u591A\u4E86\u4E00\u7B14\u628A\u5B83\u7684\u6539\u52A8\u64A4\u56DE\u53BB\u7684\u65B0\u63D0\u4EA4\u3002\u8FD9\u7B14\u65B0\u63D0\u4EA4\u8FD8\u6CA1\u6709\u63A8\u9001\uFF1B\u5982\u679C\u548C\u522B\u7684\u5206\u652F\u51B2\u7A81\uFF0C\u9700\u8981\u5148\u89E3\u51B3\u51B2\u7A81\u3002\u539F\u578B\u4E0D\u771F\u7684\u5199\u5386\u53F2\u3002",
          source: "history"
        });
      }
      case "commit-cherry-pick": {
        if (state.busy !== null || state.reloading) return state;
        const entry = state.localCommits.find((row) => row.oid === action.oid) ?? base.screen.commits.find((row) => row.oid === action.oid);
        if (entry === void 0) return state;
        if (entry.parents.length > 1) {
          return withResult(state, { tone: "error", text: "\u5408\u5E76\u63D0\u4EA4\u4E0D\u80FD\u76F4\u63A5\u62E3\u9009\u3002", detail: "\u5408\u5E76\u63D0\u4EA4\u6709\u4E24\u4E2A\u7236\u63D0\u4EA4\uFF0C\u62E3\u9009\u65F6 git \u4E0D\u77E5\u9053\u8981\u5E26\u54EA\u4E00\u8FB9\uFF1B\u5148\u62E3\u9009\u5B83\u5F15\u5165\u7684\u90A3\u4E9B\u666E\u901A\u63D0\u4EA4\u3002", source: "history" });
        }
        return withResult({ ...state, ahead: state.ahead + 1 }, {
          tone: "ok",
          text: `\u5DF2\u628A\u63D0\u4EA4 ${entry.short} \u62E3\u9009\u5230\u5F53\u524D\u5206\u652F\u3002`,
          detail: "\u539F\u6765\u7684\u63D0\u4EA4\u7559\u5728\u5B83\u81EA\u5DF1\u7684\u5206\u652F\u4E0A\uFF1B\u5F53\u524D\u5206\u652F\u591A\u4E86\u4E00\u7B14\u5185\u5BB9\u76F8\u540C\u3001\u63D0\u4EA4\u53F7\u4E0D\u540C\u7684\u65B0\u63D0\u4EA4\uFF0C\u8FD8\u6CA1\u6709\u63A8\u9001\u3002\u539F\u578B\u4E0D\u771F\u7684\u5199\u5386\u53F2\u3002",
          source: "history"
        });
      }
      default:
        return state;
    }
  }
  function metadataOf(base, path) {
    return [...base.screen.staged, ...base.screen.unstaged].find((entry) => entry.path === path);
  }
  function nameOfPath(path) {
    const segments = path.split(/[\\/]/);
    return segments[segments.length - 1] ?? path;
  }
  function changeSummary(base, path) {
    const meta = metadataOf(base, path);
    if (meta === void 0) return "";
    const parts = [];
    if (meta.addedLines !== null && meta.addedLines > 0) parts.push(`\u65B0\u589E ${meta.addedLines} \u884C`);
    if (meta.deletedLines !== null && meta.deletedLines > 0) parts.push(`\u5220\u9664 ${meta.deletedLines} \u884C`);
    return parts.join("\uFF0C");
  }

  // docs/prototype/vc-redesign/src/domain/handoff.ts
  var TITLES = {
    general: "\u4E0D\u60F3\u4EB2\u81EA\u5904\u7406\uFF1F\u628A\u5F53\u524D\u72B6\u6001\u4EA4\u7ED9 AI",
    changes: "\u6539\u52A8\u592A\u591A\uFF1F\u4EA4\u7ED9 AI \u62C6\u6210\u51E0\u6761\u63D0\u4EA4",
    worktrees: "\u5DE5\u4F5C\u6811\u592A\u4E71\uFF1F\u4EA4\u7ED9 AI \u6536\u5C3E",
    branches: "\u5206\u652F\u5173\u7CFB\u592A\u4E71\uFF1F\u4EA4\u7ED9 AI \u7406\u6E05"
  };
  var LEDES = {
    general: "\u8FD9\u6BB5\u8BF4\u660E\u5E26\u7740\u4ED3\u5E93\u3001\u5206\u652F\u3001\u5DE5\u4F5C\u533A\u6587\u4EF6\u3001\u5176\u4ED6\u5DE5\u4F5C\u6811\u548C\u6700\u8FD1\u63D0\u4EA4\uFF1B\u590D\u5236\u4E4B\u540E\u7C98\u8D34\u5230\u65B0\u5BF9\u8BDD\u91CC\uFF0C\u5C31\u80FD\u63A5\u7740\u8C08\u3002",
    changes: "\u8FD9\u6BB5\u8BF4\u660E\u4F1A\u5217\u51FA\u6BCF\u4E00\u4E2A\u672A\u63D0\u4EA4\u7684\u6587\u4EF6\u548C\u589E\u5220\u884C\u6570\uFF0C\u590D\u5236\u4E4B\u540E\u7C98\u8D34\u5230\u65B0\u5BF9\u8BDD\u91CC\uFF0C\u8BA9 AI \u76F4\u63A5\u5224\u65AD\u8BE5\u5206\u6210\u51E0\u6761\u63D0\u4EA4\u3002",
    worktrees: "\u8FD9\u6BB5\u8BF4\u660E\u4F1A\u5217\u51FA\u6BCF\u4E00\u68F5\u5176\u4ED6\u5DE5\u4F5C\u6811\u7684\u72B6\u6001\u4E0E\u539F\u56E0\uFF0C\u590D\u5236\u4E4B\u540E\u8BA9 AI \u5224\u65AD\u54EA\u4E9B\u8BE5\u89E3\u9501\u3001\u54EA\u4E9B\u8BE5\u6E05\u7406\u8BB0\u5F55\u3001\u54EA\u4E9B\u8BE5\u79FB\u9664\u3002",
    branches: "\u8FD9\u6BB5\u8BF4\u660E\u4F1A\u5217\u51FA\u672C\u5730\u5206\u652F\u4E0E\u4E0A\u6E38\u7684\u5173\u7CFB\u3001\u9886\u5148\u843D\u540E\u4E0E\u662F\u5426\u5DF2\u5408\u5E76\uFF0C\u590D\u5236\u4E4B\u540E\u8BA9 AI \u7ED9\u51FA\u5B89\u5168\u7684\u5408\u5E76\u4E0E\u5220\u9664\u987A\u5E8F\u3002"
  };
  var GOALS = {
    general: "\u5148\u5E2E\u6211\u628A\u5F53\u524D\u72B6\u6001\u6838\u5BF9\u6E05\u695A\uFF0C\u518D\u544A\u8BC9\u6211\u4E0B\u4E00\u6B65\u6700\u503C\u5F97\u505A\u7684\u4E00\u4EF6\u4E8B\u3002",
    changes: "\u628A\u8FD9\u6279\u6539\u52A8\u6574\u7406\u6210\u82E5\u5E72\u6761\u4E3B\u9898\u6E05\u695A\u7684\u63D0\u4EA4\uFF0C\u5E76\u9010\u6761\u544A\u8BC9\u6211\u5E94\u8BE5\u628A\u54EA\u4E9B\u6587\u4EF6\u653E\u8FDB\u540C\u4E00\u6761\u63D0\u4EA4\u3002",
    worktrees: "\u628A\u5DE5\u4F5C\u6811\u6E05\u5355\u6062\u590D\u5E72\u51C0\uFF1A\u80FD\u89E3\u9501\u7684\u89E3\u9501\uFF0C\u80FD\u6E05\u7406\u8BB0\u5F55\u7684\u6E05\u7406\u8BB0\u5F55\uFF0C\u80FD\u79FB\u9664\u7684\u79FB\u9664\uFF1B\u6BCF\u4E00\u6B65\u5148\u8BF4\u6E05\u695A\u98CE\u9669\u3002",
    branches: "\u7406\u6E05\u5206\u652F\u5173\u7CFB\uFF1A\u8BE5\u5408\u5E76\u7684\u5408\u5E76\uFF0C\u8BE5\u5220\u9664\u7684\u5220\u9664\uFF0C\u7136\u540E\u544A\u8BC9\u6211\u4EE5\u540E\u600E\u4E48\u4FDD\u6301\u6574\u6D01\u3002"
  };
  function fileLine(entry) {
    if (entry.conflict) return `${entry.path}\uFF08\u51B2\u7A81\uFF0C\u5C1A\u672A\u89E3\u51B3\uFF09`;
    const added = entry.addedLines;
    const deleted = entry.deletedLines;
    if (added === null && deleted === null) return `${entry.path}\uFF08\u672A\u8DDF\u8E2A\u6216\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u6CA1\u6709\u884C\u6570\uFF09`;
    const parts = [];
    if (added !== null && added > 0) parts.push(`\u65B0\u589E ${added} \u884C`);
    if (deleted !== null && deleted > 0) parts.push(`\u5220\u9664 ${deleted} \u884C`);
    return parts.length === 0 ? `${entry.path}\uFF08\u5185\u5BB9\u4E0D\u53D8\uFF0C\u53EA\u6709\u6587\u4EF6\u72B6\u6001\u53D8\u5316\uFF09` : `${entry.path}\uFF08${parts.join("\uFF0C")}\uFF09`;
  }
  function pendingOperationText(screen) {
    const names = [];
    if (screen.repo.merging) names.push("\u5408\u5E76");
    if (screen.repo.rebasing) names.push("\u53D8\u57FA");
    if (screen.repo.cherryPicking) names.push("\u62E3\u9009");
    if (screen.repo.reverting) names.push("\u56DE\u9000");
    return names.length === 0 ? "\u65E0\uFF0C\u6CA1\u6709\u6B63\u5728\u8FDB\u884C\u7684\u5408\u5E76\u3001\u53D8\u57FA\u3001\u62E3\u9009\u6216\u56DE\u9000" : `\u6B63\u5728\u8FDB\u884C\uFF1A${names.join("\u3001")}`;
  }
  function worktreeStateText(row) {
    if (row.locked) return row.lockReason === null ? "\u5DF2\u88AB\u5360\u7528\uFF0Cgit \u8BB0\u4E86\u7BA1\u7406\u5458\u9501" : `\u5DF2\u88AB\u5360\u7528\uFF1A${row.lockReason}`;
    if (row.prunable) return "\u76EE\u5F55\u5DF2\u7ECF\u4E0D\u5B58\u5728\uFF0C\u53EA\u5269\u4E00\u6761 git \u8BB0\u5F55";
    if (row.prunableUnknown) return "\u76EE\u5F55\u8FD8\u5728\u4E0D\u5728\u65E0\u6CD5\u5224\u65AD\uFF0C\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4";
    return null;
  }
  function numbered(lines) {
    return lines.map((line, index) => `  ${index + 1}. ${line}`).join("\n");
  }
  function buildHandoff(data, kind, nowMs, focus) {
    const screen = data.screen;
    const identity = screen.identity;
    const upstream = screen.branches.find((row) => row.short === data.branch)?.upstream ?? null;
    const otherWorktrees = screen.otherWorktrees;
    const abnormal = otherWorktrees.filter((row) => worktreeStateText(row) !== null);
    const branches = data.branches;
    const mergedBranches = branches.filter((row) => row.mergedIntoCurrent && row.name !== data.branch);
    const looseBranches = branches.filter((row) => row.upstream === null && row.name !== data.branch);
    const stagedLines = screen.staged.map(fileLine);
    const unstagedLines = screen.unstaged.map(fileLine);
    const conflictLines = screen.unstaged.filter((row) => row.conflict).map(fileLine);
    const recentCommits = data.commits.slice(0, 5).map((commit) => `${commit.short} ${commit.subject}\uFF08${commit.author}\uFF0C${whenText(nowMs, commit.authorDateMs)}\uFF09`);
    const repoPath = data.repoRoot.replace(/\\/g, "/");
    const identityLines = [
      `\u8DEF\u5F84\uFF1A${repoPath}`,
      `\u5F53\u524D\u5DE5\u4F5C\u6811\uFF1A${identity.worktreePath.replace(/\\/g, "/")}`,
      `\u5206\u652F\uFF1A${identity.branch ?? "\u6E38\u79BB HEAD\uFF0C\u4E0D\u5728\u4EFB\u4F55\u5206\u652F\u4E0A"}`,
      `\u4E0A\u6E38\uFF1A${upstream ?? "\u8FD9\u6761\u5206\u652F\u6CA1\u6709\u8BBE\u7F6E\u4E0A\u6E38"}`,
      `\u540C\u6B65\uFF1A\u8D85\u524D ${identity.ahead} \u7B14\u63D0\u4EA4\uFF0C\u843D\u540E ${identity.behind} \u7B14\u63D0\u4EA4`
    ];
    const changesLines = [
      `\u5DF2\u6682\u5B58\uFF1A${screen.stagedCount} \u4E2A\u6587\u4EF6`,
      ...stagedLines.length === 0 ? [] : [numbered(stagedLines)],
      `\u672A\u6682\u5B58\uFF1A${screen.unstagedCount} \u4E2A\u6587\u4EF6`,
      ...unstagedLines.length === 0 ? [] : [numbered(unstagedLines)],
      `\u51B2\u7A81\uFF1A${screen.conflictCount} \u4E2A\u6587\u4EF6`,
      ...conflictLines.length === 0 ? [] : [numbered(conflictLines)],
      `\u672A\u5B8C\u6210\u7684\u64CD\u4F5C\uFF1A${pendingOperationText(screen)}`
    ];
    const worktreeLines = otherWorktrees.length === 0 ? ["\u6CA1\u6709\u5176\u4ED6\u5DE5\u4F5C\u6811\u3002"] : [
      `\u5171 ${otherWorktrees.length} \u68F5\uFF0C\u5176\u4E2D ${abnormal.length} \u68F5\u9700\u8981\u5904\u7406\u3002`,
      ...abnormal.length === 0 ? [] : [numbered(abnormal.map((row) => {
        const reason = worktreeStateText(row);
        return `${row.display}\uFF1A${row.path}\uFF08${reason ?? ""}\uFF09`;
      }))]
    ];
    const branchLines = branches.length === 0 ? ["\u6CA1\u6709\u8BFB\u5230\u7684\u672C\u5730\u5206\u652F\u3002"] : [
      `\u672C\u5730 ${branches.length} \u6761\uFF0C\u5F53\u524D\u662F ${data.branch}\u3002`,
      numbered(branches.map((row) => {
        const parts = [];
        if (row.name === data.branch) parts.push("\u5F53\u524D\u5206\u652F");
        parts.push(row.upstream === null ? "\u6CA1\u6709\u4E0A\u6E38" : `\u4E0A\u6E38 ${row.upstream}`);
        if (row.ahead > 0) parts.push(`\u8D85\u524D ${row.ahead}`);
        if (row.behind > 0) parts.push(`\u843D\u540E ${row.behind}`);
        if (row.name !== data.branch) parts.push(row.mergedIntoCurrent ? "\u5DF2\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F" : "\u5C1A\u672A\u5408\u5E76\u8FDB\u5F53\u524D\u5206\u652F");
        return `${row.name}\uFF08${parts.join("\uFF0C")}\uFF09\uFF1A${row.subject}`;
      })),
      `\u5176\u4E2D\u5DF2\u5408\u5E76 ${mergedBranches.length} \u6761\uFF0C\u6CA1\u6709\u4E0A\u6E38 ${looseBranches.length} \u6761\u3002`
    ];
    const prompt = [
      "\u6211\u5728\u672C\u5730\u4ED3\u5E93\u7684\u7248\u672C\u7BA1\u7406\u9875\u4E0A\u9047\u5230\u4E86\u4E0B\u9762\u7684\u60C5\u51B5\uFF0C\u8BF7\u4F60\u5E2E\u6211\u5224\u65AD\u5E76\u7ED9\u51FA\u4E0B\u4E00\u6B65\u505A\u6CD5\u3002",
      "",
      "\u3010\u4ED3\u5E93\u4E0E\u5206\u652F\u3011",
      ...identityLines,
      "",
      "\u3010\u5DE5\u4F5C\u533A\u73B0\u72B6\u3011",
      ...changesLines,
      "",
      "\u3010\u5176\u4ED6\u5DE5\u4F5C\u6811\u3011",
      ...worktreeLines,
      "",
      "\u3010\u672C\u5730\u5206\u652F\u3011",
      ...branchLines,
      "",
      "\u3010\u6700\u8FD1\u63D0\u4EA4\u3011",
      recentCommits.length === 0 ? "  \u6CA1\u6709\u8BFB\u5230\u63D0\u4EA4\u3002" : numbered(recentCommits),
      "",
      "\u3010\u6211\u770B\u5230\u7684\u73B0\u8C61\u3011",
      `  \u754C\u9762\u505C\u5728\uFF1A${focus}`,
      "  \uFF08\u5728\u8FD9\u91CC\u8865\u4E00\u53E5\uFF1A\u4F60\u6253\u5F00\u9762\u677F\u65F6\u60F3\u505A\u4EC0\u4E48\uFF0C\u6216\u8005\u770B\u5230\u54EA\u91CC\u4E0D\u5BF9\u52B2\u3002\u8FD9\u4E00\u53E5\u4E0D\u5199\uFF0C\u6A21\u578B\u53EA\u80FD\u4ECE\u4E0A\u9762\u7684\u72B6\u6001\u91CC\u731C\u3002\uFF09",
      "",
      "\u3010\u6211\u60F3\u505A\u4EC0\u4E48\u3011",
      `  \uFF08\u7528\u4E00\u4E24\u53E5\u8BDD\u8BF4\u6E05\u4F60\u60F3\u5F97\u5230\u7684\u7ED3\u679C\u3002\u53EF\u4EE5\u7167\u8FD9\u4E2A\u65B9\u5411\u5199\uFF1A${GOALS[kind]}\uFF09`,
      "",
      "\u3010\u8BF7\u4F60\u3011",
      "  1. \u5148\u7528\u4E09\u4E94\u53E5\u8BDD\u590D\u8FF0\u4F60\u7406\u89E3\u7684\u72B6\u6001\uFF0C\u5E76\u6307\u51FA\u6211\u53EF\u80FD\u8BEF\u89E3\u7684\u5730\u65B9\u3002",
      "  2. \u518D\u6309\u6B65\u9AA4\u7ED9\u51FA\u505A\u6CD5\uFF0C\u6BCF\u4E00\u6B65\u5199\u6E05\u695A\u4F1A\u6539\u52A8\u4EC0\u4E48\u3001\u4E0D\u4F1A\u6539\u52A8\u4EC0\u4E48\u3001\u600E\u4E48\u9A8C\u8BC1\u6210\u529F\u3002",
      "  3. \u78B0\u5230\u4E22\u5F03\u6539\u52A8\u3001\u8986\u76D6\u5DF2\u63A8\u9001\u7684\u5386\u53F2\u3001\u5F3A\u5236\u63A8\u9001\u4E4B\u524D\uFF0C\u5148\u505C\u4E0B\u6765\u95EE\u6211\u786E\u8BA4\u3002",
      "",
      "\u3010\u8865\u5145\u3011",
      "  \uFF08\u5982\u679C\u8FD8\u6709\u522B\u7684\u80CC\u666F\u6216\u9650\u5236\uFF0C\u5199\u5728\u8FD9\u91CC\u3002\uFF09"
    ].join("\n");
    return { title: TITLES[kind], lede: LEDES[kind], prompt, charCount: prompt.length };
  }
  var HANDOFF_ENTRY = {
    general: "\u4E0D\u60F3\u4EB2\u81EA\u5904\u7406\uFF1F\u4EA4\u7ED9 AI",
    changes: "\u62FF\u4E0D\u51C6\u600E\u4E48\u62C6\u63D0\u4EA4\uFF1F\u4EA4\u7ED9 AI",
    worktrees: "\u4E0D\u60F3\u81EA\u5DF1\u6392\u67E5\uFF1F\u4EA4\u7ED9 AI",
    branches: "\u5206\u652F\u5173\u7CFB\u592A\u4E71\uFF1F\u4EA4\u7ED9 AI \u7406\u6E05"
  };

  // docs/prototype/vc-redesign/src/data/patches.ts
  var TS_SAMPLE = [
    { kind: "filehead", text: "diff --git a/src/client/views/shared/workRouteTable.ts b/src/client/views/shared/workRouteTable.ts" },
    { kind: "hunk", text: "@@ -18,7 +18,7 @@ export const workRouteTableOf = function (rows) {" },
    { kind: "context", text: "  const table = new Map()" },
    { kind: "context", text: "  for (const row of rows) {" },
    { kind: "del", text: "-    table.set(row.key, row.ticket)" },
    { kind: "add", text: "+    table.set(row.key, row.ticket ?? row.fallback)" },
    { kind: "context", text: "  }" },
    { kind: "context", text: "  return table" },
    { kind: "context", text: "}" }
  ];
  var TS_SAMPLE_TWO = [
    { kind: "filehead", text: "diff --git a/src/refresh/rooms/host/outbound-admission.ts b/src/refresh/rooms/host/outbound-admission.ts" },
    { kind: "hunk", text: "@@ -41,6 +41,10 @@ export const admitOutbound = function (request) {" },
    { kind: "context", text: "  if (!request.sessionId) return { ok: false, reason: 'no-session' }" },
    { kind: "add", text: "+  if (request.retryOf) {" },
    { kind: "add", text: "+    traces.push({ kind: 'retry', id: request.retryOf })" },
    { kind: "add", text: "+  }" },
    { kind: "context", text: "  const admitted = checkQuota(request)" },
    { kind: "del", text: "-  return admitted ? allow(request) : deny(request)" },
    { kind: "add", text: "+  return admitted ? allow(request) : deny(request, { retryable: true })" }
  ];
  var MARKDOWN_SAMPLE = [
    { kind: "filehead", text: "diff --git a/docs/review/sample.md b/docs/review/sample.md" },
    { kind: "hunk", text: "@@ -1,4 +1,6 @@" },
    { kind: "context", text: "# \u8BC4\u5BA1\u8BB0\u5F55" },
    { kind: "add", text: "+## \u7ED3\u8BBA" },
    { kind: "add", text: "+\u4E24\u5904\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4\u7684\u8FB9\u754C\u5DF2\u7ECF\u5217\u5728\u4E0B\u9762\u3002" },
    { kind: "context", text: "" },
    { kind: "context", text: "## \u8BC1\u636E" }
  ];
  var PNG_SAMPLE = [
    { kind: "filehead", text: "Binary files a/docs/design/md-env-check-chain.png and b/docs/design/md-env-check-chain.png differ" },
    { kind: "no-newline", text: "\u539F\u578B\u4E0D\u6E32\u67D3\u4E8C\u8FDB\u5236\u5DEE\u5F02\u3002" }
  ];
  function samplePatch(path) {
    if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".tsx")) {
      return path.includes("outbound-admission") ? TS_SAMPLE_TWO : TS_SAMPLE;
    }
    if (path.endsWith(".md")) return MARKDOWN_SAMPLE;
    if (path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".webp")) return PNG_SAMPLE;
    return null;
  }

  // docs/prototype/vc-redesign/src/domain/select.ts
  function judgeScreen(base, state) {
    const screen = base.screen;
    return {
      ...screen,
      stagedCount: state.staged.length,
      unstagedCount: state.unstaged.length,
      conflictCount: state.conflicts.length,
      identity: {
        ...screen.identity,
        ahead: state.ahead,
        behind: state.behind,
        basisMs: state.basisMs
      }
    };
  }
  function verdictOf(screen, op) {
    const decision = judge(screen, op);
    if (decision.verdict === "block") {
      return { disabled: true, warn: false, reason: COPY.block[decision.reasons[0]] ?? COPY.block["unknown-operation"] };
    }
    if (decision.verdict === "warn") {
      return { disabled: false, warn: true, reason: COPY.warn[decision.reasons[0]] ?? null };
    }
    return { disabled: false, warn: false, reason: null };
  }
  function actionOf(screen, op, label, state, override = {}) {
    const verdict = verdictOf(screen, op);
    const disabled = override.disabled === true || verdict.disabled || state.busy !== null || state.reloading;
    const busy = state.busy === op || op === "fetch" && state.reloading;
    return {
      id: op,
      label,
      disabled,
      reason: override.reason ?? verdict.reason,
      warn: verdict.warn,
      primary: override.primary === true && !disabled,
      busy
    };
  }
  function tabsOf(base, state) {
    const changes = state.staged.length + state.unstaged.length + state.conflicts.length;
    return [
      { id: "changes", label: COPY.views.changes, count: changes, unit: COPY.units.change },
      { id: "commits", label: COPY.views.commits, count: base.totalCommits, unit: COPY.units.commit },
      { id: "worktrees", label: COPY.views.worktrees, count: base.screen.otherWorktrees.filter((item) => !item.current).length + (state.demoWorktrees ? DEMO_WORKTREE_COUNT : 0), unit: COPY.units.worktree },
      { id: "stash", label: COPY.views.stash, count: state.stashes.length, unit: COPY.units.stash }
    ];
  }
  function nextStepOf(state) {
    if (state.conflicts.length > 0) return { text: "\u5148\u89E3\u51B3\u51B2\u7A81\u6587\u4EF6\uFF0C\u518D\u63D0\u4EA4", tone: "error" };
    if (state.behind > 0) return { text: "\u5148\u62C9\u53D6\u8FDC\u7AEF\u7684\u65B0\u63D0\u4EA4", tone: "warn" };
    if (state.staged.length > 0 && state.message.trim() === "") return { text: "\u5199\u4E00\u53E5\u63D0\u4EA4\u8BF4\u660E\uFF0C\u518D\u63D0\u4EA4", tone: "info" };
    if (state.staged.length > 0) return { text: "\u63D0\u4EA4\u5DF2\u6682\u5B58\u7684\u6587\u4EF6", tone: "ok" };
    if (state.unstaged.length > 0) return { text: "\u5148\u6682\u5B58\u8981\u63D0\u4EA4\u7684\u6587\u4EF6", tone: "muted" };
    if (state.ahead > 0) return { text: "\u63A8\u9001\u672C\u5730\u63D0\u4EA4\u5230\u8FDC\u7AEF", tone: "ok" };
    return { text: "\u5DE5\u4F5C\u533A\u4E0E\u8FDC\u7AEF\u90FD\u5DF2\u540C\u6B65", tone: "muted" };
  }
  function railOf(base, state, nowMs) {
    const identity = base.screen.identity;
    const currentBranch = state.branches.find((row) => row.current);
    const screen = judgeScreen(base, state);
    const sync = syncModel(identity.sync, state.ahead, state.behind);
    const syncChips = [];
    if (sync.kind === "counts") {
      syncChips.push({ kind: "ahead", label: COPY.rail.syncAhead, value: sync.ahead, muted: sync.ahead === 0 });
      syncChips.push({ kind: "behind", label: COPY.rail.syncBehind, value: sync.behind, muted: sync.behind === 0 });
    }
    const next = nextStepOf(state);
    const pullVerdict = verdictOf(screen, "pull");
    const pushAheadMissing = state.ahead === 0;
    const pull = actionOf(screen, "pull", COPY.actions.pull, state, {
      primary: state.behind > 0,
      busyLabel: COPY.busy.pull
    });
    const fetch = actionOf(screen, "fetch", COPY.actions.fetch, state, { busyLabel: COPY.busy.fetch });
    const push = actionOf(screen, "push", COPY.actions.push, state, {
      disabled: pushAheadMissing,
      reason: pushAheadMissing ? COPY.block["nothing-to-push"] : null,
      primary: !pushAheadMissing && state.behind === 0,
      busyLabel: COPY.busy.push
    });
    return {
      worktreeDisplay: identity.worktreeDisplay,
      worktreePath: identity.worktreePath,
      branch: currentBranch === void 0 ? identity.branch : currentBranch.name,
      detached: identity.detached,
      oidShort: identity.oid === null ? null : shortOid(identity.oid),
      sync,
      syncChips,
      readAtText: timeText(nowMs, state.readAtMs),
      basisText: state.basisMs === null ? COPY.rail.basisUnknown : timeText(nowMs, state.basisMs),
      next: next.text,
      nextTone: next.tone,
      pull: { ...pull, disabled: pullVerdict.disabled || pull.disabled },
      fetch,
      push,
      busy: state.busy,
      busyLabel: state.busy === null ? null : COPY.busy[state.busy],
      reloading: state.reloading,
      copiedPath: state.copiedPath
    };
  }
  function timeText(nowMs, ms) {
    const minutes = Math.max(0, Math.floor((nowMs - ms) / 6e4));
    if (minutes < 1) return "\u521A\u521A";
    if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
    const date = new Date(ms);
    return `${date.getMonth() + 1} \u6708 ${date.getDate()} \u65E5`;
  }
  function fileRowOf(base, state, path, options) {
    const meta = metadataOf(base, path);
    const change = meta?.change ?? "modified";
    const badge = changeBadge(change);
    const { dir, name } = splitPath(path);
    const isUntracked = change === "untracked";
    const expanded = state.openFile === path;
    const patch = expanded && !isUntracked && !options.conflict ? samplePatch(path) : null;
    let patchNote = null;
    if (expanded) {
      if (options.conflict) patchNote = "\u51B2\u7A81\u6587\u4EF6\u5728\u5408\u5E76\u5B8C\u6210\u524D\u6CA1\u6709\u5355\u4E00\u57FA\u7EBF\uFF0C\u539F\u578B\u4E0D\u5C55\u793A\u5DEE\u5F02\u3002";
      else if (isUntracked) patchNote = "\u672A\u8DDF\u8E2A\u6587\u4EF6\u8FD8\u6CA1\u6709\u57FA\u7EBF\u7248\u672C\uFF0C\u539F\u578B\u4E0D\u5C55\u793A\u5DEE\u5F02\u3002";
      else if (patch === null) patchNote = "\u8FD9\u4E2A\u6269\u5C55\u540D\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u793A\u4F8B\u8865\u4E01\u3002";
    }
    const extraBadges = [];
    if (options.conflict) extraBadges.push("\u51B2\u7A81");
    else if (options.staged) extraBadges.push(COPY.changes.stagedBadge);
    if (isUntracked) extraBadges.push(COPY.changes.untracked);
    const busy = state.busy !== null || state.reloading;
    return {
      path,
      dir,
      name,
      fullPath: path,
      badge,
      changeLabel: null,
      extraBadges,
      delta: isUntracked ? null : lineDelta(meta?.addedLines ?? null, meta?.deletedLines ?? null),
      conflict: options.conflict,
      staged: options.staged,
      expanded,
      patch,
      patchNote,
      canStage: !busy && !options.conflict && !options.staged,
      canUnstage: !busy && !options.conflict && options.staged,
      untracked: isUntracked,
      showMenu: !busy && !options.staged,
      canDiscard: !busy && !options.conflict && !options.staged && !isUntracked,
      canIgnore: !busy && !options.conflict && !options.staged && isUntracked,
      canDeleteUntracked: !busy && !options.conflict && !options.staged && isUntracked,
      resolvable: !busy && options.conflict
    };
  }
  function pendingOf(base, state) {
    const pending = state.changesPending;
    if (pending === null) return null;
    if (state.busy !== null || state.reloading) return null;
    if (pending.kind === "discard-all") {
      return {
        kind: pending.kind,
        path: null,
        title: COPY.changes.confirmDiscardAllTitle(state.unstaged.length),
        body: COPY.changes.confirmDiscardAllBody,
        meta: COPY.changes.confirmDiscardAllMeta(state.unstaged.length),
        confirmLabel: COPY.changes.confirmDiscard,
        danger: true
      };
    }
    const path = pending.path;
    if (path === null) return null;
    const meta = metadataOf(base, path);
    const name = splitPath(path).name;
    const lines = [];
    if (meta !== void 0) {
      if (meta.addedLines !== null && meta.addedLines > 0) lines.push(`\u65B0\u589E ${meta.addedLines} \u884C`);
      if (meta.deletedLines !== null && meta.deletedLines > 0) lines.push(`\u5220\u9664 ${meta.deletedLines} \u884C`);
    }
    const metaText = lines.length === 0 ? null : `\u8FD9\u6B21\u4F1A\u4E22\u6389 ${lines.join("\uFF0C")}`;
    switch (pending.kind) {
      case "discard":
        return { kind: pending.kind, path, title: COPY.changes.confirmDiscardTitle(name), body: COPY.changes.confirmDiscardBody, meta: metaText, confirmLabel: COPY.changes.confirmDiscard, danger: true };
      case "ignore":
        return { kind: pending.kind, path, title: COPY.changes.confirmIgnoreTitle(name), body: COPY.changes.confirmIgnoreBody, meta: null, confirmLabel: COPY.changes.confirmIgnore, danger: false };
      case "delete-untracked":
        return { kind: pending.kind, path, title: COPY.changes.confirmDeleteTitle(name), body: COPY.changes.confirmDeleteBody, meta: null, confirmLabel: COPY.changes.confirmDelete, danger: true };
      case "resolve-ours":
        return { kind: pending.kind, path, title: COPY.changes.confirmResolveOursTitle(name), body: COPY.changes.confirmResolveOursBody, meta: null, confirmLabel: COPY.changes.confirmResolve, danger: true };
      case "resolve-theirs":
        return { kind: pending.kind, path, title: COPY.changes.confirmResolveTheirsTitle(name), body: COPY.changes.confirmResolveTheirsBody, meta: null, confirmLabel: COPY.changes.confirmResolve, danger: true };
      default:
        return null;
    }
  }
  function changesOf(base, state) {
    const screen = judgeScreen(base, state);
    const busy = state.busy !== null || state.reloading;
    const stagedRows = state.staged.map((path) => fileRowOf(base, state, path, { staged: true, conflict: false }));
    const unstagedRows = state.unstaged.map((path) => fileRowOf(base, state, path, { staged: false, conflict: false }));
    const conflictRows = state.conflicts.map((path) => fileRowOf(base, state, path, { staged: false, conflict: true }));
    const groups = [];
    if (state.changesFilter === "all" || state.changesFilter === "conflict") {
      groups.push({
        id: "conflict",
        label: COPY.changes.groupConflict,
        emptyText: COPY.changes.groupEmptyConflict,
        rows: conflictRows
      });
    }
    if (state.changesFilter === "all" || state.changesFilter === "staged") {
      groups.push({
        id: "staged",
        label: COPY.changes.groupStaged,
        emptyText: COPY.changes.groupEmptyStaged,
        rows: stagedRows
      });
    }
    if (state.changesFilter === "all" || state.changesFilter === "unstaged") {
      groups.push({
        id: "unstaged",
        label: COPY.changes.groupUnstaged,
        emptyText: COPY.changes.groupEmptyUnstaged,
        rows: unstagedRows
      });
    }
    const keepEmptyGroup = state.changesFilter !== "all";
    const visibleGroups = groups.filter((group) => {
      if (keepEmptyGroup) return true;
      if (group.id === "staged") return true;
      return group.rows.length > 0;
    });
    const commitVerdict = verdictOf(screen, "commit");
    let disabledReason = commitVerdict.reason;
    if (state.staged.length === 0) disabledReason = COPY.changes.commitNoStaged;
    else if (state.conflicts.length > 0) disabledReason = COPY.block["conflicts-unresolved"];
    else if (state.message.trim() === "") disabledReason = COPY.changes.commitNoMessage;
    const changeCount = state.staged.length + state.unstaged.length;
    return {
      stats: [
        { id: "conflict", label: COPY.changes.filterConflict, count: state.conflicts.length, tone: "error" },
        { id: "staged", label: COPY.changes.filterStaged, count: state.staged.length, tone: "ok" },
        { id: "unstaged", label: COPY.changes.filterUnstaged, count: state.unstaged.length, tone: "mod" }
      ],
      filter: state.changesFilter,
      groups: visibleGroups,
      empty: state.staged.length === 0 && state.unstaged.length === 0 && state.conflicts.length === 0,
      stagedCount: state.staged.length,
      unstagedCount: state.unstaged.length,
      conflictCount: state.conflicts.length,
      busy,
      canStageAll: !busy && state.conflicts.length === 0 && state.unstaged.length > 0,
      canUnstageAll: !busy && state.staged.length > 0,
      canDiscardAll: !busy && state.conflicts.length === 0 && state.unstaged.length > 0,
      canStash: !busy && state.conflicts.length === 0 && changeCount > 0,
      stashReason: state.conflicts.length > 0 ? COPY.block["conflicts-unresolved"] : null,
      openMenuPath: state.openMenuPath,
      pending: pendingOf(base, state),
      ignoredNote: state.ignored.length === 0 ? null : COPY.changes.ignoredNote(state.ignored.length),
      composer: {
        stagedCount: state.staged.length,
        message: state.message,
        placeholder: COPY.changes.messagePlaceholder,
        hint: COPY.changes.messageHint,
        disabled: busy || disabledReason !== null,
        disabledReason,
        busy: state.busy === "commit"
      }
    };
  }
  function dayGroupLabel(nowMs, ms) {
    const date = new Date(ms);
    const now = new Date(nowMs);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    if (dayStart === startOfToday) return COPY.history.groupToday;
    if (dayStart === startOfToday - 24 * 60 * 60 * 1e3) return COPY.history.groupYesterday;
    return COPY.history.groupDate(date.getMonth() + 1, date.getDate());
  }
  function historyEntries(base, state) {
    const local = state.localCommits.map((commit) => ({
      oid: commit.oid,
      short: commit.short,
      subject: commit.subject,
      author: commit.author,
      authorDateMs: commit.authorDateMs,
      parents: commit.parents,
      files: commit.files,
      local: true
    }));
    const total = historyTotal(base, state);
    const keep = Math.max(0, total - local.length);
    const captured = base.screen.commits.filter((commit) => commit.oid !== state.undoneOid).slice(0, keep).map((commit) => ({
      oid: commit.oid,
      short: commit.short,
      subject: commit.subject,
      author: commit.author,
      authorDateMs: commit.authorDateMs,
      parents: commit.parents,
      files: base.commitFiles.get(commit.oid) ?? [],
      local: false
    }));
    return [...local, ...captured];
  }
  function historyTotal(base, state) {
    return Math.max(0, base.totalCommits - (state.undoneOid === null ? 0 : 1));
  }
  function matchesQuery(entry, query) {
    if (query === "") return true;
    const needle = query.trim().toLowerCase();
    if (needle === "") return true;
    return entry.subject.toLowerCase().includes(needle) || entry.author.toLowerCase().includes(needle) || entry.short.toLowerCase().includes(needle);
  }
  function historyOf(base, state, nowMs) {
    const entries = historyEntries(base, state);
    const filtered = entries.filter((entry) => matchesQuery(entry, state.historyQuery) && (!state.historyMergeOnly || entry.parents.length > 1));
    let previousGroup = "";
    const rows = filtered.map((entry) => {
      const group = dayGroupLabel(nowMs, entry.authorDateMs);
      const groupLabel = group === previousGroup ? null : group;
      previousGroup = group;
      return {
        oid: entry.oid,
        short: entry.short,
        subject: entry.subject,
        author: entry.author,
        when: timeText(nowMs, entry.authorDateMs),
        merge: entry.parents.length > 1,
        filesCount: entry.files.length,
        group: groupLabel,
        selected: state.historyOpenOid === entry.oid
      };
    });
    let detail = null;
    if (state.historyOpenOid !== null) {
      const entry = entries.find((item) => item.oid === state.historyOpenOid);
      if (entry !== void 0) {
        const merge = entry.parents.length > 1;
        const files = entry.files.map((file) => {
          const { dir, name } = splitPath(file.path);
          const patch = samplePatch(file.path);
          return {
            path: file.path,
            dir,
            name,
            // 和改动视图共用同一套行数差规则：0 不显示（见 data/format.ts 的 lineDelta 注释）。
            delta: lineDelta(file.added, file.deleted),
            expanded: state.historyOpenFile === file.path,
            patch,
            binary: patch !== null && patch.every((line) => line.kind === "filehead" || line.kind === "no-newline")
          };
        });
        detail = {
          oid: entry.oid,
          short: entry.short,
          subject: entry.subject,
          author: entry.author,
          when: timeText(nowMs, entry.authorDateMs),
          parents: entry.parents.map(shortOid),
          files,
          filesNote: entry.files.length === 0 ? merge ? COPY.history.filesEmptyMerge : COPY.history.filesEmpty : null,
          loading: false
        };
      }
    }
    return {
      detail,
      rows,
      loaded: rows.length,
      total: historyTotal(base, state),
      query: state.historyQuery,
      mergeOnly: state.historyMergeOnly,
      empty: rows.length === 0,
      scopeText: COPY.history.loadedCount(rows.length, historyTotal(base, state)),
      mergeOnlyText: COPY.history.mergeOnly
    };
  }
  var DEMO_WORKTREE_COUNT = 2;
  function demoWorktreesOf(repoRoot) {
    const base = repoRoot.replace(/[\\\\/]+$/, "");
    return [
      {
        path: base + "/.worktrees/1600-locked-demo",
        display: "1600-locked-demo",
        head: "9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293",
        branch: "ticket/1600-locked-demo",
        bare: false,
        current: false,
        locked: true,
        lockReason: "\u53E6\u4E00\u4E2A\u7EC8\u7AEF\u6B63\u5728\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8DD1\u957F\u6D4B\u8BD5\uFF0Cgit \u7528 admin \u9501\u6321\u4F4F\u4E86\u5360\u7528",
        lockUnknown: false,
        prunable: false,
        prunableUnknown: false
      },
      {
        path: base + "/.worktrees/1502-gone-demo",
        display: "1502-gone-demo",
        head: "4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6",
        branch: "fix/1502-gone-demo",
        bare: false,
        current: false,
        locked: false,
        lockReason: null,
        lockUnknown: false,
        prunable: true,
        prunableUnknown: false
      }
    ];
  }
  function stateChipsOf(worktree) {
    const states = [];
    if (worktree.locked) states.push({ label: COPY.worktrees.locked, tone: "warn", detail: worktree.lockReason });
    if (worktree.prunable) states.push({ label: COPY.worktrees.prunable, tone: "error", detail: null });
    else if (worktree.prunableUnknown) states.push({ label: COPY.worktrees.prunableUnknown, tone: "warn", detail: "\u8FD9\u4E2A git \u7248\u672C\u7B54\u4E0D\u51FA\u76EE\u5F55\u8FD8\u5728\u4E0D\u5728\u3002" });
    if (worktree.lockUnknown) states.push({ label: COPY.worktrees.lockUnknown, tone: "warn", detail: "\u8FD9\u4E2A git \u7248\u672C\u7B54\u4E0D\u51FA\u9501\u5B9A\u72B6\u6001\u3002" });
    if (worktree.bare) states.push({ label: COPY.worktrees.bare, tone: "info", detail: "\u88F8\u4ED3\u5E93\u6CA1\u6709\u5DE5\u4F5C\u533A\u3002" });
    if (worktree.branch === null && !worktree.bare) states.push({ label: COPY.worktrees.noBranch, tone: "muted", detail: null });
    const abnormal = states.some((state) => state.tone === "warn" || state.tone === "error");
    return { states, abnormal };
  }
  function worktreeRowOf(state, worktree) {
    const { dir, name } = splitPath(worktree.path);
    const chips = stateChipsOf(worktree);
    return {
      path: worktree.path,
      dir,
      name,
      branch: worktree.branch,
      detached: worktree.branch === null,
      oidShort: shortOid(worktree.head),
      states: chips.states,
      abnormal: chips.abnormal,
      copied: state.copiedPath === worktree.path,
      locked: worktree.locked,
      prunable: worktree.prunable
    };
  }
  function applyWorktreeActions(state, item) {
    const unlocked = state.unlockedWorktrees.includes(item.path);
    const pruned = state.prunedWorktrees.includes(item.path);
    if (!unlocked && !pruned) return item;
    return {
      ...item,
      locked: unlocked ? false : item.locked,
      lockReason: unlocked ? null : item.lockReason,
      prunable: pruned ? false : item.prunable
    };
  }
  function worktreesOf(base, state) {
    const identity = base.screen.identity;
    const current = identity.worktreePath === "" ? null : worktreeRowOf(state, {
      path: identity.worktreePath,
      display: identity.worktreeDisplay,
      head: identity.oid ?? "",
      branch: identity.branch,
      bare: false,
      current: true,
      locked: false,
      lockReason: null,
      lockUnknown: false,
      prunable: false,
      prunableUnknown: false
    });
    const demo = state.demoWorktrees ? demoWorktreesOf(identity.worktreePath) : [];
    const othersRaw = [...base.screen.otherWorktrees.filter((item) => !item.current), ...demo].filter((item) => !state.hiddenWorktrees.includes(item.path)).map((item) => applyWorktreeActions(state, item));
    const others = othersRaw.map((item) => worktreeRowOf(state, item)).sort((a, b) => Number(b.abnormal) - Number(a.abnormal));
    const abnormal = others.filter((row) => row.abnormal).length;
    return {
      current,
      others,
      othersCount: others.length,
      abnormalCount: abnormal,
      empty: others.length === 0,
      notice: `${COPY.worktrees.scope}${COPY.worktrees.boundary}`,
      aiLabel: COPY.worktrees.ai,
      aiEnabled: abnormal > 0,
      pending: state.worktreePending
    };
  }
  function branchRowOf(state, row, nowMs) {
    return {
      name: row.name,
      current: row.current,
      upstream: row.upstream,
      ahead: row.ahead,
      behind: row.behind,
      oidShort: row.oidShort,
      when: timeText(nowMs, row.lastCommitMs),
      subject: row.subject,
      merged: row.mergedIntoCurrent
    };
  }
  function branchesOf(base, state, nowMs) {
    const query = state.branchQuery.trim().toLowerCase();
    const rows = state.branches.filter((row) => query === "" || row.name.toLowerCase().includes(query)).map((row) => branchRowOf(state, row, nowMs));
    const current = state.branches.find((row) => row.current) ?? null;
    const selectedRaw = state.branchSelected === null ? null : state.branches.find((row) => row.name === state.branchSelected) ?? null;
    let selected = null;
    if (selectedRaw !== null) {
      const row = branchRowOf(state, selectedRaw, nowMs);
      const isCurrent = selectedRaw.current;
      selected = {
        row,
        canSwitch: !isCurrent,
        canMerge: !isCurrent,
        canDelete: !isCurrent,
        canRebase: !isCurrent,
        switchReason: isCurrent ? COPY.branches.switchCurrent : null,
        mergeReason: null,
        deleteReason: isCurrent ? COPY.branches.cannotDeleteCurrent : null,
        rebaseReason: isCurrent ? COPY.branches.rebaseCurrent : null,
        pending: state.branchPending
      };
    }
    return {
      rows,
      total: state.branches.length,
      currentName: current === null ? base.branch : current.name,
      selected,
      sub: state.branchSub,
      draft: state.branchDraft,
      query: state.branchQuery,
      pending: state.branchPending,
      empty: rows.length === 0,
      dirty: state.staged.length > 0 || state.unstaged.length > 0 || state.conflicts.length > 0
    };
  }
  function stashOf(state, nowMs) {
    const rows = state.stashes.map((entry) => ({
      id: entry.id,
      message: entry.message,
      when: timeText(nowMs, entry.whenMs),
      paths: entry.paths,
      filesCount: entry.paths.length
    }));
    const pending = state.stashPending === null ? null : {
      id: state.stashPending.id,
      title: COPY.stash.dropTitle(state.stashPending.id),
      body: COPY.stash.dropBody
    };
    return {
      rows,
      total: rows.length,
      empty: rows.length === 0,
      pending,
      busy: state.busy !== null
    };
  }
  function panelModelOf(base, state, nowMs) {
    const tabs = tabsOf(base, state);
    const confirm = state.confirmPull === null ? null : {
      title: COPY.rail.confirmTitle,
      body: COPY.rail.confirmBody,
      files: state.confirmPull.files,
      continueLabel: COPY.rail.confirmContinue,
      cancelLabel: COPY.rail.confirmCancel
    };
    return {
      rail: railOf(base, state, nowMs),
      tabs,
      changes: changesOf(base, state),
      history: historyOf(base, state, nowMs),
      worktrees: worktreesOf(base, state),
      branches: branchesOf(base, state, nowMs),
      stash: stashOf(state, nowMs),
      result: state.result,
      confirm,
      busy: state.busy,
      nowMs
    };
  }

  // docs/prototype/vc-redesign/src/ui/dom.ts
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props !== null) {
      if (props.class !== void 0) node.className = props.class;
      if (props.text !== void 0) node.textContent = props.text;
      if (props.title !== void 0) node.title = props.title;
      if (props.id !== void 0) node.id = props.id;
      if (props.role !== void 0) node.setAttribute("role", props.role);
      if (props.attrs !== void 0) {
        for (const [name, value] of Object.entries(props.attrs)) {
          if (value === null || value === void 0 || value === false) continue;
          node.setAttribute(name, value === true ? "" : String(value));
        }
      }
      if (props.dataset !== void 0) {
        for (const [name, value] of Object.entries(props.dataset)) {
          if (value === void 0) continue;
          node.dataset[name] = String(value);
        }
      }
      if (props.on !== void 0) {
        for (const [name, handler] of Object.entries(props.on)) {
          if (handler !== void 0) node.addEventListener(name, handler);
        }
      }
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }
  function clear(node) {
    while (node.firstChild !== null) node.removeChild(node.firstChild);
  }
  var ICON_PATHS = {
    chevron: "M6 9l6 6 6-6",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    copy: "M8 8h10v12H8zM6 16H4V4h12v2",
    check: "M4 12l5 5L20 6",
    alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
    back: "M20 12H5M11 6l-6 6 6 6",
    folder: "M3 6h7l2 3h9v10H3z",
    file: "M6 3h8l4 4v14H6zM14 3v4h4",
    commit: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 12h5M16 12h5",
    branch: "M6 3v18M6 9c0 4 6 4 6 8M12 9h4M16 7a2 2 0 1 0 0 .1M9 5a2 2 0 1 1 0 .1",
    // 四角星：AI 交接的入口记号；刻意不用机器人头像，避免读者以为这是另一个终端。
    spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
    close: "M6 6l12 12M18 6L6 18"
  };
  function icon(kind, size = 14) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[kind]);
    svg.append(path);
    return svg;
  }
  function spinner() {
    return h("span", { class: "spinner", attrs: { "aria-hidden": "true" } });
  }

  // docs/prototype/vc-redesign/src/ui/primitives.ts
  function button(options) {
    const busy = options.busy === true;
    const classes = ["btn", `btn-${options.kind ?? "secondary"}`, `btn-${options.size ?? "md"}`];
    if (options.disabled === true && !busy) classes.push("is-disabled");
    if (busy) classes.push("is-busy");
    const node = h("button", {
      class: classes.join(" "),
      attrs: {
        type: "button",
        disabled: options.disabled === true || busy,
        "aria-busy": busy ? "true" : null,
        "aria-describedby": options.describedBy ?? null,
        title: options.title ?? null,
        ...options.focusKey === void 0 ? {} : { "data-focus-key": options.focusKey }
      },
      dataset: {
        action: options.action,
        ...options.dataset ?? {}
      }
    });
    if (busy) node.append(spinner());
    if (options.icon !== void 0) node.append(icon(options.icon, 13));
    node.append(h("span", { class: "btn-label", text: busy ? options.busyLabel ?? options.label : options.label }));
    return node;
  }
  function chip(text, tone, options = {}) {
    const classes = ["chip", `chip-${tone}`];
    if (options.small === true) classes.push("chip-sm");
    if (options.mono === true) classes.push("mono");
    return h("span", { class: classes.join(" "), text, title: options.title });
  }
  function badgeLetter(letter, tone, title) {
    return h("span", { class: `badge badge-${tone}`, text: letter, title });
  }
  function resultBanner(result) {
    const sourceLabel = {
      sync: "\u540C\u6B65\u52A8\u4F5C",
      reload: "\u91CD\u65B0\u8BFB\u53D6",
      commit: "\u63D0\u4EA4",
      copy: "\u590D\u5236",
      ai: "AI \u4EA4\u63A5",
      branch: "\u5206\u652F\u52A8\u4F5C",
      worktree: "\u5DE5\u4F5C\u6811\u52A8\u4F5C",
      changes: "\u6539\u52A8\u52A8\u4F5C",
      history: "\u63D0\u4EA4\u52A8\u4F5C",
      stash: "\u8D2E\u85CF\u52A8\u4F5C"
    };
    return h(
      "div",
      {
        class: `result result-${result.tone}`,
        attrs: { role: "status", "aria-live": "polite" }
      },
      h("span", { class: "result-tag", text: sourceLabel[result.source] }),
      h("span", { class: "result-text", text: result.text }),
      result.detail === null ? null : h("span", { class: "result-detail", text: result.detail }),
      h(
        "button",
        {
          class: "result-close",
          attrs: { type: "button", "aria-label": "\u5173\u95ED\u8FD9\u6761\u7ED3\u679C" },
          dataset: { action: "result-dismiss" },
          on: {}
        },
        "\xD7"
      )
    );
  }
  function emptyState(title, hint, extra) {
    return h(
      "div",
      { class: "empty" },
      h("div", { class: "empty-title", text: title }),
      hint === null ? null : h("div", { class: "empty-hint", text: hint }),
      extra === void 0 ? null : extra
    );
  }
  var PATCH_CLASS = {
    add: "diff-add",
    del: "diff-del",
    context: "diff-ctx",
    hunk: "diff-hunk",
    filehead: "diff-head",
    "no-newline": "diff-note"
  };
  function patchBlock(lines) {
    const block = h("pre", { class: "patch", attrs: { "aria-label": "\u793A\u4F8B\u9010\u884C\u5DEE\u5F02" } });
    for (const line of lines) {
      block.append(h("code", { class: `diff-line ${PATCH_CLASS[line.kind]}`, text: line.text === "" ? " " : line.text }));
    }
    return block;
  }
  function note(text, tone = "muted") {
    return h("span", { class: `note note-${tone}`, text });
  }

  // docs/prototype/vc-redesign/src/ui/views/handoff.ts
  function renderHandoffSheet(model) {
    const { draft, copied } = model;
    const layer = h("div", { class: "handoff-layer is-pop" });
    layer.append(h("div", {
      class: "handoff-backdrop",
      attrs: { "aria-hidden": "true" },
      dataset: { action: "handoff-close" }
    }));
    const sheet = h("section", {
      class: "handoff-sheet is-pop",
      attrs: {
        role: "dialog",
        "aria-labelledby": "handoff-title",
        "aria-describedby": "handoff-lede"
      }
    });
    const head = h(
      "header",
      { class: "handoff-head" },
      h("p", { class: "handoff-kicker mono", text: COPY.ai.kicker }),
      h("h2", { class: "handoff-title", id: "handoff-title", text: draft.title }),
      h("button", {
        class: "icon-btn handoff-close",
        attrs: {
          type: "button",
          title: COPY.ai.closeTitle,
          "aria-label": COPY.ai.closeTitle,
          "data-focus-key": "handoff-close"
        },
        dataset: { action: "handoff-close" }
      }, icon("close", 14))
    );
    const prompt = h("pre", {
      class: "handoff-prompt",
      attrs: { tabindex: 0, "aria-label": "\u4EA4\u7ED9 AI \u7684\u8BF4\u660E\u5168\u6587" }
    });
    prompt.textContent = draft.prompt;
    const foot = h("footer", { class: "handoff-foot" });
    if (copied) foot.append(h("p", { class: "handoff-copied", attrs: { role: "status" } }, icon("check", 13), h("span", { text: COPY.ai.copied(draft.charCount) })));
    else foot.append(h("p", { class: "handoff-hint", text: COPY.ai.footNote }));
    foot.append(h(
      "div",
      { class: "handoff-actions" },
      button({ label: COPY.ai.closeLabel, kind: "ghost", size: "md", action: "handoff-close", focusKey: "handoff-close-2" }),
      button({
        label: COPY.ai.copyLabel,
        kind: "primary",
        size: "md",
        action: "handoff-copy",
        focusKey: "handoff-copy",
        title: COPY.ai.footNote
      })
    ));
    sheet.append(
      head,
      h("p", { class: "handoff-lede", id: "handoff-lede", text: draft.lede }),
      prompt,
      foot
    );
    layer.append(sheet);
    return layer;
  }
  function handoffEntry(label, kind, variant) {
    const node = h("button", {
      class: `ai-entry ai-entry-${variant}`,
      attrs: {
        type: "button",
        title: COPY.ai.entryAria(label),
        "aria-label": COPY.ai.entryAria(label),
        "data-focus-key": `handoff-${kind}`
      },
      dataset: { action: "handoff-open", kind }
    }, icon("spark", 14), h("span", { class: "ai-entry-label", text: label }));
    if (variant === "rail") node.append(h("span", { class: "ai-entry-sub", text: COPY.ai.railSub }));
    return node;
  }

  // docs/prototype/vc-redesign/src/ui/rail.ts
  function renderRail(model, result) {
    const rail = h("header", { class: "rail", attrs: { "aria-label": "\u4ED3\u5E93\u72B6\u6001" } });
    const idRow = h("div", { class: "rail-row rail-id" });
    idRow.append(h("span", { class: "rail-repo mono", text: model.worktreeDisplay, title: model.worktreePath }));
    if (model.branch === null) {
      idRow.append(chip(COPY.rail.detached, "warn", { small: true }));
    } else {
      idRow.append(
        h("span", { class: "rail-slash", text: "/", attrs: { "aria-hidden": "true" } }),
        h(
          "button",
          {
            class: "rail-branch-btn",
            attrs: {
              type: "button",
              title: COPY.rail.branchHint,
              "aria-label": `\u5F53\u524D\u5206\u652F ${model.branch}\u3002${COPY.rail.branchHint}`,
              "data-focus-key": "branch-open"
            },
            dataset: { action: "branch-open" }
          },
          h("span", { class: "rail-branch mono", text: model.branch }),
          h("span", { class: "rail-branch-chevron", attrs: { "aria-hidden": "true" } }, icon("chevron", 11))
        )
      );
    }
    if (model.oidShort !== null) {
      idRow.append(h("span", { class: "rail-oid mono", text: model.oidShort, title: "\u5F53\u524D\u63D0\u4EA4\u7684\u77ED\u53F7" }));
    }
    idRow.append(
      h("button", {
        class: "icon-btn",
        attrs: { type: "button", "aria-label": COPY.rail.copyRepoPath, title: COPY.rail.copyRepoPath, "data-focus-key": "copy-repo" },
        dataset: { action: "copy-repo" }
      }, icon("copy", 14))
    );
    const syncRow = h("div", { class: "rail-row rail-sync" });
    if (model.sync.kind === "counts") {
      for (const item of model.syncChips) {
        const tone = item.value === 0 ? " is-zero" : item.kind === "ahead" ? " is-ahead" : " is-behind";
        syncRow.append(
          h(
            "span",
            {
              class: `sync-count${tone}`,
              attrs: { title: COPY.rail.syncHint(item.label, item.value), "aria-label": COPY.rail.syncHint(item.label, item.value) }
            },
            h("span", { class: "sync-label", text: item.label }),
            h("span", { class: "sync-value", text: String(item.value) })
          )
        );
      }
    } else {
      syncRow.append(chip(model.sync.text, model.sync.tone === "warn" ? "warn" : "muted", { small: true }));
    }
    syncRow.append(
      h(
        "span",
        { class: "fact" },
        h("span", { class: "fact-k", text: "\u8BFB\u53D6\u4E8E" }),
        h("span", { class: "fact-v", text: model.readAtText, attrs: { title: COPY.rail.readHint } })
      ),
      h(
        "span",
        { class: "fact" },
        h("span", { class: "fact-k", text: "\u8FDC\u7AEF\u4F9D\u636E" }),
        h("span", { class: "fact-v", text: model.basisText, attrs: { title: COPY.rail.basisHint } })
      )
    );
    syncRow.append(
      h("button", {
        class: `icon-text-btn${model.reloading ? " is-busy" : ""}`,
        attrs: {
          type: "button",
          "data-focus-key": "reload",
          disabled: model.reloading || model.busy !== null,
          "aria-busy": model.reloading ? "true" : null,
          title: `${COPY.rail.reload}\uFF08${COPY.rail.readAt(model.readAtText)}\uFF09`
        },
        dataset: { action: "reload" }
      }, icon("refresh", 13), h("span", { text: model.reloading ? COPY.rail.reloadBusy : COPY.rail.reload }))
    );
    const actRow = h("div", { class: "rail-row rail-acts" });
    actRow.append(
      button({ label: model.pull.label, kind: "secondary", size: "sm", disabled: model.pull.disabled, busy: model.busy === "pull", busyLabel: COPY.busy.pull, title: model.pull.reason, action: "pull", focusKey: "pull" })
    );
    actRow.append(
      button({ label: model.fetch.label, kind: "ghost", size: "sm", disabled: model.fetch.disabled, busy: model.busy === "fetch" || model.reloading, busyLabel: COPY.busy.fetch, title: model.fetch.reason, action: "fetch", focusKey: "fetch" })
    );
    const pushButton = button({ label: model.push.label, kind: "secondary", size: "sm", disabled: model.push.disabled, busy: model.busy === "push", busyLabel: COPY.busy.push, title: model.push.reason, action: "push", focusKey: "push" });
    if (model.push.primary) pushButton.classList.add("is-suggested");
    actRow.append(pushButton);
    const nextChip = h(
      "span",
      { class: `next-step next-${model.nextTone}`, attrs: { title: COPY.rail.nextHint } },
      h("span", { class: "next-k", text: COPY.rail.next }),
      h("span", { class: "next-v", text: model.next })
    );
    actRow.append(nextChip);
    const pathRow = h(
      "div",
      { class: "rail-row rail-path" },
      h("span", { class: "rail-path-label", text: "\u5DE5\u4F5C\u6811\u8DEF\u5F84" }),
      h("span", { class: "rail-path-value mono", text: model.worktreePath })
    );
    const aiRow = h("div", { class: "rail-row rail-ai" }, handoffEntry(HANDOFF_ENTRY.general, "general", "rail"));
    const reasons = h("div", { class: "rail-reasons" });
    const rows = [
      [COPY.actions.pull, model.pull],
      [COPY.actions.push, model.push]
    ];
    for (const [label, action] of rows) {
      if (action.reason === null) continue;
      reasons.append(h(
        "div",
        { class: `reason${action.disabled ? " is-block" : " is-warn"}` },
        h("span", { class: "reason-k", text: label }),
        h("span", { class: "reason-v", text: action.reason })
      ));
    }
    rail.append(idRow, syncRow, actRow, reasons, pathRow, aiRow);
    if (result !== null) rail.append(resultBanner(result));
    return rail;
  }

  // docs/prototype/vc-redesign/src/ui/views/changes.ts
  function renderChanges(model, result) {
    const view = h("div", { class: "view view-changes" });
    const filterRow = h("div", { class: "filters", attrs: { role: "group", "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009" } });
    for (const stat of model.stats) {
      const active = model.filter === stat.id;
      filterRow.append(
        h(
          "button",
          {
            class: `filter-chip tone-${stat.tone}${active ? " is-on" : ""}${stat.count === 0 ? " is-zero" : ""}`,
            attrs: {
              type: "button",
              "aria-pressed": active ? "true" : "false",
              "data-focus-key": `filter-${stat.id}`,
              title: active ? "\u518D\u70B9\u4E00\u6B21\u663E\u793A\u5168\u90E8\u5206\u7EC4" : `\u53EA\u770B${stat.label}`
            },
            dataset: { action: "filter", filter: stat.id }
          },
          h("span", { class: "filter-label", text: stat.label }),
          h("span", { class: "filter-count", text: String(stat.count) })
        )
      );
    }
    const list = h("div", { class: "changes-scroll" });
    if (result !== null && result.source !== "commit") list.append(resultBanner(result));
    if (model.ignoredNote !== null) list.append(h("div", { class: "changes-note" }, note(model.ignoredNote, "muted")));
    if (model.empty) {
      list.append(emptyState(COPY.changes.emptyTitle, COPY.changes.emptyHint));
    } else {
      for (const group of model.groups) list.append(renderGroup(group, model));
    }
    const composer = h("div", { class: "composer" });
    if (result !== null && result.source === "commit") composer.append(resultBanner(result));
    const stashBtn = h("button", {
      class: `link-btn${model.canStash ? "" : " is-disabled"}`,
      attrs: {
        type: "button",
        "data-focus-key": "stash-create",
        title: model.canStash ? COPY.changes.stashHint : model.stashReason ?? COPY.changes.stashBlocked,
        disabled: !model.canStash
      },
      dataset: { action: "stash-create" }
    }, COPY.changes.stashAction);
    const stagedLine = h(
      "div",
      { class: "composer-head" },
      h(
        "span",
        { class: "composer-count" },
        h("span", { class: "count", text: String(model.composer.stagedCount) }),
        h("span", { class: "unit", text: "\u4E2A\u6587\u4EF6\u5DF2\u6682\u5B58" })
      ),
      h(
        "span",
        { class: "composer-links" },
        model.canUnstageAll ? h("button", {
          class: "link-btn",
          attrs: { type: "button", "data-focus-key": "unstage-all" },
          dataset: { action: "unstage-all" }
        }, COPY.actions.unstageAll) : null,
        stashBtn
      )
    );
    const textarea = h("textarea", {
      class: "commit-input",
      attrs: {
        id: "commit-message",
        rows: 2,
        placeholder: model.composer.placeholder,
        "data-field": "message",
        "data-focus-key": "commit-message",
        "aria-label": "\u63D0\u4EA4\u8BF4\u660E",
        "aria-describedby": "commit-hint"
      }
    });
    textarea.value = model.composer.message;
    const hint = h(
      "div",
      { class: "composer-hint", id: "commit-hint" },
      h("span", { class: "hint-text", text: model.composer.hint }),
      handoffEntry(HANDOFF_ENTRY.changes, "changes", "inline")
    );
    const commitButton = button({
      label: COPY.changes.commitLabel(model.composer.stagedCount),
      kind: "primary",
      size: "md",
      disabled: model.composer.disabled,
      busy: model.composer.busy,
      busyLabel: COPY.busy.commit,
      title: model.composer.disabledReason,
      action: "commit",
      focusKey: "commit"
    });
    const submitRow = h("div", { class: "composer-submit" }, commitButton);
    composer.append(stagedLine, textarea, hint);
    if (model.composer.disabledReason !== null) {
      composer.append(h(
        "div",
        { class: "composer-reason", id: "commit-reason" },
        icon("alert", 12),
        h("span", { text: model.composer.disabledReason })
      ));
    }
    composer.append(submitRow);
    view.append(filterRow, list, composer);
    return view;
  }
  function renderGroup(group, model) {
    const section = h("section", { class: `group group-${group.id}` });
    if (group.rows.length === 0) {
      section.append(h(
        "div",
        { class: "group-empty" },
        h("span", { class: "group-empty-text", text: group.emptyText })
      ));
      return section;
    }
    const head = h(
      "div",
      { class: "group-head" },
      h("span", { class: "group-title", text: group.label }),
      h("span", { class: "group-count", text: String(group.rows.length) })
    );
    if (group.id === "staged" && model.canUnstageAll) {
      head.append(h("button", {
        class: "group-action",
        attrs: { type: "button", "aria-label": COPY.actions.unstageAll },
        dataset: { action: "unstage-all" }
      }, COPY.actions.unstageAll));
    }
    if (group.id === "unstaged") {
      const blocked = model.conflictCount > 0;
      head.append(h("button", {
        class: `group-action${blocked ? " is-disabled" : ""}`,
        attrs: {
          type: "button",
          disabled: !model.canStageAll || blocked,
          title: blocked ? COPY.block["conflicts-unresolved"] : null,
          "aria-label": COPY.actions.stageAll
        },
        dataset: { action: "stage-all" }
      }, COPY.actions.stageAll));
      if (model.canDiscardAll) {
        head.append(h("button", {
          class: "group-action is-danger",
          attrs: { type: "button", "aria-label": COPY.changes.discardAll, title: "\u628A\u5168\u90E8\u672A\u6682\u5B58\u7684\u6539\u52A8\u4E22\u5F03\uFF08\u4E0D\u80FD\u64A4\u56DE\uFF09" },
          dataset: { action: "changes-pending", kind: "discard-all" }
        }, COPY.changes.discardAll));
      }
    }
    section.append(head);
    if (model.pending !== null && model.pending.kind === "discard-all") section.append(renderConfirmCard(model.pending));
    for (const row of group.rows) section.append(renderFileRow(row, model));
    return section;
  }
  function renderFileRow(row, model) {
    const pendingHere = model.pending !== null && model.pending.path === row.fullPath;
    const menuOpen = model.openMenuPath === row.fullPath;
    const rowNode = h("div", {
      class: `file-row${row.expanded ? " is-open" : ""}${row.conflict ? " is-conflict" : ""}${pendingHere ? " is-pending" : ""}`
    });
    const main = h("div", {
      class: "file-main",
      attrs: {
        role: "button",
        tabindex: 0,
        "aria-expanded": row.expanded ? "true" : "false",
        "aria-label": `${row.fullPath}\uFF1A${row.staged ? "\u5DF2\u6682\u5B58" : row.conflict ? "\u51B2\u7A81" : "\u672A\u6682\u5B58"}`,
        "data-focus-key": `row:${row.fullPath}`,
        title: row.fullPath
      },
      dataset: { action: "toggle-file", path: row.fullPath }
    });
    main.append(badgeLetter(row.badge.letter, row.badge.tone, row.conflict ? "\u51B2\u7A81\u6587\u4EF6" : "\u53D8\u66F4\u7C7B\u578B"));
    main.append(h(
      "span",
      { class: "file-path" },
      h("span", { class: "file-dir", text: row.dir }),
      h("span", { class: "file-name", text: row.name })
    ));
    if (row.extraBadges.length > 0) {
      const extras = h("span", { class: "file-extras" });
      for (const text of row.extraBadges) extras.append(chip(text, row.conflict ? "error" : text === COPY.changes.stagedBadge ? "ok" : "muted", { small: true }));
      main.append(extras);
    }
    if (row.delta !== null) {
      main.append(h(
        "span",
        { class: "file-delta" },
        row.delta.added === null ? null : h("span", { class: "dl-add", text: row.delta.added }),
        row.delta.deleted === null ? null : h("span", { class: "dl-del", text: row.delta.deleted })
      ));
    }
    main.append(h("span", { class: `row-chevron${row.expanded ? " is-open" : ""}`, attrs: { "aria-hidden": "true" } }, icon("chevron", 12)));
    const actions = h("span", { class: "file-actions" });
    if (row.canStage) {
      actions.append(h("button", {
        class: "row-act",
        attrs: { type: "button", title: `\u6682\u5B58 ${row.name}`, "data-focus-key": `stage:${row.fullPath}` },
        dataset: { action: "stage", path: row.fullPath }
      }, COPY.actions.stage));
    } else if (row.canUnstage) {
      actions.append(h("button", {
        class: "row-act",
        attrs: { type: "button", title: `\u64A4\u56DE ${row.name} \u7684\u6682\u5B58`, "data-focus-key": `unstage:${row.fullPath}` },
        dataset: { action: "unstage", path: row.fullPath }
      }, COPY.actions.unstage));
    }
    if (row.showMenu) {
      actions.append(h("button", {
        class: `row-act row-more${menuOpen ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "aria-haspopup": "true",
          "aria-expanded": menuOpen ? "true" : "false",
          "aria-label": COPY.changes.menuOpen,
          title: COPY.changes.menuOpen,
          "data-focus-key": `more:${row.fullPath}`
        },
        dataset: { action: "changes-open-menu", path: row.fullPath }
      }, h("span", { class: "row-more-dots", text: "\u22EF", attrs: { "aria-hidden": "true" } })));
    }
    rowNode.append(main, actions);
    const wrap = h("div", { class: "file-row-wrap" }, rowNode);
    if (menuOpen) wrap.append(renderRowMenu(row, model));
    if (pendingHere && model.pending !== null) wrap.append(renderConfirmCard(model.pending));
    if (row.expanded) {
      const body = h("div", { class: "file-detail" });
      if (row.patch !== null) body.append(patchBlock(row.patch), h("div", { class: "file-detail-note", text: COPY.changes.patchNote }));
      else if (row.patchNote !== null) body.append(note(row.patchNote));
      wrap.append(body);
    }
    return wrap;
  }
  function renderRowMenu(row, model) {
    const menu = h("div", { class: "row-menu", attrs: { role: "menu", "aria-label": `${row.name} \u7684\u66F4\u591A\u64CD\u4F5C` } });
    const item = (label, action, dataset, danger = false) => h("button", {
      class: `row-menu-item${danger ? " is-danger" : ""}`,
      attrs: { type: "button", role: "menuitem", "data-focus-key": `menu:${row.fullPath}:${action}:${dataset.kind ?? ""}` },
      dataset: { action, ...dataset }
    }, label);
    if (row.canDiscard) menu.append(item(COPY.changes.menuDiscard, "changes-pending", { kind: "discard", path: row.fullPath }, true));
    if (row.canIgnore) menu.append(item(COPY.changes.menuIgnore, "changes-pending", { kind: "ignore", path: row.fullPath }));
    if (row.canDeleteUntracked) menu.append(item(COPY.changes.menuDelete, "changes-pending", { kind: "delete-untracked", path: row.fullPath }, true));
    if (row.resolvable) {
      menu.append(item(COPY.changes.menuResolveOurs, "changes-pending", { kind: "resolve-ours", path: row.fullPath }, true));
      menu.append(item(COPY.changes.menuResolveTheirs, "changes-pending", { kind: "resolve-theirs", path: row.fullPath }, true));
    }
    if (menu.childElementCount === 0) menu.append(note("\u8FD9\u4E00\u884C\u6CA1\u6709\u53EF\u7528\u7684\u884C\u7EA7\u52A8\u4F5C\u3002"));
    menu.append(h("button", {
      class: "row-menu-item is-close",
      attrs: { type: "button", "aria-label": COPY.changes.menuClose },
      dataset: { action: "changes-open-menu", path: "" }
    }, COPY.changes.menuClose));
    void model;
    return menu;
  }
  function renderConfirmCard(pending) {
    const card = h(
      "div",
      { class: `changes-confirm${pending.danger ? " is-danger" : " is-warn"}`, attrs: { role: "group", "aria-label": pending.title } },
      h("h3", { class: "changes-confirm-title", text: pending.title }),
      h("p", { class: "changes-confirm-body", text: pending.body })
    );
    if (pending.meta !== null) card.append(h("p", { class: "changes-confirm-meta", text: pending.meta }));
    card.append(h(
      "div",
      { class: "changes-confirm-actions" },
      button({ label: COPY.changes.confirmCancel, kind: "ghost", size: "sm", action: "changes-pending-cancel", focusKey: "changes-cancel" }),
      button({
        label: pending.confirmLabel,
        kind: pending.danger ? "danger" : "secondary",
        size: "sm",
        action: "changes-apply",
        focusKey: "changes-confirm"
      })
    ));
    return card;
  }

  // docs/prototype/vc-redesign/src/ui/views/branches.ts
  function renderBranches(model, result) {
    const view = h("div", { class: "view view-branches" });
    view.append(renderHead(model));
    if (model.sub === "create" || model.sub === "rename") {
      view.append(renderForm(model));
    } else if (model.sub === "detail" && model.selected !== null) {
      view.append(renderDetail(model.selected, model));
    } else {
      view.append(renderList(model));
    }
    if (result !== null) view.append(resultBanner(result));
    return view;
  }
  function renderHead(model) {
    const head = h("div", { class: "branch-head" });
    head.append(h("button", {
      class: "icon-text-btn",
      attrs: { type: "button", "data-focus-key": "branch-back", title: COPY.branches.back },
      dataset: { action: model.sub === "list" ? "branch-close" : "branch-sub", sub: "list" }
    }, icon("back", 13), h("span", { text: model.sub === "list" ? COPY.branches.back : COPY.branches.backList })));
    const title = model.sub === "detail" && model.selected !== null ? model.selected.row.name : model.sub === "create" ? COPY.branches.createTitle : model.sub === "rename" && model.selected !== null ? COPY.branches.renameTitle : COPY.branches.listTitle;
    head.append(h("h2", { class: "branch-title", text: title }));
    if (model.sub === "list") {
      head.append(
        h("span", { class: "branch-count", text: `${model.total}` }),
        h("span", { class: "branch-count-unit", text: "\u4E2A" })
      );
      head.append(h("span", { class: "branch-spacer" }));
      head.append(button({
        label: COPY.branches.newBranch,
        kind: "secondary",
        size: "sm",
        action: "branch-sub",
        dataset: { sub: "create" },
        focusKey: "branch-new"
      }));
    }
    return head;
  }
  function renderList(model) {
    const wrap = h("div", { class: "branch-list-wrap" });
    const search = h("input", {
      class: "branch-search",
      attrs: {
        type: "search",
        value: model.query,
        placeholder: COPY.branches.searchPlaceholder,
        "aria-label": COPY.branches.searchPlaceholder,
        "data-focus-key": "branch-query"
      },
      dataset: { field: "branch-query" }
    });
    wrap.append(search);
    if (model.empty) {
      wrap.append(emptyState(COPY.branches.empty, null));
      return wrap;
    }
    const list = h("div", { class: "branch-scroll" });
    for (const row of model.rows) list.append(renderRow(model, row));
    wrap.append(list);
    wrap.append(h("div", { class: "branch-ai" }, handoffEntry(HANDOFF_ENTRY.branches, "branches", "inline")));
    return wrap;
  }
  function renderRow(model, row) {
    const sync = h("span", { class: "branch-sync" });
    if (row.ahead > 0) sync.append(h("span", { class: "branch-count-chip is-ahead", attrs: { title: COPY.branches.ahead(row.ahead) } }, COPY.branches.ahead(row.ahead)));
    if (row.behind > 0) sync.append(h("span", { class: "branch-count-chip is-behind", attrs: { title: COPY.branches.behind(row.behind) } }, COPY.branches.behind(row.behind)));
    return h(
      "button",
      {
        class: `branch-row${row.current ? " is-current" : ""}${model.selected?.row.name === row.name && model.sub === "detail" ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "data-focus-key": `branch:${row.name}`,
          title: row.current ? `${row.name}\uFF1A\u5F53\u524D\u5206\u652F` : `\u67E5\u770B\u5206\u652F ${row.name}`
        },
        dataset: { action: "branch-select", name: row.name }
      },
      h(
        "span",
        { class: "branch-row-main" },
        h(
          "span",
          { class: "branch-row-name" },
          h("span", { class: "mono", text: row.name }),
          row.current ? chip(COPY.branches.current, "ok", { small: true }) : null
        ),
        h(
          "span",
          { class: "branch-row-meta" },
          h("span", { class: "mono branch-upstream", text: row.upstream ?? COPY.branches.noUpstream }),
          h("span", { class: "branch-when", text: row.when })
        )
      ),
      h(
        "span",
        { class: "branch-row-side" },
        sync,
        h("span", { class: "branch-chevron" }, icon("chevron", 12))
      )
    );
  }
  function renderDetail(detail, model) {
    const row = detail.row;
    const wrap = h("div", { class: "branch-detail" });
    if (row.ahead > 0 || row.behind > 0) {
      const sync = h("div", { class: "branch-detail-sync" });
      if (row.ahead > 0) sync.append(chip(COPY.branches.ahead(row.ahead), "info", { small: true }));
      if (row.behind > 0) sync.append(chip(COPY.branches.behind(row.behind), "error", { small: true }));
      wrap.append(sync);
    }
    wrap.append(renderFacts(row));
    const actions = h("div", { class: "branch-actions" });
    actions.append(button({
      label: COPY.branches.switch,
      kind: "secondary",
      size: "sm",
      disabled: !detail.canSwitch,
      title: detail.switchReason,
      action: "branch-switch",
      dataset: { name: row.name },
      focusKey: "branch-switch"
    }));
    actions.append(button({
      label: COPY.branches.merge,
      kind: "secondary",
      size: "sm",
      disabled: !detail.canMerge,
      title: detail.mergeReason,
      action: "branch-merge",
      dataset: { name: row.name },
      focusKey: "branch-merge"
    }));
    actions.append(button({
      label: COPY.branches.rebase,
      kind: "secondary",
      size: "sm",
      disabled: !detail.canRebase,
      title: detail.rebaseReason,
      action: "branch-rebase-start",
      dataset: { name: row.name },
      focusKey: "branch-rebase"
    }));
    actions.append(button({
      label: COPY.branches.rename,
      kind: "ghost",
      size: "sm",
      action: "branch-sub",
      dataset: { sub: "rename" },
      focusKey: "branch-rename"
    }));
    const danger = button({
      label: COPY.branches.delete,
      kind: "danger",
      size: "sm",
      disabled: !detail.canDelete,
      title: detail.deleteReason,
      action: "branch-delete-start",
      dataset: { name: row.name },
      focusKey: "branch-delete"
    });
    actions.append(danger);
    wrap.append(actions);
    if (detail.pending !== null) wrap.append(renderConfirm(detail.pending, model.currentName));
    else wrap.append(h("p", { class: "branch-hint", text: COPY.branches.mergeHint }));
    if (model.dirty) {
      wrap.append(h("p", { class: "branch-hint is-warn", text: "\u5DE5\u4F5C\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8\uFF1A\u5207\u6362\u6216\u5408\u5E76\u4E4B\u524D\uFF0C\u5148\u60F3\u6E05\u695A\u8FD9\u4E9B\u6539\u52A8\u8981\u8DDF\u7740\u8D70\u8FD8\u662F\u8981\u7559\u5728\u539F\u5206\u652F\u3002" }));
    }
    return wrap;
  }
  function renderFacts(row) {
    const facts = h("dl", { class: "branch-facts" });
    const fact = (label, value, mono, title) => h(
      "div",
      { class: "branch-fact" },
      h("dt", { class: "branch-fact-k", text: label }),
      h("dd", { class: `branch-fact-v${mono ? " mono" : ""}`, text: value, attrs: title === void 0 ? {} : { title } })
    );
    facts.append(
      fact("\u4E0A\u6E38\u8DDF\u8E2A", row.upstream ?? COPY.branches.noUpstream, true),
      fact(COPY.branches.latestCommit, row.oidShort, true, row.subject),
      fact("\u63D0\u4EA4\u65F6\u95F4", row.when, false),
      fact("\u5408\u5E76\u72B6\u6001", row.merged ? COPY.branches.merged : COPY.branches.notMerged, false)
    );
    facts.append(h("p", { class: "branch-subject", text: row.subject }));
    return facts;
  }
  function renderConfirm(pending, currentName) {
    const isDelete = pending.kind === "delete";
    const isRebase = pending.kind === "rebase";
    const title = isDelete ? COPY.branches.deleteTitle(pending.name) : isRebase ? COPY.branches.rebaseTitle(currentName ?? "\u5F53\u524D\u5206\u652F", pending.name) : COPY.branches.switchDirtyTitle;
    const body = isDelete ? COPY.branches.deleteBody : isRebase ? COPY.branches.rebaseBody : COPY.branches.switchDirtyBody;
    const confirmLabel = isDelete ? COPY.branches.deleteConfirm : isRebase ? COPY.branches.rebaseConfirm : COPY.branches.switchConfirm;
    const confirmAction = isDelete ? "branch-delete-confirm" : isRebase ? "branch-rebase-confirm" : "branch-switch-confirm";
    return h(
      "div",
      { class: `branch-confirm${isDelete ? " is-danger" : " is-warn"}` },
      h("h3", { class: "branch-confirm-title", text: title }),
      h("p", { class: "branch-confirm-body", text: body }),
      h(
        "div",
        { class: "branch-confirm-actions" },
        button({
          label: COPY.branches.cancel,
          kind: "ghost",
          size: "sm",
          action: "branch-pending-cancel",
          focusKey: "branch-cancel"
        }),
        button({
          label: confirmLabel,
          kind: isDelete ? "danger" : "secondary",
          size: "sm",
          action: confirmAction,
          dataset: { name: pending.name },
          focusKey: "branch-confirm"
        })
      )
    );
  }
  function renderForm(model) {
    const isCreate = model.sub === "create";
    const wrap = h("div", { class: "branch-form" });
    wrap.append(h("p", { class: "branch-form-note", text: isCreate ? COPY.branches.createFrom(model.currentName ?? "") : model.selected?.row.name ?? "" }));
    wrap.append(h("label", { class: "branch-form-label", text: COPY.branches.branchLabel, attrs: { for: "branch-name-input" } }));
    const input = h("input", {
      class: "branch-input",
      attrs: {
        type: "text",
        id: "branch-name-input",
        value: model.draft,
        placeholder: isCreate ? COPY.branches.createPlaceholder : COPY.branches.renamePlaceholder,
        "aria-label": isCreate ? COPY.branches.createPlaceholder : COPY.branches.renamePlaceholder,
        "data-focus-key": "branch-draft"
      },
      dataset: { field: "branch-draft" }
    });
    wrap.append(input);
    wrap.append(h("p", { class: "branch-form-hint", text: COPY.branches.nameHint }));
    const actions = h("div", { class: "branch-form-actions" });
    actions.append(button({
      label: COPY.branches.cancel,
      kind: "ghost",
      size: "sm",
      action: "branch-sub",
      dataset: { sub: "list" },
      focusKey: "branch-cancel"
    }));
    actions.append(button({
      label: isCreate ? COPY.branches.create : COPY.branches.renameSubmit,
      kind: "primary",
      size: "sm",
      action: isCreate ? "branch-create" : "branch-rename-confirm",
      dataset: isCreate ? {} : { name: model.selected?.row.name ?? "" },
      focusKey: "branch-submit"
    }));
    wrap.append(actions);
    return wrap;
  }

  // docs/prototype/vc-redesign/src/ui/views/history.ts
  function renderHistory(model, options = {}) {
    if (model.detail !== null) return renderDetail2(model.detail, options);
    return renderList2(model, options);
  }
  function renderList2(model, options) {
    const view = h("div", { class: "view view-history" });
    const search = h("input", {
      class: "search-input",
      attrs: {
        type: "search",
        placeholder: COPY.history.searchPlaceholder(model.total),
        "aria-label": COPY.history.searchPlaceholder(model.total),
        autocomplete: "off",
        spellcheck: "false",
        "data-field": "history-query",
        "data-focus-key": "history-query"
      }
    });
    search.value = model.query;
    const mergeToggle = h("button", {
      class: `toggle-btn${model.mergeOnly ? " is-on" : ""}`,
      attrs: { type: "button", "aria-pressed": model.mergeOnly ? "true" : "false", "data-focus-key": "history-merge" },
      dataset: { action: "history-merge-only" }
    }, COPY.history.mergeOnly);
    const tools = h("div", { class: "history-tools" }, search, mergeToggle);
    const scope = h("div", { class: "history-scope", text: model.scopeText });
    const scroll = h("div", { class: "history-scroll" });
    if (options.result !== null && options.result !== void 0 && options.result.source === "history") {
      scroll.append(resultBanner(options.result));
    }
    if (model.empty) {
      scroll.append(emptyState(COPY.history.empty, null));
    } else {
      for (const row of model.rows) {
        if (row.group !== null) scroll.append(h("div", { class: "day-group", text: row.group }));
        scroll.append(renderCommitLine(row, model, options));
      }
    }
    view.append(tools, scope, scroll);
    return view;
  }
  function renderCommitLine(row, model, options) {
    const menuOpen = options.menuOid === row.oid;
    const line = h(
      "div",
      { class: "commit-line" },
      h(
        "div",
        {
          class: `commit-row${row.selected ? " is-selected" : ""}${menuOpen ? " is-menu" : ""}`,
          attrs: {
            role: "button",
            tabindex: 0,
            "aria-label": `${row.short} ${row.subject}`,
            "data-focus-key": `commit:${row.oid}`,
            title: row.subject
          },
          dataset: { action: "history-open", oid: row.oid }
        },
        h("span", { class: "commit-hash mono", text: row.short }),
        subjectNodeOf(row),
        h(
          "span",
          { class: "commit-meta" },
          h("span", { class: "commit-author", text: row.author }),
          h("span", { class: "commit-when", text: row.when }),
          row.filesCount > 0 ? h("span", { class: "commit-files", text: `${row.filesCount} \u4E2A\u6587\u4EF6` }) : null
        ),
        h("span", { class: "commit-chevron" }, icon("chevron", 12))
      ),
      h("button", {
        class: `commit-more${menuOpen ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "aria-haspopup": "true",
          "aria-expanded": menuOpen ? "true" : "false",
          "aria-label": COPY.history.menuOpen,
          title: COPY.history.menuOpen,
          "data-focus-key": `commit-more:${row.oid}`,
          disabled: options.busy === true
        },
        dataset: { action: "commit-menu", oid: row.oid }
      }, h("span", { text: "\u22EF", attrs: { "aria-hidden": "true" } }))
    );
    const wrap = h("div", { class: "commit-line-wrap" }, line);
    if (menuOpen) {
      const headOid = options.headOid ?? null;
      if (options.confirmOid === row.oid) {
        wrap.append(renderUndoConfirm(row, model));
      } else {
        wrap.append(renderCommitMenu(row, headOid));
      }
    }
    return wrap;
  }
  function renderCommitMenu(row, headOid) {
    const isHead = headOid !== null && headOid === row.oid;
    const menu = h("div", { class: "commit-menu", attrs: { role: "menu", "aria-label": `\u63D0\u4EA4 ${row.short} \u7684\u66F4\u591A\u64CD\u4F5C` } });
    const item = (label, action, dataset, options = {}) => h("button", {
      class: `row-menu-item${options.danger === true ? " is-danger" : ""}`,
      attrs: { type: "button", role: "menuitem", disabled: options.disabled === true, title: options.title ?? null, "aria-label": label },
      dataset: { action, ...dataset }
    }, label);
    menu.append(item(COPY.history.menuRevert, "commit-revert", { oid: row.oid }));
    if (!row.merge) menu.append(item(COPY.history.menuCherryPick, "commit-cherry-pick", { oid: row.oid }));
    else menu.append(item(COPY.history.menuCherryPick, "commit-cherry-pick", { oid: row.oid }, { disabled: true, title: "\u5408\u5E76\u63D0\u4EA4\u6709\u4E24\u4E2A\u7236\u63D0\u4EA4\uFF0C\u62E3\u9009\u65F6 git \u4E0D\u77E5\u9053\u8981\u5E26\u54EA\u4E00\u8FB9\u3002" }));
    menu.append(item(
      COPY.history.menuUndo,
      "commit-undo-start",
      { oid: row.oid },
      { disabled: !isHead, title: isHead ? COPY.history.undoBody : COPY.history.menuUndoHint, danger: true }
    ));
    menu.append(item(COPY.history.menuCopy, "copy-oid", { oid: row.oid }));
    menu.append(h("button", {
      class: "row-menu-item is-close",
      attrs: { type: "button", "aria-label": COPY.history.menuClose },
      dataset: { action: "commit-menu", oid: row.oid }
    }, COPY.history.menuClose));
    return menu;
  }
  function renderUndoConfirm(row, model) {
    void model;
    return h(
      "div",
      { class: "commit-confirm", attrs: { role: "group", "aria-label": COPY.history.undoTitle(row.subject) } },
      h("h3", { class: "commit-confirm-title", text: COPY.history.undoTitle(row.subject) }),
      h("p", { class: "commit-confirm-body", text: COPY.history.undoBody }),
      h("p", { class: "commit-confirm-note", text: COPY.history.undoNote }),
      h(
        "div",
        { class: "commit-confirm-actions" },
        button({ label: COPY.history.cancel, kind: "ghost", size: "sm", action: "commit-menu-close", focusKey: "commit-cancel" }),
        button({
          label: COPY.history.undoConfirm,
          kind: "danger",
          size: "sm",
          action: "commit-undo",
          dataset: { oid: row.oid },
          focusKey: "commit-undo-confirm"
        })
      )
    );
  }
  function subjectNodeOf(row) {
    if (!row.merge) return h("span", { class: "commit-subject", text: row.subject });
    return h(
      "span",
      { class: "commit-subject commit-subject-merge" },
      h("span", { class: "commit-merge-lead", text: COPY.history.mergeChip }),
      h("span", { class: "commit-merge-raw mono", text: row.subject })
    );
  }
  function renderDetail2(detail, options) {
    const view = h("div", { class: "view view-detail" });
    const head = h(
      "div",
      { class: "detail-head" },
      h("button", {
        class: "back-btn",
        attrs: { type: "button", "data-focus-key": "history-back" },
        dataset: { action: "history-back" }
      }, icon("back", 13), h("span", { text: COPY.actions.back }))
    );
    view.append(head);
    const scroll = h("div", { class: "detail-scroll" });
    if (detail.parents.length > 1) {
      scroll.append(
        h("h2", { class: "detail-subject", text: `${COPY.history.mergeChip}\u63D0\u4EA4` }),
        h("div", { class: "detail-subject-raw mono", text: detail.subject })
      );
    } else {
      scroll.append(h("h2", { class: "detail-subject", text: detail.subject }));
    }
    const meta = h("dl", { class: "detail-meta" });
    const row = (label, value) => h(
      "div",
      { class: "meta-row" },
      h("dt", { class: "meta-k", text: label }),
      h("dd", { class: "meta-v" }, value)
    );
    meta.append(
      row(COPY.history.hash, h("span", { class: "mono", text: detail.short, title: detail.oid })),
      row(COPY.history.author, detail.author),
      row(COPY.history.time, detail.when)
    );
    const parents = h("span", { class: "parents" });
    detail.parents.forEach((parent) => {
      parents.append(h("span", { class: "parent-hash mono", text: parent, attrs: { title: `\u7236\u63D0\u4EA4 ${parent}` } }));
    });
    meta.append(row(COPY.history.parents, parents));
    scroll.append(meta);
    const files = h("div", { class: "detail-files" });
    files.append(h("div", { class: "detail-files-head" }, COPY.history.changedFiles(detail.files.length)));
    if (detail.filesNote !== null) files.append(note(detail.filesNote, "muted"));
    for (const file of detail.files) {
      const fileNode = h("div", {
        class: `file-row commit-file${file.expanded ? " is-open" : ""}`,
        attrs: {
          role: "button",
          tabindex: 0,
          "aria-expanded": file.expanded ? "true" : "false",
          "aria-label": file.path,
          "data-focus-key": `history-file:${file.path}`,
          title: file.path
        },
        dataset: { action: "history-file", path: file.path }
      });
      fileNode.append(h(
        "span",
        { class: "file-path" },
        h("span", { class: "file-dir", text: file.dir }),
        h("span", { class: "file-name", text: file.name })
      ));
      fileNode.append(h(
        "span",
        { class: "file-delta" },
        file.delta.added === null ? null : h("span", { class: "dl-add", text: file.delta.added }),
        file.delta.deleted === null ? null : h("span", { class: "dl-del", text: file.delta.deleted })
      ));
      fileNode.append(h("span", { class: `row-chevron${file.expanded ? " is-open" : ""}` }, icon("chevron", 12)));
      files.append(fileNode);
      if (file.expanded) {
        const body = h("div", { class: "file-detail" });
        if (file.patch !== null) {
          body.append(patchBlock(file.patch));
          body.append(h("div", { class: "file-detail-note", text: file.binary ? "\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u539F\u578B\u4E0D\u6E32\u67D3\u5DEE\u5F02\u3002" : COPY.history.diffSampleNote }));
        } else {
          body.append(note("\u8FD9\u4E2A\u6269\u5C55\u540D\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u793A\u4F8B\u8865\u4E01\u3002"));
        }
        files.append(body);
      }
    }
    scroll.append(files);
    if (options.result !== null && options.result !== void 0 && options.result.source === "history") {
      scroll.append(resultBanner(options.result));
    }
    view.append(scroll);
    return view;
  }

  // docs/prototype/vc-redesign/src/ui/views/stash.ts
  function renderStash(model, result) {
    const view = h("div", { class: "view view-stash" });
    const head = h(
      "div",
      { class: "stash-head" },
      h(
        "div",
        { class: "stash-head-text" },
        h("h2", { class: "stash-title", text: COPY.stash.title }),
        h("p", { class: "stash-count", text: COPY.changes.stashHint })
      )
    );
    view.append(head);
    view.append(note(COPY.stash.boundary, "muted"));
    const scroll = h("div", { class: "stash-scroll" });
    if (result !== null) scroll.append(resultBanner(result));
    if (model.empty) {
      scroll.append(emptyState(COPY.stash.empty, COPY.stash.emptyHint));
    } else {
      for (const row of model.rows) scroll.append(renderStashRow(row, model));
    }
    view.append(scroll);
    return view;
  }
  function renderStashRow(row, model) {
    const wrap = h("div", { class: "stash-row-wrap" });
    const line = h("div", { class: "stash-row" });
    const main = h(
      "div",
      { class: "stash-main" },
      h(
        "div",
        { class: "stash-id-line" },
        h("span", { class: "stash-id mono", text: row.id }),
        h("span", { class: "stash-message", text: row.message, title: row.message })
      ),
      h("div", { class: "stash-meta", text: COPY.stash.entryMeta(row.when, row.filesCount) })
    );
    line.append(main);
    const actions = h("div", { class: "stash-actions" });
    actions.append(button({
      label: COPY.stash.apply,
      kind: "secondary",
      size: "sm",
      action: "stash-apply",
      dataset: { id: row.id },
      focusKey: `stash-apply:${row.id}`,
      title: COPY.stash.applyHint,
      disabled: model.busy
    }));
    actions.append(button({
      label: COPY.stash.pop,
      kind: "secondary",
      size: "sm",
      action: "stash-pop",
      dataset: { id: row.id },
      focusKey: `stash-pop:${row.id}`,
      title: COPY.stash.popHint,
      disabled: model.busy
    }));
    actions.append(button({
      label: COPY.stash.drop,
      kind: "ghost",
      size: "sm",
      action: "stash-pending",
      dataset: { kind: "drop", id: row.id },
      focusKey: `stash-drop:${row.id}`,
      title: COPY.stash.dropTitle(row.id),
      disabled: model.busy
    }));
    line.append(actions);
    wrap.append(line);
    const paths = h("div", { class: "stash-paths" });
    paths.append(h("p", { class: "stash-paths-note", text: COPY.stash.pathsNote }));
    const list = h("ul", { class: "stash-path-list" });
    for (const path of row.paths) list.append(h("li", { class: "stash-path mono", text: path, attrs: { title: path } }));
    paths.append(list);
    wrap.append(paths);
    if (model.pending !== null && model.pending.id === row.id) {
      wrap.append(h(
        "div",
        { class: "stash-confirm", attrs: { role: "group", "aria-label": model.pending.title } },
        h("p", { class: "stash-confirm-title", text: model.pending.title }),
        h("p", { class: "stash-confirm-body", text: model.pending.body }),
        h(
          "div",
          { class: "stash-confirm-actions" },
          button({ label: COPY.stash.cancel, kind: "ghost", size: "sm", action: "stash-pending-cancel", focusKey: "stash-cancel" }),
          button({
            label: COPY.stash.dropConfirm,
            kind: "danger",
            size: "sm",
            action: "stash-drop",
            dataset: { id: row.id },
            focusKey: `stash-drop-confirm:${row.id}`
          })
        )
      ));
    }
    return wrap;
  }

  // docs/prototype/vc-redesign/src/ui/views/worktrees.ts
  function renderWorktrees(model, result, options) {
    const view = h("div", { class: "view view-worktrees" });
    if (options.noticeOpen) view.append(renderNotice(model));
    view.append(renderCurrent(model.current));
    view.append(renderHead2(model, options, options.noticeOpen));
    const rows = options.filter === "abnormal" ? model.others.filter((row) => row.abnormal) : model.others;
    const list = h("div", { class: "wt-list" });
    if (model.empty) {
      list.append(emptyState(COPY.worktrees.empty, COPY.worktrees.emptyHint));
    } else if (rows.length === 0) {
      list.append(emptyState(COPY.worktrees.filterEmpty, null));
    } else {
      for (const row of rows) list.append(renderRow2(row, options.expandedPath === row.path, model.pending));
    }
    view.append(list);
    view.append(h(
      "div",
      { class: "wt-foot" },
      handoffEntry(model.abnormalCount > 0 ? HANDOFF_ENTRY.worktrees : COPY.ai.cleanEntry, "worktrees", "inline")
    ));
    if (result !== null) view.append(resultBanner(result));
    return view;
  }
  function renderNotice(model) {
    return h(
      "aside",
      { class: "wt-notice", attrs: { role: "note" } },
      h("span", { class: "wt-notice-text", text: model.notice }),
      h("button", {
        class: "wt-notice-close",
        attrs: { type: "button", "aria-label": COPY.worktrees.noticeClose, title: COPY.worktrees.noticeClose },
        dataset: { action: "wt-note-close" }
      }, "\xD7")
    );
  }
  function renderCurrent(row) {
    if (row === null) return h("div", {});
    const head = h(
      "div",
      { class: "wt-current-head" },
      chip(COPY.worktrees.current, "ok", { small: true }),
      h("span", { class: "wt-name mono", text: row.name, title: row.path }),
      row.branch === null ? chip(COPY.worktrees.noBranch, "muted", { small: true }) : h("span", { class: "wt-branch", attrs: { title: `\u5206\u652F ${row.branch}` } }, h("span", { class: "mono", text: row.branch })),
      h("button", {
        class: "icon-btn wt-current-copy",
        attrs: {
          type: "button",
          title: COPY.worktrees.copyPath,
          "aria-label": `\u590D\u5236\u5F53\u524D\u5DE5\u4F5C\u6811\u8DEF\u5F84\uFF1A${row.path}`,
          "data-focus-key": `wt-copy:${row.path}`
        },
        dataset: { action: "worktree-copy", path: row.path }
      }, icon("copy", 14))
    );
    return h(
      "section",
      { class: "wt-current" },
      head,
      h("div", { class: "wt-current-path mono", text: row.path, title: row.path })
    );
  }
  function renderHead2(model, options, noticeOpen) {
    const head = h(
      "div",
      { class: "wt-head" },
      h("span", { class: "wt-head-title", text: "\u5176\u4ED6\u5DE5\u4F5C\u6811" }),
      h("span", { class: "wt-head-count", text: String(model.othersCount) }),
      h("span", { class: "wt-head-unit", text: COPY.units.worktree }),
      model.abnormalCount > 0 ? h("span", { class: "wt-head-alert", text: `\u5176\u4E2D ${model.abnormalCount} \u68F5\u9700\u8981\u5904\u7406` }) : null
    );
    const filters = h("div", { class: "wt-filters", attrs: { role: "group", "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009\u5DE5\u4F5C\u6811" } });
    filters.append(filterChip(COPY.worktrees.filterAll, String(model.othersCount), options.filter === "all", "all"));
    if (model.abnormalCount > 0) {
      filters.append(filterChip(COPY.worktrees.filterAbnormal, String(model.abnormalCount), options.filter === "abnormal", "abnormal"));
    }
    head.append(filters);
    if (!noticeOpen) {
      head.append(h("button", {
        class: "icon-btn wt-notice-open",
        attrs: {
          type: "button",
          title: COPY.worktrees.noticeOpen,
          "aria-label": COPY.worktrees.noticeOpen,
          "data-focus-key": "wt-note-open"
        },
        dataset: { action: "wt-note-open" }
      }, "?"));
    }
    return head;
  }
  function filterChip(label, count, on, filter) {
    return h(
      "button",
      {
        class: `filter-chip${filter === "abnormal" ? " tone-error" : " tone-ok"}${on ? " is-on" : ""}`,
        attrs: {
          type: "button",
          "aria-pressed": on ? "true" : "false",
          "data-focus-key": `wt-filter-${filter}`
        },
        dataset: { action: "wt-filter", filter }
      },
      h("span", { class: "filter-label", text: label }),
      h("span", { class: "filter-count", text: count })
    );
  }
  function renderRow2(row, expanded, pending) {
    const rowNode = h("div", {
      class: `wt-row${row.abnormal ? " is-abnormal" : ""}${expanded ? " is-open" : ""}`
    });
    const nameRow = h(
      "div",
      { class: "wt-name-row" },
      h("span", { class: "wt-name mono", text: row.name, title: row.path }),
      row.branch === null ? chip(COPY.worktrees.noBranch, "muted", { small: true }) : h("span", { class: "wt-branch", attrs: { title: `\u5206\u652F ${row.branch}` } }, h("span", { class: "mono", text: row.branch })),
      h("span", { class: "wt-oid mono", text: row.oidShort, title: "\u8FD9\u4E2A\u5DE5\u4F5C\u6811\u5F53\u524D\u6307\u5411\u7684\u63D0\u4EA4\u77ED\u53F7" })
    );
    const pathRow = h(
      "div",
      { class: "wt-path" },
      h("span", { class: "wt-path-dir mono", text: row.dir }),
      h("span", { class: "wt-path-name mono", text: row.name })
    );
    const stateRow = h("div", { class: "wt-states" });
    for (const state of row.states) stateRow.append(chip(state.label, state.tone, { small: true, title: state.detail ?? void 0 }));
    const actions = h(
      "div",
      { class: "wt-actions" },
      h("button", {
        class: "icon-btn",
        attrs: {
          type: "button",
          title: COPY.worktrees.copyPath,
          "aria-label": `${COPY.worktrees.copyPath}\uFF1A${row.path}`,
          "data-focus-key": `wt-copy:${row.path}`
        },
        dataset: { action: "worktree-copy", path: row.path }
      }, icon("copy", 14)),
      h("button", {
        class: `icon-btn wt-expander${expanded ? " is-open" : ""}`,
        attrs: {
          type: "button",
          "aria-expanded": expanded ? "true" : "false",
          "aria-label": expanded ? COPY.worktrees.collapse : COPY.worktrees.expand,
          title: expanded ? COPY.worktrees.collapse : COPY.worktrees.expand,
          "data-focus-key": `wt-expand:${row.path}`
        },
        dataset: { action: "wt-expand", path: row.path }
      }, icon("chevron", 12))
    );
    rowNode.append(h("div", { class: "wt-main" }, nameRow, pathRow, stateRow), actions);
    const wrap = h("div", { class: "wt-row-wrap" }, rowNode);
    if (expanded) wrap.append(renderDetail3(row, pending));
    return wrap;
  }
  function renderDetail3(row, pending) {
    const detail = h("div", { class: `wt-detail${row.abnormal ? " is-abnormal" : ""}` });
    const fact = (label, value, mono) => h(
      "div",
      { class: "wt-fact" },
      h("span", { class: "wt-fact-k", text: label }),
      h("span", { class: `wt-fact-v${mono ? " mono" : ""}`, text: value, title: value })
    );
    detail.append(
      fact(COPY.worktrees.detailPath, row.path, true),
      fact(COPY.worktrees.detailBranch, row.branch ?? COPY.worktrees.noBranch, false),
      fact(COPY.worktrees.detailHead, row.oidShort, true)
    );
    const awaiting = pending !== null && pending.path === row.path;
    if (!awaiting) {
      for (const state of row.states) {
        if (state.detail === null) continue;
        detail.append(fact(state.label, state.detail, false));
      }
    }
    if (!awaiting) {
      const actions = h("div", { class: "wt-actions-row" });
      if (row.locked) {
        actions.append(button({
          label: COPY.worktrees.unlock,
          kind: "secondary",
          size: "sm",
          action: "wt-pending",
          dataset: { kind: "unlock", path: row.path, name: row.name },
          focusKey: `wt-unlock:${row.path}`
        }));
      }
      if (row.prunable) {
        actions.append(button({
          label: COPY.worktrees.pruneRecord,
          kind: "secondary",
          size: "sm",
          action: "wt-pending",
          dataset: { kind: "prune", path: row.path, name: row.name },
          focusKey: `wt-prune:${row.path}`
        }));
      }
      actions.append(button({
        label: COPY.worktrees.remove,
        kind: "danger",
        size: "sm",
        action: "wt-pending",
        dataset: { kind: "remove", path: row.path, name: row.name },
        focusKey: `wt-remove:${row.path}`
      }));
      detail.append(actions, h("p", { class: "wt-action-note", text: COPY.worktrees.actionsHint }));
    }
    if (pending !== null && pending.path === row.path) {
      detail.append(h(
        "div",
        { class: `wt-confirm${pending.kind === "remove" ? " is-danger" : " is-warn"}` },
        h("h4", { class: "wt-confirm-title", text: pendingTitle(pending) }),
        h("p", { class: "wt-confirm-body", text: pendingBody(pending) }),
        h(
          "div",
          { class: "wt-confirm-actions" },
          button({
            label: COPY.worktrees.cancel,
            kind: "ghost",
            size: "sm",
            action: "wt-pending-cancel",
            focusKey: "wt-cancel"
          }),
          button({
            label: pending.kind === "unlock" ? COPY.worktrees.unlockConfirm : pending.kind === "prune" ? COPY.worktrees.pruneConfirm : COPY.worktrees.removeConfirm,
            kind: pending.kind === "remove" ? "danger" : "secondary",
            size: "sm",
            action: "wt-apply",
            dataset: { kind: pending.kind, path: pending.path, name: pending.name },
            focusKey: "wt-confirm"
          })
        )
      ));
    }
    return detail;
  }
  function pendingTitle(pending) {
    if (pending.kind === "unlock") return COPY.worktrees.unlockTitle;
    if (pending.kind === "prune") return COPY.worktrees.pruneTitle;
    return COPY.worktrees.removeTitle(pending.name);
  }
  function pendingBody(pending) {
    if (pending.kind === "unlock") return COPY.worktrees.unlockBody;
    if (pending.kind === "prune") return COPY.worktrees.pruneBody;
    return COPY.worktrees.removeBody;
  }

  // docs/prototype/vc-redesign/src/ui/app.ts
  var PANEL_WIDTHS = [300, 380, 460, 520];
  var DEFAULT_WIDTH = 460;
  var DEFAULT_THEME = "dark";
  function mount(root2) {
    const data = buildPrototypeData();
    const base = {
      screen: data.screen,
      commitFiles: data.commitFiles,
      totalCommits: data.commits.length,
      branch: data.branch,
      branches: data.branches.map((row) => ({ ...row, current: row.name === data.branch }))
    };
    let state = createSessionState(base, Date.now());
    let panelWidth = DEFAULT_WIDTH;
    let theme = DEFAULT_THEME;
    let embed = false;
    let lastFocusKey = null;
    let historyListScroll = 0;
    let resultTimer = null;
    let resultRef = null;
    let opTimer = null;
    let pendingOp = null;
    let wtFilter = "all";
    let wtNoteOpen = true;
    let expandedWorktree = null;
    let handoffKind = null;
    let handoffFocus = "";
    let handoffCopied = false;
    let commitMenuOid = null;
    let commitConfirmOid = null;
    const liveRegion = h("div", { class: "sr-only", attrs: { "aria-live": "polite", role: "status" } });
    root2.append(liveRegion);
    function snapshotFocus() {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const key = active.dataset.focusKey;
      if (key === void 0) return null;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return { key, start: active.selectionStart, end: active.selectionEnd };
      }
      return { key, start: null, end: null };
    }
    function restoreFocus(key, caret) {
      const targetKey = key ?? lastFocusKey;
      if (targetKey === null) return;
      const el = root2.querySelector(`[data-focus-key="${cssEscape(targetKey)}"]`);
      if (el === null) return;
      el.focus();
      if (caret !== null && caret.key === targetKey && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        const start = caret.start ?? el.value.length;
        const end = caret.end ?? start;
        el.setSelectionRange(start, end);
      }
    }
    function captureScroll() {
      const selector = ".changes-scroll, .history-scroll, .detail-scroll, .branch-scroll";
      const el = root2.querySelector(selector);
      if (el === null) return null;
      const scrollSelector = el.classList.contains("changes-scroll") ? ".changes-scroll" : el.classList.contains("history-scroll") ? ".history-scroll" : el.classList.contains("branch-scroll") ? ".branch-scroll" : ".detail-scroll";
      return { selector: scrollSelector, top: el.scrollTop };
    }
    function restoreScroll(snapshot) {
      if (snapshot === null) return;
      const el = root2.querySelector(snapshot.selector);
      if (el !== null) el.scrollTop = snapshot.top;
    }
    function dispatch(action, options = {}) {
      const focus = snapshotFocus();
      const scroll = captureScroll();
      const next = reduce(state, action, base);
      if (next === state) return;
      state = next;
      render({
        focusKey: options.focusKey ?? focus?.key ?? null,
        focusCaret: focus,
        scroll: options.scroll === void 0 ? scroll : options.scroll,
        post: options.post
      });
    }
    function repaint(options = {}) {
      render(options);
    }
    function render(options = {}) {
      const model = panelModelOf(base, state, Date.now());
      const frame = buildFrame(model);
      clear(root2);
      root2.append(liveRegion, frame);
      restoreScroll(options.scroll ?? null);
      restoreFocus(options.focusKey ?? null, options.focusCaret ?? null);
      const pendingCard = root2.querySelector(".wt-confirm, .branch-confirm, .changes-confirm, .commit-confirm, .stash-confirm");
      if (pendingCard !== null) pendingCard.scrollIntoView({ block: "nearest" });
      positionPopconfirm();
      positionBranchPop();
      positionHandoff();
      scheduleResultDismiss();
      liveRegion.textContent = state.result === null ? "" : state.result.text;
      options.post?.();
    }
    function scheduleResultDismiss() {
      if (state.result === null) {
        resultRef = null;
        if (resultTimer !== null) {
          window.clearTimeout(resultTimer);
          resultTimer = null;
        }
        return;
      }
      if (state.result === resultRef) return;
      resultRef = state.result;
      if (resultTimer !== null) window.clearTimeout(resultTimer);
      resultTimer = window.setTimeout(() => {
        resultTimer = null;
        if (state.result === resultRef) dispatch({ type: "result-clear" }, { focusKey: lastFocusKey });
      }, 9e3);
    }
    function segmented(labelText, items) {
      const group = h("div", { class: "seg", attrs: { role: "group", "aria-label": labelText } });
      for (const item of items) {
        group.append(h("button", {
          class: `seg-btn${item.on ? " is-on" : ""}`,
          attrs: {
            type: "button",
            "aria-pressed": item.on ? "true" : "false",
            "data-focus-key": item.key
          },
          dataset: { action: item.action, ...item.dataset }
        }, item.label));
      }
      return h("div", { class: "ctl" }, h("span", { class: "ctl-label", text: labelText }), group);
    }
    function buildFrame(model) {
      const head = h(
        "header",
        { class: "proto-head" },
        h("p", { class: "proto-kicker", text: COPY.frame.kicker }),
        h("h1", { class: "proto-title", text: COPY.frame.title }),
        h("p", { class: "proto-lede", text: COPY.frame.lede }),
        h(
          "div",
          { class: "proto-meta" },
          h("span", { class: "proto-chip", text: COPY.frame.metaData }),
          h("span", { class: "proto-chip", text: COPY.frame.metaWidth }),
          h("span", { class: "proto-chip", text: COPY.frame.metaSkin })
        )
      );
      const tools = h(
        "div",
        { class: "proto-tools" },
        h(
          "div",
          { class: "proto-controls" },
          segmented(COPY.frame.width, PANEL_WIDTHS.map((width) => ({
            key: `width-${width}`,
            label: String(width),
            on: panelWidth === width,
            action: "width",
            dataset: { width: String(width) }
          }))),
          segmented(COPY.frame.theme, [
            { key: "theme-dark", label: COPY.frame.themeDark, on: theme === "dark", action: "theme", dataset: { theme: "dark" } },
            { key: "theme-light", label: COPY.frame.themeLight, on: theme === "light", action: "theme", dataset: { theme: "light" } }
          ])
        ),
        h("span", { class: "proto-tools-note", text: COPY.frame.toolsNote })
      );
      const stage = h("div", { class: "stage" });
      const panel = h("div", {
        class: "panel",
        attrs: { "data-view": state.view }
      });
      const frame = h("div", { class: "frame", attrs: { style: `width: ${panelWidth + 22}px` } });
      const railResult = model.result !== null && (model.result.source === "sync" || model.result.source === "reload" || model.result.source === "copy") ? model.result : null;
      panel.append(renderRail(model.rail, railResult));
      panel.append(renderTabs(model));
      panel.append(h("main", { class: "panel-body", attrs: { id: "view-panel", role: "tabpanel", "aria-labelledby": `tab-${state.view}` } }, renderActiveView(model)));
      if (state.branchOpen) panel.append(renderBranchPopover(model));
      if (model.confirm !== null) panel.append(renderPopconfirm(model.confirm));
      if (handoffKind !== null) {
        panel.append(renderHandoffSheet({
          draft: buildHandoff(data, handoffKind, Date.now(), handoffFocus),
          copied: handoffCopied
        }));
      }
      frame.append(panel);
      stage.append(frame);
      const foot = h(
        "footer",
        { class: "proto-foot" },
        h("span", { class: "foot-hint", text: COPY.frame.hint }),
        h("span", { class: "foot-captured", text: COPY.frame.capturedAt(whenText(Date.now(), data.nowMs)) })
      );
      const wrap = h("div", { class: `proto${embed ? " is-embed" : ""}` }, head, tools, stage, foot);
      exitBusyLabel(wrap, model);
      return wrap;
    }
    function renderTabs(model) {
      const nav = h("nav", { class: "views", attrs: { role: "tablist", "aria-label": "\u7248\u672C\u7BA1\u7406\u89C6\u56FE" } });
      model.tabs.forEach((tab, index) => {
        const active = state.view === tab.id;
        const node = h(
          "button",
          {
            class: `tab${active ? " is-on" : ""}`,
            attrs: {
              type: "button",
              role: "tab",
              id: `tab-${tab.id}`,
              "aria-selected": active ? "true" : "false",
              "aria-controls": "view-panel",
              tabindex: active ? 0 : -1,
              "data-focus-key": `tab-${tab.id}`,
              title: `${tab.label}\uFF1A${tab.count} ${tab.unit}`
            },
            dataset: { action: "tab", view: tab.id }
          },
          h("span", { class: "tab-label", text: tab.label }),
          h(
            "span",
            { class: "tab-count" },
            h("span", { class: "count", text: String(tab.count) }),
            h("span", { class: "unit", text: tab.unit })
          )
        );
        if (index > 0) node.dataset.order = String(index);
        nav.append(node);
      });
      return nav;
    }
    function renderActiveView(model) {
      switch (state.view) {
        case "commits":
          return renderHistory(model.history, {
            result: model.result,
            // 最新一条提交在列表最上面；菜单里「撤销这次提交」只对它开放。
            headOid: model.history.rows[0] === void 0 ? null : model.history.rows[0].oid,
            menuOid: commitMenuOid,
            confirmOid: commitConfirmOid
          });
        case "worktrees": {
          const options = {
            filter: wtFilter,
            noticeOpen: wtNoteOpen,
            expandedPath: expandedWorktree
          };
          const result = model.result !== null && (model.result.source === "ai" || model.result.source === "worktree") ? model.result : null;
          return renderWorktrees(model.worktrees, result, options);
        }
        case "stash":
          return renderStash(model.stash, model.result);
        default:
          return renderChanges(model.changes, model.result);
      }
    }
    function renderBranchPopover(model) {
      return h("div", {
        class: "branch-pop",
        attrs: { role: "dialog", "aria-label": COPY.branches.listTitle }
      }, renderBranches(model.branches, model.result !== null && model.result.source === "branch" ? model.result : null));
    }
    function positionBranchPop() {
      const pop = root2.querySelector(".branch-pop");
      if (pop === null) return;
      const anchor = root2.querySelector('[data-action="branch-open"]');
      const panel = root2.querySelector(".panel");
      if (anchor === null || panel === null) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8));
      let top = a.bottom - p.top + 8;
      if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.classList.add("is-placed");
    }
    function positionHandoff() {
      const layer = root2.querySelector(".handoff-layer.is-pop");
      if (layer === null || handoffKind === null) return;
      const sheet = layer.querySelector(".handoff-sheet");
      const panel = root2.querySelector(".panel");
      if (sheet === null || panel === null) return;
      const anchor = root2.querySelector(`[data-action="handoff-open"][data-kind="${handoffKind}"]`);
      const p = panel.getBoundingClientRect();
      const width = sheet.offsetWidth;
      const height = sheet.offsetHeight;
      let left = Math.max(8, (p.width - width) / 2);
      let top = Math.max(8, (p.height - height) / 3);
      if (anchor !== null) {
        const a = anchor.getBoundingClientRect();
        left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8));
        top = a.bottom - p.top + 8;
        if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8);
      }
      sheet.style.left = `${left}px`;
      sheet.style.top = `${top}px`;
      sheet.style.width = `${Math.min(440, p.width - 16)}px`;
      layer.classList.add("is-placed");
    }
    function renderPopconfirm(confirm) {
      return h(
        "div",
        {
          class: "popconfirm",
          attrs: { role: "dialog", "aria-labelledby": "confirm-title", "aria-describedby": "confirm-body" }
        },
        h(
          "div",
          { class: "popconfirm-card" },
          h("h3", { class: "popconfirm-title", id: "confirm-title", text: confirm.title }),
          h("p", { class: "popconfirm-body", id: "confirm-body", text: confirm.body }),
          h("p", { class: "popconfirm-meta", text: COPY.rail.confirmFiles(confirm.files.length) }),
          h(
            "div",
            { class: "popconfirm-actions" },
            h("button", {
              class: "btn btn-md",
              attrs: { type: "button", "data-focus-key": "confirm-cancel" },
              dataset: { action: "confirm-cancel" }
            }, confirm.cancelLabel),
            h("button", {
              class: "btn btn-primary btn-md",
              attrs: { type: "button", "data-focus-key": "confirm-continue" },
              dataset: { action: "confirm-continue" }
            }, confirm.continueLabel)
          )
        )
      );
    }
    function positionPopconfirm() {
      const pop = root2.querySelector(".popconfirm");
      if (pop === null) return;
      const anchor = root2.querySelector('[data-action="pull"]');
      const panel = root2.querySelector(".panel");
      if (anchor === null || panel === null) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const left = Math.min(Math.max(a.left - p.left, 8), Math.max(8, p.width - width - 8));
      let top = a.bottom - p.top + 8;
      if (top + height > p.height - 8) top = Math.max(8, a.top - p.top - height - 8);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.classList.add("is-placed");
    }
    function exitBusyLabel(wrap, model) {
      if (model.busy !== null || model.rail.reloading) wrap.setAttribute("aria-busy", "true");
    }
    function runOp(op) {
      if (state.busy !== null || state.reloading) return;
      if (op === "commit") dispatch({ type: "commit-start" }, { focusKey: "commit" });
      else dispatch({ type: "op-start", op }, { focusKey: op });
      pendingOp = op;
      if (opTimer !== null) window.clearTimeout(opTimer);
      const delay = op === "commit" ? 700 : 850;
      opTimer = window.setTimeout(() => {
        opTimer = null;
        const finished = pendingOp;
        pendingOp = null;
        if (finished === null) return;
        if (finished === "commit") dispatch({ type: "commit-finish" }, { focusKey: "commit-message" });
        else dispatch({ type: "op-finish", op: finished, nowMs: Date.now() }, { focusKey: finished });
      }, delay);
    }
    function runReload() {
      if (state.reloading || state.busy !== null) return;
      dispatch({ type: "reload-start" }, { focusKey: "reload" });
      window.setTimeout(() => {
        dispatch({ type: "reload-finish", readAtMs: Date.now(), basisMs: state.basisMs ?? Date.now() }, { focusKey: "reload" });
      }, 500);
    }
    function dirtyFiles() {
      return [...state.staged, ...state.unstaged];
    }
    function backToHistoryList() {
      const detail = panelModelOf(base, state, Date.now()).history.detail;
      dispatch({ type: "history-back" }, {
        focusKey: detail === null ? "tab-commits" : `commit:${detail.oid}`,
        scroll: null,
        post: () => {
          const list = root2.querySelector(".history-scroll");
          if (list !== null) list.scrollTop = historyListScroll;
        }
      });
    }
    async function copyPath(path) {
      try {
        await navigator.clipboard.writeText(path);
      } catch {
      }
      dispatch({ type: "copy", path }, { focusKey: lastFocusKey });
    }
    function closeTransientPanels() {
      if (state.openMenuPath !== null) state = reduce(state, { type: "changes-open-menu", path: null }, base);
      if (state.changesPending !== null) state = reduce(state, { type: "changes-pending", pending: null }, base);
      if (state.stashPending !== null) state = reduce(state, { type: "stash-pending", pending: null }, base);
      commitMenuOid = null;
      commitConfirmOid = null;
    }
    function focusText(model) {
      if (state.branchOpen) return "\u5206\u652F\u6D6E\u5C42\uFF0C\u6B63\u5728\u672C\u5730\u5206\u652F\u6E05\u5355\u91CC";
      if (state.view === "commits") {
        const detail = model.history.detail;
        return detail === null ? "\u63D0\u4EA4\u5386\u53F2\u89C6\u56FE\u7684\u5217\u8868" : `\u63D0\u4EA4\u5386\u53F2\u89C6\u56FE\uFF0C\u6B63\u5728\u770B\u63D0\u4EA4 ${detail.short} \u7684\u8BE6\u60C5`;
      }
      if (state.view === "worktrees") {
        return `\u5DE5\u4F5C\u6811\u89C6\u56FE\uFF0C\u7B5B\u9009\u662F${wtFilter === "all" ? "\u5168\u90E8" : "\u53EA\u770B\u9700\u8981\u5904\u7406"}`;
      }
      if (state.view === "stash") {
        return `\u8D2E\u85CF\u89C6\u56FE\uFF0C\u5217\u8868\u91CC\u6709 ${model.stash.total} \u6761\u8BB0\u5F55`;
      }
      const filter = state.changesFilter;
      const filterLabel = filter === "conflict" ? "\u53EA\u770B\u51B2\u7A81" : filter === "staged" ? "\u53EA\u770B\u5DF2\u6682\u5B58" : filter === "unstaged" ? "\u53EA\u770B\u672A\u6682\u5B58" : "\u5168\u90E8";
      return `\u6539\u52A8\u89C6\u56FE\uFF0C\u7B5B\u9009\u662F${filterLabel}`;
    }
    async function copyHandoff(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
      }
      handoffCopied = true;
      liveRegion.textContent = COPY.ai.copied(text.length);
      repaint({ focusKey: "handoff-copy" });
    }
    function onClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest("[data-action]");
      if (el === null) return;
      const action = el.dataset.action ?? "";
      const model = panelModelOf(base, state, Date.now());
      switch (action) {
        case "width": {
          const next = Number(el.dataset.width);
          if (next === panelWidth) return;
          panelWidth = next;
          repaint({ focusKey: `width-${next}` });
          return;
        }
        case "theme": {
          const next = el.dataset.theme;
          if (next !== "dark" && next !== "light") return;
          if (next === theme) return;
          theme = next;
          document.documentElement.dataset.theme = next;
          repaint({ focusKey: `theme-${next}` });
          return;
        }
        case "tab": {
          const view = el.dataset.view;
          if (view !== "changes" && view !== "commits" && view !== "worktrees" && view !== "stash") return;
          if (state.branchOpen) {
            state = reduce(state, { type: "branch-close" }, base);
          }
          closeTransientPanels();
          if (state.view === view) {
            repaint({ focusKey: `tab-${view}`, scroll: null });
            return;
          }
          dispatch({ type: "view", view }, { focusKey: `tab-${view}`, scroll: null });
          return;
        }
        case "reload":
          runReload();
          return;
        case "pull": {
          if (model.rail.pull.disabled) return;
          if (state.confirmPull !== null) {
            dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
            return;
          }
          if (model.rail.pull.warn) {
            dispatch({ type: "pull-confirm-open", files: dirtyFiles(), dirtyCount: dirtyFiles().length }, { focusKey: "confirm-cancel" });
            return;
          }
          runOp("pull");
          return;
        }
        case "fetch":
          runOp("fetch");
          return;
        case "push":
          runOp("push");
          return;
        case "copy-repo":
          void copyPath(model.rail.worktreePath);
          return;
        case "worktree-copy": {
          const path = el.dataset.path ?? "";
          void copyPath(path);
          return;
        }
        case "filter": {
          const filter = el.dataset.filter;
          if (filter !== "conflict" && filter !== "staged" && filter !== "unstaged") return;
          dispatch({ type: "filter", filter: state.changesFilter === filter ? "all" : filter }, { focusKey: `filter-${filter}` });
          return;
        }
        case "toggle-file": {
          const path = el.dataset.path ?? "";
          dispatch({ type: "toggle-file", path }, { focusKey: `row:${path}` });
          return;
        }
        case "stage":
        case "unstage": {
          const path = el.dataset.path ?? "";
          dispatch({ type: action, path }, { focusKey: `row:${path}` });
          return;
        }
        case "stage-all":
          dispatch({ type: "stage-all" }, { focusKey: "stage-all" });
          return;
        case "unstage-all":
          dispatch({ type: "unstage-all" }, { focusKey: "unstage-all" });
          return;
        case "commit": {
          if (model.changes.composer.disabled) return;
          runOp("commit");
          return;
        }
        case "changes-open-menu": {
          const path = el.dataset.path ?? "";
          const open = state.openMenuPath === path;
          dispatch({ type: "changes-open-menu", path: open ? null : path }, { focusKey: `row-more:${path}` });
          return;
        }
        case "changes-pending": {
          const kind = el.dataset.kind;
          if (kind !== "discard" && kind !== "discard-all" && kind !== "ignore" && kind !== "delete-untracked" && kind !== "resolve-ours" && kind !== "resolve-theirs") return;
          const pendingKind = kind;
          const path = el.dataset.path ?? null;
          dispatch({ type: "changes-pending", pending: { kind: pendingKind, path } }, { focusKey: "changes-cancel", scroll: null });
          return;
        }
        case "changes-pending-cancel":
          dispatch({ type: "changes-pending", pending: null }, { focusKey: lastFocusKey, scroll: null });
          return;
        case "changes-apply":
          dispatch({ type: "changes-apply" }, { focusKey: lastFocusKey, scroll: null });
          return;
        case "stash-create":
          dispatch({ type: "stash-create" }, { focusKey: "composer-links", scroll: null });
          return;
        case "stash-apply":
        case "stash-pop": {
          const id = el.dataset.id ?? "";
          dispatch({ type: action, id }, { focusKey: `stash-${action === "stash-apply" ? "apply" : "pop"}:${id}`, scroll: null });
          return;
        }
        case "stash-pending": {
          const pending = { kind: "drop", id: el.dataset.id ?? "" };
          dispatch({ type: "stash-pending", pending }, { focusKey: "stash-cancel", scroll: null });
          return;
        }
        case "stash-pending-cancel":
          dispatch({ type: "stash-pending", pending: null }, { focusKey: lastFocusKey, scroll: null });
          return;
        case "stash-drop":
          dispatch({ type: "stash-drop", id: el.dataset.id ?? "" }, { focusKey: "tab-stash", scroll: null });
          return;
        case "commit-menu": {
          const oid = el.dataset.oid ?? "";
          const open = commitMenuOid === oid && commitConfirmOid === null;
          commitMenuOid = open ? null : oid;
          commitConfirmOid = null;
          repaint({ focusKey: `commit-more:${oid}` });
          return;
        }
        case "commit-menu-close":
          commitMenuOid = null;
          commitConfirmOid = null;
          repaint({ focusKey: lastFocusKey });
          return;
        case "commit-undo-start": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = oid;
          commitConfirmOid = oid;
          repaint({ focusKey: "commit-cancel" });
          return;
        }
        case "commit-undo": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = null;
          commitConfirmOid = null;
          dispatch({ type: "commit-undo", oid }, { focusKey: "tab-commits", scroll: null });
          return;
        }
        case "commit-revert":
        case "commit-cherry-pick": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = null;
          commitConfirmOid = null;
          dispatch({ type: action, oid }, { focusKey: `commit:${oid}`, scroll: null });
          return;
        }
        case "copy-oid": {
          const oid = el.dataset.oid ?? "";
          commitMenuOid = null;
          commitConfirmOid = null;
          void copyPath(oid);
          repaint({ focusKey: "tab-commits" });
          return;
        }
        case "history-open": {
          const scrollEl = root2.querySelector(".history-scroll");
          historyListScroll = scrollEl === null ? 0 : scrollEl.scrollTop;
          dispatch({ type: "history-open", oid: el.dataset.oid ?? "" }, { focusKey: "history-back", scroll: null, post: () => {
            const el2 = root2.querySelector(".detail-scroll");
            if (el2 !== null) el2.scrollTop = 0;
          } });
          return;
        }
        case "history-file": {
          const path = el.dataset.path ?? "";
          dispatch({ type: "history-open-file", path }, { focusKey: `history-file:${path}` });
          return;
        }
        case "history-back": {
          backToHistoryList();
          return;
        }
        case "history-merge-only":
          dispatch({ type: "history-merge-only" }, { focusKey: "history-merge" });
          return;
        case "ai-worktrees":
          dispatch({ type: "ai-worktrees" }, { focusKey: "ai-worktrees" });
          return;
        case "handoff-open": {
          const kind = el.dataset.kind;
          if (kind !== "general" && kind !== "changes" && kind !== "worktrees" && kind !== "branches") return;
          handoffKind = kind;
          handoffFocus = focusText(model);
          handoffCopied = false;
          repaint({ focusKey: "handoff-copy" });
          return;
        }
        case "handoff-close": {
          if (handoffKind === null) return;
          const previous = handoffKind;
          handoffKind = null;
          handoffCopied = false;
          repaint({ focusKey: `handoff-${previous}` });
          return;
        }
        case "handoff-copy": {
          if (handoffKind === null) return;
          const draft = buildHandoff(data, handoffKind, Date.now(), handoffFocus);
          void copyHandoff(draft.prompt);
          return;
        }
        case "wt-filter": {
          const filter = el.dataset.filter === "abnormal" ? "abnormal" : "all";
          if (filter === wtFilter) return;
          wtFilter = filter;
          repaint({ focusKey: `wt-filter-${filter}` });
          return;
        }
        case "wt-note-close":
          wtNoteOpen = false;
          repaint({ focusKey: "wt-note-open" });
          return;
        case "wt-note-open":
          wtNoteOpen = true;
          repaint({ focusKey: "wt-note-open" });
          return;
        case "wt-expand": {
          const path = el.dataset.path ?? "";
          expandedWorktree = expandedWorktree === path ? null : path;
          repaint({ focusKey: `wt-expand:${path}` });
          return;
        }
        case "branch-open":
          dispatch({ type: "branch-open" }, { focusKey: "branch-search", scroll: null });
          return;
        case "branch-close":
          dispatch({ type: "branch-close" }, { focusKey: "branch-open", scroll: null });
          return;
        case "branch-select": {
          const name = el.dataset.name ?? "";
          dispatch({ type: "branch-select", name }, { focusKey: "branch-back", scroll: null });
          return;
        }
        case "branch-sub": {
          const sub = el.dataset.sub;
          if (sub !== "list" && sub !== "detail" && sub !== "create" && sub !== "rename") return;
          const next = sub;
          const focusKey = next === "create" || next === "rename" ? "branch-draft" : "branch-back";
          dispatch({ type: "branch-sub", sub: next }, { focusKey, scroll: null });
          return;
        }
        case "branch-create":
          dispatch({ type: "branch-create" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-rename-confirm":
          dispatch({ type: "branch-rename", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-switch": {
          const name = el.dataset.name ?? "";
          if (model.branches.dirty) {
            dispatch({ type: "branch-pending", pending: { kind: "switch", name } }, { focusKey: "branch-confirm", scroll: null });
            return;
          }
          dispatch({ type: "branch-switch", name }, { focusKey: "branch-back", scroll: null });
          return;
        }
        case "branch-switch-confirm":
          dispatch({ type: "branch-switch", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-merge":
          dispatch({ type: "branch-merge", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-delete-start":
          dispatch({ type: "branch-pending", pending: { kind: "delete", name: el.dataset.name ?? "" } }, { focusKey: "branch-cancel", scroll: null });
          return;
        case "branch-delete-confirm":
          dispatch({ type: "branch-delete", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-rebase-start":
          dispatch({ type: "branch-pending", pending: { kind: "rebase", name: el.dataset.name ?? "" } }, { focusKey: "branch-cancel", scroll: null });
          return;
        case "branch-rebase-confirm":
          dispatch({ type: "branch-rebase", name: el.dataset.name ?? "" }, { focusKey: "branch-back", scroll: null });
          return;
        case "branch-pending-cancel":
          dispatch({ type: "branch-pending", pending: null }, { focusKey: "branch-back", scroll: null });
          return;
        case "wt-pending": {
          const kind = el.dataset.kind;
          if (kind !== "unlock" && kind !== "prune" && kind !== "remove") return;
          const pending = { kind, path: el.dataset.path ?? "", name: el.dataset.name ?? "" };
          dispatch({ type: "wt-pending", pending }, { focusKey: "wt-cancel", scroll: null });
          return;
        }
        case "wt-pending-cancel":
          dispatch({ type: "wt-pending", pending: null }, { focusKey: `wt-expand:${el.dataset.path ?? expandedWorktree ?? ""}`, scroll: null });
          return;
        case "wt-apply":
          dispatch({ type: "wt-apply" }, { focusKey: `wt-expand:${expandedWorktree ?? ""}`, scroll: null });
          return;
        case "confirm-cancel":
          dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
          return;
        case "confirm-continue":
          dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
          runOp("pull");
          return;
        case "result-dismiss":
          dispatch({ type: "result-clear" }, { focusKey: lastFocusKey });
          return;
        default:
          return;
      }
    }
    function onChange(event) {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return;
      if (event instanceof InputEvent && event.isComposing) return;
      const field = target.dataset.field;
      if (field === "message") {
        const next = reduce(state, { type: "message", value: target.value }, base);
        if (next === state) return;
        state = next;
        syncComposer();
      } else if (field === "history-query") {
        dispatch({ type: "history-query", value: target.value }, { focusKey: "history-query" });
      } else if (field === "branch-query") {
        dispatch({ type: "branch-query", value: target.value }, { focusKey: "branch-search" });
      } else if (field === "branch-draft") {
        dispatch({ type: "branch-draft", value: target.value }, { focusKey: "branch-draft" });
      }
    }
    function syncComposer() {
      const composer = root2.querySelector(".composer");
      if (composer === null) return;
      const current = panelModelOf(base, state, Date.now()).changes.composer;
      const buttonEl = composer.querySelector(".btn-primary");
      if (buttonEl !== null) {
        const busy = current.busy;
        buttonEl.disabled = current.disabled || busy;
        buttonEl.classList.toggle("is-disabled", current.disabled && !busy);
        buttonEl.setAttribute("aria-busy", busy ? "true" : "false");
        buttonEl.title = current.disabledReason ?? "";
        const label = buttonEl.querySelector(".btn-label");
        if (label !== null) label.textContent = busy ? COPY.busy.commit : COPY.changes.commitLabel(current.stagedCount);
      }
      const submitRow = composer.querySelector(".composer-submit");
      const reason = composer.querySelector(".composer-reason");
      if (current.disabledReason === null) {
        if (reason !== null) reason.remove();
        return;
      }
      if (reason !== null) {
        const text = reason.querySelector("span");
        if (text !== null) text.textContent = current.disabledReason;
        return;
      }
      if (submitRow !== null) {
        submitRow.before(h("div", { class: "composer-reason" }, icon("alert", 12), h("span", { text: current.disabledReason })));
      }
    }
    function onKeyDown(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (event.key === "Escape" && handoffKind !== null) {
        event.preventDefault();
        const previous = handoffKind;
        handoffKind = null;
        handoffCopied = false;
        repaint({ focusKey: `handoff-${previous}` });
        return;
      }
      if (event.key === "Escape" && state.changesPending !== null) {
        event.preventDefault();
        dispatch({ type: "changes-pending", pending: null }, { focusKey: lastFocusKey });
        return;
      }
      if (event.key === "Escape" && state.stashPending !== null) {
        event.preventDefault();
        dispatch({ type: "stash-pending", pending: null }, { focusKey: lastFocusKey });
        return;
      }
      if (event.key === "Escape" && (commitMenuOid !== null || commitConfirmOid !== null)) {
        event.preventDefault();
        commitMenuOid = null;
        commitConfirmOid = null;
        repaint({ focusKey: "tab-commits" });
        return;
      }
      if (event.key === "Escape" && state.branchPending !== null) {
        event.preventDefault();
        dispatch({ type: "branch-pending", pending: null }, { focusKey: "branch-back" });
        return;
      }
      if (event.key === "Escape" && state.worktreePending !== null) {
        event.preventDefault();
        dispatch({ type: "wt-pending", pending: null }, { focusKey: `wt-expand:${state.worktreePending.path}` });
        return;
      }
      if (event.key === "Escape" && state.branchOpen) {
        event.preventDefault();
        dispatch({ type: "branch-close" }, { focusKey: "branch-open" });
        return;
      }
      if (event.key === "Escape" && state.confirmPull !== null) {
        event.preventDefault();
        dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
        return;
      }
      if (state.confirmPull !== null) return;
      const row = target.closest('[data-action="toggle-file"], [data-action="history-open"], [data-action="history-file"]');
      if (row !== null && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        row.click();
        return;
      }
      if (target.getAttribute("role") === "tab") {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const tabs = Array.from(root2.querySelectorAll('.views [role="tab"]'));
        const index = tabs.indexOf(target);
        if (index < 0) return;
        const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
        const nextTab = tabs[nextIndex];
        const view = nextTab.dataset.view;
        if (view === "changes" || view === "commits" || view === "worktrees" || view === "stash") {
          dispatch({ type: "view", view }, { focusKey: `tab-${view}`, scroll: null });
        }
      }
    }
    root2.addEventListener("click", onClick);
    root2.addEventListener("input", onChange);
    root2.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (state.confirmPull !== null && target.closest(".popconfirm") === null && target.closest('[data-action="pull"]') === null) {
        dispatch({ type: "pull-confirm-close" }, { focusKey: "pull" });
      }
      if (state.branchOpen && target.closest(".branch-pop") === null && target.closest('[data-action="branch-open"]') === null) {
        state = reduce(state, { type: "branch-close" }, base);
        repaint({ focusKey: "branch-open" });
      }
      const insideTransient = target.closest(".row-menu, .row-more, .row-act, .commit-menu, .commit-more, .changes-confirm, .commit-confirm") !== null;
      if (!insideTransient && (commitMenuOid !== null || commitConfirmOid !== null || state.openMenuPath !== null)) {
        commitMenuOid = null;
        commitConfirmOid = null;
        if (state.openMenuPath !== null) state = reduce(state, { type: "changes-open-menu", path: null }, base);
        repaint({ focusKey: lastFocusKey });
      }
    });
    root2.addEventListener("focusin", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.dataset.focusKey !== void 0) lastFocusKey = target.dataset.focusKey;
    });
    function applyDeepLink() {
      const params = new URLSearchParams(window.location.search);
      const widthParam = Number(params.get("width"));
      if (PANEL_WIDTHS.includes(widthParam)) panelWidth = widthParam;
      const themeParam = params.get("theme");
      if (themeParam === "dark" || themeParam === "light") theme = themeParam;
      embed = params.get("embed") === "1";
      const wt = params.get("wt");
      if (wt === "abnormal" || wt === "all") wtFilter = wt;
      if (params.get("wtnote") === "0") wtNoteOpen = false;
      if (params.get("demo") === "1") state = reduce(state, { type: "demo-worktrees" }, base);
      if (params.get("wtexpand") === "1") {
        const first = panelModelOf(base, state, Date.now()).worktrees.others.find((row) => row.abnormal);
        expandedWorktree = first === void 0 ? null : first.path;
      }
      const wtPendingParam = params.get("wtpending");
      if (wtPendingParam === "unlock" || wtPendingParam === "prune" || wtPendingParam === "remove") {
        const path = params.get("wtpath") ?? "";
        const row = panelModelOf(base, state, Date.now()).worktrees.others.find((candidate) => candidate.path === path);
        if (row !== void 0) {
          expandedWorktree = row.path;
          state = reduce(state, { type: "wt-pending", pending: { kind: wtPendingParam, path: row.path, name: row.name } }, base);
        }
      }
      const view = params.get("view");
      if (view === "changes" || view === "commits" || view === "worktrees" || view === "stash") {
        state = reduce(state, { type: "view", view }, base);
      }
      const menuPath = params.get("menu");
      if (menuPath !== null && menuPath !== "") {
        state = reduce(state, { type: "changes-open-menu", path: menuPath }, base);
      }
      const changePending = params.get("cpending");
      if (changePending === "discard" || changePending === "discard-all" || changePending === "ignore" || changePending === "delete-untracked" || changePending === "resolve-ours" || changePending === "resolve-theirs") {
        state = reduce(state, { type: "changes-pending", pending: { kind: changePending, path: params.get("cpath") ?? null } }, base);
      }
      const commitMenu = params.get("commitmenu");
      if (commitMenu !== null && commitMenu !== "") commitMenuOid = commitMenu;
      if (params.get("commitconfirm") === "1" && commitMenuOid !== null) commitConfirmOid = commitMenuOid;
      if (params.get("stashdemo") === "1") state = reduce(state, { type: "stash-create" }, base);
      const stashPending = params.get("stashpending");
      if (stashPending === "drop") {
        const stashId = params.get("stashid") ?? "stash@{0}";
        state = reduce(state, { type: "stash-pending", pending: { kind: "drop", id: stashId } }, base);
      }
      if (params.get("branches") === "1") state = reduce(state, { type: "branch-open" }, base);
      const branchName = params.get("branch");
      if (branchName !== null && branchName !== "") state = reduce(state, { type: "branch-select", name: branchName }, base);
      const branchSubParam = params.get("bsub");
      if (branchSubParam === "list" || branchSubParam === "detail" || branchSubParam === "create" || branchSubParam === "rename") {
        state = reduce(state, { type: "branch-sub", sub: branchSubParam }, base);
      }
      const branchDraft = params.get("bdraft");
      if (branchDraft !== null && branchDraft !== "") state = reduce(state, { type: "branch-draft", value: branchDraft }, base);
      const branchPendingParam = params.get("bpending");
      if (branchPendingParam === "delete" || branchPendingParam === "switch" || branchPendingParam === "rebase") {
        const selected = state.branchSelected;
        if (selected !== null) {
          state = reduce(state, { type: "branch-pending", pending: { kind: branchPendingParam, name: selected } }, base);
        }
      }
      if (params.get("merge") === "1") state = reduce(state, { type: "history-merge-only" }, base);
      const query = params.get("q");
      if (query !== null && query !== "") state = reduce(state, { type: "history-query", value: query }, base);
      const open = params.get("open");
      if (open !== null && open !== "") state = reduce(state, { type: "history-open", oid: open }, base);
      const file = params.get("file");
      if (file !== null && file !== "") state = reduce(state, { type: "history-open-file", path: file }, base);
      const filter = params.get("filter");
      if (filter === "conflict" || filter === "staged" || filter === "unstaged") {
        state = reduce(state, { type: "filter", filter }, base);
      }
      const message = params.get("message");
      if (message !== null && message !== "") state = reduce(state, { type: "message", value: message }, base);
      if (params.get("confirm") === "1") {
        state = reduce(state, { type: "pull-confirm-open", files: dirtyFiles(), dirtyCount: dirtyFiles().length }, base);
      }
      const ai = params.get("ai");
      if (ai === "general" || ai === "changes" || ai === "worktrees" || ai === "branches") {
        handoffKind = ai;
        handoffFocus = focusText(panelModelOf(base, state, Date.now()));
        if (params.get("aicopied") === "1") handoffCopied = true;
      }
    }
    applyDeepLink();
    document.documentElement.dataset.theme = theme;
    render({ focusKey: null });
    window.setInterval(() => dispatch({ type: "tick" }, { focusKey: lastFocusKey }), 3e4);
  }
  function cssEscape(value) {
    return value.replace(/["\\]/g, "\\$&");
  }

  // docs/prototype/vc-redesign/src/main.ts
  var root = document.getElementById("app");
  if (root === null) throw new Error("\u539F\u578B\u9875\u9762\u7F3A\u5C11 #app \u6302\u8F7D\u70B9\uFF1Aindex.html \u4E0E src/main.ts \u4E0D\u4E00\u81F4\u3002");
  mount(root);
})();
