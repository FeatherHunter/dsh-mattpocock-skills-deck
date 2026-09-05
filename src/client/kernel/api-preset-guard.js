/**
 * src/client/kernel/api-preset-guard.js — 内核模块（#478 由 api-naming.js 拆出之预设守卫：探针、创建后验、隔离与后验编排）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 * 依赖同闭包的 getRowPreset/isHealthyPreset（api-naming，调用时），仅在运行时调用，初始化期不求值。
 */
    // ============ 预设守卫（#478 创建后验编排：探针/后验/隔离/编排）============
    export const describeReuseDecision = function(row, normTarget) {
      // #478 现场探针（只读、不改行为）：返回脱敏摘要，不记完整路径；供回填偶现快照时把候选分支落到唯一分支。
      try {
        const preset = getRowPreset(row)
        return { blank: !!(row && row.blank), preset: preset || '(empty)', healthy: isHealthyPreset(preset) }
      } catch (e) { return null }
    }
    export const verifyFreshPreset = function(sessions, sid) {
      // #478 创建后验：只对“明确读到 code/broken”判 bad；读不到判 unknown（快照滞后时不得阻断创建）。
      // 读取两路：实时会话对象（若宿主暴露 sessions.get）与列表快照行；任一路明确为 code/broken 即 bad。
      try {
        const readings = []
        try {
          if (sessions && typeof sessions.get === 'function') {
            const live = sessions.get(sid)
            if (live) {
              if (typeof live.agentPreset === 'string' && live.agentPreset) readings.push(live.agentPreset)
              if (typeof live.preset === 'string' && live.preset) readings.push(live.preset)
              try {
                if (live.projections && live.projections.values && typeof live.projections.values.agentPreset === 'string' && live.projections.values.agentPreset) readings.push(live.projections.values.agentPreset)
              } catch (eP) {}
              try {
                if (live.projectionValues && typeof live.projectionValues.agentPreset === 'string' && live.projectionValues.agentPreset) readings.push(live.projectionValues.agentPreset)
              } catch (eP2) {}
            }
          }
        } catch (eG) {}
        try {
          if (sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
            const snap = sessions.list.getSnapshot()
            const row = snap && snap.byId ? snap.byId[sid] : null
            const p = getRowPreset(row)
            if (p) readings.push(p)
          }
        } catch (eS) {}
        for (let i = 0; i < readings.length; i++) {
          const v = String(readings[i] || '').trim()
          if (v === 'code' || v === 'broken') return 'bad'
        }
        return readings.length ? 'ok' : 'unknown'
      } catch (e) { return 'unknown' }
    }
    export const tryQuarantineSession = function(sessions, sid) {
      // #478 隔离：已确认 code 的新会话绝不 open；尽力关闭（能力探测，缺哪个跳过哪个，全程不抛；宿主暂无关闭能力时返回 false，幽灵由复用闸门永久隔离）。
      try {
        if (!sessions || !sid) return false
        const names = ['close', 'archive', 'delete', 'remove']
        for (let i = 0; i < names.length; i++) {
          try {
            const fn = sessions[names[i]]
            if (typeof fn === 'function') {
              const r = fn.call(sessions, sid)
              if (r && typeof r.catch === 'function') r.catch(function () {})
              return true
            }
          } catch (eOne) {}
        }
      } catch (e) {}
      return false
    }
    export const createVerifiedPTCSession = function(createOnce, sessions) {
      // #478 创建后验编排：首建验 bad 则隔离并重建一次；两次 bad 则抛 preset-blocked 错误（调用方大声失败回当前会话，绝不 open code）。
      // createOnce 由调用方传入单次 PTC 创建（单点工厂或直建回退）；本函数只做后验与重试，不碰入参构造。
      return createOnce().then(function (sid) {
        if (verifyFreshPreset(sessions, sid) !== 'bad') return sid
        tryQuarantineSession(sessions, sid)
        return createOnce().then(function (sid2) {
          if (verifyFreshPreset(sessions, sid2) !== 'bad') return sid2
          tryQuarantineSession(sessions, sid2)
          throw new Error('preset-blocked: fresh session preset is code')
        })
      })
    }
