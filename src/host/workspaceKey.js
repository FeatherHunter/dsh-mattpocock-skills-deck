export function normalizeWorkspacePath(raw, platform) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return s;
  try {
    if (platform && platform.path && typeof platform.path.normalize === 'function') {
      let n = platform.path.normalize(s);
      const sep = platform.path.sep;
      let isRoot = false;
      if (platform.os === 'win32') {
        isRoot = /^[A-Za-z]:\\$/.test(n) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(n) || n === '\\' || n === '/';
      } else {
        isRoot = n === '/';
      }
      if (!isRoot) {
        while (n.length>1 && n.endsWith(sep)) n=n.slice(0,-1);
        const otherSep = sep==='\\' ? '/' : '\\';
        while(n.length>1 && n.endsWith(otherSep)) n=n.slice(0,-1);
      }
      if(platform.os==='win32') n=n.toLowerCase();
      return n;
    }
  } catch {}
  return s;
}
export async function canonicalWorkspaceKey(raw, deps) {
  const getPlatform = deps && deps.getPlatform;
  const getFs = deps && deps.getFs;
  const getDefaultCwd = deps && deps.getDefaultCwd;
  let input = raw;
  if (input == null || (typeof input==='string' && !input.trim())) {
    try { input = getDefaultCwd ? getDefaultCwd() : ''; } catch { input = ''; }
    if (!input) return '';
  }
  if (typeof input!=='string') input=String(input);
  input=input.trim();
  if(!input){
    try{ input = getDefaultCwd ? getDefaultCwd() : ''; }catch{}
  }
  let platform=null;
  try{ platform = getPlatform ? await getPlatform() : null; }catch{}
  try{
    if(platform && platform.path && typeof platform.path.isAbsolute==='function' && platform.path.isAbsolute(input)){
      return normalizeWorkspacePath(input, platform);
    }
  }catch{}
  try{
    const fss = getFs ? getFs() : null;
    if(fss && typeof fss.resolve==='function'){
      const t = await fss.resolve(input);
      const target = (t && typeof t==='object') ? (t.path || t.target || t.displayPath || '') : t;
      if(typeof target==='string' && target){
        const isAbs = (platform && platform.path && typeof platform.path.isAbsolute==='function')
          ? platform.path.isAbsolute(target)
          : (/^[A-Za-z]:[\\\/]/.test(target) || /^\//.test(target) || /^\\\\/.test(target));
        if(isAbs) return normalizeWorkspacePath(target, platform);
      }
    }
  }catch{}
  try{
    if(platform && typeof platform.getHome==='function'){
      const home = await platform.getHome();
      if(home && platform.path){
        const joined = platform.path.join(home, input);
        return normalizeWorkspacePath(joined, platform);
      }
    }
  }catch{}
  if(platform) return normalizeWorkspacePath(input, platform);
  return input;
}
export default { normalizeWorkspacePath, canonicalWorkspaceKey };
