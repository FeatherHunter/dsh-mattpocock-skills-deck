import { createPlatform } from './src/host/platform/index.js'
import { githubMatches } from './src/host/tracker/backends/github/index.js'
import { createRegistry } from './src/host/tracker/registry.js'

const fakeCtx = {
  get: (k) => {
    if (k === 'subprocess') return {
      async resolveExecutable(name){
        // use Node's which
        const { execSync } = await import('node:child_process')
        try {
          const out = execSync(`where ${name}`, { encoding: 'utf8' }).split('\n')[0].trim()
          return out || name
        } catch { return name }
      },
      spawn: () => ({ stdout:{on:()=>{}}, stderr:{on:()=>{}}, on:()=>{}, terminate:()=>{} })
    }
    if (k === 'timer') return { timeout: (fn,ms)=>setTimeout(fn,ms), clearTimeout: (id)=>clearTimeout(id) }
    if (k === 'fs') {
      // Use Node's fs/promises with DSH's fs interface (resolve, readText, lstat)
      // DSH's fs has resolve(path, {cwd}) and readText(target)
      // We need to mimic that: resolve returns a target object, readText reads it
      // For simplicity, we will directly use Node's fs for the test of githubMatches's first probe (fs.resolve + readText)
      // We'll create a mock that does the same as platform's fs
      return {
        async resolve(p, opts){
          const cwd = opts && opts.cwd ? opts.cwd : process.cwd()
          const { join } = await import('node:path')
          const full = join(cwd, p)
          return { target: full, path: full }
        },
        async readText(target){
          const p = typeof target === 'object' && target.target ? target.target : target
          const { readFile } = await import('node:fs/promises')
          return await readFile(p, 'utf8')
        },
        async lstat(p){
          const { lstat } = await import('node:fs/promises')
          return await lstat(p)
        }
      }
    }
    return undefined
  },
  set: ()=>{}
}

const platform = await createPlatform(fakeCtx)
console.log('platform os', platform.os)
console.log('platform path sep', platform.path.sep)
console.log('platform getHome', await platform.getHome())

const cwd = 'D:\\2Study\\StudyNotes'
console.log('testing cwd', cwd)

// Test githubMatches directly
try {
  const handle = { cwd }
  const ctx = { cwd, platform, fs: platform.fs, timers: { setTimeout, clearTimeout } }
  const ok = await githubMatches(handle, ctx)
  console.log('githubMatches result for StudyNotes:', ok)
  // Also try reading .git/config directly via platform.fs
  try {
    const t = await platform.fs.resolve('.git/config', { cwd })
    console.log('resolve .git/config target', t)
    const txt = await platform.fs.readText(t)
    console.log('readText contains github?', /github\.com/i.test(txt), 'first 200 chars', txt.slice(0,200).replace(/\n/g,' | '))
  } catch(e){ console.log('fs read fail', e.message) }
} catch(e){ console.log('githubMatches error', e.stack) }

// Test registry select
try {
  const reg = createRegistry({}, { matchesTimeout: 3000 })
  const { githubModule } = await import('./src/host/tracker/backends/github/index.js')
  const { createMarkdownBackend, matches: mdMatches } = await import('./src/host/tracker/backends/markdown/index.js')
  const { gitlabBackend } = await import('./src/host/tracker/backends/gitlab/index.js')
  reg.register(githubModule)
  // markdown
  try {
    const mkCreate = createMarkdownBackend
    if (mkCreate) {
      const mod = { id: 'markdown', label: 'Markdown', create: mkCreate, matches: mdMatches || (async()=>false) }
      reg.register(mod)
      console.log('registered markdown')
    }
  } catch(e){ console.log('markdown register fail', e.message)}
  try { reg.register(gitlabBackend); console.log('registered gitlab') } catch(e){ console.log('gitlab fail', e.message)}
  console.log('modules', reg.modules().map(m=>m.id))
  const handle = { cwd }
  const sel = await reg.select(handle, { cwd, platform, fs: platform.fs, timers: { setTimeout, clearTimeout } })
  console.log('registry select for StudyNotes:', JSON.stringify(sel,null,2))
} catch(e){ console.log('registry select error', e.stack) }
