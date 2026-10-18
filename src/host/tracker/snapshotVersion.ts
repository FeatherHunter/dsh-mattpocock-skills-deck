// src/host/tracker/snapshotVersion.ts —— 快照版号算法：拉取请求三字段签名与整份版号（#1255 从 snapshot.ts 拆出）
//
// 为什么单列：版号是 304 正确性的核心 —— 版号里 effortOf(t)+'#'+key 的拼接决定了缓存命中与否，
//   算错就会送出陈旧快照；它是纯函数（快照进来，12 位散列出去），值得一个独立的屋顶，
//   改动时一眼看到影响范围。
// 什么约定不能改：
//   1. MISSING / BAD / EMPTY 三态划分与 #508 口径一致，只改拉取请求字段也换版号。
//   2. 先试真散列（crypto），取不到才回落土散列；行为与拆分前逐行一致，只加 export、去缩进，不改逻辑。
// 跨文件边只有一条（snapshot.ts → 本文件，被依赖方）：snapshotVersionOf；
//   prSigOf 只在本文件内用，不导出。

import { effortOf } from '../../tracker/kernel/identity-keys.js'

// 本域 types 为空，CommonJS 的 require 声明随 @types 一起缺席；运行时在 ESM 下取不到 require
// 会直接抛错并走进下面的 catch 回退分支。按存在声明只为过编译器，不产生运行时代码，行为与原来一致。
declare const require: (id: string) => any

function prSigOf(x: any): string{ try{ const has=Object.prototype.hasOwnProperty; const pr=!has.call(x,'isPullRequest')?'MISSING':(x.isPullRequest===true?'pr':(x.isPullRequest===false?'issue':'BAD')); const mg=!has.call(x,'mergedAt')?'MISSING':(x.mergedAt==null?'null':String(x.mergedAt)); let rv='MISSING'; if(has.call(x,'reviews')){ rv=!Array.isArray(x.reviews)?'BAD':('n'+x.reviews.length+':'+x.reviews.map(function(r: any){ try{ return String((r&&r.state)||'')+'@'+String((r&&r.reviewer&&r.reviewer.login)||'')+'@'+String((r&&r.submittedAt)||''); }catch(e){ return '?'; } }).sort().join(',').slice(0,200)); } return pr+'|'+mg+'|'+rv; }catch(e){ return 'ERR'; } }
export function snapshotVersionOf(snap: any): string{ try{ const all: string[]=[]; const lblOf=function(x: any): string{ try{ return (x.labels||[]).map(function(l: any){ return typeof l==='string'?l:(l.name||''); }).slice().sort().join(','); }catch(e){ return ''; } }; (snap.maps||[]).forEach(function(m: any){ const mapTitle=String(m.title||''); const mapLbl=lblOf(m); const mapUpd=String(m.updatedAt||''); (m.tickets||[]).forEach(function(t: any){ all.push(effortOf(t)+'#'+String(t.key||t.number)+':'+String(t.state||'')+':'+String(t.title||'')+':'+lblOf(t)+':'+String(t.updatedAt||'')+':'+String(t.progress||'')+':'+String(t.claimedBy||'')+':'+prSigOf(t)); }); // map 自身变化也计入版号（标题/标签/时间）
    all.push('map:'+effortOf(m)+'#'+String(m.key||m.number)+':'+String(m.state||'')+':'+mapTitle+':'+mapLbl+':'+mapUpd); }); (snap.issues||[]).forEach(function(it: any){ all.push(effortOf(it)+'#'+String(it.key||it.number)+':'+String(it.state||'')+':'+String(it.title||'')+':'+lblOf(it)+':'+String(it.updatedAt||'')+':'+prSigOf(it)); }); const _dc=(snap.deck&&snap.deck.counts)||null; all.push('deck:'+(_dc?(_dc.open+','+_dc.closed+','+_dc.total):'none')+':'+((snap.deck&&snap.deck.partial===true)?'1':'0')); all.sort(); const str=all.join('|'); try{ const cr=require('crypto'); if(cr&&cr.createHash) return cr.createHash('sha1').update(str).digest('hex').slice(0,12);}catch(e){} let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0; return (h>>>0).toString(16).padStart(8,'0'); }catch(e){ return '0'; }}
