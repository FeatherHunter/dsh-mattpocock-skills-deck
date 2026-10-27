// AUTO-GENERATED。来源脚本：docs/prototype/vc-redesign/tools/capture-git.ts。
// 采集时间 2026-10-27T09:00:00.859Z；仓库根 D:\dsh-plugin\dsh-mattpocock-skills-deck；分支 main；提交 50 条；工作树 15 棵。
// 不要手改；要刷新就重新跑一次生成脚本。
export interface CapturedFile {
  path: string
  added: number
  deleted: number
}

export interface CapturedCommit {
  oid: string
  short: string
  author: string
  email: string
  authorDateMs: number
  subject: string
  parents: string[]
  files: CapturedFile[]
}

export interface CapturedWorktree {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
}

export const capturedAtMs = 1793091600859
export const capturedRepoRoot = "D:\\dsh-plugin\\dsh-mattpocock-skills-deck"
export const capturedHead = "a65498e89293c36f3f0781e38ee986d30bfe2418"
export const capturedBranch = "main"
export const capturedCommits: CapturedCommit[] = [
  {
    "oid": "a65498e89293c36f3f0781e38ee986d30bfe2418",
    "short": "a65498e8",
    "author": "FeatherHunter",
    "email": "975559549@qq.com",
    "authorDateMs": 1793091381000,
    "subject": "新会话决策链加常驻诊断日志，下次复发可直接查日志定位",
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
    "authorDateMs": 1793091320000,
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
    "authorDateMs": 1793091277000,
    "subject": "GitLab 工作区的补身份不再被「只给 GitHub 问」挡住：抽出共享补齐实现并让刷新与 deck 工具共用（#1583）",
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
    "authorDateMs": 1793091101000,
    "subject": "合并#1579票号徽标斜杠修复到主分支",
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
    "authorDateMs": 1793090702000,
    "subject": "修复本地后端票号徽标斜杠被省略的问题，上限收窄到85像素（#1579）",
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
    "authorDateMs": 1793089241000,
    "subject": "致谢表自动更新：把新编号贡献并进来，中英两表按花数与最后活跃重排",
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
    "authorDateMs": 1793088422000,
    "subject": "对齐斜杠边界到票面约定：斜杠前的连字符不再挡住技能名入口，并给连字符边界加一道正例门禁（#1556）",
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
    "authorDateMs": 1793088310000,
    "subject": "技能详情正文支持普通文字里的技能名入口：普通文字层新增斜杠加名单查表规则，复用已有判定与入口构件，让/implement里的/tdd与/code-review点得开（#1556）",
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
    "authorDateMs": 1793088256000,
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
    "authorDateMs": 1793088232000,
    "subject": "本地 Markdown 工作区的票详情不再报 refId missing：会话装配按模块优先补齐两条定位口（#1581）",
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
    "authorDateMs": 1793087468000,
    "subject": "每日更新 Star History：追加拉取到的星标数据并重新生成手绘双主题图表",
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
    "authorDateMs": 1793087054000,
    "subject": "导览文档引用按今天的代码重新对齐：修正 296 行路径与行号（#1531）",
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
    "authorDateMs": 1793085495000,
    "subject": "把版本号推进到 1.9.0-beta.27：beta.26 之后收口票面工具无损回执、单票薄读与在办表独立工具等改动，重发一版让升级生效",
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
    "authorDateMs": 1793084574000,
    "subject": "接手与补充提示词改挂 triage 技能并补齐状态分支（#1577）",
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
    "author": "王辰浩",
    "email": "975559549@qq.com",
    "authorDateMs": 1793081976000,
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
    "authorDateMs": 1793081824000,
    "subject": "把远端 main 新合入的 #1576 改动合进 #1505 分支，门禁归属表按合并后的树重新生成",
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
    "author": "王辰浩",
    "email": "975559549@qq.com",
    "authorDateMs": 1793081678000,
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
    "authorDateMs": 1793081633000,
    "subject": "合并 origin/main 0d50024b 到 #1571 修复分支，重生成门禁归属表",
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
    "authorDateMs": 1793081386000,
    "subject": "把主分支最新改动合进 #1505 分支，门禁归属表按合并后的树重新生成",
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
    "authorDateMs": 1793080921000,
    "subject": "重生成门禁归属表，把这次拆出来的两个新文件登记进去",
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
    "authorDateMs": 1793080916000,
    "subject": "github 房把 gh 客户端的外围零件拆到独立文件，三扇门禁跟着改读新文件",
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
    "authorDateMs": 1793080909000,
    "subject": "检测层把两层证据的读法拆到独立文件，让 backendDecision.ts 回到文件粒度基线以里",
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
    "authorDateMs": 1793079864000,
    "subject": "合入远端 main 的 10 笔改动，本地 6 笔提交与它分叉后第一次对齐",
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
    "authorDateMs": 1793079818000,
    "subject": "把在办表的读取工具按一次读取计入工具预算，免得它被预算门禁当成零成本的调用",
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
    "authorDateMs": 1793079812000,
    "subject": "整段改写正文前先读一次正文指纹并带上 bodyDigest，让 #1091 门禁跟上正文指纹锁的契约",
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
    "authorDateMs": 1793079812000,
    "subject": "在办表回执里的保留期、在办窗口与存档上限改读中央生成值，三个数不再手写；时间配置门禁登记两处单位换算",
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
    "authorDateMs": 1793079799000,
    "subject": "胶囊折叠标签把让位号只写一份，单段与两段共用同一处样式分叉；907 门禁补上折叠函数的全局注册",
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
    "authorDateMs": 1793079785000,
    "subject": "把损坏的 .wt-head 临时工作树目录加进忽略名单，本地残留不再混进待提交清单",
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
    "authorDateMs": 1793078704000,
    "subject": "把写回执里的在办表搬进独立读工具并关闭旧参数（#1561）",
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
    "authorDateMs": 1793078497000,
    "subject": "修复 #1566：环境检查认得出第二 remote 上的 GitHub 仓库身份",
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
    "authorDateMs": 1793077822000,
    "subject": "修复 Markdown 认领与判定层对声明口径不一致的问题（#1572）",
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
    "authorDateMs": 1793077284000,
    "subject": "让环境检查探针开会话沿用链求值定下的后端（#1505）",
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
    "authorDateMs": 1793076658000,
    "subject": "GitHub 房 20 处 -F 改 -f、GraphQL 变量错误判解析、env 文案按原因分流（#1571）",
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
    "authorDateMs": 1793076374000,
    "subject": "修复 #1563：状态栏胶囊窄栏下目录先让位，编号尾巴永不缩小",
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
    "authorDateMs": 1793076320000,
    "subject": "回话按 Q3 分开写排队与拿到名额后两段（#1560）",
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
    "authorDateMs": 1793076245000,
    "subject": "补充 #1566 第四轮定稿笔记：宿主本地身份解析改扫全部远端，检查链与面板共用证据",
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
    "authorDateMs": 1793076085000,
    "subject": "重生成门禁归属表：纳入合并进来的 issue-index-scan.ts（#1559）",
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
    "authorDateMs": 1793076060000,
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
    "authorDateMs": 1793076046000,
    "subject": "合并远端 main 与 #1574 审查修复（#1574）",
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
    "authorDateMs": 1793076041000,
    "subject": "补强 deck 工具无损门禁：覆盖降级分支与成功断言，并重生成归属表（#1559）",
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
    "authorDateMs": 1793076025000,
    "subject": "补齐1574的审查意见：修正文档边界与应急脚本的重试读回（#1574）",
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
    "authorDateMs": 1793075822000,
    "subject": "修复 #1560：房内排队等名额只等上限，不再吃掉整档预算",
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
    "authorDateMs": 1793074781000,
    "subject": "市场详情页截图收敛为 6 张：对齐市场端展示上限，去掉末尾两张",
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
    "authorDateMs": 1793073140000,
    "subject": "补充 #1566 第三轮复核笔记：期望对照与面板身份同源路径",
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
    "authorDateMs": 1793072404000,
    "subject": "修复1568：发布清单的构建钩子换成只在发布时跑，用户安装不再被要构建授权",
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
    "authorDateMs": 1793072180000,
    "subject": "合并 origin/main 到 main：让票面工具故障说明与应急脚本跟上前端修复（#1574）",
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
    "authorDateMs": 1793071680000,
    "subject": "修复 deck_issue_list 成功回执不是无损 JSON：缺省键不出现，并补九工具无损门禁（#1559）",
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
    "authorDateMs": 1793071614000,
    "subject": "新增票面应急脚本，四个动作都先读回再写并核对",
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
    "authorDateMs": 1793071548000,
    "subject": "给票面工具故障补上应急路径说明，升级后先自检再干活",
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
    "authorDateMs": 1793071403000,
    "subject": "实现单票薄读与正文指纹锁：缺省只回摘要与总数，全文分块加指纹，写回凭指纹验旧",
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
]
export const capturedWorktrees: CapturedWorktree[] = [
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
]
