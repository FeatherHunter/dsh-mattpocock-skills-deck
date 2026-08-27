/**
 * client/kernel/link.js — Client 侧 URL 契约 helper（#227 迁移 15 处 github.com 硬编码）。
 */
    export const issueUrlFor = (st, key) => {
      const n = String(key || '').trim()
      if (!n) return ''
      const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
      const bid = sel ? sel.backendId : null
      if (bid === 'markdown') return ''
      const repo = st && st.snapshot && (st.snapshot.repository || st.snapshot.repo)
      const repo2 = st && st.repository
      let refId = ''
      if (repo && typeof repo.refId === 'string' && repo.refId) refId = repo.refId
      else if (repo && repo.owner && repo.name) refId = repo.owner + '/' + repo.name
      else if (repo2 && typeof repo2.refId === 'string' && repo2.refId) refId = repo2.refId
      else if (repo2 && repo2.owner && repo2.name) refId = repo2.owner + '/' + repo2.name
      if (!refId || !refId.includes('/')) return ''
      if (bid === 'gitlab') return 'https://gitlab.com/' + refId + '/-/issues/' + n
      return 'https://github.com/' + refId + '/issues/' + n
    }
    export const searchUrlFor = (st, name) => {
      const n = String(name || '').trim()
      if (!n) return ''
      const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
      const bid = sel ? sel.backendId : null
      if (bid === 'markdown') return ''
      if (bid === 'gitlab') return 'https://gitlab.com/search?search=' + encodeURIComponent(n)
      return 'https://github.com/search?q=' + encodeURIComponent(n)
    }
    export const repoUrlFor = (st) => {
      const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
      const bid = sel ? sel.backendId : null
      if (bid === 'markdown') return ''
      const repo = st && (st.snapshot && (st.snapshot.repository || st.snapshot.repo))
      if (repo && repo.url) return repo.url
      const refId = repo && (repo.refId || (repo.owner && repo.name ? repo.owner + '/' + repo.name : ''))
      if (!refId || !refId.includes('/')) return ''
      if (bid === 'gitlab') return 'https://gitlab.com/' + refId
      return 'https://github.com/' + refId
    }

