import { createRegistry } from './src/host/tracker/registry.js'
import { createPlatform } from './src/host/platform/index.js'
import { githubModule } from './src/host/tracker/backends/github/index.js'
import { createRequire } from 'node:module'
const ctx = {
  get: (k) => {
    if (k === 'subprocess') return {
      async resolveExecutable(name){ 
        // try to find gh and git
        const { spawnSync } = await import('node:child_process')
        // Simplified: return name
        return name
      },
      spawn: ()=>({ stdout:{on:()=>{}}, stderr:{on:()=>{}}, on:()=>{}, terminate:()=>{} })
    }
    if (k === 'timer') return { timeout: (fn,ms)=>setTimeout(fn,ms), clearTimeout: (id)=>clearTimeout(id) }
    if (k === 'fs') {
      const fs = await import('node:fs/promises')
      return fs
    }
    return undefined
  },
  set: ()=>{}
}
// This is a simplified test, we will directly test github matches via platform
const platform = await createPlatform({
  get: (k)=>{
    if(k==='subprocess') return ctx.get('subprocess')
    if(k==='timer') return ctx.get('timer')
    if(k==='fs') return { 
      // use node fs
      async lstat(p){ try{ const { lstat } = await import('node:fs/promises'); return await lstat(p)}catch{ throw new Error('not found')} },
      async readText(){ return ''},
      async access(p){ const { access } = await import('node:fs/promises'); return access(p)},
    }
    if(k==='platform') return platform
    return undefined
  }
})
console.log('platform', platform.os, platform.path.sep)
// Try to create registry and test select for StudyNotes
const reg = createRegistry({}, { matchesTimeout: 3000 })
reg.register(githubModule)
console.log('registered', reg.modules().map(m=>m.id))
const handle = { cwd: 'D:\\2Study\\StudyNotes' }
// Need to mock platform for matches: github matches checks handle.cwd and platform.fs?
// Let's directly call matches
try {
  const ok = await githubModule.matches(handle, { cwd: handle.cwd, platform, fs: platform.fs, timers: { setTimeout, clearTimeout } })
  console.log('github matches for StudyNotes:', ok)
} catch(e){ console.log('matches error', e.message, e.stack) }

try {
  const sel = await reg.select(handle, { cwd: handle.cwd, platform, fs: platform.fs, timers: { setTimeout, clearTimeout } })
  console.log('select result', JSON.stringify(sel,null,2))
} catch(e){ console.log('select error', e.stack) }
