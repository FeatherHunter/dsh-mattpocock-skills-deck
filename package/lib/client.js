/**
 * dsh-mattpocock-skills-deck 路 Client 鍗婏紙UX v25 路 2026-08-14 T2a 閰嶇疆椤甸鏋讹級
 *
 * v26 鍙樻洿锛?373 鐢ㄦ埛鎷嶆澘 2026-08-14锛夛細
 *   鎵撳紑褰㈠紡鏀舵暃涓恒€屼粎鍙充晶 details 鍒椼€嶁€斺€旂Щ闄?Document PiP 鐙珛灏忕獥锛圗lectron 涓嶅彲鐢ㄣ€?
 *   鏇捐嚧妗岄潰鍗℃锛夈€佸仠闈?鎮诞鍙屾ā寮忚蹇嗭紙PANEL_MODE_KEY锛夈€佺姸鎬佹爮銆屽仠闈犮€峴eg銆佸彸鏍忋€屾偓娴€嶆寜閽紱
 *   鐘舵€佹爮鑳跺泭鍏佽鎹㈣锛堢獎鏍忎笉鍐嶆埅鏂級銆?
 *
 * v25 鍙樻洿锛坢ap #364锛夛細
 *   T2a锛氶厤缃〉楠ㄦ灦锛坰ettings.plugins.tab銆學aystation銆? 鎸佷箙鍖?+ 骞挎挱锛夛紱
 *   T2b锛氬姩浣滄ā鏉跨紪杈戝櫒 + 鍗犱綅绗︿繚鎶わ紱
 *   T3锛?366锛夛細dsws locale 鍛藉悕绌洪棿 zh/en 瀛楀吀锛屽叏鎺т欢鏂囧瓧鍙岃璺熼殢 harness 璇█锛圙itHub 鏁版嵁涓嶇炕璇戯級銆?
 *
 * v25 鍙樻洿锛坢ap #364 路 T2a锛夛細
 *   50. 閰嶇疆椤甸鏋讹細settings.plugins.tab銆學aystation銆嶆敞鍐岋紙璁剧疆 鈫?鎻掍欢鍙锛夛紱
 *       涓夌粍鏃㈡湁閰嶇疆杩佸叆锛堥潰鏉块粯璁ら珮搴︿笁妗?/ 寮€濮嬫ā鏉?/ 澶栬锛夛紱
 *       閰嶇疆鎸佷箙鍖?dsws.cfg + dsws.templates锛堟棫 dsws.startCfg 鑷姩杩佺Щ锛夛紱
 *       淇濆瓨鍚庡箍鎾悓姝ユ墍鏈変細璇?store锛堜慨澶嶅瑙?灏哄涓嶆寔涔呭寲闅愭€?bug锛夛紱
 *       闈㈡澘鍐?StartCfgModal 绉婚櫎锛孯un 鍗′繚鐣欍€屾墦寮€閰嶇疆銆嶅紩瀵兼寜閽€?
 *
 * v24 鍙樻洿锛堢敤鎴峰弽棣堬級锛?
 *   48. 浜ゆ帴绗簩鍑绘枃浠跺悕淇锛氳蹇嗙涓€鍑绘ā鏉跨殑鏃堕棿鎴筹紝绗簩鍑昏鍚屼竴涓枃浠?
 *       锛堟ā鏉垮啓浠€涔堝悕灏辫浠€涔堝悕锛涗笉鍐嶅洜鐩綍鏃犳枃妗ｈ€屽厹搴曟棫 latest.md锛涙湭鐐圭涓€鍑绘墠鍥為€€鏌ユ渶鏂帮級
 *   49. 闈㈡澘榛樿楂樺害 1/4 鈫?1/2锛堢敤鎴峰弽棣?1/4 澶皬锛?
 *
 * v23锛氶潰鏉块粯璁ら珮搴?= 灞忓箷绾?1/4銆?
 * v22锛氬紩瀵煎彞銆屼粠绗竴鎬у師鐞嗗嚭鍙戝畬鎴愪换鍔★紝骞跺鎶楀紡瀹℃煡銆傘€嶏紱浜ゆ帴绗竴鍑绘仮澶嶆敞鍏ユ椂闂存埑妯℃澘锛?
 * 绗簩鍑婚濉紭鍖?澶嶅埗銆?
 * v21锛氬姩浣滄寜閽?prompt 绮剧畝 + 缁熶竴寮曞鍙ャ€?
 * v20锛氭爣绛俱€?N銆嶇偣鍑诲睍寮€鍏ㄩ儴鏍囩/鏀惰捣銆?
 * v19锛歡rilling鈫掕璁?/ 澶撮儴 repo 鍚?/ 鐜娈垫湯灏?/ map 璇︽儏鎵ц+浠诲姟鍔ㄤ綔 / map 琛岃繘搴?/
 * 浜ゆ帴鏃堕棿鎴?鏌ユ渶鏂?澶嶅埗銆?
 * v18锛氬彲鎺?鍗犵敤鍒楄〃鍙ｅ緞 / 鎸夐挳鍘诲紑濮嬶紙璇婃柇/鎵ц/淇锛? 鐐瑰嚮棰勫～杈撳叆妗嗐€?
 * v17锛歩sLight 鏀?YIQ 鎰熺煡浜害銆倂16锛氭寜閽壊 = label 閰嶇疆鑹层€?
 * v15锛氱姸鎬佹爮闃叉崲琛岃嚜閫傚簲 / map 缃《 / 琚樆濉炴爣绛?/ 浼氳瘽 cwd 鏀?SessionSummary.cwd銆?
 * v14锛氬叏閮ㄦ墽琛屾壒娆★紙涓夐€変竴鍔ㄤ綔 / map 琛岀獊鍑?/ 宸插叧闂姌鍙?/ chips 娣辫竟妗?/ 绐勫睆鎶樺彔 /
 * 鍒锋柊閬僵 / 涓婚瀹夊叏鑹?/ 浜ゆ帴鎸夐挳 / 鐘舵€佹爮绛夊 / 鎸変細璇?store锛夈€?
 * v13锛歝wd 鏉冨▉鍙嶆煡锛坵f.cwd锛? sessionId 鍙樺寲閲嶆帰娴嬨€倂12锛歳epoKey 鎸?cwd 缂撳瓨 /
 * 澶辫触涓嶅厹鍋囨暟鎹?/ 涓夎鍥炬敹鏁?/ 娌夋穩=娉ㄥ叆蹇収妯℃澘銆?
 * v11锛歭abel 棰滆壊 = GitHub 閰嶇疆鑹层€倂10锛歝wd 鍏宠仈 / 鏍囩瑙嗗浘 / 鍦嗗舰鎶€鑳界幆銆?
 * v9锛欴ESIGN.md 搂12.2 Round 3 瀹氱 1A-7A 钀藉疄銆?
 *
 * 鏈枃浠跺唴瀹?= cordis_define 鐨?code.client锛堢函 JS 鍑芥暟浣擄紝杩斿洖 Cordis Plugin锛夈€?
 */
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const timer = ctx.get('timer')
    const h = React.createElement
    // issue #3锛氭诞灞傛寕椤跺眰 鈥斺€?createPortal 鍒?document.body锛岃 position:fixed 鐨勮鍙ｅ潗鏍囦笌
    //   z-index 鐪熸鍏ㄥ眬鐢熸晥銆傚涓昏緭鍏ュ尯绁栧厛鑻ュ甫 transform / filter / backdrop-filter /
    //   will-change / contain锛宖ixed 鐨勫寘鍚潡浼氶檷绾т负璇ョ鍏堬紙鍧愭爣鍋忕Щ + 琚?overflow 瑁佸壀锛夛紝
    //   杩欐鏄妧鑳?tooltip 琚伄鎸?鎴柇鐨勬牴鍥犮€傚彇涓嶅埌 react-dom 鏃堕€€鍖栦负鍘熷湴娓叉煋锛堜笉鍔ｄ簬鐜扮姸锛夈€?
    const RDOM = (function () {
      try { if (typeof ReactDOM !== 'undefined' && ReactDOM && ReactDOM.createPortal) return ReactDOM } catch (e) { /* noop */ }
      try { if (typeof window !== 'undefined' && window.ReactDOM && window.ReactDOM.createPortal) return window.ReactDOM } catch (e) { /* noop */ }
      try { if (typeof require === 'function') { const m = require('react-dom'); if (m && m.createPortal) return m } } catch (e) { /* noop */ }
      return null
    })()
    const portalTop = function (node) {
      if (RDOM && typeof document !== 'undefined' && document.body) return RDOM.createPortal(node, document.body)
      return node
    }
    // v1.3.3锛氶潰鏉跨増鏈彿锛坱abs 琛屾渶鍙充晶鏄剧ず锛屼究浜庢牳瀵瑰凡鏇存柊锛?
    // issue #22锛氫氦浜掑脊灞傜粺涓€鎸傚埌 body锛岄伩鍏嶈鐘舵€佹爮甯冨眬 wrapper 瑁佸壀銆?
    const PortalOverlay = function (props, children) {
      return portalTop(h('div', props || {}, children))
    }
    const DSW_VERSION = 'v1.6.18'

    // ============================================================
    // 0. 鏍峰紡
    // ============================================================
    styles.insert([
      '.dsws-panel{position:fixed;left:16px;top:76px;width:460px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.45);z-index:9999;font-family:var(--dsw-font-family);font-size:13px;color:var(--dsw-alias-label-primary,#e6edf3);line-height:1.6;overflow:hidden}',
      '.dsws-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2d35);cursor:move;user-select:none}',
      '.dsws-tabs{display:flex;flex-wrap:nowrap;gap:4px;padding:8px 12px 0;overflow:hidden;white-space:nowrap}',
      '.dsws-tab{padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;white-space:nowrap;flex:none;line-height:1.5}',
      '.dsws-tab.on{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // v0.3 娓愯繘寮忔姌鍙狅細鎸夐挳鎸?data-priority 閫愪釜鎶樺彔锛坧riority 灏?閲嶈=鏅氭姌鍙狅級锛宮ax-width 鍔ㄧ敾骞虫粦杩囨浮
      '.dsws-tabs .dsws-tab > span:last-child,.dsws-tabs .dsws-btn > span:last-child{max-width:120px;overflow:hidden;white-space:nowrap;transition:max-width .25s ease,opacity .2s ease,margin .25s ease}',
      '.dsws-tabs .dsws-tab.collapsed > span:last-child,.dsws-tabs .dsws-btn.collapsed > span:last-child{max-width:0;opacity:0;margin-left:-4px;margin-right:-4px}',
      '.dsws-tabs > span:last-child{transition:max-width .25s ease,opacity .2s ease;overflow:hidden;white-space:nowrap}',
      '.dsws-tabs .dsws-tab.collapsed,.dsws-tabs .dsws-btn.collapsed{padding-left:6px;padding-right:6px;transition:padding .25s ease}',
      '.dsws-tabs.dsws-no-anim *,.dsws-tabs.dsws-no-anim{transition:none!important}',
      '.dsws-body{flex:1;overflow-y:auto;padding:10px 12px}',
      '.dsws-rz{position:absolute;z-index:6}',
      '.dsws-rz-n{top:0;left:8px;right:8px;height:5px;cursor:ns-resize}',
      '.dsws-rz-s{bottom:0;left:8px;right:8px;height:5px;cursor:ns-resize}',
      '.dsws-rz-e{right:0;top:8px;bottom:8px;width:5px;cursor:ew-resize}',
      '.dsws-rz-w{left:0;top:8px;bottom:8px;width:5px;cursor:ew-resize}',
      '.dsws-rz-ne{top:0;right:0;width:10px;height:10px;cursor:nesw-resize}',
      '.dsws-rz-nw{top:0;left:0;width:10px;height:10px;cursor:nwse-resize}',
      '.dsws-rz-se{bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-label-caption,#8b8b95) 50%);opacity:.5;border-radius:0 0 12px 0}',
      '.dsws-rz-se:hover{opacity:1}',
      '.dsws-rz-sw{bottom:0;left:0;width:10px;height:10px;cursor:nesw-resize}',
      '.dsws-maprow{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;padding:9px 12px;margin-bottom:8px;cursor:pointer;background:var(--dsw-alias-bg-layer-1,#10131a)}',
      '.dsws-maprow:hover{border-color:var(--dsw-alias-border-l2,#3a3f4a)}',
      '.dsws-mtitle{font-weight:600;font-size:13px}',
      '.dsws-prog{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3,#0c0e12);overflow:hidden;margin-top:4px}',
      '.dsws-prog>i{display:block;height:100%;background:var(--dsw-alias-state-success-primary,#4ade80);border-radius:2px}',
      '.dsws-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 8px;border-radius:99px;font-size:11px;line-height:1.7;margin-right:4px;white-space:nowrap}',
      '.dsws-chip-r{background:rgba(88,166,255,.18);color:#58a6ff}',
      '.dsws-chip-p{background:rgba(247,120,186,.16);color:#f778ba}',
      '.dsws-chip-g{background:rgba(63,185,80,.16);color:#3fb950}',
      '.dsws-chip-t{background:rgba(240,136,62,.16);color:#f0883e}',
      '.dsws-chip-m{background:rgba(188,140,255,.16);color:#bc8cff}',
      '.dsws-trow{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:6px;border:1px solid transparent}',
      '.dsws-trow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      '.dsws-trow .dsws-tt{flex:1;min-width:0}',
      // v27锛?396锛夛細鏍囬娓叉煋绛栫暐銆?
      // 鍘嗗彶锛歸ord-break:break-all + 瀛?span 鐨?.dsws-ellip{white-space:nowrap} 瀵艰嚧闀挎爣棰樿闈欓粯鐪佺暐鍙锋埅鏂€?
      // 鐜板湪锛氱埗 .dsws-tt-name 涓嶅啀寮哄埗 break-all锛涙爣棰?span 鐢?.dsws-tt-wrap锛堟浛鎹?.dsws-ellip锛夛紝
      //   鍏佽鎸夌┖鏍?涓枃鏍囩偣鎹㈣锛沨over 閫氳繃鐜版湁 title=... 鍏滃簳鏄剧ず瀹屾暣鏂囨湰銆?
      '.dsws-tt-name{font-size:12.5px;display:flex;align-items:center;gap:5px}',
      '.dsws-tt-wrap{min-width:0;overflow-wrap:break-word;word-break:normal;line-break:auto;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dsws-tt-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-btn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);background:var(--dsw-alias-bg-layer-1,#10131a);color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;cursor:pointer}',
      '.dsws-btn:hover{border-color:var(--dsw-alias-border-l2,#3a3f4a)}',
      // v14-5锛氫富鑹叉寜閽浐瀹氫富棰樺畨鍏ㄨ壊锛堜笉鍐嶄緷璧?alias 鍙橀噺锛屽綋鍓嶄富棰樹笅浼氳В鏋愭垚娣辫壊瀵艰嚧榛戝簳榛戝瓧锛?
      '.dsws-btn.primary{background:#c084fc;border-color:transparent;color:#140a1e;font-weight:600}',
      '.dsws-btn.primary:hover{border-color:rgba(20,10,30,.55)}',
      // v1.3.3锛氱獎灞忓彧鍓╁浘鏍囨椂淇濇寔鎸夐挳楂樺害銆佺敾鎴愭鏂瑰舰锛堥珮=瀹?鎸夐挳楂橈級锛屽浘鏍囧眳涓?
      '.dsws-btn.narrow-icon{width:20px;height:20px;padding:0;justify-content:center;align-items:center;gap:0}',
      '.dsws-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-grp{margin:12px 0 4px;font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);display:flex;align-items:center;gap:6px}',
      '.dsws-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}',
      '.dsws-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000}',
      '.dsws-modalbox{width:460px;max-width:94vw;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;padding:14px 16px;font-family:var(--dsw-font-family);font-size:13px;color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-ta{width:100%;min-height:90px;background:var(--dsw-alias-bg-layer-1,#10131a);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:6px;color:var(--dsw-alias-label-primary,#e6edf3);font-family:var(--ds-font-family-code,monospace);font-size:12px;padding:8px;box-sizing:border-box}',
      '.dsws-note{position:absolute;left:14px;bottom:14px;top:auto;right:auto;padding:6px 12px;border-radius:6px;background:var(--dsw-alias-toast-bg,#22252c);border:1px solid var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.4)}',
      '.dsws-skill{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px}',
      '.dsws-skill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}',
      '.dsws-skill .dsws-tt{flex:1;min-width:0}',
      // 闇€姹?锛?026-08-18锛夛細鎶€鑳芥诞灞備富棰樺寲婊氬姩鏉?
      '.dsws-skillpop{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#3a3f4a) transparent}',
      '.dsws-skillpop::-webkit-scrollbar{width:8px}',
      '.dsws-skillpop::-webkit-scrollbar-track{background:transparent}',
      '.dsws-skillpop::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#3a3f4a);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
      '.dsws-skillpop::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-caption,#8b8b95);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
      '.dsws-seg{cursor:pointer;padding:2px 7px;border-radius:99px;border:1px solid transparent;display:inline-flex;align-items:center;gap:4px}',
      '.dsws-seg:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // 闇€姹?路浜岄樁娈?rev锛?026-08-18锛夛細浜ゆ帴鍒嗗壊鎸夐挳 鈥斺€?澶栨杈规/缁嗗垎闅旂嚎 hover 鏃舵墠鏄剧ず锛堜笌 seg 甯搁┗閫忔槑涓€鑷达級锛涘乏鍙冲崐鍚勮嚜鐐瑰嚮鍖?+ hover 娌跨敤 seg 鑳屾櫙
      '.dsws-split{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:99px;flex:none;overflow:hidden}',
      '.dsws-split:hover{border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      '.dsws-split .dsws-split-part{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;cursor:pointer}',
      '.dsws-split .dsws-split-part:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsws-split .dsws-split-div{width:1px;height:14px;background:var(--dsw-alias-border-l1,#2a2d35);flex:none;opacity:0;transition:opacity .12s}',
      '.dsws-split:hover .dsws-split-div{opacity:1}',
      '.dsws-timebtn{cursor:pointer;padding:2px 7px;border-radius:99px;border:1px dashed transparent;color:var(--dsw-alias-label-caption,#8b8b95);white-space:nowrap;font-variant-numeric:tabular-nums;flex:none}',
      '.dsws-timebtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));border-color:var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-uirow{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap}',
      '.dsws-uirow .dsws-btn.on{border-color:var(--dsw-alias-state-success-primary,#4ade80);color:var(--dsw-alias-state-success-primary,#4ade80)}',
      // v14-22锛氭暟瀛楀尯鍥哄畾涓や綅鏁扮瓑瀹斤紙98/99 5 瀛楃锛?-/8 绛夊锛涙湭鏉?9/10 涓嶅彉瀹斤級
      '.dsws-num{display:inline-block;min-width:5ch;text-align:center;font-variant-numeric:tabular-nums;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:11px;line-height:1.5;white-space:nowrap}',
      // v15-24锛氳兌鍥婂搴﹂€傞厤鍐呭锛坒it-content 涓嶅帇缂╀笉鎹㈣锛涗笂闄愭斁瀹斤級
      // #372 淇锛?026-08-14 鑻辨枃鎬佹孩鍑猴級锛氬師涓婇檺 min(92vw,640px) 鍦ㄨ嫳鏂囬暱鏂囨锛堝銆孒andoff 路 new session銆嶏級涓嬭Е椤讹紝
      //   鍐呭浠庤儗鏅彸缂樻孩鍑恒€傛斁瀹藉埌 min(96vw,1400px)锛歸idth:fit-content + margin:0 auto 鈫?鑳跺泭濮嬬粓
      //   浠ョ姸鎬佹爮涓績涓鸿酱鍚戜袱杈圭敓闀匡紙鑳屾櫙瀹屾暣鍖呰９鍐呭锛夛紝涓嶅啀鎴柇/婧㈠嚭銆?
      // #16 淇锛?026-08-18 绐勫睆鎹㈣锛夛細v15 淇簡 white-space:nowrap + flex:none + width:fit-content 浣嗘紡鏀?flex-wrap:wrap锛?
      //   绐楀彛 < 920px 鏃惰兌鍥婅嚜鐒跺 > 96vw 鈫?children 琚己琛屾崲琛屾垚涓?涓夎锛岀牬鍧忓崟琛屽眳涓鎰熴€?
      //   鏀逛负 flex-wrap:nowrap + white-space:nowrap 鍏滃簳锛涜兌鍥婂缁堝崟琛屻€?
      //   閰嶅悎涓嬫柟 5 绾?[data-narrow] 灞炴€ч€夋嫨鍣細JSX 鍦?renderStatusBar 鍐?data-narrow={dn||null}锛?
      //   鎸夎鍙ｅ閫愮骇闅愯棌 children 鏂囧瓧 span锛屼繚鐣欏浘鏍?鏁板瓧锛沜hildren 鍏ㄩ儴 flex:none + nowrap 绂佹鎹㈣銆?
      // #16 鐢ㄦ埛楠屾敹鍙嶉锛?026-08-18 R2锛夛細鑳跺泭瀹藉簲璺熼殢杈撳叆鍖哄乏鍙宠竟锛堜笉鍐嶆槸鎸夎鍙?96vw 鎾戯級鈥斺€?
      //   max-width 鏀规垚 max-width:100% 璁╁灞傝緭鍏ュ尯瀹瑰櫒鑳藉皝椤讹紱淇濈暀 max-width:1400px 闃茶秴瀹藉睆婧㈠嚭锛?
      //   鍘绘帀 margin:0 auto锛堝灞?wrapper 璐熻矗灞呬腑锛夈€?
      // #16 v1.6.3 璋冭瘯閽╁瓙锛堜粎 v1.6.3 涓存椂寮€鍚紝涓嬩釜鐗堟湰绉婚櫎锛夛細
      //   缁?.dsws-capsule 鍔?border:2px dashed magenta + 澶栧眰 wrapper background:rgba(255,0,255,.08)锛?
      //   璁╃敤鎴疯兘鐩存帴鐪嬪埌銆岃兌鍥婃湰韬€嶅拰銆屽灞?wrapper銆嶇殑瀹為檯杈圭晫锛岀‘璁ゆ槸鍝竴灞傛病缂╁埌銆?
      //   鎺掓煡 R2 鍙嶉銆岀湅涓嶅埌鍙樺寲銆嶇敤锛?-2 涓?issue 鍛ㄦ湡鍐呮媶鎺夈€?
      // #16 v1.6.7 R7 淇锛堢敤鎴烽獙鏀跺弽棣?2026-08-18锛夛細magenta 妗嗚繙灏忎簬 cyan 妗嗭紝宸﹀彸娌¤窡杈撳叆鍖哄榻愩€?
      //   涔嬪墠 capsule width:fit-content 鈫?榛樿鎸夊唴瀹硅嚜鐒跺锛堢害 700px锛夛紝灏忎簬 wrapper 1300px锛屽眳涓悗宸﹀彸鍚?00px绌虹櫧銆?
      //   鏀逛负鏉′欢寮忓搴︼細dn=0 (瀹借鍙? 鈫?width:100% 鎾戞弧 wrapper锛屽乏鍙宠竟 = 杈撳叆鍖鸿竟锛?
      //                  dn>=1 鈫?width:fit-content 鑷劧瀹藉眳涓紙鐢ㄦ埛涔嬪墠宸叉帴鍙椼€宒n=4 鏃?capsule 涓嶅啀缂┿€嶆柟妗?B锛夈€?
      //   max-width:min(100%,1400px) 浠嶄繚鐣欙紙闃茶秴瀹藉睆婧㈠嚭锛夈€?
      // #16 R10锛堢敤鎴烽獙鏀跺弽棣?2026-08-18 R9 鍚庯級锛歝apsule 鍐呭瀹?= textarea 瀹斤紙iw px锛夛紝浣?capsule 鑷甫
      //   padding:3px 6px + border:1px锛圕SS 榛樿 content-box锛夆啋 capsule border-box 澶栨 = iw + 9 + 2 = iw + 11锛?
      //   姣?textarea 澶栨锛坕w锛夊 11px锛堝乏鍙冲悇 5.5px锛夈€傛敼涓?box-sizing:border-box锛岃 capsule border-box = textarea 澶栨銆?
      // #16 R11锛堢敤鎴烽獙鏀跺弽棣?2026-08-18 R10 鍚庯級锛歝apsule 鍥哄畾瀹?= iw 鈫?children 灞呬腑鍚庡乏鍙崇┖鐧介殢 children 缂╁皬鑰屽彉澶с€?
      //   鏀逛负 CSS width:fit-content锛堥粯璁?children 鑷劧瀹斤級锛沬nline maxWidth:iw 闃叉 capsule 姣旇緭鍏ユ瀹斤紙pixel 瀵归綈 R10 淇濈暀锛夈€?
      '.dsws-capsule{max-width:min(100%,1400px);width:100%;box-sizing:border-box;display:flex;flex-wrap:nowrap;white-space:nowrap;justify-content:center;align-items:center;gap:2px 6px;background:var(--dsw-alias-bg-layer-1,#10131a);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:14px;padding:3px 6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);cursor:pointer;user-select:none}',
      // dn>=1 鏃?capsule 鍙?fit-content 鑷劧瀹藉眳涓紙鐢ㄦ埛 B 鏂规锛歞n=4 鍚?capsule 涓嶅啀缂╋級
      '',
      // 澶栧眰 wrapper 璋冭瘯閽╁瓙瑙?StatusBar render 澶?inline style 娉ㄩ噴
      '.dsws-capsule .dsws-capsule-word{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:99px;font-weight:600;color:var(--dsw-alias-label-primary,#e6edf3);flex:none}',
      '.dsws-capsule .dsws-capsule-word:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsws-capsule .dsws-seg{flex:none}',
      '.dsws-capsule .dsws-timebtn{flex:none}',
      // #16 V2锛?026-08-18 澶嶇幇鍚庨噸璁捐锛夛細5 绾?[data-narrow-N] 闃堝€间綋绯绘湁缁撴瀯鎬?bug鈥斺€?
      //   dn 淇″彿婧?R5 璧锋敼涓鸿緭鍏ュ尯锛坵rapper锛夊锛岄粯璁?1280 瑙嗗彛涓嬭緭鍏ュ尯浠?812px 鈫?dn=0 姘镐笉鍑虹幇锛?
      //   瀹藉睆榛樿缂哄搧鐗屽瓧锛涗笖 .dsws-seg.note 閫夋嫨鍣ㄥ紩鐢ㄤ笉瀛樺湪鐨?class锛坰eg() 棣栧弬鏄浘鏍囧悕涓嶆槸 class锛夛紝
      //   銆屾棤鏁板瓧娈点€嶇骇浠庢湭鐢熸晥銆傛敼涓哄唴瀹硅嚜閫傚簲娓愯繘鏀剁缉锛堜豢 #15锛夛細
      //   姣忎釜鍙敹缂╂枃瀛?span 鎵?data-fold-priority锛?=鏈€鍏堟敹鈥?=鏈€鍚庢敹锛夛紝applyFold 鍦?
      //   鍏ㄥ睍寮€鍩虹涓婃寜 priority 鍗囧簭閫愪釜鍔?.dsws-folded锛岀洿鍒?scrollWidth 鈮?clientWidth銆?
      //   浼樺厛绾?= 淇℃伅浠峰€硷細鍝佺墝(1) 鈫?娌夋穩(2)/浜ゆ帴(3)/鍒锋柊瀛?4) 鈫?鍙帴(5)/BUG(6)/璇婃柇(7)/鐜(8) 鈫?鏃堕棿(9)銆?
      //   鍥炬爣+鏁板瓧姘镐笉鏀剁缉锛涙渶绐勬€?= 鍥炬爣+鏁板瓧绱у噾鏉★紙wrapper overflow:hidden 鎴彸缂橈紝绂佹鎹㈣锛夈€?
      '.dsws-capsule [data-fold-priority].dsws-folded{display:none}',
      '.dsws-banner{display:flex;align-items:center;gap:8px;border-radius:8px;padding:6px 10px;font-size:12px;margin:6px 0;cursor:pointer}',
      '.dsws-banner.bad{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.45);color:#f87171}',
      '.dsws-banner.warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);color:#fbbf24}',
      '.dsws-banner.ok{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.35);color:#4ade80}',
      // v1.3.3 UI 淇锛歛ggrow 鐜板惈涓よ瀛愬潡锛堣1 idcol+鏍囬+鍦嗙幆 / 琛? 鏍囩+鎸夐挳锛夛紝蹇呴』绾靛悜鍫嗗彔
      // v1.3.3锛氬乏渚ч鐣欑┖鐧藉噺 20%锛?px 鈫?6.4px锛宮ap 琛?鏅€氳涓€鑷存洿绱у噾锛?
      '.dsws-aggrow{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:6px 6.4px;border-radius:6px;border:1px solid transparent}',
      '.dsws-aggrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // v1.3.3 UI锛氳緟鍔╂寜閽紙澶嶅埗/澶栭摼锛夊父鏄撅紙鐢ㄦ埛瑕佹眰涓€鐩存樉绀猴紝涓?hover锛?
      '.dsws-aggrow .dsws-aux{display:inline-flex;align-items:center;gap:2px;flex:none}',
      // v1.3.3 UI锛氳2 鏍囩璐績鎶樺彔锛堝崟琛屼笉鎹㈣锛屽澶氱獎灏戯紝+N 寮圭獥灞曞紑锛?
      '.dsws-tags{display:flex;align-items:center;gap:3px;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap}',
      '.dsws-tags .dsws-chip{flex:none}',
      // v1.3.3锛?N 灞曞紑绗﹀彿鏁翠綋缂╁皬 20%锛坧adding 8鈫?px 路 font 11鈫?px 路 line-height 1.7鈫?.8锛?
      '.dsws-more{background:rgba(188,140,255,.1);color:#bc8cff;border:1px dashed rgba(188,140,255,.55);cursor:pointer;flex:none;transition:background .12s,border-color .12s;padding:0 6px;font-size:9px;line-height:1.8}',
      '.dsws-more:hover{background:rgba(188,140,255,.22);border-color:rgba(188,140,255,.8)}',
      // v1.3.3 UI锛氳1 缂栧彿 + map 寰界珷绔栨帓锛堟爣棰樿幏寰楁洿瀹藉睍绀哄尯锛?
      '.dsws-idcol{display:flex;flex-direction:column;align-items:flex-start;gap:3px;flex:none}',
      '.dsws-idnum{display:inline-block;font-family:Consolas,Menlo,monospace;font-weight:700;font-size:11px;line-height:1.4;padding:2px 7px;border-radius:6px;border:1px solid;font-variant-numeric:tabular-nums}',
      // v1.3.3 UI锛歮ap 琛岃糠浣犲渾鐜繘搴︼紙鏇夸唬闀挎潯 + 鉁擄級
      // v1.3.3 瀵归綈淇锛氬渾鐜笌鏁板瓧闆堕棿闅欙紙gap 0 + 鏂囨湰宸﹀榻愮揣璐达級锛?
      //   鏂囨湰鍥哄畾鏈€灏忓搴︼紙5 瀛楃瀹?26/27锛夆啋 鍚勮鍙崇紭瀵归綈锛?
      //   v1.3.3 寰皟锛歮in-width 38 鈫?35px锛?6/27 鍙充晶绌洪殭鍑忓崐锛?
      '.dsws-ring{flex:none;display:inline-flex;align-items:center;gap:0}',
      '.dsws-ring svg{transform:rotate(-90deg)}',
      '.dsws-ring-txt{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.5;flex:none;letter-spacing:.2px;min-width:35px;text-align:left}',
      // v1.3.3 UI锛?N 寮圭獥锛坒ixed 瀹氫綅锛岃嚜閫傚簲闈㈡澘宸﹀彸杈圭晫锛?
      '.dsws-pop{position:fixed;z-index:1000;background:#1c1f26;border:1px solid var(--dsw-alias-border-l2,#3a3f4a);border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.55);padding:10px 12px;display:none}',
      '.dsws-pop .caret{position:absolute;width:10px;height:10px;background:#1c1f26;border-left:1px solid var(--dsw-alias-border-l2,#3a3f4a);border-top:1px solid var(--dsw-alias-border-l2,#3a3f4a);transform:rotate(45deg)}',
      '.dsws-pop .pt{font-size:10px;color:var(--dsw-alias-label-caption,#8b8b95);letter-spacing:1px;margin-bottom:6px;text-transform:uppercase}',
      '.dsws-pop .pl{display:flex;flex-wrap:wrap;gap:4px}',
      '.dsws-pop .ptitle{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#2a2d35);padding-top:7px;line-height:1.55;overflow-wrap:break-word;word-break:break-word}',
      '.dsws-pop .ptitle b{color:var(--dsw-alias-label-primary,#e6edf3);font-weight:600}',
      // v1.4锛圱2 #443锛夛細Map 璇︽儏椤垫紡鏂楀垎灞傚舰鎬侊紙D1-D8 瑙勬牸锛?
      '.dsws-layers{display:flex;flex-direction:column;gap:4px;margin:10px 0;padding:8px 10px;border-radius:10px;background:linear-gradient(90deg,rgba(74,222,128,.05),rgba(255,255,255,.015));border:1px solid rgba(74,222,128,.2)}',
      '.dsws-layers .row1{display:flex;align-items:center;gap:8px}',
      '.dsws-layers .cap{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);letter-spacing:.5px;text-transform:uppercase;flex:none}',
      '.dsws-layers .segs{flex:1;display:flex;gap:3px;height:12px}',
      '.dsws-layers .seg{flex:1;border-radius:3px;position:relative;background:rgba(255,255,255,.06);border:1px dashed rgba(255,255,255,.14)}',
      '.dsws-layers .seg.past{background:linear-gradient(180deg,rgba(74,222,128,.7),rgba(74,222,128,.4));border:none}',
      '.dsws-layers .seg.past::after{content:"鉁?;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:7px;color:#04120a;font-weight:700}',
      '.dsws-layers .seg.curr{background:linear-gradient(180deg,#4ade80,#2dd45f);border:none;box-shadow:0 0 8px rgba(74,222,128,.5)}',
      '.dsws-layers .row2{display:flex;justify-content:space-between;font-size:8.5px;color:var(--dsw-alias-label-caption,#8b8b95);align-items:center}',
      '.dsws-layers .row2 .cur{color:#4ade80;font-weight:700;display:inline-flex;align-items:center;gap:4px}',
      '.dsws-start{display:flex;gap:8px;align-items:flex-start;margin:6px 0 2px}',
      '.dsws-start .cap{font-size:13px;font-weight:700;color:#fff;line-height:1.1}',
      '.dsws-start .desc{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);font-style:italic;line-height:1.3}',
      // T15锛氬眰瀹瑰櫒 + 鏄庢樉灞傚彿锛堝綋鍓嶅眰楂樹寒锛夛紱灞傚唴缃戞牸鑷€傚簲鍒楁暟锛涘崱鐗囬珮搴︽亽瀹?
      '.dsws-layerbox{border-radius:12px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.008));padding:8px 10px 10px;margin-top:6px}',
      '.dsws-layerbox.cur{border-color:rgba(74,222,128,.5);box-shadow:0 0 16px rgba(74,222,128,.14);background:linear-gradient(180deg,rgba(74,222,128,.05),rgba(255,255,255,.008))}',
      '.dsws-layerTag{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary,#e6edf3);letter-spacing:.5px;margin:0 0 8px}',
      '.dsws-layerTag .layerNo{width:22px;height:22px;flex:none;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);background:rgba(255,255,255,.08);border:1.5px solid var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-secondary,#a1a1aa);font-variant-numeric:tabular-nums}',
      '.dsws-layerbox.cur .dsws-layerNo{background:rgba(74,222,128,.16);border-color:rgba(74,222,128,.7);color:#4ade80}',
      '.dsws-layerTag .layerTitle{flex:none}',
      '.dsws-layerTag .sp{flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l1,#2a2d35),transparent)}',
      // T15锛氬眰鍐呯綉鏍?鈥斺€?瀹藉害鍙樺鑷姩澶氬垪锛坢inmax 190px 淇濊瘉鏈€绐?鈮? 鍒楋級锛涗笉鍐嶆í鍚戞粴鍔?
      '.dsws-layer{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;padding:0 0 2px}',
      // 绐勯潰鏉匡紙<380px锛夊垪瀹戒笅闄愰檷鍒?150px锛屼粛淇濊瘉 鈮? 鍒?
      '.dsws-narrow .dsws-layer{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}',
      // T15锛氬崱鐗囧搴﹂殢鍒椾几缂╋紙涓嶅啀鍥哄畾 200px锛夛紱鍐呴儴琛屽浐瀹氬崰浣嶄繚璇侀珮搴︽亽瀹?
      '.dsws-node{display:flex;flex-direction:column;gap:4px;border-radius:10px;padding:7px 8px;min-width:0;width:auto;position:relative;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1.5px solid var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-node .row1{display:flex;align-items:center;gap:6px}',
      '.dsws-node .icbox{width:22px;height:22px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;border:1.5px solid;background:rgba(0,0,0,.5);color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-node .meta{display:flex;align-items:center;gap:5px;margin-bottom:1px}',
      '.dsws-node .no{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);font-family:var(--ds-font-family-code,Consolas,Menlo,monospace)}',
      '.dsws-node .tag{font-size:8px;padding:0 4px;border-radius:3px;border:1px solid;opacity:.85;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace)}',
      '.dsws-node .tt{font-size:11px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;min-height:30.8px}',
      '.dsws-node .acts{display:flex;gap:4px;flex-wrap:wrap;align-items:center;min-height:24px}',
      '.dsws-node.done{opacity:.55}',
      '.dsws-node.now{border-color:rgba(74,222,128,.9);box-shadow:0 0 14px rgba(74,222,128,.3)}',
      '.dsws-node.wait{border-color:rgba(240,136,62,.5);border-style:dashed;opacity:.8}',
      '.dsws-node.fog{filter:blur(2.4px) brightness(.45);opacity:.6;cursor:pointer;border-color:rgba(192,132,252,.4)}',
      '.dsws-node.fog.revealed{filter:none;opacity:1;cursor:default}',
      '.dsws-node.fog .acts{pointer-events:none;filter:blur(1px)}',
      '.dsws-node.fog.revealed .acts{pointer-events:auto;filter:none}',
      '.dsws-node .qmark{position:absolute;right:7px;bottom:7px;width:12px;height:12px;color:rgba(192,132,252,.8);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
      '.dsws-gate{height:26px;display:flex;align-items:center;justify-content:center;position:relative}',
      '.dsws-gate::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.15),transparent)}',
      '.dsws-gate .g{width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#16181d);border:2px solid;display:flex;align-items:center;justify-content:center;z-index:1;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-gate .g.lock{border-color:rgba(240,136,62,.55);color:#f0883e}',
      '.dsws-gate .g.open{border-color:rgba(74,222,128,.75);color:#4ade80;box-shadow:0 0 8px rgba(74,222,128,.3)}',
      '.dsws-dest{position:relative;margin-top:14px;border-radius:14px;padding:14px 12px 12px;text-align:center;background:linear-gradient(180deg,rgba(192,132,252,.1),rgba(88,166,255,.03) 70%,transparent);border:1.5px solid rgba(192,132,252,.35)}',
      '.dsws-dest .ring{width:72px;height:72px;margin:0 auto;position:relative}',
      // v1.4 淇锛歳otate(-90deg) 鍙綔鐢ㄤ簬杩涘害鐜?svg锛堢洿鎺ュ瓙鍏冪礌锛夛紝涓嶆尝鍙?core 鏃楀笢锛堟棗甯滀繚鎸佺珫鐩达級
      '.dsws-dest .ring > svg{transform:rotate(-90deg)}',
      '.dsws-dest .ring .track{stroke:rgba(255,255,255,.07);fill:none;stroke-width:6}',
      '.dsws-dest .ring .prog{fill:none;stroke-width:6;stroke-linecap:round;stroke:rgba(192,132,252,.7)}',
      '.dsws-dest .core{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}',
      '.dsws-dest .core svg{width:22px;height:22px;fill:none;stroke:#c084fc;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
      '.dsws-dest .title{font-size:15px;font-weight:700;margin-top:4px;color:#e6edf3}',
      '.dsws-dest .acts{display:flex;justify-content:center;gap:8px;margin-top:8px}',
      '.dsws-ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsws-cgroup{margin:10px 0 2px;font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);display:flex;align-items:center;gap:6px}',
      '.dsws-ccard{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1,#10131a)}',
      '.dsws-ccard .nm{font-size:12.5px;font-weight:600}',
      '.dsws-ccard .dt{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-ccard .act{margin-top:5px;display:flex;gap:6px}',
      // v1.5 T10 R7锛氬埛鏂伴伄缃╁凡搴熼櫎锛堟墜鍔ㄥ埛鏂拌蛋闈欓粯璺緞锛夛紱spinner 浠呴寮€ loading 鐢?
      '.dsws-spinner{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#c084fc;animation:dsws-spin .8s linear infinite;flex:none}',
      '@keyframes dsws-spin{to{transform:rotate(360deg)}}',
      // v1.5 T10锛氬埛鏂板叆鍙ｆ寜閽唴鑱旇浆鍦堬紙闈為樆濉炲弽棣?路 R7 鍙嶉鍗婏級+ R5 鍙樺寲琛岄珮浜紙鍙樻洿鐞ョ弨娓愰殣 / 鏂板缁块棯锛?
      '.dsws-spin{display:inline-flex;animation:dsws-spin .8s linear infinite}',
      '@keyframes dsws-flash-amber{0%{background-color:rgba(251,191,36,.20)}100%{background-color:transparent}}',
      '@keyframes dsws-flash-green{0%{background-color:rgba(74,222,128,.20)}100%{background-color:transparent}}',
      '.dsws-row-changed{animation:dsws-flash-amber 2.4s ease-out 1}',
      '.dsws-row-added{animation:dsws-flash-green 2.4s ease-out 1}',
      // v25 路 T2b锛氶厤缃〉锛坰ettings.plugins.tab锛変笓鐢ㄦ牱寮?
      '.dsws-cfg{max-width:720px;display:flex;flex-direction:column;gap:12px;padding:2px 2px 4px}',
      '.dsws-cfg-head{display:flex;align-items:center;gap:10px}',
      '.dsws-cfg-head .t{font-size:15px;font-weight:700;letter-spacing:.2px}',
      '.dsws-cfg-head .s{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:12px}',
      '.dsws-cfg-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);line-height:1.7}',
      '.dsws-cfg-group{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#10131a);padding:10px 14px}',
      '.dsws-cfg-gtitle{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:650;margin-bottom:4px}',
      '.dsws-cfg-gdesc{font-size:11.5px;color:var(--dsw-alias-label-caption,#8b8b95);margin-bottom:10px;line-height:1.65}',
      '.dsws-cfg-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}',
      '.dsws-cfg-label{font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);flex:none}',
      '.dsws-cfg-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#16181d);padding:3px;gap:2px}',
      '.dsws-cfg-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;padding:4px 14px;border-radius:6px;cursor:pointer;font-family:var(--dsw-font-family)}',
      '.dsws-cfg-seg button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsws-cfg-seg button.on{background:#c084fc;color:#140a1e;font-weight:600}',
      '.dsws-cfg-sw{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12px}',
      '.dsws-cfg-sw input{display:none}',
      '.dsws-cfg-sw .tr{width:34px;height:19px;border-radius:99px;background:var(--dsw-alias-bg-layer-3,#0c0e12);border:1px solid var(--dsw-alias-border-l1,#2a2d35);position:relative;flex:none;transition:background .15s,border-color .15s}',
      '.dsws-cfg-sw .tr::after{content:"";position:absolute;left:2px;top:2px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-label-caption,#8b8b95);transition:transform .15s,background .15s}',
      '.dsws-cfg-sw input:checked + .tr{background:rgba(192,132,252,.22);border-color:rgba(192,132,252,.55)}',
      '.dsws-cfg-sw input:checked + .tr::after{transform:translateX(15px);background:#c084fc}',
      '.dsws-cfg-ta{width:100%;min-height:56px;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;color:var(--dsw-alias-label-primary,#e6edf3);font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:11.5px;line-height:1.6;padding:7px 9px;box-sizing:border-box;resize:none;overflow:hidden}',
      '.dsws-cfg-ta:focus{outline:none;border-color:rgba(192,132,252,.6)}',
      '.dsws-cfg-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0}',
      '.dsws-cfg-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:99px;font-size:11px;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);cursor:pointer;background:rgba(188,140,255,.14);color:#bc8cff;border:1px solid rgba(188,140,255,.35);transition:background .12s}',
      '.dsws-cfg-chip:hover{background:rgba(188,140,255,.26)}',
      '.dsws-cfg-chip.req{background:rgba(248,113,113,.14);color:#f87171;border-color:rgba(248,113,113,.45)}',
      '.dsws-cfg-chip.req:hover{background:rgba(248,113,113,.26)}',
      '.dsws-cfg-chip .must{font-family:var(--dsw-font-family);font-size:10px;opacity:.85}',
      '.dsws-cfg-legend{font-size:11px;color:var(--dsw-alias-label-caption,#8b8b95);display:flex;align-items:center;gap:12px;margin-top:2px}',
      '.dsws-cfg-card{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#16181d);padding:12px 14px;margin-bottom:10px}',
      '.dsws-cfg-card-head{display:flex;align-items:center;gap:8px;margin-bottom:2px}',
      '.dsws-cfg-card-name{font-size:13px;font-weight:650}',
      '.dsws-cfg-card-desc{font-size:11.5px;color:var(--dsw-alias-label-caption,#8b8b95);margin-bottom:4px;line-height:1.6}',
      '.dsws-cfg-preview{border:1px dashed var(--dsw-alias-border-l2,#3a3f4a);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#0c0e12);padding:7px 10px;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#a1a1aa);white-space:pre-wrap;word-break:break-all;margin-top:5px}',
      '.dsws-cfg-preview .pv-label{display:block;font-family:var(--dsw-font-family);font-size:10px;letter-spacing:.5px;color:var(--dsw-alias-label-caption,#8b8b95);margin-bottom:3px}',
      '.dsws-cfg-err{border:1px solid rgba(248,113,113,.5);background:rgba(248,113,113,.1);border-radius:10px;padding:10px 12px;font-size:12px;color:#f87171;line-height:1.7}',
      '.dsws-cfg-err .t{font-weight:650;display:flex;align-items:center;gap:6px;margin-bottom:2px}',
      '.dsws-cfg-save{align-self:flex-end;background:#c084fc;color:#140a1e;border:none;border-radius:8px;font-size:13px;font-weight:650;padding:8px 28px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
      '.dsws-cfg-save:hover{filter:brightness(1.08)}',
      '.dsws-cfg-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:7px;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:11.5px;padding:3px 10px;cursor:pointer}',
      '.dsws-cfg-btn:hover{border-color:var(--dsw-alias-border-l2,#3a3f4a);color:var(--dsw-alias-label-primary,#e6edf3)}',
      // T2 #35 路 鏃犱粨搴撶孩鍗★紙ListTab 棣栧睆鏈€浼樺厛锛壜?鏍峰紡澶嶇敤 dsws-banner bad 瑙嗚璇█
      '.dsws-no-repo-card{border:1px solid rgba(248,113,113,.45);background:rgba(248,113,113,.12);border-radius:8px;padding:10px 12px;margin-bottom:8px}',
      '.dsws-no-repo-card .head{display:flex;align-items:flex-start;gap:8px}',
      '.dsws-no-repo-card .ttl{font-weight:600;color:#f87171;font-size:12.5px;line-height:1.4}',
      '.dsws-no-repo-card .desc{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);margin-top:2px;line-height:1.5}',
      '.dsws-no-repo-card .acts{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}',
      '.dsws-no-repo-card .ghost{background:transparent;border:1px solid rgba(248,113,113,.35);color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-no-repo-card .ghost:hover{border-color:rgba(248,113,113,.55);color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-no-repo-form{margin-top:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#10131a)}',
      '.dsws-no-repo-form .row{display:flex;align-items:center;gap:8px;margin:6px 0}',
      '.dsws-no-repo-form label{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);flex:none;min-width:52px}',
      '.dsws-no-repo-form input[type="text"]{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:6px;color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;padding:4px 8px}',
      '.dsws-no-repo-form input[type="text"]:focus{outline:none;border-color:rgba(192,132,252,.55)}',
      '.dsws-no-repo-form .err{font-size:11px;color:#f87171;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35);border-radius:6px;padding:5px 8px;margin-top:6px}',
      '.dsws-no-repo-form .hint{font-size:10px;color:var(--dsw-alias-label-caption,#8b8b95);margin-top:2px}',
      '.dsws-no-repo-form .radio{display:inline-flex;align-items:center;gap:4px;font-size:11px;cursor:pointer}',
    ].join(''))

    // ============================================================
    // 0.5 locale锛圱3 #366 路 dsws 鍛藉悕绌洪棿 zh/en锛涜窡闅?harness 璇█锛汫itHub 鏁版嵁涓嶇炕璇戯級
    // 濂戠害锛歝tx.locale锛坉sh-client-locale锛夛細register(ns, {zh, en}) + bind(ns) 绋冲畾寮曠敤锛岃皟鐢ㄦ椂璇诲綋鍓嶈瑷€锛?
    // 鎵€鏈?outlet 鍦?locale 鍒囨崲鏃惰嚜鍔ㄩ噸娓叉煋锛坲seLocaleRevision锛夛紝妯″潡绾?t 鍗冲彲鐢熸晥銆?
    // v1.5锛氬叏閮?prompt锛圙UIDE_LINE/MAP_EXECUTE/COMPLETE/FIXATE/TPL_DEFAULT/setup/newWayfinder/mapHead锛?
    //   闆嗕腑涓?L 瀛楀吀 prompt.*锛坺h/en 鍙岃璺熼殢 DSH 璇█锛夛紝瀹￠槄涓庝紭鍖栬 docs/prompts-review.md銆?
    // ============================================================
    const L = {
      zh: {
        'nav.word': '娌夋穩',
        'nav.takeable': '鍙帴',
        'nav.occupied': '闃诲',
        'nav.env': '鐜',
        'nav.envTitle': '鐜妫€鏌?({n}/{t})',
        'panel.title': 'MattSkills',
        'nav.takeableTitle': '鍙帴 = 鏈棰嗗彲鎵ц鐨勪换鍔℃暟',
        'nav.occupiedTitle': '闃诲 = 宸茶棰嗘湭鍏抽棴鐨勪换鍔℃暟',
        'nav.bug': 'BUG',
        'nav.bugTitle': '杩囨护锛歰pen + bug 鏍囩',
        'nav.bugNew': '鏂板',
        'nav.bugNewTitle': '鏂颁細璇濅腑鎵撳紑 /wayfinder 鏂板 BUG 鍗?prompt',
        'nav.triage': '璇婃柇',
        'nav.triageTitle': '杩囨护锛歰pen + needs-triage 鏍囩',
        'nav.refresh': '鏇存柊',
        'nav.refreshing': '鏇存柊涓€?,
        'nav.refreshTitle': '閲嶆柊妫€鏌?+ 鍒锋柊蹇収',
        'nav.fixateTitle': '淇濆瓨杩涘害蹇収 路 娉ㄥ叆闆朵涪澶?prompt',
        'nav.handoff': '浜ゆ帴',
        'nav.handoffReady': '浜ゆ帴缁欐柊浼氳瘽',
        'nav.handoffTitle': '浜ゆ帴锛氬彂閫?/handoff 鐢熸垚浜ゆ帴鏂囨。',
        'nav.handoffReadyTitle': '寮€鏂颁細璇濆苟棰勫～浜ゆ帴鏂囨。璺緞',
        'nav.handoffGreyTitle': '灏氭湭鐢熸垚浜ゆ帴鏂囨。锛氬厛鐐广€屼氦鎺ャ€嶇敓鎴?,
        'nav.skillsTitle': '鎶€鑳藉浠讹細鐐瑰嚮灞曞紑鎶€鑳藉垪琛紝鐐瑰嚮鎶€鑳藉悕鎻掑叆褰撳墠浼氳瘽',
        'nav.skillHint': '鐐瑰嚮鎶€鑳藉悕 鈫?鎻掑叆鍒板綋鍓嶄細璇?,
        'banner.setup': 'setup 鏈墽琛?,
        'banner.skills': '鏈娴嬪埌鏍稿績鎶€鑳藉浠讹紙wayfinder / triage / grilling / grill-me / implement / ask-matt 绛夛級锛歿list}銆傚畨瑁呭悗鎵嶈兘浣跨敤鍏ㄦ祦绋嬪姛鑳姐€?,
        'banner.skillsBtn': '甯垜瀹夎 Matt 鎶€鑳藉浠?,
        'banner.setupBtn': '甯垜鎵ц /setup-matt-pocock-skills',
        'banner.ghcli': '鏈畨瑁?GitHub CLI 鈥斺€?闈㈡澘鎵€鏈夋暟鎹兘渚濊禆 gh锛岃鍏堝畨瑁?,
        'banner.ghcliBtn': '鎵撳紑瀹夎椤?,
        'banner.ghauth': '鏈櫥褰?GitHub 鈥斺€?杩愯 gh auth login锛堟祻瑙堝櫒鎺堟潈锛夊悗鍐嶄娇鐢?,
        'banner.ghauthBtn': '鏌ョ湅鐧诲綍鎸囧崡',
        'env.installBtn': '瀹夎寮曞',
        'env.guide': '閰嶇疆寮曞 路 鎸夐『搴忓畬鎴?,
        'env.g1': '瀹夎 GitHub CLI',
        'env.g2': '鐧诲綍 GitHub',
        'env.g3': '杩愯 setup 鍒濆鍖栵紙閫?GitHub tracker锛?,
        'env.g4': '瀹夎 Matt skills 鎶€鑳藉浠?,
        'act.diagnose': '璇婃柇',
        'act.fix': '淇',
        'act.discuss': '璁ㄨ',
        'act.execute': '鎵ц',
        'act.view': '鏌ョ湅',
        'act.load': '鍔犺浇',
        'act.done': '瀹屾垚',
        'type.research': '鐮旂┒',
        'type.prototype': '鍘熷瀷',
        'type.grilling': '瀵归綈',
        'type.task': '浠诲姟',
        'list.back': '杩斿洖鍒楄〃',
        'list.mapChip': '鍦板浘',
        'list.loadFail': '鍔犺浇澶辫触',
        'list.noDest': '锛堟湭濉啓 Destination锛?,
        'list.noNotes': '锛堟湭濉啓 Notes锛?,
        'list.kpi.takeable': '鍙帴',
        'list.kpi.occupied': '闃诲',
        'list.kpi.closed': '宸插叧闂?,
        'list.refresh': '鍒锋柊',
        'list.refreshing': '鍒锋柊涓€?,
        'list.envWarn': '{n} 椤圭幆澧冩湭灏辩华锛岀偣姝ゆ煡鐪?,
        'list.all': '鍏ㄩ儴',
        'list.loading': '鍔犺浇涓€?,
        'list.errFull': '蹇収鍔犺浇澶辫触锛歿err}',
        'list.restFallback': '鈿?GraphQL 閰嶉宸茶€楀敖锛屽凡鍒囨崲 REST 閫氶亾锛堟暟鎹彲鑳界暐鏃э紝閰嶉鎭㈠鍚庤嚜鍔ㄥ洖鍒囷級',
        'list.none': '鏆傛棤',
        'list.closedN': '宸插叧闂?{n}',
        'list.collapse': '鏀惰捣',
        'list.blocked': '琚樆濉?,
        'list.blockedTitle': '琚?{by} 闃诲锛堢偣鍑绘煡鐪嬪湴鍥捐鎯咃級',
        'list.tagsTitle': '鍏ㄩ儴鏍囩锛歿names}锛堢偣鍑诲睍寮€锛?,
        'list.tagsCount': '鍏ㄩ儴鏍囩 路 {n} 涓?,
        'list.popTitle': '鏍囬',
        'cfg.previewTitle': '绀轰緥 issue 鏍囬',
        'list.tagsCollapseTitle': '鏀惰捣鏍囩',
        'list.copyLinkTitle': '澶嶅埗閾炬帴',
        'list.openInGithubTitle': '鍦?GitHub 涓婃煡鐪?#{n}',
        'list.mapTitle': '鏌ョ湅鍦板浘璇︽儏',
        'list.state.all': '鍏ㄩ儴', 'list.state.open': 'Open', 'list.state.closed': '宸插叧闂?, 'list.state.blocked': '闃诲', 'list.state.frontier': '鍙帴',
        'list.filterActive': '褰撳墠杩囨护锛?, 'list.filterClear': '娓呴櫎鍏ㄩ儴',
        'list.sort.updatedAt': '鏇存柊', 'list.sort.createdAt': '鍒涘缓', 'list.sort.number': '缂栧彿', 'list.sort.title': '鏍囬',
        'map.decisions': 'Decisions so far锛坽n}锛?,
        'map.fog': 'Not yet specified锛堟垬闆?{n}锛?,
        'map.outOfScope': 'Out of scope锛坽n}锛?,
        'map.grpTakeable': '鍙帴 {n}',
        'map.grpClaimed': '宸茶棰?{n}',
        'map.grpBlocked': '琚樆濉?{n}',
        'map.grpClosed': '宸插叧闂?{n}',
        'map.layer': '灞?{n}',
        'map.progressCap': '鍦板浘杩涘害',
        'map.curLayer': '褰撳墠锛氬眰 {n}',
        'map.layersPassed': '{n}/{t} 灞傚凡閫氳繃',
        'map.notesCap': '姝ｆ枃璇︽儏',
        'map.startCap': 'Start',
        'map.destCap': 'Destination',
        'map.startBtn': '寮€濮?#{n}',
        'map.archive': '妗ｆ',
        'map.subClaimed': '宸茶棰?{who}',
        'map.subBlocked': '琚樆濉烇細{who}',
        'map.subClosed': '宸插叧闂?,
        'map.executeTitle': '鎵ц 路 娉ㄥ叆鍦板浘寮€濮嬫彁绀鸿瘝',
        'map.doneTitle': '瀹屾垚 路 娉ㄥ叆鏀跺熬纭 prompt',
        'skill.centerRing': '涓績 = 鎺ㄨ崘 路 鐜粫 = 鐩稿叧锛堝疄蹇冨凡瑁?绌哄績鏈锛壜?鐐瑰嚮娉ㄥ叆 /skill',
        'skill.centerTitle': '鎺ㄨ崘 {skill} 路 娉ㄥ叆 /{skill}',
        'skill.all': '鍏ㄩ儴鎶€鑳?,
        'skill.generic': '閫氱敤寤鸿',
        'skill.notes': '銆寋m}銆峃otes 鎸囧畾',
        'skill.treat': '鐢?/{s} 澶勭悊',
        'skill.list': '鍒楄〃',
        'skill.ring': '鍦嗙幆',
        'env.title': '鐜妫€鏌?{n}',
        'env.recheck': '閲嶆柊妫€鏌?,
        'env.checking': '妫€鏌ヤ腑鈥?,
        'env.missing': '缂哄け',
        'env.partial': '閮ㄥ垎灏辩华',
        'env.ready': '灏辩华',
        'env.failFull': '鐜妫€鏌ュけ璐ワ細{err}',
        'env.detecting': '妫€娴嬩腑鈥?,
        'env.missingBanner': '{n} 椤圭己澶憋紝鍏堣ˉ榻愬啀寮€濮?wayfinder 宸ヤ綔',
        'env.openUrl': '鎵撳紑缃戝潃',
        'env.copyUrl': '澶嶅埗缃戝潃',
        'panel.snapErr': '蹇収寮傚父',
        'panel.loading': '鍔犺浇涓€?,
        'panel.tabList': '鍒楄〃',
        'panel.tabSkills': '鎶€鑳?,
        'panel.tabChecks': '鐜妫€鏌?,
        'panel.refreshing': '鍒锋柊涓€?,
        'panel.closeTitle': '鍏抽棴闈㈡澘',
        'rz.n': '鎷栦笂杈?= 鍔犻珮闈㈡澘', 'rz.s': '鎷栦笅杈?= 鍔犻珮闈㈡澘', 'rz.e': '鎷栧彸杈?= 鍔犲闈㈡澘', 'rz.w': '鎷栧乏杈?= 鍔犲闈㈡澘',
        'rz.ne': '鍙充笂瑙掔缉鏀?, 'rz.nw': '宸︿笂瑙掔缉鏀?, 'rz.se': '鍙充笅瑙掔缉鏀?, 'rz.sw': '宸︿笅瑙掔缉鏀?,
        'toast.injectedHandoff': '宸叉敞鍏?/handoff 浜ゆ帴妯℃澘锛堝惈鏃堕棿鎴虫枃浠跺悕锛夛紝纭鍚庡彂閫?,
        'toast.copiedHandoff': '宸插鍒朵氦鎺ユ枃妗ｆ寚浠?,
        'toast.copiedHandoffFile': '宸插鍒朵氦鎺ユ枃妗ｆ寚浠わ細{file}',
        'toast.handoffGrey': '璇峰厛鐐广€屼氦鎺ャ€嶇敓鎴愪氦鎺ユ枃妗?,
        'toast.injected': '宸叉敞鍏ヨ緭鍏ユ锛岀‘璁ゅ悗鍙戦€?,
        'toast.copiedFallback': '宸插鍒跺埌鍓创鏉匡紙杈撳叆妗嗕笉鍙敤锛屽厹搴曪級',
        'toast.copied': '宸插鍒?,
        'toast.copyFailed': '澶嶅埗澶辫触锛岃鎵嬪姩澶嶅埗',
        'toast.clipboardUnavailable': '鍓创鏉夸笉鍙敤',
        'toast.snapFail': '蹇収鍒锋柊澶辫触锛歿err}',
        'toast.copiedLink': '宸插鍒堕摼鎺?#{n}',
        'toast.newSessionOpened': '宸插湪鏂颁細璇濅腑鎵撳紑骞堕濉寚浠わ紙鍚?cwd锛?,
        'toast.newSessionManual': '璇锋墜鍔ㄦ柊寤轰細璇濆苟鍛藉悕涓恒€寋title}銆嶏紱鎸囦护宸查濉綋鍓嶈緭鍏ユ',
        'toast.resetPanelWidthDone': '闈㈡澘瀹藉害宸查噸缃?路 涓嬫鎵撳紑鐢熸晥',
        'toast.resetPanelWidthFail': 'layout 鏈嶅姟鏆備笉鏀寔閲嶇疆 路 璇锋洿鏂?DSH harness',
        // #394锛氭柊浼氳瘽鎸夐挳鍙鏂囧瓧 + hover title锛堝幓鎺夊啑浣?detail锛岄潬 #361 doc + 琛屼负鏈韩瑙ｉ噴锛?
        'list.newSessionLabel': '鏂颁細璇?,
        'panel.newWayfinder': '+ 闇€姹?,
        'panel.newWayfinderTitle': '鏂颁細璇濅腑鎵撳紑 /wayfinder 鏂板闇€姹?prompt锛堢户鎵垮綋鍓嶅伐浣滃尯锛?,
        'panel.newBug': '+ bug',
        'panel.newBugTitle': '鏂颁細璇濅腑鎵撳紑 /wayfinder 鏂板 BUG 鍗?prompt锛堢户鎵垮綋鍓嶅伐浣滃尯锛?,
        'panel.diffRemoved': '{n} 涓凡鍏抽棴/绉婚櫎',
        'panel.repoTitle': '褰撳墠浠撳簱锛岀偣鍑绘墦寮€ GitHub',
        'panel.noRepo': '娌℃湁浠撳簱',
        'panel.noRepoTitle': '褰撳墠宸ヤ綔鍖轰笉鏄?Git 浠撳簱 鈥斺€?璇峰厛 git init 鎴栬繘鍏ヤ粨搴撶洰褰?,
        'panel.noRepoCardTitle': '褰撳墠宸ヤ綔鍖轰笉鏄?Git 浠撳簱 鈥?鐐规鍒濆鍖栧苟鍙戝竷',
        'panel.noRepoCardDesc': '鐐瑰嚮灏嗗畠鍙樻垚 GitHub 浠撳簱骞跺彂甯?,
        'panel.noRepoCardAction': '鍒涘缓骞跺彂甯?,
        'panel.noRepoCardDismiss': '蹇界暐',
        'panel.noRepoCardDone': '宸插湪棣栧睆寮曞 路 鍒囨崲鍒?ListTab 瀹屾垚',
        'panel.noRepoFormName': '浠撳簱鍚?,
        'panel.noRepoFormNameHint': '浠呮敮鎸佸瓧姣嶃€佹暟瀛椼€?_- 路 鈮?00',
        'panel.noRepoFormVisibility': '鍙鎬?,
        'panel.noRepoFormPublic': '鍏紑',
        'panel.noRepoFormPrivate': '绉佹湁',
        'panel.noRepoFormSubmit': '鍒涘缓骞跺彂甯?,
        'panel.noRepoFormCancel': '鍙栨秷',
        'panel.noRepoFormSubmitting': '鍒涘缓涓€?,
        'panel.noRepoErr.bad-name': '浠撳簱鍚嶄粎鏀寔瀛楁瘝/鏁板瓧/._- 涓?鈮?00',
        'panel.noRepoErr.no-git': '鏈壘鍒?git锛岃鍏堝畨瑁?Git',
        'panel.noRepoErr.no-gh': '鏈壘鍒?gh锛岃鍏堝畨瑁?GitHub CLI',
        'panel.noRepoErr.not-logged-in': '鏈櫥褰?GitHub锛岃鍏堟墽琛?gh auth login',
        'panel.noRepoErr.already-exists': '鍚屽悕浠撳簱宸插瓨鍦紝鍘?GitHub 鏌ョ湅',
        'panel.noRepoErr.network': '缃戠粶寮傚父锛岃閲嶈瘯',
        'panel.noRepoErr.permission': '鏉冮檺涓嶈冻锛岃妫€鏌ョ櫥褰曡处鍙?,
        'panel.noRepoErr.unknown': '鍒涘缓澶辫触锛岃鏌ョ湅閿欒璇︽儏',
        'panel.noRepoErr.git-commit-failed': 'Git 鎻愪氦澶辫触',
        'panel.noRepoReset': '閲嶇疆蹇界暐',
        'panel.noRepoCreateSuccess': '宸插垱寤?{repo}',
        'map.newSessionTitle': '鍦ㄦ柊浼氳瘽鎵撳紑锛堟帹杩涜 map锛?,
        'progress.todo': '鏈姩宸?, 'progress.doing': '杩涜涓?{n}%', 'progress.confirm': '95% 路 寰呯‘璁?, 'progress.accept': '100% 路 寰呴獙鏀?, 'progress.done': '瀹屾垚',
        'err.hostUnavailable': 'host.call 涓嶅彲鐢紙Host 鍗婃湭鍔犺浇锛?,
        'err.connUnavailable': 'connection 鏈嶅姟涓嶅彲鐢紙Host 鍗婃湭鍔犺浇锛?,
        'err.statusEmpty': 'wf.status 杩斿洖绌虹粨鏋?,
        'err.snapshotEmpty': 'wf.snapshot 杩斿洖寮傚父',
        'cfg.status': '閰嶇疆',
        'cfg.saved': '宸蹭繚瀛?,
        'cfg.sub': '閰嶇疆闈㈡澘涓庡姩浣滄彁绀鸿瘝锛氶潤鎬佹枃鏈彲鑷敱缂栬緫锛屽崰浣嶇鐢辩郴缁熸敞鍏ョ湡鍊硷紝鐐瑰嚮鍗冲彲鎻掑叆銆?,
        'matte.title': 'Matt Pocock 鎶€鑳介泦',
        'matte.desc': '宸ョ▼棰嗗煙 + 閫氱敤棰嗗煙鐨?AI agent 鎶€鑳介泦锛坵ayfinder / triage / grilling / handoff 绛?25 涓牳蹇冩妧鑳斤級',
        'matte.openRepo': '鎵撳紑 GitHub',
        'matte.copyPrompt': '澶嶅埗瀹夎 prompt',
        'cfg.openIn': '鎵撳紑浣嶇疆',
        'cfg.openInDesc': '闈㈡澘鍦ㄥ摢涓尯鍩熸墦寮€銆俠etter-sidebar 宸插畨瑁呮椂榛樿渚ц竟鏍忥紱绐楀彛缂╁皬鏃朵晶杈规爮鏇寸ǔ銆?,
        'cfg.openInLabel': '鎵撳紑浣嶇疆',
        'cfg.openInDock': '鍋滈潬鍒?,
        'cfg.openInSidebar': '渚ц竟鏍?,
        'cfg.openInHint': '宸插嵆鏃剁敓鏁堬細涓嬫鎵撳紑闈㈡澘鏃舵寜鏂颁綅缃墦寮€',
        'cfg.panelWidth': '闈㈡澘瀹藉害',
        'cfg.resetPanelWidth': '閲嶇疆闈㈡澘瀹藉害',
        'cfg.resetPanelWidthDesc': '涓嬫鎵撳紑闈㈡澘鏃朵娇鐢?layout 鏈嶅姟榛樿瀹藉害锛堟竻鎺変笂娆＄殑鎷栨嫿璁板繂锛?,
        'cfg.startTpl': '寮€濮嬫ā鏉匡紙鎵ц鍔ㄤ綔锛?,
        'cfg.startTplDesc': '銆屾墽琛屻€嶆寜閽敞鍏ョ殑鎻愮ず璇嶏紱鐣欑┖浣跨敤榛樿妯℃澘銆?,
        'cfg.withPrefix': '甯?/wayfinder 鍓嶇紑',
        'cfg.tplEditor': '鍔ㄤ綔妯℃澘缂栬緫鍣?,
        'cfg.tplEditorDesc': '銆屾墽琛屻€嶅鐨勫叚涓姩浣滄寜閽敞鍏ョ殑鎻愮ず璇嶃€傜偣鍑讳笅鏂瑰崰浣嶇鎻掑叆鍒板厜鏍囧锛涚孩鑹层€屽繀濉€嶅崰浣嶇鍒犻櫎鍚庢棤娉曚繚瀛樸€?,
        'cfg.execHint': '銆屾墽琛屻€嶆ā鏉垮湪寮€濮嬫ā鏉胯妭缂栬緫 鈫?,
        'cfg.saveRejected': '淇濆瓨琚嫆缁?,
        'cfg.saveAll': '淇濆瓨鍏ㄩ儴',
        'cfg.resetAll': '鎭㈠鍏ㄩ儴榛樿',
        'cfg.reset': '鎭㈠榛樿',
        'cfg.preview': '鏁堟灉棰勮',
        'cfg.must': '蹇呭～',
        'cfg.chipReq': '蹇呭～鍗犱綅绗︼細鍒犻櫎鍚庢棤娉曚繚瀛?,
        'cfg.chipInsert': '鐐瑰嚮鎻掑叆鍒板厜鏍囧',
        'tpl.missing': '缂哄皯寮哄埗鍗犱綅绗?{list}',
        'tpl.unknown': '鏈煡鍗犱綅绗?{list}',
        'tpl.name.diagnose': '璇婃柇', 'tpl.name.fix': '淇', 'tpl.name.discuss': '璁ㄨ',
        'tpl.name.handoff1': '浜ゆ帴绗竴鍑?, 'tpl.name.handoff2': '浜ゆ帴绗簩鍑?, 'tpl.name.fixate': '娌夋穩',
        'tpl.desc.diagnose': 'needs-triage 绁ㄧ殑琛岀骇鍔ㄤ綔',
        'tpl.desc.fix': 'bug 绁ㄧ殑琛岀骇鍔ㄤ綔',
        'tpl.desc.discuss': 'wayfinder:grilling 绁ㄧ殑琛岀骇鍔ㄤ綔',
        'tpl.desc.handoff1': '鐢熸垚浜ゆ帴鏂囨。锛堝惈鏃堕棿鎴筹紝涓ゅ嚮鏂囦欢鍚嶄竴鑷达級',
        'tpl.desc.handoff2': '璇诲彇浜ゆ帴鏂囨。',
        'tpl.desc.fixate': '闆朵涪澶卞揩鐓?prompt',
        'run.loaded': '宸插姞杞?,
        'run.desc': '鐜妫€鏌ワ紙wf.status锛? 闈㈡澘锛坵f.snapshot锛夊潎宸叉帴鐪熴€?,
        'run.openPanel': '鎵撳紑闈㈡澘',
        'run.openCfg': '鎵撳紑閰嶇疆',
        'run.cfgGuide': '閰嶇疆椤碉細璁剧疆 鈫?鎻掍欢 鈫?MattSkills',
        'skilldesc.ask-matt': '鎶€鑳借矾鐢卞櫒锛氫笉鐭ラ亾璇ョ敤鍝釜 skill 鏃堕棶瀹?,
        'skilldesc.setup-matt-pocock-skills': '浠撳簱鍒濆鍖栵細issue tracker / 鏍囩 / 鏂囨。璺緞',
        'skilldesc.wayfinder': '涓哄璁椤圭洰寤哄喅绛栧湴鍥句笌瀛愮エ鎷嗚В',
        'skilldesc.triage': 'issue 鍒嗘祦锛氬綊绫烩啋楠岃瘉鈫掕拷闂紝鐩磋嚦 ready-for-agent',
        'skilldesc.grilling': '鍦ㄤ綘鎷嶆澘鍓嶅弽澶嶈拷闂緞娓咃紝鐩村埌璁捐钀藉湴',
        'skilldesc.domain-modeling': '姊崇悊棰嗗煙鏈锛岃浠ｇ爜 / 鏂囨。 / 瀵硅瘽鐢ㄥ悓涓€濂楄瘝',
        'skilldesc.research': '鍚庡彴璋冪爺锛屽啓杩?repo 鍐?markdown 骞跺紩婧?,
        'skilldesc.prototype': '涓€娆℃€у師鍨嬪洖绛旇璁￠棶棰?,
        'skilldesc.implement': '鎶婅鏍兼枃妗ｆ媶鎴愪唬鐮佷换鍔★紝閫愰」瀹炵幇',
        'skilldesc.code-review': '鎸変粨搴撹鑼?+ 鍘熻鏍硷紝鍙岃酱瀹℃煡浣犵殑鏀瑰姩',
        'skilldesc.codebase-design': '涓轰唬鐮佹壘娓呮櫚鐨勬ā鍧楄竟鐣屼笌鎺ュ彛',
        'skilldesc.diagnosing-bugs': '纭?bug / 鎬ц兘鍥炲綊锛氬畾浣嶁啋鍋囪鈫掗獙璇侊紝寰幆寰€澶?,
        'skilldesc.improve-codebase-architecture': '鎵嚭浠ｇ爜搴撶殑娣卞寲鏈轰細锛岃緭鍑?HTML 鎶ュ憡',
        'skilldesc.tdd': '娴嬭瘯椹卞姩寮€鍙戯細鍏堝啓澶辫触娴嬭瘯锛屽啀鍐欐渶灏忓疄鐜?,
        'skilldesc.handoff': '鎶婂綋鍓嶅璇濆帇缂╂垚浜ゆ帴鏂囨。',
        'skilldesc.teach': '璺?session 鏁欎綘鏂版妧鑳?,
        'skilldesc.to-spec': '鎶婇浂鏁ｈ璁哄浐鍖栨垚鍙墽琛岀殑瑙勬牸鏂囨。',
        'skilldesc.to-tickets': '鎶婅鏍兼媶鎴?tickets',
        'skilldesc.resolving-merge-conflicts': '瑙ｅ喅鍚堝苟鍐茬獊',
        'skilldesc.writing-great-skills': '涓?AI 鍐欏嚭鍙鐢ㄣ€佸彲娴嬭瘯鐨勬妧鑳芥弿杩?,
      },
      en: {
        'nav.word': 'Consolidate',
        'nav.takeable': 'Ready',
        'nav.occupied': 'Busy',
        'nav.env': 'Env',
        'nav.envTitle': 'Environment checks ({n}/{t})',
        'panel.title': 'MattSkills',
        'nav.takeableTitle': 'Ready = unclaimed, takeable tasks',
        'nav.occupiedTitle': 'Busy = claimed but not yet closed',
        'nav.bug': 'BUG',
        'nav.bugTitle': 'Filter: open + bug label',
        'nav.bugNew': 'New',
        'nav.bugNewTitle': 'Open a /wayfinder new-BUG prompt in a new session (same workspace)',
        'nav.triage': 'Triage',
        'nav.triageTitle': 'Filter: open + needs-triage label',
        'nav.refresh': 'Refresh',
        'nav.refreshing': 'Updating鈥?,
        'nav.refreshTitle': 'Re-check + refresh snapshot',
        'nav.fixateTitle': 'Save a snapshot 路 inject the zero-loss prompt',
        'nav.handoff': 'Handoff',
        'nav.handoffReady': 'Handoff 路 new session',
        'nav.handoffTitle': 'Handoff: send /handoff to generate the handoff doc',
        'nav.handoffReadyTitle': 'Open a new session with the handoff doc path prefilled',
        'nav.handoffGreyTitle': 'No handoff doc yet 鈥?click Handoff first to generate one',
        'nav.skillsTitle': 'Skill suite: expand the skill list; click a skill to insert it into this session',
        'nav.skillHint': 'Click a skill to insert it into this session',
        'banner.setup': 'setup not run yet',
        'banner.skills': 'Core skill suite missing (wayfinder / triage / grilling / grill-me / implement / ask-matt 鈥?: {list}. Install them to use the full workflow.',
        'banner.skillsBtn': 'Install the Matt skill suite for me',
        'banner.setupBtn': 'Run /setup-matt-pocock-skills for me',
        'banner.ghcli': 'GitHub CLI not installed 鈥?all panel data depends on gh, install it first',
        'banner.ghcliBtn': 'Open install page',
        'banner.ghauth': 'Not signed in to GitHub 鈥?run gh auth login (browser auth) first',
        'banner.ghauthBtn': 'View sign-in guide',
        'env.installBtn': 'Install guide',
        'env.guide': 'Setup guide 路 complete in order',
        'env.g1': 'Install GitHub CLI',
        'env.g2': 'Sign in to GitHub',
        'env.g3': 'Run skill setup (choose GitHub tracker)',
        'env.g4': 'Install Matt skills suite',
        'act.diagnose': 'Diagnose',
        'act.fix': 'Fix',
        'act.discuss': 'Discuss',
        'act.execute': 'Execute',
        'act.view': 'View',
        'act.load': 'Load',
        'act.done': 'Complete',
        'type.research': 'Research',
        'type.prototype': 'Prototype',
        'type.grilling': 'Align',
        'type.task': 'Task',
        'list.back': 'Back to list',
        'list.mapChip': 'Map',
        'list.loadFail': 'Failed to load',
        'list.noDest': '(no Destination)',
        'list.noNotes': '(no Notes)',
        'list.kpi.takeable': 'Ready',
        'list.kpi.occupied': 'Blocked',
        'list.kpi.closed': 'Closed',
        'list.refresh': 'Refresh',
        'list.refreshing': 'Refreshing鈥?,
        'list.envWarn': '{n} check(s) not ready 鈥?click to view',
        'list.all': 'All',
        'list.loading': 'Loading鈥?,
        'list.errFull': 'Snapshot failed: {err}',
        'list.restFallback': '鈿?GraphQL quota exhausted 鈥?switched to REST channel (data may be slightly stale; auto-reverts when quota resets)',
        'list.none': 'None',
        'list.closedN': 'Closed {n}',
        'list.collapse': 'Collapse',
        'list.blocked': 'Blocked',
        'list.blockedTitle': 'Blocked by {by} (click for map details)',
        'list.tagsTitle': 'All labels: {names} (click to expand)',
        'list.tagsCount': 'All labels 路 {n}',
        'list.popTitle': 'Title',
        'cfg.previewTitle': 'Sample issue title',
        'list.tagsCollapseTitle': 'Collapse labels',
        'list.copyLinkTitle': 'Copy link',
        'list.openInGithubTitle': 'Open #{n} on GitHub',
        'list.mapTitle': 'View map details',
        'list.state.all': 'All', 'list.state.open': 'Open', 'list.state.closed': 'Closed', 'list.state.blocked': 'Blocked', 'list.state.frontier': 'Ready',
        'list.filterActive': 'Active filters: ', 'list.filterClear': 'Clear all',
        'list.sort.updatedAt': 'Updated', 'list.sort.createdAt': 'Created', 'list.sort.number': 'Number', 'list.sort.title': 'Title',
        'map.decisions': 'Decisions so far ({n})',
        'map.fog': 'Not yet specified (fog {n})',
        'map.outOfScope': 'Out of scope ({n})',
        'map.grpTakeable': 'Ready {n}',
        'map.grpClaimed': 'Claimed {n}',
        'map.grpBlocked': 'Blocked {n}',
        'map.grpClosed': 'Closed {n}',
        'map.layer': 'Layer {n}',
        'map.progressCap': 'Map progress',
        'map.curLayer': 'Current: layer {n}',
        'map.layersPassed': '{n}/{t} layers passed',
        'map.notesCap': 'Notes',
        'map.startCap': 'Start',
        'map.destCap': 'Destination',
        'map.startBtn': 'Start #{n}',
        'map.archive': 'Archive',
        'map.subClaimed': 'Claimed by {who}',
        'map.subBlocked': 'Blocked by: {who}',
        'map.subClosed': 'Closed',
        'map.executeTitle': 'Execute 路 inject the map\'s start prompt',
        'map.doneTitle': 'Complete 路 inject the wrap-up confirmation prompt',
        'skill.centerRing': 'Center = recommended 路 Ring = related (filled = installed / hollow = not) 路 click to inject /skill',
        'skill.centerTitle': 'Recommended {skill} 路 click to inject /{skill}',
        'skill.all': 'All skills',
        'skill.generic': 'General suggestion',
        'skill.notes': 'Specified by "{m}" Notes',
        'skill.treat': 'Handle with /{s}',
        'skill.list': 'List',
        'skill.ring': 'Ring',
        'env.title': 'Environment checks {n}',
        'env.recheck': 'Re-check',
        'env.checking': 'Checking鈥?,
        'env.missing': 'Missing',
        'env.partial': 'Partial',
        'env.ready': 'Ready',
        'env.failFull': 'Environment check failed: {err}',
        'env.detecting': 'Detecting鈥?,
        'env.missingBanner': '{n} missing 鈥?fix them before starting wayfinder work',
        'env.openUrl': 'Open URL',
        'env.copyUrl': 'Copy URL',
        'panel.snapErr': 'Snapshot error',
        'panel.loading': 'Loading鈥?,
        'panel.tabList': 'List',
        'panel.tabSkills': 'Skills',
        'panel.tabChecks': 'Checks',
        'panel.refreshing': 'Refreshing鈥?,
        'panel.closeTitle': 'Close panel',
        'rz.n': 'Drag the top edge up = grow taller', 'rz.s': 'Drag the bottom edge down = grow taller', 'rz.e': 'Drag the right edge right = grow wider', 'rz.w': 'Drag the left edge left = grow wider',
        'rz.ne': 'Resize NE', 'rz.nw': 'Resize NW', 'rz.se': 'Resize SE', 'rz.sw': 'Resize SW',
        'toast.injectedHandoff': '/handoff template injected (timestamped filename) 鈥?confirm before sending',
        'toast.copiedHandoff': 'Handoff command copied',
        'toast.copiedHandoffFile': 'Handoff command copied: {file}',
        'toast.handoffGrey': 'Click Handoff first to generate the handoff doc',
        'toast.injected': 'Injected into the input box 鈥?confirm before sending',
        'toast.copiedFallback': 'Copied to clipboard (input box unavailable)',
        'toast.copied': 'Copied',
        'toast.copyFailed': 'Copy failed 鈥?copy manually',
        'toast.clipboardUnavailable': 'Clipboard unavailable',
        'toast.snapFail': 'Snapshot refresh failed: {err}',
        'toast.copiedLink': 'Link # {n} copied',
        'toast.newSessionOpened': 'Opened in a new session with the prompt prefilled (same cwd)',
        'toast.newSessionManual': 'Please create a new session manually and name it "{title}"; the prompt is prefilled in the current input',
        'toast.resetPanelWidthDone': 'Panel width reset 路 takes effect on next open',
        'toast.resetPanelWidthFail': 'Layout service doesn\'t support reset yet 路 please update DSH harness',
        // #394锛歷isible label + hover title for new-session button
        'list.newSessionLabel': 'New session',
        'panel.newWayfinder': '+ Requirement',
        'panel.newWayfinderTitle': 'Open a /wayfinder new-requirement prompt in a new session (same workspace)',
        'panel.newBug': '+ BUG',
        'panel.newBugTitle': 'Open a /wayfinder new-BUG prompt in a new session (same workspace)',
        'panel.diffRemoved': '{n} closed/removed',
        'panel.repoTitle': 'Current repo 鈥?open on GitHub',
        'panel.noRepo': 'No repo',
        'panel.noRepoTitle': 'Current workspace is not a Git repo 鈥?run git init or open a repo directory',
        'panel.noRepoCardTitle': 'Current workspace is not a Git repo 鈥?click to init and publish',
        'panel.noRepoCardDesc': 'Turn this workspace into a GitHub repo and publish it',
        'panel.noRepoCardAction': 'Create and publish',
        'panel.noRepoCardDismiss': 'Ignore',
        'panel.noRepoCardDone': 'Already guided on first screen 路 switch to ListTab',
        'panel.noRepoFormName': 'Repository name',
        'panel.noRepoFormNameHint': 'Letters, digits, ._- only 路 鈮?00',
        'panel.noRepoFormVisibility': 'Visibility',
        'panel.noRepoFormPublic': 'Public',
        'panel.noRepoFormPrivate': 'Private',
        'panel.noRepoFormSubmit': 'Create and publish',
        'panel.noRepoFormCancel': 'Cancel',
        'panel.noRepoFormSubmitting': 'Creating鈥?,
        'panel.noRepoErr.bad-name': 'Name supports only letters/digits/._- 鈮?00',
        'panel.noRepoErr.no-git': 'git not found 鈥?please install Git',
        'panel.noRepoErr.no-gh': 'gh not found 鈥?please install GitHub CLI',
        'panel.noRepoErr.not-logged-in': 'Not logged into GitHub 鈥?run gh auth login',
        'panel.noRepoErr.already-exists': 'Repository already exists 鈥?view on GitHub',
        'panel.noRepoErr.network': 'Network error 鈥?please retry',
        'panel.noRepoErr.permission': 'Permission denied 鈥?check login account',
        'panel.noRepoErr.unknown': 'Creation failed 鈥?see error details',
        'panel.noRepoErr.git-commit-failed': 'Git commit failed',
        'panel.noRepoReset': 'Reset ignore',
        'panel.noRepoCreateSuccess': 'Created {repo}',
        'map.newSessionTitle': 'Open in a new session (advance this map)',
        'progress.todo': 'Not started', 'progress.doing': 'In progress {n}%', 'progress.confirm': '95% 路 confirming', 'progress.accept': '100% 路 acceptance', 'progress.done': 'Done',
        'err.hostUnavailable': 'host.call unavailable (host half not loaded)',
        'err.connUnavailable': 'connection service unavailable (host half not loaded)',
        'err.statusEmpty': 'wf.status returned an empty result',
        'err.snapshotEmpty': 'wf.snapshot returned an error',
        'cfg.status': 'Config',
        'cfg.saved': 'Saved',
        'cfg.sub': 'Configure the panel and action prompts: static text is freely editable; placeholders are filled in by the system 鈥?click to insert.',
        'matte.title': 'Matt Pocock skills',
        'matte.desc': 'Engineering + general-purpose AI agent skills (25 core skills: wayfinder / triage / grilling / handoff 鈥?',
        'matte.openRepo': 'Open GitHub',
        'matte.copyPrompt': 'Copy install prompt',
        'cfg.openIn': 'Open in',
        'cfg.openInDesc': 'Where the panel opens. Defaults to the sidebar when dsh-better-sidebar is installed; the sidebar stays put when the window shrinks.',
        'cfg.openInLabel': 'Open location',
        'cfg.openInDock': 'Details column',
        'cfg.openInSidebar': 'Sidebar',
        'cfg.openInHint': 'Applied instantly 鈥?next panel open uses this location',
        'cfg.panelWidth': 'Panel width',
        'cfg.resetPanelWidth': 'Reset panel width',
        'cfg.resetPanelWidthDesc': 'Next panel open will use the layout service default width (clears the persisted drag memory).',
        'cfg.startTpl': 'Start template (execute)',
        'cfg.startTplDesc': 'Prompt injected by the Execute button; leave empty for the default template.',
        'cfg.withPrefix': 'Prefix with /wayfinder',
        'cfg.tplEditor': 'Action template editor',
        'cfg.tplEditorDesc': 'Prompts for the six action buttons other than Execute. Click a placeholder below to insert at the cursor; deleting a red Required placeholder blocks saving.',
        'cfg.execHint': 'Edit the Execute template in the Start template section 鈫?,
        'cfg.saveRejected': 'Save rejected',
        'cfg.saveAll': 'Save all',
        'cfg.resetAll': 'Reset all defaults',
        'cfg.reset': 'Reset default',
        'cfg.preview': 'Preview',
        'cfg.must': 'Required',
        'cfg.chipReq': 'Required placeholder: cannot save without it',
        'cfg.chipInsert': 'Click to insert at cursor',
        'tpl.missing': 'Missing required placeholder(s): {list}',
        'tpl.unknown': 'Unknown placeholder(s): {list}',
        'tpl.name.diagnose': 'Diagnose', 'tpl.name.fix': 'Fix', 'tpl.name.discuss': 'Discuss',
        'tpl.name.handoff1': 'Handoff 路 first hit', 'tpl.name.handoff2': 'Handoff 路 second hit', 'tpl.name.fixate': 'Consolidate',
        'tpl.desc.diagnose': 'Row action for needs-triage tickets',
        'tpl.desc.fix': 'Row action for bug tickets',
        'tpl.desc.discuss': 'Row action for wayfinder:grilling tickets',
        'tpl.desc.handoff1': 'Generate the handoff doc (timestamped; both hits share the filename)',
        'tpl.desc.handoff2': 'Read the handoff doc',
        'tpl.desc.fixate': 'Zero-loss snapshot prompt',
        'run.loaded': 'Loaded',
        'run.desc': 'Environment checks (wf.status) and panel (wf.snapshot) are live.',
        'run.openPanel': 'Open panel',
        'run.openCfg': 'Open config',
        'run.cfgGuide': 'Config: Settings 鈫?Plugins 鈫?MattSkills',
        'skilldesc.ask-matt': 'Skill router: ask it when unsure which skill to use',
        'skilldesc.setup-matt-pocock-skills': 'Repo bootstrap: issue tracker / labels / doc paths',
        'skilldesc.wayfinder': 'Build decision maps + sub-ticket breakdowns for big projects',
        'skilldesc.triage': 'Route issues: classify 鈫?verify 鈫?grill, until ready-for-agent',
        'skilldesc.grilling': 'Relentlessly question you until the design is locked down',
        'skilldesc.domain-modeling': 'Lock down domain terms so code, docs and chat use one language',
        'skilldesc.research': 'Background research written into repo markdown with sources',
        'skilldesc.prototype': 'One-off prototype answering a design question',
        'skilldesc.implement': 'Break a spec into code tasks and implement them one by one',
        'skilldesc.code-review': 'Review your diff on both repo standards and the originating spec',
        'skilldesc.codebase-design': 'Find clean module boundaries and interfaces for your code',
        'skilldesc.diagnosing-bugs': 'Hard bugs / perf regressions: locate 鈫?hypothesize 鈫?verify, loop',
        'skilldesc.improve-codebase-architecture': 'Scan the codebase for deepening opportunities, output an HTML report',
        'skilldesc.tdd': 'Test-driven dev: failing test first, then minimal implementation',
        'skilldesc.handoff': 'Compress this conversation into a handoff doc',
        'skilldesc.teach': 'Teach you new skills across sessions',
        'skilldesc.to-spec': 'Turn scattered discussions into an executable spec',
        'skilldesc.to-tickets': 'Split specs into tickets',
        'skilldesc.resolving-merge-conflicts': 'Resolve merge conflicts',
        'skilldesc.writing-great-skills': 'Write reusable, testable skill descriptions for AI',
      },
    }
    const localeSvc = ctx.get('locale')
    if (localeSvc && typeof localeSvc.register === 'function') {
      ctx.effect(function () {
        return localeSvc.register('dsws', L)
      }, 'dsws: locale')
    }
    // tr锛歭ocale 缁戝畾锛堢ǔ瀹氬紩鐢紝璋冪敤鏃惰褰撳墠璇█锛涘懡鍚?tr 閬垮厤涓庣エ鍔″弬鏁?t 鍐茬獊锛夛紱鏈嶅姟缂哄け鏃堕€€鍖?zh 瀛楀吀锛堜笌 locale 鍚岃涔夛細{name} 鍙傛暟鏇挎崲锛?
    const tr = (localeSvc && typeof localeSvc.bind === 'function')
      ? localeSvc.bind('dsws')
      : function (key, params) {
          let s = (L.zh[key] !== undefined) ? L.zh[key] : key
          if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return name in params ? String(params[name]) : m })
          return s
        }

    // ============================================================
    // 1. 鎶€鑳界洰褰?+ 鍦烘櫙鎺ㄨ崘鏄犲皠
    // ============================================================
    // T3锛氭弿杩板湪娓叉煋鏃?tr('skilldesc.<name>')锛堟澶?use 瀛楁涓轰腑鏂囬潤鎬佸弬鑰冿級
    const SKILLS = [
      { name: 'ask-matt', level: 'warn', use: '鎶€鑳借矾鐢卞櫒锛氫笉鐭ラ亾璇ョ敤鍝釜 skill 鏃堕棶瀹? },
      { name: 'setup-matt-pocock-skills', level: 'ok', use: '浠撳簱鍒濆鍖栵細issue tracker / 鏍囩 / 鏂囨。璺緞' },
      { name: 'wayfinder', level: 'warn', use: '宸ㄥ瀷椤圭洰鍐崇瓥鍦板浘锛堟湰鎻掍欢鏈嶅姟鐨勫璞★級' },
      { name: 'triage', level: 'ok', use: 'issue 鐘舵€佹満娴佽浆锛歝ategorise鈫抳erify鈫抔rill' },
      { name: 'grilling', level: 'ok', use: '绌疯拷涓嶈垗鐨勫榻愭彁闂紙璁捐鏍戯級' },
      { name: 'domain-modeling', level: 'ok', use: '棰嗗煙鏈涓庣粺涓€璇█' },
      { name: 'research', level: 'ok', use: '鍚庡彴璋冪爺锛屽啓杩?repo 鍐?markdown 骞跺紩婧? },
      { name: 'prototype', level: 'ok', use: '涓€娆℃€у師鍨嬪洖绛旇璁￠棶棰? },
      { name: 'implement', level: 'warn', use: '鎶婅鏍艰惤鎴愪唬鐮侊紙task 鍨?ticket锛? },
      { name: 'code-review', level: 'ok', use: '鎸夋爣鍑?+ 瑙勬牸鍙岃酱瀹℃煡鏀瑰姩' },
      { name: 'codebase-design', level: 'ok', use: '娣辨ā鍧楄璁¤瘝姹? },
      { name: 'diagnosing-bugs', level: 'ok', use: '纭?bug 涓庢€ц兘鍥炲綊璇婃柇寰幆' },
      { name: 'improve-codebase-architecture', level: 'ok', use: '鎵?deepening opportunities 鍑?HTML 鎶ュ憡' },
      { name: 'tdd', level: 'ok', use: '绾?缁?閲嶆瀯' },
      { name: 'handoff', level: 'warn', use: '鎶婂綋鍓嶅璇濆帇缂╂垚浜ゆ帴鏂囨。' },
      { name: 'teach', level: 'ok', use: '璺?session 鏁欎綘鏂版妧鑳? },
      { name: 'to-spec', level: 'warn', use: '鎶婅璁哄浐鍖栨垚瑙勬牸' },
      { name: 'to-tickets', level: 'warn', use: '鎶婅鏍兼媶鎴?tickets' },
      { name: 'resolving-merge-conflicts', level: 'ok', use: '瑙ｅ喅鍚堝苟鍐茬獊' },
      { name: 'writing-great-skills', level: 'warn', use: '鍐欏嚭浼樼鎶€鑳? },
    ]
    const TYPE_SKILLS = {
      research: ['research'],
      prototype: ['prototype'],
      grilling: ['grilling', 'domain-modeling'],
      task: ['implement'],
    }
    const TYPE_LABEL = {
      research: ['research', 'r', '鐮旂┒'],
      prototype: ['prototype', 'p', '鍘熷瀷'],
      grilling: ['grilling', 'g', '瀵归綈'],
      task: ['task', 't', '浠诲姟'],
    }
    const TYPE_ICON = { research: 'search', prototype: 'hammer', grilling: 'chat', task: 'gear' }

    // ============================================================
    // 2. 澶栬鏂规锛堝浘鏍?+ 鍔ㄤ綔璇嶏紝鍙垏鎹級
    // ============================================================
    const ICON_SCHEMES = [
      { id: 'compass', label: '缃楃洏' },
      { id: 'beacon', label: '鐏' },
      { id: 'radar', label: '闆疯揪' },
      { id: 'pin', label: '鍥鹃拤' },
    ]
    const WORD_SCHEMES = ['娌夋穩', '钀界焊', '瀛樻。', '蹇収']

    const Icon = ({ scheme, size }) => {
      const s = size || 16
      const common = { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'inline-block', verticalAlign: '-2px', flex: 'none' } }
      if (scheme === 'beacon') return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 4, fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })])
      if (scheme === 'radar') return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('circle', { cx: 12, cy: 12, r: 5 }), h('circle', { cx: 12, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M12 12L19 8' }), h('circle', { cx: 16.5, cy: 6.5, r: 1.1, fill: 'currentColor', stroke: 'none' })])
      if (scheme === 'pin') return h('svg', common, [h('path', { d: 'M12 21s-6-5.1-6-10a6 6 0 1112 0c0 4.9-6 10-6 10z' }), h('circle', { cx: 12, cy: 11, r: 2.2, fill: 'currentColor', stroke: 'none' })])
      return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('polygon', { points: '15.5 8.5 13 13 8.5 15.5 11 11', fill: 'currentColor', stroke: 'none' })])
    }

    // ---- 閫氱敤鍥炬爣闆嗭紙缁熶竴 SVG stroke 椋庢牸锛?---
    const Ic = ({ n, size, color }) => {
      const s = size || 13
      const common = { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'inline-block', verticalAlign: '-2px', flex: 'none' }, color: color || undefined }
      switch (n) {
        case 'dot': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 4.5, fill: 'currentColor', stroke: 'none' })])
        case 'target': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 8 }), h('circle', { cx: 12, cy: 12, r: 2.4, fill: 'currentColor', stroke: 'none' })])
        case 'lock': return h('svg', common, [h('rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }), h('path', { d: 'M8 11V8a4 4 0 018 0v3' })])
        case 'map': return h('svg', common, [h('path', { d: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z' }), h('path', { d: 'M9 3v15M15 6v15' })])
        case 'compass': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('polygon', { points: '15.5 8.5 13 13 8.5 15.5 11 11', fill: 'currentColor', stroke: 'none' })])
        case 'gear': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 3 }), h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })])
        case 'refresh': return h('svg', common, [h('path', { d: 'M21 12a9 9 0 11-2.6-6.4' }), h('polyline', { points: '21 3 21 9 15 9' })])
        case 'note': return h('svg', common, [h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }), h('path', { d: 'M8 9h8M8 13h8M8 17h5' })])
        case 'fog': return h('svg', common, [h('path', { d: 'M8 17a4 4 0 010-8 5 5 0 019.6-1.6A3.5 3.5 0 0118 17z' }), h('path', { d: 'M3 21h18' })])
        case 'ban': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M5.6 5.6l12.8 12.8' })])
        case 'person': return h('svg', common, [h('circle', { cx: 12, cy: 8, r: 3.5 }), h('path', { d: 'M5 20a7 7 0 0114 0' })])
        case 'check': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M8.5 12.5l2.5 2.5 4.5-5' })])
        case 'play': return h('svg', common, [h('path', { d: 'M8 5.5l11 6.5-11 6.5z', fill: 'currentColor', stroke: 'none' })])
        case 'link': return h('svg', common, [h('path', { d: 'M10 14a5 5 0 007.1 0l2.8-2.8a5 5 0 00-7.1-7.1L11 5.9' }), h('path', { d: 'M14 10a5 5 0 00-7.1 0l-2.8 2.8a5 5 0 007.1 7.1L13 18.1' })])
        case 'back': return h('svg', common, [h('path', { d: 'M19 12H5' }), h('polyline', { points: '12 19 5 12 12 5' })])
        case 'alert': return h('svg', common, [h('path', { d: 'M12 3l10 18H2z' }), h('path', { d: 'M12 9.5V14' }), h('circle', { cx: 12, cy: 17, r: 0.7, fill: 'currentColor', stroke: 'none' })])
        case 'x': return h('svg', common, [h('path', { d: 'M6 6l12 12M18 6L6 18' })])
        case 'star': return h('svg', common, [h('path', { d: 'M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2-5.6-3.2-5.6 3.2 1.3-6.2L3 9.5l6.3-.7z', fill: 'currentColor', stroke: 'none' })])
        case 'search': return h('svg', common, [h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'M21 21l-4.3-4.3' })])
        case 'hammer': return h('svg', common, [h('path', { d: 'M14 4l6 6-2.5 2.5-6-6z' }), h('path', { d: 'M3 21l7.5-7.5' }), h('path', { d: 'M12.5 9.5l2 2' })])
        case 'chat': return h('svg', common, [h('path', { d: 'M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z' })])
        case 'clipboard': return h('svg', common, [h('rect', { x: 5, y: 4, width: 14, height: 16, rx: 2 }), h('path', { d: 'M9 2h6v4H9z' }), h('path', { d: 'M9 11h6M9 15h4' })])
        case 'list': return h('svg', common, [h('path', { d: 'M8 6h12M8 12h12M8 18h12' }), h('circle', { cx: 4, cy: 6, r: 0.8, fill: 'currentColor', stroke: 'none' }), h('circle', { cx: 4, cy: 12, r: 0.8, fill: 'currentColor', stroke: 'none' }), h('circle', { cx: 4, cy: 18, r: 0.8, fill: 'currentColor', stroke: 'none' })])
        case 'info': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 11v5' }), h('circle', { cx: 12, cy: 8, r: 0.7, fill: 'currentColor', stroke: 'none' })])
        case 'handoff': return h('svg', common, [h('path', { d: 'M7 17l-4-4 4-4' }), h('path', { d: 'M3 13h6a6 6 0 016 6' }), h('path', { d: 'M17 7l4 4-4 4' }), h('path', { d: 'M21 11h-6a6 6 0 00-6-6' })])
        // 闇€姹?锛?026-08-18锛夛細浜ゆ帴鏂囨。 + 鍑虹澶?鈥斺€?銆屾柊浼氳瘽浜ゆ帴銆嶅皬鎸夐挳
        case 'handoff-open': return h('svg', common, [h('path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }), h('path', { d: 'M14 3v5h5' }), h('path', { d: 'M10 15l4-4' }), h('path', { d: 'M11 11h3v3' })])
        // 闇€姹?路rev锛?026-08-18锛夛細绂佺敤鎬佲€滄枃妗ｆ殏涓嶅彲寮€鈥?鈥斺€?浜ゆ帴鏂囨。 + 鏂滄潬锛堟湭鐢熸垚鏃跺彸渚ф寜閽殑闈欐鏍峰紡锛?
        case 'handoff-off': return h('svg', common, [h('path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }), h('path', { d: 'M14 3v5h5' }), h('path', { d: 'M8 16l8-8' })])
        // 闇€姹?锛?026-08-18锛夛細2脳2 缃戞牸 鈥斺€?鎶€鑳藉垪琛ㄦ寜閽?
        case 'skills': return h('svg', common, [h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }), h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 })])
        // #394锛氫笌 nav.handoff 鍚屽浘鏍囬€犳垚銆屼氦鎺?/ 鏂板紑浼氳瘽銆嶄簩涔夛紱鏂颁細璇濇寜閽崲 external-link 娑堟
        case 'external-link': return h('svg', common, [h('path', { d: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6' }), h('polyline', { points: '15 3 21 3 21 9' }), h('line', { x1: 10, y1: 14, x2: 21, y2: 3 })])
        // 鏂板BUG鍏ュ彛锛坕ssue #4锛夛細铏舰鍥炬爣 鈥斺€?銆? 鏂板BUG鍗曘€嶆寜閽?/ 鐘舵€佹爮 BUG 鎮仠鑿滃崟銆屾柊澧炪€?
        case 'bug': return h('svg', common, [h('path', { d: 'M8 2l1.88 1.88' }), h('path', { d: 'M14.12 3.88L16 2' }), h('path', { d: 'M9 7.13v-1a3.003 3.003 0 116 0v1' }), h('path', { d: 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6' }), h('path', { d: 'M12 20v-9' }), h('path', { d: 'M6.53 9C4.6 8.8 3 7.1 3 5' }), h('path', { d: 'M6 13H2' }), h('path', { d: 'M3 21c0-2.1 1.7-3.9 3.8-4' }), h('path', { d: 'M20.97 5c0 2.1-1.6 3.8-3.5 4' }), h('path', { d: 'M22 13h-4' }), h('path', { d: 'M17.2 17c2.1.1 3.8 1.9 3.8 4' })])
        default: return null
      }
    }

    // ============================================================
    // 2.5 閰嶇疆妯″瀷锛坴25 路 T2a锛歞sws.cfg + dsws.templates锛涙棫 dsws.startCfg 鑷姩杩佺Щ锛?
    // 蹇呴』浣嶄簬 搂3 store 涔嬪墠锛圖EFAULT_PANEL_H 鍥哄畾 1/2锛?
    // ============================================================
    // ============================================================
    // 搂prompts锛歱rompt 娉ㄥ唽琛紙鍐呭灞?路 鐙珛浜?UI 鏂囨 i18n锛夆€斺€?鏂规 A
    //   姣忔潯锛歿 version, placeholders, use, zh, en }锛涜繍琛屾椂鎸夊綋鍓嶈瑷€缁?promptText(id, params) 鍙栫敤
    //   鍗犱綅绗﹀绾︼細鏂囨湰鍐?{x} 蹇呴』澹版槑鍦?placeholders锛沺romptText 鍙浛鎹㈠凡澹版槑鍙傛暟锛堟湭鐭ヤ繚鐣欙級
    //   鍘熷垯锛氭墍鏈?prompt 鐩稿鎵€寮曠敤鎶€鑳斤紙wayfinder/grilling/triage 绛夛級鍙仛銆岃拷鍔犳墿灞曡姹傘€嶏紝缁濅笉瑕嗙洊鎶€鑳借嚜韬鍒欍€?
    //   瀹￠槄锛歞ocs/prompts-review.html / .md 路 濂戠害鏍￠獙锛歵ests/verify-prompts.js
    // ============================================================
    const PROMPTS = {
      "guide": { version: 1, placeholders: [], use: '缁熶竴寮曞鍙ワ紙杩藉姞浜庡悇鍔ㄤ綔 prompt 鏈熬锛?, zh: '浠庣涓€鎬у師鐞嗗嚭鍙戝畬鎴愪换鍔★紝骞跺鎶楀紡瀹℃煡銆?, en: 'Approach tasks from first principles, and review adversarially.' },
      "mapExecute": { version: 4, placeholders: [], use: 'map 鎵ц / 鏂颁細璇濓紙鏈畬鎴愭€侊級路 鎺ㄨ繘寮?, zh: '璇锋寜浠ヤ笅娴佺▼鎺ㄨ繘璇?map锛堥伒寰?wayfinder 鎶€鑳借鍒欙級锛歕n1. 鍔犺浇 wayfinder 鎶€鑳斤紙濡傛湭鍔犺浇锛夛紱\n2. 鍒嗘瀽杩欎釜 map锛圖estination / Notes / 闃诲鍏崇郴 / 褰撳墠 frontier锛夛紱\n3. 鎸夌涓€鎬у師鐞嗗垎鏋愬綋鍓嶆渶閫傚悎鎺ㄨ繘鐨勪笅涓€涓?issue锛坒rontier 涓环鍊兼渶楂樸€侀闄╂渶浣庛€佹渶瑙ｉ樆鐨勶級锛沑n4. 鍘绘墽琛屽畠锛氬厛璁ら 鈫?璇昏 issue 鐨?Description / Notes / 闃诲鍏崇郴 鈫?鍒跺畾鏂规 鈫?瀹炴柦 鈫?楠屾敹锛沑n5. 缁撴潫鍓嶆寜杩涘害濂戠害鏇存柊璇?issue 姝ｆ枃锛?# 杩涘害锛歂% + 涓嬩竴姝ワ級锛涙湰娆℃帹杩涘畬鎴愪笖楠屾敹閫氳繃 鈫?100% + close銆俓n鑻ユ湰娆℃帹杩涙湁鍏抽棴鐨勭エ锛氭寜 wayfinder 瑙勫垯鍚屾 map 璁板綍锛圖ecisions so far 杩藉姞 gist / 杩烽浘姣曚笟 / Out of scope锛夈€?, en: 'Please advance this map:\n1. Load the wayfinder skill (if not loaded);\n2. Analyze this map (Destination / Notes / blocking relationships / current frontier);\n3. From first principles, pick the most valuable next issue on the frontier (highest value, lowest risk, most unblocking);\n4. Go execute it: read the issue Description / Notes / blocking relationships 鈫?plan 鈫?implement 鈫?verify.\n\nApproach tasks from first principles, and review adversarially.\nIf this advance closes any ticket, sync the map records per wayfinder rules (Decisions so far gist / fog graduation / Out of scope).' },
      "complete": { version: 3, placeholders: ['n', 'closed', 'total'], use: 'map 瀹屾垚鎬?路 瀹屾垚纭锛堟敹灏?close / 鍒楅仐婕忥級', zh: '## 瀹屾垚纭 路 MAP #{n}\n\n褰撳墠鍦板浘鏄剧ず 100% 瀹屾垚锛歿closed}/{total} 涓?issue 宸插叧闂紝浣?map 鏈韩浠?open銆俓n\n璇锋寜浠ヤ笅娴佺▼澶勭悊锛歕n\n1. 妫€鏌ュ畬鎴愮姸鎬佹槸鍚︾湡瀹烇細{closed}/{total} 宸?CLOSED 鈥斺€?浣?map 鏈韩浠?OPEN銆傝妫€鏌ワ細\n   - 瀛愮エ鏄惁鐪熺殑瑙ｅ喅浜嗗師 Destination锛焅n   - 鏄惁杩樻湁 Not yet specified 涓湭姣曚笟鐨勪簨椤癸紵\n   - 瀹為檯宸插畬鎴愬嵈婕忔爣 CLOSED 鐨?issue锛堟紡鍏?璇紑锛夆€斺€?閫愪釜鏍稿 ticket 鐨勫畬鎴愮姸鎬佷笌鍏抽棴鐘舵€佹槸鍚︿竴鑷达紱\n   - 鏄惁鏈?issue 灞炰簬璇?map 浣嗘湭寤虹珛 sub-issue 鍏崇郴锛沑n2. 纭鍚庡鐞嗭細\n   - 纭疄鍏ㄩ儴瀹屾垚 鈫?璋冪敤 close + 鍦?Decisions so far 杩藉姞鎬荤粨锛堟瘡涓?closed ticket 涓€琛?gist锛夛紱\n   - 鍙戠幇閬楁紡 鈫?鍒楀嚭鏈畬鎴愰」锛屽厛瑙ｅ喅鍐嶉噸鏂板垽鏂紱\n   - 涓嶇‘瀹?鈫?璇㈤棶鐢ㄦ埛銆岃鍦板浘鐨勫叏閮ㄥ伐浣滄槸鍚﹀凡瀹屾垚锛岄渶瑕佸仛鏀跺熬鍚楋紵銆嶄笉瑕佹搮鑷?close锛沑n3. 鏈€缁堢洰鏍囷細瑕佷箞 close map + 鍐?Decisions so far 鎬荤粨锛岃涔堟槑纭寚鍑烘湭瀹屾垚椤广€俓n\n浠庣涓€鎬у師鐞嗗嚭鍙戝畬鎴愪换鍔★紝骞跺鎶楀紡瀹℃煡銆俓n鏀跺熬瑙勫垯锛氬凡瀹炴柦瀹屾垚銆佹祴璇曠豢銆佷粎宸敤鎴风‘璁ょ殑绁?鈥斺€?宸茬‘璁ゅ垯 close锛屾湭纭鍒欐爣娉ㄣ€岃繘搴?100% 路 寰呴獙鏀躲€嶏紝涓嶅緱鏄剧ず涓烘湭鍔ㄥ伐銆俓n缁存姢鍦板浘璁板綍锛坵ayfinder 瑙勫垯锛夛細\n- 鍏抽棴涓€寮犵エ鏃讹紝鍦ㄦ墍灞?map 鐨?Decisions so far 杩藉姞涓€琛?gist锛堢エ鍚?+ 閾炬帴 + 涓€鍙ヨ瘽缁撹锛夛紱\n- 妫€鏌?map 鐨?Not yet specified锛氬彲鏄庣‘鐨勪簨椤规瘯涓氫负鏂扮エ锛坈reate-then-wire锛夛紝骞朵粠杩烽浘鑺傛竻闄わ紱\n- 瓒婂嚭鐩殑鍦拌寖鍥寸殑绁?鈫?绉诲叆 Out of scope锛堝啓鏄庡師鍥狅級锛屼笉鐣欏湪 frontier銆?, en: '## Completion check 路 MAP #{n}\n\nThe map shows 100% complete: {closed}/{total} issues closed, but the map itself is still open.\n\nHandle it as follows:\n\n1. Verify the completion is real: {closed}/{total} are CLOSED 鈥?but the map is still OPEN. Check:\n   - Did the sub-issues really resolve the original Destination?\n   - Are there ungraduated items left in Not yet specified?\n   - Any issue actually completed but missing CLOSED (missed/erroneous) 鈥?verify each ticket completion vs close state;\n   - Any issue belonging to this map without a sub-issue relationship;\n2. Then act:\n   - All truly done 鈫?close the map + append a summary to Decisions so far (one-line gist per closed ticket);\n   - Gaps found 鈫?list the unfinished items, resolve them first, then re-judge;\n   - Unsure 鈫?ask the user \\"Has all the work on this map been completed? Should we wrap up?\\" 鈥?do not close on your own;\n3. Goal: either close the map + write the Decisions-so-far summary, or clearly list the unfinished items.\n\nApproach tasks from first principles, and review adversarially.\nMaintain map records (wayfinder rules):\n- When closing a ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion);\n- Check the map Not yet specified: graduate specifiable items into new tickets (create-then-wire) and clear them from the fog section;\n- Tickets beyond the destination scope 鈫?move to Out of scope (with reason), never left on the frontier.' },
      "fixate": { version: 1, placeholders: [], use: '娌夋穩 路 闆朵涪澶卞揩鐓?, zh: '閲岀▼纰戝浐鍖栫偣銆傛殏鍋滄帹杩涳紝鎵ц銆岄浂涓㈠け蹇収銆嶏紝浠庣涓€鎬у師鐞嗗嚭鍙戯細\n\n1. 鍏ㄩ噺澶嶈堪锛氭妸鎴戜粠浼氳瘽寮€濮嬪埌鐜板湪璇磋繃鐨勫叏閮ㄤ俊鎭紝鎸夈€岀洰鐨勫湴 / 绾︽潫涓庡亸濂?/ 宸茬‘璁ょ殑鍐冲畾 / 寰呭喅闂 / 闆惧尯锛堥殣绾﹀彲瑙佷絾杩樹笉娓呮櫚锛夈€嶄簲绫伙紝閫愭潯鍒楀嚭鈥斺€斾笉鍘嬬缉銆佷笉鍚堝苟锛屽畞鍙暟鍡︿笉鍙渷鐣ャ€俓n2. 姣忔潯鍚庨潰鏍囨敞鍑哄锛氱敤鎴戠殑鍘熻瘽寮曠敤锛岃鎴戠煡閬撳畠鏉ヨ嚜鎴戝摢鍙ヨ瘽銆俓n3. 鍗曠嫭鍒椾竴鑺傘€屽彲鐤戦仐婕忋€嶏細鍑℃槸鎴戞彁杩囥€佷絾浣犺寰椾笌涓荤嚎鏃犲叧銆佸お妯＄硦鎴栧儚鎵ц缁嗚妭鑰屾病绾冲叆鐨勶紝鍏ㄩ儴鎽嗗嚭鏉ワ紝鍐欐槑浣犲綋鍒濅笉绾冲叆鐨勭悊鐢憋紝鐢辨垜瑁佸喅銆俓n4. 鍒楀畬鍚庡仠涓嬬瓑鎴戦€愭潯鏍稿銆傛垜纭鎴栦慨姝ｅ畬姣曞悗锛屼綘鍐嶆妸娓呭崟钀界洏锛氬凡鏈夊湴鍥惧氨鍐欒繘 map 姝ｆ枃鍜屽搴?ISSUE锛涘彧鏈塈SSUE灏卞啓杩涘搴擨SSUE锛涢兘娌℃湁灏卞厛鐢熸垚涓€浠藉揩鐓х瑪璁板苟鍛婅瘔鎴戝瓨鍝紝绛夊缓鍥炬椂鎼叆銆?, en: 'Milestone checkpoint. Pause progress and take a "zero-loss snapshot", from first principles:\n\n1. Restate everything I have said since the session started, in five categories: "Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)" 鈥?list every item, no compression, no merging, rather verbose than omitted.\n2. Annotate each item with its source: quote my original words so I know which sentence it came from.\n3. Add a separate "Suspected omissions" section: everything I mentioned but you deemed off-topic, too vague, or execution detail and did not include 鈥?list them all with your reason, and let me decide.\n4. Stop and wait for my item-by-item review after listing. Once I confirm or correct, persist the list: if a map exists, write into the map body and the corresponding ISSUEs; if only ISSUEs, write into those ISSUEs; if neither, create a snapshot note and tell me where it is, to migrate when a map is created.' },
      "progress": { version: 2, placeholders: [], use: '杩涘害濂戠害锛堟墍鏈夊姩浣?prompt 寮曠敤锛?, zh: '杩涘害琛ㄨ揪锛堟瘡娆″姩浣滅粨鏉熷墠蹇呴』鏇存柊 鈥斺€?杩欐槸鍔ㄤ綔鐨勪竴閮ㄥ垎锛屼笉鏄彲閫夐」锛夛細\n1. issue 姝ｆ枃缁存姢鍥哄畾杩涘害鍖猴細`## 杩涘害锛歂%`锛圢 涓?0-100 鏁存暟锛岀姝€屽ぇ姒?/ 鍩烘湰銆嶇瓑妯＄硦璇嶏級锛沑n2. 鏇存柊鍓嶅厛璇绘鏂囧綋鍓嶈繘搴︼紝鍩轰簬鏈€鏂扮姸鎬佸啓鐪熷疄褰撳墠鍊硷紙鍙笂璋冧篃鍙笅璋冿級锛沑n3. 鏈姩宸?= 0%锛涜繘琛屼腑 = 1-94%锛?5% = 宸插畬鎴愬緟鐢ㄦ埛纭锛堜笅涓€姝ユ敞鏄庛€屽緟纭浠€涔堛€嶏級锛涚‘璁ゅ悗绔嬪嵆鍐?100% 骞?close锛沑n4. 100% = 纭瀹屾垚锛坈lose 鍚庤繘搴﹀尯淇濈暀涓哄巻鍙诧級锛沑n5. 棣栨鎺ヨЕ鏃犺繘搴﹀尯鐨勭エ锛氬厛鎸夌幇鐘惰ˉ鍐欎竴涓笌瀹炴柦璁板綍鐩哥鐨勮繘搴︺€?, en: 'Progress expression (must update before finishing every action 鈥?it is part of the action, not optional):\n1. Keep a fixed progress section in the issue body: `## Progress: N%` (N is an integer 0-100; no vague words like "about / basically");\n2. Before updating, read the body current progress and write the true current value based on the latest state (can go up or down);\n3. Not started = 0%; in progress = 1-94%; 95% = done, awaiting user confirmation (note "what is pending" in the next step); once confirmed, immediately write 100% and close;\n4. 100% = confirmed done (the section stays as history after close);\n5. On first contact with a ticket lacking the section, write a progress matching its implementation record.' },
      "bodyFormat": { version: 2, placeholders: [], use: '姝ｆ枃鏍煎紡濂戠害锛圱16 路 缁熶竴杩藉姞浜?map/ticket 鍐欐鏂囩殑鍔ㄤ綔锛?, zh: '姝ｆ枃鏍煎紡锛堝啓/鏀?issue 姝ｆ枃鏃跺繀椤婚伒瀹堬級锛歕n1. 鐢ㄧ湡瀹炴崲琛屼功鍐欙細`## 绔犺妭` 鐙崰涓€琛岋紝娈佃惤闂寸暀绌鸿锛沑n2. 绂佹瀛楅潰 \\n 杞箟锛堜笉瑕佹妸鎹㈣鍐欐垚 \\n 涓や釜瀛楃锛夈€佺姝㈡鏂囦互 BOM锛圽\ufeff锛夊紑澶达紱\n3. 鍐欏洖 issue 姝ｆ枃鏃剁敤鏂囦欢鎵胯浇姝ｆ枃锛堢湡瀹炴崲琛岋級锛屼笉瑕佺敤 JSON/杞箟瀛楃涓插唴鑱旀嫾瑁呫€?, en: 'Body format (mandatory when writing/editing an issue body):\n1. Use real newlines: each `## section` on its own line, blank line between paragraphs;\n2. No literal \\n escapes (do not write newlines as the two characters backslash-n), no BOM (\\ufeff) at the start;\n3. Write issue bodies via file-based input (real newlines in the file), never inline JSON-escaped strings.' },
      "grill": { version: 1, placeholders: [], use: '婢勬竻瑙勫垯锛坓rilling 鎶€鑳斤級', zh: '鍔ㄦ墜鍓嶅厛鎯充竴涓嬶細鎴戣鍋氱殑浜嬮噷锛屾湁娌℃湁鍝儴鍒嗘槸銆屾垜鐚滅敤鎴锋兂瑕佽繖鏍枫€嶇殑锛熷鏋滄湁锛屽埆鐚?鈥斺€?鐢?grilling 鎶€鑳芥妸鐚滅殑鍦版柟闂竻妤氬啀鍔ㄦ墜銆?, en: 'Before you start, check: is any part of what you are about to do based on a guess about what the user wants? If so, do not guess 鈥?use the grilling skill to settle those guesses before acting.' },
      "newMap": { version: 2, placeholders: [], use: '寤哄浘瑙勫垝濂戠害', zh: '寤哄浘鍓嶅厛瀹屾垚锛堝啓鍏?map body 鏃㈡湁绔犺妭锛岄伒寰?wayfinder 鎶€鑳借鍒欙級锛歕n0. 鍏堢敤 grilling 婢勬竻鐩殑鍦颁笌鑼冨洿锛屼笉鑷繁瀹?scope锛沑n1. 骞惰 / 涓茶锛氬湪 Notes 鐢ㄤ竴鍙ヨ瘽姒傛嫭銆屽摢浜涚エ涓茶锛堣闃诲锛夈€佸摢浜涘彲骞惰銆嶏紱\n2. 宸茬煡 / 寰呰皟鏌?/ 杩烽浘锛氬凡纭 鈫?Decisions so far锛涘緟璋冩煡 鈫?寤虹エ锛涙ā绯婂緟瀹?鈫?Not yet specified锛堣糠闆惧尯锛屽悗缁瘯涓氫负鏂扮エ锛夛紱\n3. 褰掑睘锛氭瘡寮犵エ澹版槑寤鸿 owner锛坅gent 鎴栦汉 路 HITL锛夛紝grilling 绫诲繀椤绘爣 HITL锛沑n4. 姣忓紶鏂板缓绁ㄥ啓鍏?`## 杩涘害锛?%` 鍩哄噯銆?, en: 'Complete before building a map (write into the map body existing sections, follow the wayfinder skill rules):\n0. Clarify the destination and scope with grilling first; do not set scope yourself;\n1. Parallel / serial: summarize in Notes in one sentence "which tickets are serial (blocked) and which run in parallel";\n2. Known / to-investigate / fog: confirmed 鈫?Decisions so far; to investigate 鈫?create tickets; vague pending 鈫?Not yet specified (the fog zone, later graduating into new tickets);\n3. Ownership: declare a suggested owner per ticket (agent or human 路 HITL); grilling tickets must be marked HITL;\n4. Write a `## Progress: 0%` baseline into every new ticket.' },
      "tpl.diagnose": { version: 3, placeholders: ['url'], use: '鍔ㄤ綔鎸夐挳銆岃瘖鏂€嶏紙needs-triage 绁級', zh: '/triage\n{url}\n\n璇婃柇杩欎釜 issue锛堣瘖鏂祦绋嬮伒寰?/triage 鎶€鑳借嚜韬鍒欙級锛歕n1. 鍏堝紕娓呭畠鍒板簳鍑轰簡浠€涔堥棶棰橈紙鐜拌薄 / 褰卞搷鑼冨洿 / 澶嶇幇姝ラ锛夛紱\n2. 鍒楀嚭鍙兘鐨勬牴鍥狅紙澶氫釜鍊欓€夛紝鏍囨敞鍚勮嚜鍙兘鎬э級锛沑n3. 缁欏垎娴佸缓璁紙淇 / 鍏抽棴 / 閲嶈璁?/ 绛夊緟锛夆€斺€?寤鸿鏄綘鐨勫垽鏂紝涓嶆槸璁╀綘鐩存帴鎵ц锛沑n4. 鍔ㄦ墜鍓嶈嫢鏈夈€屾垜鐚滅敤鎴锋兂瑕佽繖鏍枫€嶇殑鍦版柟锛屽厛鐢?grilling 鎶€鑳芥緞娓咃紱\n5. 缁撴潫鍓嶆寜杩涘害濂戠害鏇存柊 issue 姝ｆ枃銆?, en: '/triage\n{url}\n\nDiagnose this issue (follow the /triage skill own rules):\n1. Pin down what is actually wrong (symptoms / impact / repro steps);\n2. List possible root causes (multiple candidates, with confidence);\n3. Propose triage (fix / close / redesign / wait) 鈥?a recommendation for the user, not a license to execute;\n4. Before acting, if any part rests on a guess about what the user wants, settle it with the grilling skill first;\n5. Update the issue body per the progress contract before finishing.' },
      "tpl.fix": { version: 2, placeholders: ['url'], use: '鍔ㄤ綔鎸夐挳銆屼慨澶嶃€嶏紙bug 绁級', zh: '/implement\n{url}\n\n淇杩欎釜 bug锛堥伒寰?wayfinder 鎶€鑳借鍒欙級锛歕n1. 鍏堝鐜帮紝鍐嶅畾浣嶆牴鍥狅紙淇敊鍦版柟 = 鐧戒慨锛夛紱\n2. 瀹炴柦淇锛沑n3. 鍔犳祴璇曞苟璺戦€氾紱\n4. 瀵规姉寮忓鏌ヨ嚜宸辩殑鏀瑰姩锛堟垜浼氭紡鍦ㄥ摢閲岋紵锛夛紱\n5. 鏈夊亣璁惧厛鐢?grilling 鎶€鑳芥緞娓咃紝涓嶉粯璁わ紱\n6. 缁撴潫鍓嶆寜杩涘害濂戠害鏇存柊锛堜慨澶嶅畬鎴愪絾鏈獙鏀?鈫?95% 路 寰呯‘璁わ級銆?, en: '/implement\n{url}\n\nFix this bug (follow the wayfinder skill rules):\n1. Reproduce it first, then find the root cause (fixing the wrong spot is wasted work);\n2. Implement the fix;\n3. Add tests and get them green;\n4. Adversarially review your own change (where did I miss?);\n5. Settle assumptions with the grilling skill first, never assume;\n6. Update per the progress contract before finishing (fix done, unverified 鈫?95% 路 awaiting confirmation).' },
      "tpl.discuss": { version: 2, placeholders: ['url'], use: '鍔ㄤ綔鎸夐挳銆岃璁恒€嶏紙grilling 绁級', zh: '/grill-me\n{url}\n\n杩欎釜 issue 闇€瑕佽璁哄畾澶猴紝鐢?grilling 鎶€鑳藉拰鎴戝璇濓紙瀵硅瘽鏂瑰紡閬靛惊 grilling 鎶€鑳借嚜韬鍒欙級锛歕n1. 璁ㄨ鍥寸粫鐩爣 / 杈圭晫 / 椋庨櫓 / 閫夐」鏉冭　 / 鍐崇瓥锛沑n2. 涓嶆浛鎴戝仛鍐冲畾锛岀瓑鎴戠‘璁ょ粨璁猴紱\n3. 璁ㄨ鏈夌粨璁烘椂锛屾妸缁撹鍐欒繘 issue 姝ｆ枃锛堟垨寤鸿钀芥垚绁?/ 鍐崇瓥璁板綍锛夛紱\n4. 缁撴潫鍓嶆寜杩涘害濂戠害鏇存柊銆?, en: '/grill-me\n{url}\n\nThis issue needs discussion before a decision 鈥?use the grilling skill to talk with me (follow the grilling skill own dialogue rules):\n1. Keep the discussion on goal / boundary / risks / options-tradeoffs / decision;\n2. Do not decide for me; wait for my confirmation of conclusions;\n3. When a conclusion emerges, write it into the issue body (or propose it as a ticket / decision record);\n4. Update per the progress contract before finishing.' },
      "tpl.execute": { version: 4, placeholders: ['url'], use: '鍔ㄤ綔鎸夐挳銆屾墽琛屻€嶏紙鏅€氱エ锛?, zh: '/wayfinder\n{url}\n\n鎵ц杩欎釜 issue锛堥伒寰?wayfinder 鎶€鑳借鍒欙級锛歕n1. 鍏堣棰嗭紙鑻ユ湭璁ら锛夛紱璇?Description / Notes / 闃诲鍏崇郴锛岀‘璁ゅ畠鍒板簳瑕佷氦浠樹粈涔堬紱\n2. 鑻ョ洰鏍囦笉娓呮垨闇€瑕佺敤鎴峰畾澶?鈫?鍏堢敤 grilling 鎶€鑳芥緞娓咃紱\n3. 鍒跺畾鏂规 鈫?瀹炴柦 鈫?鎸夐獙鏀舵爣鍑嗚嚜鏌ワ紱\n4. 瀹屾垚涓旈€氳繃楠屾敹 鈫?100% + close锛涙湭瀹屾垚 鈫?鎸夎繘搴﹀绾﹀瀹炴洿鏂帮紙鍚笅涓€姝ワ級銆俓n鑻ユ墽琛屽悗鍏抽棴浜嗚绁細鍦ㄦ墍灞?map 鐨?Decisions so far 杩藉姞涓€琛?gist锛堢エ鍚?+ 閾炬帴 + 涓€鍙ヨ瘽缁撹锛夈€?, en: '/wayfinder\n{url}\n\nExecute this issue (follow the wayfinder skill rules):\n1. Claim it first (if unclaimed); read Description / Notes / blocking relationships; confirm what it must deliver;\n2. If the goal is unclear or needs the user call, settle it with the grilling skill first;\n3. Plan 鈫?implement 鈫?self-check against acceptance criteria;\n4. Done and verified 鈫?100% + close; otherwise update honestly per the progress contract (with next step).\nIf this execution closes the ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion).' },
      "tpl.handoff1": { version: 1, placeholders: ['ts'], use: '浜ゆ帴绗竴鍑伙紙鍐欎氦鎺ユ枃妗ｏ級', zh: '/handoff\n\n璇锋妸褰撳墠浼氳瘽鐢熸垚浜ゆ帴鏂囨。锛屽啓鍒?.scratch/handoff/{ts}.md锛堢浉瀵瑰綋鍓嶅伐浣滅洰褰曪級锛屽寘鍚笁閮ㄥ垎锛歕n1. 缁撹锛氭湰娆′細璇濆凡纭鐨勫喅瀹氫笌鎴愭灉锛沑n2. 鏈畬鎴愪簨椤癸細涓嬩竴姝ヨ缁х画鐨勪簨锛沑n3. 寤鸿 skill锛氭柊浼氳瘽鎺ユ墜鏃跺缓璁姞杞界殑鎶€鑳姐€俓n\n浠庣涓€鎬у師鐞嗗嚭鍙戝畬鎴愪换鍔★紝骞跺鎶楀紡瀹℃煡銆?, en: '/handoff\n\nCreate a handoff doc from this session, written to .scratch/handoff/{ts}.md (relative to the current working directory), with three parts:\n1. Conclusion: decisions and outcomes confirmed this session;\n2. Unfinished: what to continue next;\n3. Suggested skills: skills the next session should load.\n\nApproach tasks from first principles, and review adversarially.' },
      "tpl.handoff2": { version: 1, placeholders: ['file'], use: '浜ゆ帴绗簩鍑伙紙璇讳氦鎺ユ枃妗ｏ級', zh: '/read .scratch/handoff/{file}\n\n璇峰厛闃呰杩欎唤浜ゆ帴鏂囨。骞跺杩扮‘璁ょ悊瑙ｏ紙缁撹 / 鏈畬鎴愪簨椤?/ 寤鸿 skill锛夛紝鐒跺悗浠庣涓€鎬у師鐞嗗嚭鍙戝畬鎴愪换鍔★紝骞跺鎶楀紡瀹℃煡銆?, en: '/read .scratch/handoff/{file}\n\nRead this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.' },
      "handoffRead": { version: 1, placeholders: [], use: '浜ゆ帴绗簩鍑诲厹搴曪紙鏃犳枃浠舵椂锛?, zh: '/read .scratch/handoff/latest.md\n\n璇峰厛闃呰杩欎唤浜ゆ帴鏂囨。骞跺杩扮‘璁ょ悊瑙ｏ紙缁撹 / 鏈畬鎴愪簨椤?/ 寤鸿 skill锛夛紝鐒跺悗浠庣涓€鎬у師鐞嗗嚭鍙戝畬鎴愪换鍔★紝骞跺鎶楀紡瀹℃煡銆?, en: '/read .scratch/handoff/latest.md\n\nRead this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.' },
      "installSkills": { version: 1, placeholders: [], use: '鎶€鑳藉畨瑁呭紩瀵?路 DSH 涓撶敤锛堟í骞?/ 寮曞 g4 / 璁剧疆椤靛鍒讹級', zh: '璇蜂负 DSH 瀹夎 Matt Pocock 鐨?skills 鎶€鑳藉浠讹紙mattpocock/skills锛夛細\n1. 鍏嬮殕 https://github.com/mattpocock/skills锛沑n2. 鎸夊畼鏂?README 灏嗗伐绋嬮鍩熶笌閫氱敤棰嗗煙鐨勫叏閮?skills 瀹夎鍒?DSH 璇诲彇鐨勬妧鑳界洰褰曪細鐢ㄦ埛涓荤洰褰曚笅鐨?~/.agents/skills锛堟湰濂椾欢浠呯敤浜?DSH锛屼笉瑕佸畨瑁呭埌鍏朵粬 AI 宸ュ叿锛夛紱\n3. 瀹夎鍚庨獙璇?wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills 绛夋妧鑳芥枃浠跺凡灏变綅锛沑n4. 瀹屾垚鍚庢眹鎶ュ畨瑁呯粨鏋滀笌宸茶鎶€鑳芥竻鍗曘€?, en: 'Install the Matt Pocock skills collection (mattpocock/skills) for DSH:\n1. Clone https://github.com/mattpocock/skills;\n2. Per the official README, install all engineering and general-purpose skills into the skill directory DSH reads: ~/.agents/skills under the user home (this collection is for DSH only 鈥?do not install it into other AI tools);\n3. After install, verify wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills are in place;\n4. Report the result and the installed skill list when done.' },
      "setupRun": { version: 6, placeholders: [], use: '鐜妫€鏌ユí骞?路 setup 鏈墽琛屾寜閽紙浠呭垵濮嬪寲锛屼笉閲嶈鎶€鑳斤級', zh: '/setup-matt-pocock-skills\n\n鍒濆鍖栨湰浠撳簱锛堟妧鑳藉浠跺凡瀹夎锛屾棤闇€鍏嬮殕閲嶈锛夛細\n1. issue tracker 閫夋嫨 GitHub Issues锛沑n2. 鍒濆鍖栨椂鎸?setup-matt-pocock-skills 鎶€鑳借嚜韬祦绋嬫墽琛岋紙issue tracker 閫夋嫨 GitHub Issues锛泃riage 鏍囩淇濈暀榛樿浜旇鑹诧級锛屽苟纭繚浠撳簱涓妧鑳芥墍闇€鏍囩榻愬叏锛坱riage 浜旇鑹?+ wayfinder 鏍囩 wayfinder:map / research / prototype / grilling / task锛夛紝涓嶈鍙缓灏戞暟鍑犱釜锛涘悗缁墦鏍囩涓ユ牸閬靛惊鎶€鑳借鍒欙紝涓嶉澶栧己鍒朵换浣曟爣绛撅紱\n3. 鍒濆鍖栧畬鎴愬悗澶嶆煡鐜妫€鏌ワ紙setup 鍙樼豢鍗冲畬鎴愶級銆?, en: '/setup-matt-pocock-skills\n\nBootstrap this repo (the skill suite is already installed 鈥?no need to clone or reinstall):\n1. Choose GitHub Issues as the issue tracker;\n2. During init, follow the setup-matt-pocock-skills skill own flow (choose GitHub Issues as the tracker; keep the default triage-role labels), and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) 鈥?not just a few; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;\n3. After init, re-run the environment check (setup turns green when done).' },
      "newWayfinder": { version: 7, placeholders: ['repo'], use: '銆? 鏂板缓闇€姹傘€嶆寜閽?, zh: '/wayfinder\n璇峰府鎴戝鐞嗕竴涓渶姹傦紙涓ユ牸閬靛惊 wayfinder 鎶€鑳借鍒欙級銆俓n浠撳簱锛堝凡鑷姩濉叆褰撳墠宸ヤ綔鍖猴級锛歿repo}\n\n鏀跺埌闇€姹傚悗鎸変互涓嬫祦绋嬶細\n1. 鍏堟緞娓咃細瀵圭洰鏍?/ 鑼冨洿 / 鍋忓ソ鏈夊亣璁炬椂锛屽厛鐢?grilling 鎶€鑳芥緞娓咃紝涓嶉粯璁わ紱\n2. 鍒ゆ柇鍒嗙被锛堟寜闇€姹傜矑搴?/ 寤哄浘绮掑害锛夆€斺€斿厛鏌ヤ粨搴撳凡鏈?wayfinder:map 鍜?issue锛岀‘璁ゆ槸鍚﹀仛杩囷細\n   - 鏂板锛氬叏鏂伴渶姹傦紝涔嬪墠娌″仛杩?鈫?鎸夊缓鍥捐鍒掑绾︽柊寤?map锛圖estination + Notes + plan + tickets锛泃ickets 椤讳互 sub-issue 鍏宠仈鍒?map锛宐locking 鐢?Blocked by: #<n> 琛岃〃绀猴級锛沑n   - 澶嶇敤锛氳繖涓渶姹備箣鍓嶅凡鍋氳繃锛堝凡鏈?map / issue锛夆啋 鎵撳紑澶嶇敤瀹冿紝涓嶉噸澶嶅缓锛沑n   - 鐩存帴瀹炵幇锛氶渶姹傚緢灏?鈫?寤轰竴涓?issue 鐩存帴瀹炵幇锛屼笉寤哄ぇ map锛沑n3. 鎵ц鍚庢寜杩涘害濂戠害鏇存柊銆?, en: '/wayfinder\nPlease handle a requirement (strictly follow the wayfinder skill rules).\nRepo (auto-filled from current workspace): {repo}\n\nAfter receiving the requirement, follow this flow:\n1. Clarify first: if you hold assumptions about the goal / scope / preferences, settle them with the grilling skill, never assume;\n2. Decide the case (by requirement / map granularity) 鈥?first check existing wayfinder:map and issues in the repo to confirm whether it has been done:\n   - Add: a brand-new requirement never done before 鈫?build a new map per the planning contract (Destination + Notes + plan + tickets; wire tickets as sub-issues of the map, blocking as `Blocked by: #<n>`);\n   - Reuse: this requirement has been done before (existing map / issue) 鈫?open and reuse it, do not build a new one;\n   - Directly implement: the requirement is small 鈫?create a single issue and implement it directly, no big map;\n3. Update per the progress contract after execution.' },
      "newBugWayfinder": { version: 4, placeholders: ['repo'], use: '銆? 鏂板BUG鍗曘€嶆寜閽?/ 鐘舵€佹爮 BUG 鎮仠鑿滃崟銆屾柊澧炪€嶏紙issue #4 路 v2 淇?#1 BUG3锛氳緭鍏ヤ綅绉诲埌鏈熬 路 v3 #14锛氱簿绠€涓?4 瀛楁 路 v4 #63锛氬幓鍐呴儴瑙勫垯+瀹為檯鈫掓湡鏈?鎷彿鍗曡锛?, zh: '/wayfinder\n璇峰府鎴戞柊澧炰竴涓?BUG 鍗曪紙鎸?wayfinder 鎶€鑳借鍒欏鐞嗭級銆俓n浠撳簱锛歿repo}', en: '/wayfinder\nPlease help me file a new BUG ticket (follow the wayfinder skill rules).\nRepo: {repo}' },
      "mapHead": { version: 1, placeholders: ['n', 'title', 'url'], use: '鏂颁細璇?鎵ц 路 map 鏍囪瘑澶达紙B2锛?, zh: '## 鐩爣 map\n- 缂栧彿锛?{n}\n- 鏍囬锛歿title}\n- 閾炬帴锛歿url}', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}' },
      "stageGate": { version: 2, placeholders: [], use: '闃舵闂搁棬鏉℃锛圱13 路 缁熶竴杩藉姞浜?璇婃柇/淇/鎵ц/map鎺ㄨ繘 鍔ㄤ綔锛歯eeds-triage 蹇呴』鍏堣瘖鏂苟鍒ゆ柇鐜扮姸锛?, zh: '闃舵闂搁棬锛堝姩浣滃紑濮嬪墠蹇呰锛岃繖鏄姩浣滅殑涓€閮ㄥ垎锛屼笉鏄彲閫夐」锛夛細\n1. 鍏堣璇?issue 鐜扮姸锛氳繘搴﹀尯锛?# 杩涘害锛歂%锛? 宸叉湁瀹炴柦璁板綍 / 璇勮 / 鏍囩锛屽垽鏂畠澶勪簬鍝釜闃舵锛沑n2. 鑻ュ甫 needs-triage 鏍囩锛氬繀椤诲厛瀹屾垚璇婃柇锛堣繖鏄墠缃楠わ紝涓嶈璺宠繃鐩存帴瀹炴柦锛夛紱\n3. 璇婃柇鏃跺垽鏂綋鍓嶈繘灞曪細\n   - 宸叉湁瀹炴柦涓旂湡瀹?鈫?鏍搁獙鏄惁绗﹀悎楠屾敹鏍囧噯锛屽睘瀹炲垯缁存寔 95% 寰呯‘璁?+ 鎽?needs-triage锛堣浆 ready-for-agent锛夛紱\n   - 宸叉湁瀹炴柦浣嗚櫄鍋?鍗婃垚鍝?鈫?杩涘害鎹疄鍥炶皟鍒扮湡瀹炲€硷紙濡?30%锛夛紝缁х画璇婃柇锛沑n   - 鏈姩宸?鈫?姝ｅ父璇婃柇锛堝鐜?鈫?鏍瑰洜 鈫?鏂规 鈫?鍐欏叆 issue锛夛紱\n4. 璇婃柇瀹屾垚鎽?needs-triage 鍚庢墠鍏佽杩涘叆瀹炴柦闃舵銆?, en: 'Stage gate (must read before starting the action 鈥?it is part of the action, not optional):\n1. First read the issue current state: progress section (## Progress: N%) / existing implementation record / comments / labels 鈥?determine which stage it is in;\n2. If it carries the needs-triage label: diagnosis MUST be completed first (a prerequisite step 鈥?do not skip straight to implementation);\n3. During diagnosis, judge current progress:\n   - Existing implementation and it is real 鈫?verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (move to ready-for-agent);\n   - Existing implementation but fake/partial 鈫?revise progress back to the true value (e.g. 30%) and continue diagnosing;\n   - Not started 鈫?normal diagnosis (reproduce 鈫?root cause 鈫?plan 鈫?write into the issue);\n4. Only after diagnosis is done and needs-triage removed may implementation begin.' },
    }
    // 褰撳墠璇█锛堣窡闅?DSH locale 蹇収 active锛涚己鐪?zh锛?
    const promptLang = function () {
      try {
        const l = (localeSvc && typeof localeSvc.getSnapshot === 'function') ? localeSvc.getSnapshot().active : null
        return (l === 'en' || String(l || '').indexOf('en') === 0) ? 'en' : 'zh'
      } catch (e) { return 'zh' }
    }
    // 鍙?prompt锛歱romptText(id) 鎴?promptText(id, { 鍗犱綅绗? 鍊?})
    const promptText = function (id, params) {
      const p = PROMPTS[id]
      if (!p) return ''
      let s = (promptLang() === 'en' && p.en) ? p.en : (p.zh || '')
      if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m })
      return s
    }
    // 甯搁噺鍒悕锛堟棦鏈夊紩鐢ㄤ笉鍙橈級
    const GUIDE_LINE = promptText('guide')
    // v1.5 T4/T5锛歁att 鎶€鑳戒粨搴擄紙浠嬬粛鍗?GitHub 閾炬帴锛?
    const MATT_REPO = 'https://github.com/mattpocock/skills'
    const MAP_EXECUTE_PROMPT = function () { return promptText('mapExecute') }
    const COMPLETE_PROMPT = function () { return promptText('complete') }
    // T16锛氭鏂囨牸寮忓绾︼紙鍐?鏀?issue 姝ｆ枃鐨勫姩浣滅粺涓€杩藉姞锛?
    const BODY_FORMAT = function () { return promptText('bodyFormat') }
    // v4锛?63 grilling 瀹氱増 2026-08-20锛夛細鍘?wayfinder 鍐呴儴瑙勫垯澶嶈堪锛?63 鎯虫硶1锛歱rompt 涓嶅惈宸茬煡瑙勫垯锛実h 纭紪鐮佽В鑰︾敱 bodyFormat #62 鎵挎媴锛? 瀛楁闆?4 椤归『搴忓疄闄呪啋鏈熸湜鈫掑鐜扳啋鐜 + 褰㈡€佹嫭鍙峰崟琛岋紙鎯虫硶2锛氬瓧娈靛悕锛堣鏄庯級锛氬啋鍙峰嵆濉紝鏃犳偓琛屼緥琛岋級
    //   瀛楁闆嗭紙绗竴鎬у師鐞嗭細Bug = 瀹為檯 vs 鏈熸湜鍋忓樊锛屽疄闄呭厛浜庢湡鏈涳級锛氬疄闄咃紙鍚告敹鐜拌薄+褰卞搷鑼冨洿锛? 鏈熸湜 / 澶嶇幇姝ラ锛堝惛鏀惰儗鏅?鍦烘櫙 preamble锛? 鐜淇℃伅锛泎h 鍙腑鏂囥€乪n 鍙嫳鏂囷紝璺熼殢 DSH 璇█涓€娆″彧鍑轰竴绉?
    const NEW_BUG_FIELDS_BODY = function () { return '\n\n瀹為檯锛堢湅鍒颁粈涔堬紱鍙惈褰卞搷鑼冨洿锛夛細\n鏈熸湜锛堝簲鍙戠敓浠€涔?/ 棰勬湡缁撴灉锛夛細\n澶嶇幇姝ラ锛圼鍓嶇疆 / 鍦烘櫙] + 缂栧彿姝ラ锛夛細\n鐜淇℃伅锛圤S + 娴忚鍣?+ 鎻掍欢鐗堟湰锛夛細' }
    // v4锛?63锛夛細EN locale 鐗?鈥斺€?鎷彿璇存槑鍗曡锛岃窡闅?v4 zh 瀹為檯鈫掓湡鏈涢『搴?
    const NEW_BUG_FIELDS_BODY_EN = function () { return '\n\nActual (what happened; may include impact):\nExpected (what should happen / expected result):\nReproduction ([Preamble / Scenario] + numbered steps):\nEnvironment (OS + browser + plugin version):' }
    // v1.5锛氬畬鎴愮‘璁?prompt 鈥斺€?鎶€鑳?閾炬帴鍓嶇疆锛?wayfinder + map 閾炬帴锛夛紝鍐嶆嫾瀹屾垚纭姝ｆ枃锛堝畬鎴?= wayfinder锛?
    const completePrompt = function (st, num, total, closed) {
      return '/wayfinder\n' + 'https://github.com/' + repoStr(st) + '/issues/' + String(num || '') + '\n\n' +
        COMPLETE_PROMPT().split('{n}').join(String(num || '')).split('{total}').join(String(total)).split('{closed}').join(String(closed)) +
        (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '')
    }
    const FIXATE_PROMPT = function () { return promptText('fixate') }

    const CFG_KEY = 'dsws.cfg'
    // 鍔熻兘閰嶇疆锛堢敤鎴锋媿鏉?2026-08-14锛氬瑙傚浘鏍?鍔ㄤ綔璇嶇敱璁捐瀹氭锛屼笉鎻愪緵閰嶇疆椤癸級
    // v1.4锛氭墦寮€浣嶇疆 cfg.openIn 鈥斺€?妫€娴嬪埌 dsh-better-sidebar 宸茶鍒欓粯璁?'sidebar'锛屽惁鍒?'dock'锛?
    //   localStorage 宸叉湁鍊煎垯灏婇噸鐢ㄦ埛閫夋嫨锛堜笉瑕嗙洊锛?
    const cfg = (function () {
      const bsInstalled = !!(ctx.get('betterSidebar') && typeof ctx.get('betterSidebar').registerTab === 'function')
      const d = { withWayfinder: true, openIn: bsInstalled ? 'sidebar' : 'dock' }
      try {
        const raw = localStorage.getItem(CFG_KEY)
        if (raw) {
          const saved = JSON.parse(raw)
          if (typeof saved.openIn === 'string') d.openIn = saved.openIn  // 鐢ㄦ埛宸查€夎繃 鈫?灏婇噸
          else d.openIn = bsInstalled ? 'sidebar' : 'dock'              // 棣栨 鈫?鎸夊畨瑁呮儏鍐甸粯璁?
        }
        return Object.assign({ withWayfinder: true, openIn: 'dock' }, d)
      } catch (e) { /* 瀛樺偍涓嶅彲鐢ㄧ敤榛樿 */ }
      return d
    })()
    const saveCfg = function () { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) {} }
    // 妯℃澘瀛樺偍锛圱2b 鎵╁睍鍏ㄩ儴鍔ㄤ綔锛汿2a 鍏堟壙杞?execute = 鏃?custom锛?
    const TPL_KEY = 'dsws.templates'
    const templates = (function () {
      const d = { diagnose: '', fix: '', discuss: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
      try {
        const raw = localStorage.getItem(TPL_KEY)
        if (raw) return Object.assign(d, JSON.parse(raw))
      } catch (e) { /* 瀛樺偍涓嶅彲鐢ㄧ敤榛樿 */ }
      return d
    })()
    const saveTemplates = function () { try { localStorage.setItem(TPL_KEY, JSON.stringify(templates)) } catch (e) {} }
    // 杩佺Щ锛氭棫 dsws.startCfg锛坽withWayfinder, custom}锛夆啋 cfg.withWayfinder + templates.execute锛屾垚鍔熷悗娓呮棫 key
    const migrateStartCfg = function () {
      try {
        const raw = localStorage.getItem('dsws.startCfg')
        if (!raw) return
        const old = JSON.parse(raw)
        if (old && typeof old === 'object') {
          if (typeof old.withWayfinder === 'boolean') cfg.withWayfinder = old.withWayfinder
          if (typeof old.custom === 'string' && old.custom) templates.execute = old.custom
          saveCfg(); saveTemplates()
        }
        localStorage.removeItem('dsws.startCfg')
      } catch (e) { /* 杩佺Щ澶辫触淇濈暀鏃?key锛屼笅娆″啀璇?*/ }
    }
    migrateStartCfg()

    // ---- v25 路 T2b锛氬姩浣滄ā鏉垮紩鎿庯紙T1 瑙勬牸 搂2-搂4锛?---
    // 鍗犱綅绗﹀叏闆嗭細{url} {number} {title} {ts} {file}锛堝紩瀵煎彞鏄櫘閫氶潤鎬佹枃鏈紝涓嶆槸鍗犱綅绗︼級
    const PH = ['url', 'number', 'title', 'ts', 'file']
    // 鍚勬ā鏉垮彲鐢ㄥ崰浣嶇锛堢紪杈戝櫒 chips 灞曠ず锛?
    const TPL_PH = {
      diagnose: ['url'], fix: ['url'], discuss: ['url'], execute: ['number', 'url', 'title'],
      handoff1: ['ts'], handoff2: ['file'], fixate: [],
    }
    // 寮哄埗鍗犱綅绗﹁〃锛圱1 瑙勬牸 搂3锛夛細缂哄け鎷掔粷淇濆瓨
    const TPL_REQUIRED = {
      diagnose: ['url'], fix: ['url'], discuss: ['url'], execute: ['url'],
      handoff1: ['ts'], handoff2: ['file'], fixate: [],
    }
    // 榛樿妯℃澘鏂囨湰锛堢┖ = 鐢ㄩ粯璁わ紱T1 瑙勬牸 搂3 榛樿鏂囨湰 = 鐜扮姸浠ｇ爜鏂囨湰锛?
    const TPL_DEFAULT = {
      // T4 #9-12锛? 涓姩浣滄寜閽?prompt 鏄庣‘鍖?
      diagnose: function () { return promptText('tpl.diagnose') },
      fix: function () { return promptText('tpl.fix') },
      discuss: function () { return promptText('tpl.discuss') },
      execute: function () { return promptText('tpl.execute') },
      handoff1: function () { return promptText('tpl.handoff1') },
      handoff2: function () { return promptText('tpl.handoff2') },
      fixate: function () { return promptText('fixate') },
    }
    const tplText = (id) => templates[id] || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : '')
    // 娓叉煋锛氳浆涔?{{x}} 鈫?瀛楅潰 {x}锛堝厛鏇挎崲鍝ㄥ叺闃茶鏇挎崲锛夛紝鍐嶆浛鎹㈠凡鐭ュ崰浣嶇锛涙湭鐭ュ崰浣嶇淇濈暀鍘熸牱锛堜繚瀛樺眰宸叉嫤鎴級
    // T13 淇锛氶樁娈甸椄闂ㄧ粺涓€杩藉姞 鈥斺€?璇婃柇/淇/鎵ц 涓夌被鍔ㄤ綔**鏈熬**鎷?stageGate锛堟妧鑳藉懡浠?閾炬帴淇濇寔寮€澶达紝鑷畾涔夋ā鏉夸篃鐢熸晥锛屽厤鐤鐩栵級
    const STAGE_GATED_IDS = ['diagnose', 'fix', 'execute']
    const renderTemplate = function (id, values) {
      let text = String(tplText(id))
      if (STAGE_GATED_IDS.indexOf(id) >= 0) {
        const gate = promptText('stageGate')
        if (gate) text = text + '\n\n' + gate
      }
      const esc = []
      text = text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, function (m, name) { esc.push('{' + name + '}'); return '\u0001' + (esc.length - 1) + '\u0001' })
      text = text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : m
      })
      esc.forEach(function (s, i) { text = text.replace('\u0001' + i + '\u0001', s) })
      return text
    }
    // 鏍￠獙锛氳浆涔夐澶勭悊 鈫?鏈煡鍗犱綅绗︽娴?鈫?寮哄埗鍗犱綅绗︾己澶辨娴嬶紙T1 瑙勬牸 搂4 椤哄簭锛?
    const validateTemplate = function (id, text) {
      const found = []
      const scrubbed = String(text || '').replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, '')
      const re = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
      let m
      while ((m = re.exec(scrubbed)) !== null) found.push(m[1])
      const unknown = []
      found.forEach(function (n) { if (PH.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n) })
      const missing = []
      ;(TPL_REQUIRED[id] || []).forEach(function (n) { if (found.indexOf(n) < 0 && missing.indexOf(n) < 0) missing.push(n) })
      return { ok: unknown.length === 0 && missing.length === 0, unknown: unknown, missing: missing }
    }
    const fixateText = () => tplText('fixate')

    // ============================================================
    // 3. store锛坴14锛氭寜浼氳瘽闅旂锛涙棤 sid 鏃剁敤 shared锛?
    // ============================================================
    // v24-48锛氶潰鏉块粯璁ら珮搴?= 灞忓箷绾?1/2
    // v1.5 T3锛氶潰鏉块粯璁ら珮搴﹀浐瀹?1/2锛堢敤鎴锋媿鏉垮交搴曠Щ闄?panelHeight 閰嶇疆 鈥斺€?details 鍒楅珮搴︿笌瀹冩棤鍏筹紝閰嶇疆涓嶇敓鏁堬級
    const DEFAULT_PANEL_H = (function () {
      try { return Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) } catch (e) { return 400 }
    })()
    // #374锛氫富鍒楄〃鍋忓ソ锛堟帓搴?鐘舵€佽繃婊わ級鎸佷箙鍖栵紙localStorage 涓嶅彲鐢ㄦ椂闄嶇骇榛樿鍊硷級
    const LIST_PREFS_KEY = 'dsws.listPrefs'
    const listPrefs = (function () {
      const d = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
      try {
        const raw = localStorage.getItem(LIST_PREFS_KEY)
        if (raw) return Object.assign(d, JSON.parse(raw))
      } catch (e) { /* 瀛樺偍涓嶅彲鐢ㄧ敤榛樿 */ }
      return d
    })()
    const saveListPrefs = function () { try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(listPrefs)) } catch (e) {} }
    // #375锛歭abel 鐐瑰嚮璁板繂锛堟鏁?+ 鏈€杩戠偣鍑绘椂闂达紝鍙岄敭鎺掑簭锛?
    const LABEL_CLICKS_KEY = 'dsws.labelClicks'
    const labelClicks = (function () {
      try {
        const raw = localStorage.getItem(LABEL_CLICKS_KEY)
        if (raw) { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {} }
      } catch (e) { /* 瀛樺偍涓嶅彲鐢ㄩ檷绾х函棰戞 */ }
      return {}
    })()
    const saveLabelClicks = function () { try { localStorage.setItem(LABEL_CLICKS_KEY, JSON.stringify(labelClicks)) } catch (e) {} }
    // ============  issuePath 路 鐘舵€佹爮褰撳墠澶勭悊 Issue 杞ㄨ抗锛坴1.7.0 map #79 路 S-rec锛?===========
    const ISSUE_PATH_KEY = 'dsws.issuePath'
    const ISSUE_PATH_MAX = 100
    const ISSUE_PATH_DEBOUNCE_MS = 500
    let _issuePathSaveTimer = null
    const loadIssuePathMap = function () {
      try {
        const raw = localStorage.getItem(ISSUE_PATH_KEY)
        if (!raw) return {}
        const o = JSON.parse(raw)
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}
      } catch (e) { return {} }
    }
    const saveIssuePathMapNow = function (map) {
      try { localStorage.setItem(ISSUE_PATH_KEY, JSON.stringify(map)) } catch (e) {}
    }
    const persistIssuePath = function (st) {
      if (!st || !st.issuePath) return
      if (_issuePathSaveTimer) try { clearTimeout(_issuePathSaveTimer) } catch (e) {}
      _issuePathSaveTimer = setTimeout(function () {
        _issuePathSaveTimer = null
        try {
          const map = loadIssuePathMap()
          const key = st.sessionId || '__shared'
          map[key] = st.issuePath
          const keys = Object.keys(map)
          if (keys.length > 8) {
            keys.sort(function (a, b) { return (map[a].updatedAt || 0) - (map[b].updatedAt || 0) })
            while (Object.keys(map).length > 8) delete map[keys.shift()]
          }
          saveIssuePathMapNow(map)
        } catch (e) {}
      }, ISSUE_PATH_DEBOUNCE_MS)
    }
    const ensureIssuePath = function (st) {
      if (st.issuePath && Array.isArray(st.issuePath.nodes)) return st.issuePath
      const key = st.sessionId || '__shared'
      const map = loadIssuePathMap()
      if (map[key] && Array.isArray(map[key].nodes)) {
        st.issuePath = map[key]
        if (!st.issuePath.sessionId) st.issuePath.sessionId = st.sessionId || ''
        if (typeof st.issuePath.anchor !== 'number') st.issuePath.anchor = st.issuePath.nodes.length ? st.issuePath.nodes[0].ref : null
        if (typeof st.issuePath.current !== 'number') st.issuePath.current = st.issuePath.nodes.length ? st.issuePath.nodes[st.issuePath.nodes.length - 1].ref : null
        return st.issuePath
      }
      st.issuePath = { sessionId: st.sessionId || '', anchor: null, nodes: [], current: null, updatedAt: 0 }
      return st.issuePath
    }
    const recordIssuePath = function (st, ref, source, title) {
      const n = Number(ref)
      if (!n || isNaN(n)) return false
      ensureIssuePath(st)
      const ip = st.issuePath
      const now = Date.now()
      ip.sessionId = st.sessionId || ''
      if (!ip.nodes) ip.nodes = []
      if (ip.anchor == null) ip.anchor = n
      const last = ip.nodes.length ? ip.nodes[ip.nodes.length - 1] : null
      if (last && last.ref === n && (now - (last.ts || 0)) < 2000) {
        last.ts = now
        if (source) last.source = source
        if (title && !last.title) last.title = String(title).slice(0, 80)
        ip.current = n
        ip.updatedAt = now
        persistIssuePath(st); emit(st); return true
      }
      ip.nodes.push({ ref: n, source: String(source || 'auto'), ts: now, title: String(title || '').slice(0, 80) })
      if (ip.nodes.length > ISSUE_PATH_MAX) ip.nodes.shift()
      if (ip.nodes.length) ip.anchor = ip.nodes[0].ref
      ip.current = n
      ip.updatedAt = now
      persistIssuePath(st); emit(st); return true
    }
    const reanchorIssuePath = function (st, ref) {
      const n = Number(ref)
      if (!n || isNaN(n) || !st.issuePath || !st.issuePath.nodes.length) return false
      const found = st.issuePath.nodes.find(function (x) { return x.ref === n })
      if (!found) return false
      st.issuePath.anchor = n
      st.issuePath.current = n
      st.issuePath.updatedAt = Date.now()
      persistIssuePath(st); emit(st); return true
    }
    const clearIssuePath = function (st) {
      st.issuePath = { sessionId: st.sessionId || '', anchor: null, nodes: [], current: null, updatedAt: Date.now() }
      persistIssuePath(st); emit(st)
    }
    let _issuePathPollTs = 0
    let _issuePathPolling = false
    const pollIssuePathHost = function (st) {
      if (_issuePathPolling) return
      if (typeof host === 'undefined' || typeof host.call !== 'function') return
      _issuePathPolling = true
      host.call('wf.issuePathPoll', { since: _issuePathPollTs }).then(function (res) {
        _issuePathPolling = false
        if (!res || !res.ok || !Array.isArray(res.events) || !res.events.length) {
          if (res && typeof res.serverNow === 'number') _issuePathPollTs = res.serverNow
          return
        }
        let maxTs = _issuePathPollTs
        res.events.forEach(function (ev) {
          if (ev && ev.ref) {
            recordIssuePath(st, ev.ref, ev.source, ev.title)
            if (ev.ts && ev.ts > maxTs) maxTs = ev.ts
          }
        })
        if (res.serverNow && res.serverNow > maxTs) maxTs = res.serverNow
        _issuePathPollTs = maxTs
      }).catch(function () { _issuePathPolling = false })
    }
    let _issuePathPollTimer = null
    const startIssuePathPoll = function (st) {
      if (_issuePathPollTimer) return
      const tick = function () {
        if (st) pollIssuePathHost(st)
        _issuePathPollTimer = setTimeout(tick, 4000)
      }
      tick()
    }
    // T2 #35 路 鏃犱粨搴撶孩鍗＄姸鎬佹満锛堟寜 cwd 缁村害鎸佷箙鍖?dismiss锛涜〃鍗曟€?expanded/name/visibility/loading/error锛?
    const NOREPO_DISMISS_PREFIX = 'dsws:noRepoDismiss:'
    const cwdHash = function (s) { let h = 0; const t = String(s || ''); for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return String(h >>> 0) }
    const noRepoDismissKey = function (cwd) { return NOREPO_DISMISS_PREFIX + cwdHash(cwd || '') }
    const isNoRepoDismissed = function (cwd) { try { return localStorage.getItem(noRepoDismissKey(cwd)) === '1' } catch (e) { return false } }
    const setNoRepoDismissed = function (cwd, v) { try { if (v) localStorage.setItem(noRepoDismissKey(cwd), '1'); else localStorage.removeItem(noRepoDismissKey(cwd)) } catch (e) {} }
    const cwdBasename = function (cwd) { if (!cwd) return 'repo'; const parts = String(cwd).split(/[\\/]/); for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i]; return 'repo' }
    const isNoRepoNameValid = function (name) { return typeof name === 'string' && name.length >= 1 && name.length <= 100 && /^[A-Za-z0-9._-]+$/.test(name) }
    const ensureNoRepoCard = function (st) {
      if (!st.noRepoCard) st.noRepoCard = { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' }
      if (!st.noRepoCard.visibility) st.noRepoCard.visibility = 'private'
      if (st.noRepoCard.errorRepoUrl === undefined) st.noRepoCard.errorRepoUrl = ''
      return st.noRepoCard
    }
    const makeStore = () => ({
      open: false, tab: 'list', activeMap: null,
      notice: null, injector: null, tick: 0,
      pos: null, size: { w: 460, h: DEFAULT_PANEL_H },
      // 澶栬瀹氭锛堢敤鎴锋媿鏉匡細鍥炬爣/鍔ㄤ綔璇嶄笉鍙厤缃級
      ui: { icon: 'compass', word: '娌夋穩' },
      snapshot: null,
      cwd: '', lblFilters: [], skillView: 'list', expLabels: false,
      // #374锛氱姸鎬佽繃婊?+ 鎺掑簭锛堥粯璁?鏇存柊鏃堕棿鈫擄紝涓庣幇鐘朵竴鑷达級
      stateFilter: listPrefs.stateFilter, sortKey: listPrefs.sortKey, sortDir: listPrefs.sortDir,
      checks: null, checksUpdatedAt: '', checksMode: 'loading', checksError: null, checking: false,
      snapMode: 'loading', snapError: null, snapLoading: false,
      refreshing: false, rowFlash: {}, issueFlash: {}, handoffReady: false, skillsOpen: false, skillHover: null, skillTip: null, bugMenuOpen: false, bugMenuHover: false, bugMenuPos: null, skillPopPos: null, expTags: {}, subs: [],
      noRepoCard: { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' },
      issuePath: { sessionId: '', anchor: null, nodes: [], current: null, updatedAt: 0 },
      issuePathHover: false, issuePathPos: null,
    })
    const shared = makeStore()
    const stores = {}
    // #58 缂撳瓨浼樺厛锛氭寜 cwd 鐨勫唴瀛樺揩鐓ц〃锛堟柊 store 绉掑紑 + 璺ㄤ細璇濆悓 cwd 鍏变韩锛岄伩鍏嶇┖ cwd 鎺㈣矾 miss锛?
    const snapshotByCwd = {}
    const getCachedSnapshot = function (cwd) { return cwd ? snapshotByCwd[cwd] : null }
    const setCachedSnapshot = function (cwd, snap) { if (cwd && snap && snap.ok === true && Array.isArray(snap.maps)) snapshotByCwd[cwd] = snap }
    const hydrateFromCache = function (st) {
      if (!st || !st.cwd) return false
      const c = getCachedSnapshot(st.cwd)
      if (!c) return false
      if (!st.snapshot || c.generatedMs !== st.snapshot.generatedMs) {
        st.snapshot = c
        st.snapMode = 'real'
        st.snapError = null
        st.snapLoading = false
        return true
      }
      if (st.snapMode !== 'real') {
        st.snapMode = 'real'
        st.snapError = null
        return true
      }
      return false
    }
    const getCwdSync = function (sid) {
      try {
        const sessions = ctx.get('sessions')
        if (sessions && sid) {
          try {
            if (sessions.list && typeof sessions.list.getSnapshot === 'function') {
              const snap = sessions.list.getSnapshot()
              const row = snap && snap.byId && snap.byId[sid]
              if (row && typeof row.cwd === 'string' && row.cwd) return row.cwd
            }
          } catch (e2) {}
          if (typeof sessions.get === 'function') {
            const s = sessions.get(sid)
            if (s) {
              const header = s.header || s.meta
              const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
              if (typeof cwd === 'string' && cwd) return cwd
              const meta = s.meta
              const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
              if (typeof cwd2 === 'string' && cwd2) return cwd2
              if (typeof s.cwd === 'string' && s.cwd) return s.cwd
            }
          }
        }
      } catch (e) { /* 蹇界暐 */ }
      return ''
    }
    const storeOf = (sid) => {
      if (!sid) { ensureIssuePath(shared); return shared }
      let st = stores[sid]
      if (!st) {
        st = makeStore(); st.sessionId = sid; stores[sid] = st
        // #58 鏂?store 鍚屾琛?cwd 骞跺皾璇曟按鍚?per-cwd 缂撳瓨锛堢寮€锛?
        if (!st.cwd) {
          const sync = getCwdSync(sid)
          if (sync) st.cwd = sync
        }
        if (st.cwd) hydrateFromCache(st)
        ensureIssuePath(st)
      } else {
        // 宸叉湁 store 鑻?cwd 浠嶇┖涓斿彲鍚屾琛ラ綈锛岀珛鍗虫按鍚?
        if (!st.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        }
        ensureIssuePath(st)
      }
      return st
    }
    const emit = (st) => { st.tick++; (st.subs || []).forEach(function (f) { f(st.tick) }) }
    const sub = (st, f) => { st.subs.push(f); return () => { const i = st.subs.indexOf(f); if (i >= 0) st.subs.splice(i, 1) } }
    const useStore = (sid) => {
      const st = storeOf(sid)
      const [, set] = React.useState(0)
      React.useEffect(() => sub(st, (n) => set(n)), [st])
      return st
    }
    const NOTICE_COLOR = { ok: '#4ade80', warn: '#fbbf24', info: '#a1a1aa' }
    const noticeIcon = (k) => k === 'ok' ? 'check' : k === 'warn' ? 'alert' : 'clipboard'
    const flash = (st, msg, kind) => {
      st.notice = { text: msg, kind: kind || 'info' }; emit(st)
      if (timer !== undefined) timer.timeout(function () { if (st.notice && st.notice.text === msg) { st.notice = null; emit(st) } }, 2800)
    }

    // 娲剧敓锛氱エ鍔″垎缁勶紙frontier/claimed/blocked/closed锛?
    const compute = (st) => {
      const maps = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
      return maps.map(function (m) {
        const byNum = {}; m.tickets.forEach(function (t) { byNum[t.number] = t })
        const openBlocker = (b) => { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
        const open = m.tickets.filter(function (t) { return t.state === 'OPEN' })
        const closed = m.tickets.filter(function (t) { return t.state === 'CLOSED' })
        const frontier = open.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
        const claimed = open.filter(function (t) { return t.claimedBy })
        const blocked = open.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
        return { m: m, open: open, closed: closed, frontier: frontier, claimed: claimed, blocked: blocked }
      })
    }
    const frontierAll = (st) => compute(st).reduce(function (n, g) { return n + g.frontier.length }, 0)

    // v18-30锛氱姸鎬佹爮鍙帴/鍗犵敤鏀圭敤銆屽垪琛?open issue銆嶅彛寰勶紙涓庨潰鏉垮垪琛ㄤ竴鑷达級锛?
    //   鍙帴 = open issue 涓湭璁ら涓旀湭琚?open 闃诲锛涘崰鐢?= 宸茶棰?+ 琚樆濉烇紱涓よ€呬箣鍜?= 鍏ㄩ儴 open issue
    const openIssuesOf = (st) => ((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).filter(function (x) { return x.state !== 'CLOSED' })
    const isOccupied = function (st, x) {
      if (x.assignees && x.assignees.length) return true
      const maps = (st.snapshot && st.snapshot.maps) || []
      for (let mi = 0; mi < maps.length; mi++) {
        const m = maps[mi]
        if (!m.tickets || !m.tickets.length) continue
        const byNum = {}
        m.tickets.forEach(function (t) { byNum[t.number] = t })
        const t = byNum[x.number]
        if (t && t.blockedBy && t.blockedBy.length) {
          const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
          if (openBlockers.length) return true
        }
      }
      return false
    }
    const occCount = (st) => openIssuesOf(st).filter(function (x) { return isOccupied(st, x) }).length
    const frontierCount = (st) => openIssuesOf(st).length - occCount(st)
    // v1.5 T1锛欱UG / 璇婃柇璁℃暟锛坥pen 涓斿甫瀵瑰簲鏍囩锛屼笌銆屽彲鎺ャ€嶅悓鍙ｅ緞锛?
    const hasLabelOf = function (x, nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
    const bugCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'bug') }).length
    const triageCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'needs-triage') }).length

    // v19锛氬叡浜?鈥斺€?鏍囩閰嶇疆鑹叉槧灏勶紙浠庡揩鐓?issues 鏀堕泦 GitHub label 閰嶇疆鑹诧紝鍔ㄦ€佹煡璇㈤潪鍐欐锛?
    const buildColorOf = function (st) {
      const colorOf = {}
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      issues.forEach(function (x) {
        (x.labels || []).forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
      })
      return colorOf
    }
    // T9锛氳绾у姩浣滀富鑹茶绠楋紙涓?mkRowAction 鍏变韩 路 缁欐柊浼氳瘽鎸夐挳澶嶇敤锛氫笌鎵ц鎸夐挳鍚?label 涓昏壊锛?
    const isLightHex = function (hex) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
        const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
        return (299 * r + 587 * g + 114 * b) / 1000 > 160
      } catch (e) { return false }
    }
    const actionColorOf = function (x, colorOf) {
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const bc = function (nm, fb) { const cc = colorOf[nm]; return cc ? '#' + cc : fb }
      if (has('needs-triage')) return bc('needs-triage', '#f59e0b')
      if (has('bug')) return bc('bug', '#f87171')
      if (has('wayfinder:grilling')) return bc('wayfinder:grilling', '#d93f0b')
      return '#c084fc'
    }
    // #361锛氳绾у姩浣滄敞鍏ユ枃鏈殑鍗曚竴鐪熸簮锛堣瘖鏂?淇/璁ㄨ/鎵ц锛夆€斺€?鏂颁細璇濇墦寮€涓庤鍐呭姩浣滃叡鐢?
    const rowActionText = function (st, x) {
      const url = 'https://github.com/' + repoStr(st) + '/issues/' + x.number
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      if (has('needs-triage')) return renderTemplate('diagnose', { url: url })
      if (has('bug')) return renderTemplate('fix', { url: url })
      if (has('wayfinder:grilling')) return renderTemplate('discuss', { url: url })
      return startText(st, x)
    }
    // v19锛氬叡浜?鈥斺€?琛岀骇鍔ㄤ綔锛堝垪琛ㄤ笌 map 璇︽儏鍏辩敤锛夛細鎸?label 鍥涢€変竴锛堣瘖鏂?淇/璁ㄨ/鎵ц锛夛紝棰勫～杈撳叆妗嗭紱
    // 鎸夐挳涓讳綋鑹?= 瀵瑰簲 label 鐨?GitHub 閰嶇疆鑹诧紙YIQ 鎰熺煡浜害瀹氭枃瀛楄壊锛?
    const mkRowAction = function (st, x, narrow, colorOf) {
      const url = 'https://github.com/' + repoStr(st) + '/issues/' + x.number
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const isLight = function (hex) {
        try {
          const hh = String(hex || '').replace('#', '')
          if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
          const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
          return (299 * r + 587 * g + 114 * b) / 1000 > 160
        } catch (e) { return false }
      }
      const btnColor = function (nm, fb) { const c = colorOf[nm]; return c ? '#' + c : fb }
      const mk = (icon, label, text, colorHex) => {
        const light = isLight(colorHex)
        return h('button', {
          className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''),
          onClick: function (e) { e.stopPropagation(); inject(st, text) },
          style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: colorHex, borderColor: 'transparent', color: light ? '#140a1e' : '#ffffff' },
          title: label,
        }, [Ic({ n: icon, size: 10 }), narrow ? null : h('span', null, label)])
      }
      // v21锛氭妧鑳藉懡浠?+ URL + 缁熶竴寮曞鍙ワ紙涓嶅啀閲嶅鐏岃緭鎶€鑳藉唴閮ㄦ祦绋嬶級
      // v25 路 T2b锛氳瘖鏂?淇/璁ㄨ璧版ā鏉挎覆鏌擄紙鐢ㄦ埛鍙嚜瀹氫箟闈欐€佹枃鏈紝{url} 娉ㄥ叆锛?
      if (has('needs-triage')) return mk('chat', tr('act.diagnose'), rowActionText(st, x), btnColor('needs-triage', '#f59e0b'))
      if (has('bug')) return mk('hammer', tr('act.fix'), rowActionText(st, x), btnColor('bug', '#f87171'))
      if (has('wayfinder:grilling')) return mk('chat', tr('act.discuss'), rowActionText(st, x), btnColor('wayfinder:grilling', '#d93f0b'))
      return mk('play', tr('act.execute'), rowActionText(st, x), '#c084fc')
    }
    // v19锛氫氦鎺ユ枃妗ｆ椂闂存埑鏂囦欢鍚嶏紙YYYYMMDD-HHMMSS锛?
    const timeStampStr = () => {
      try {
        const d = new Date()
        const p = function (n) { return String(n).padStart(2, '0') }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
      } catch (e) { return 'latest' }
    }

    // ---- 鐜妫€鏌ワ紙#344 路 host.call('wf.status')锛沨ost 渚?30s 缂撳瓨 / force 閲嶆煡锛?---
    // v12锛氬け璐ヤ笉鍐嶅厹鍋囨暟鎹?鈥斺€?闈?real 鐘舵€佷竴寰嬭涓烘湭鐭ワ紙--/8锛夛紝涓嶅睍绀哄亣缁跨偣
    const CHECKS_TOTAL = 9   // v1.5 T11 璧?9 椤规娴嬶紙鍚牳蹇冩妧鑳藉浠讹級
    const loadChecks = (st, force, silent) => {
      if (st.checking) return Promise.resolve()
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        st.checksMode = 'err'
        st.checksError = tr('err.hostUnavailable')
        emit(st)
        return Promise.resolve()
      }
      st.checking = true
      // v1.5 T10 R7锛歴ilent锛堟墜鍔ㄥ埛鏂拌蛋闈欓粯璺緞锛変笉鍒?loading 鎬?
      if (force && !silent) st.checksMode = 'loading'
      emit(st)
      const args = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, force ? { force: true } : {}, { lang: promptLang() })
      return host.call('wf.status', args).then(function (res) {
        st.checking = false
        if (res && res.checks && res.checks.length) {
          st.checks = res.checks
          st.checksUpdatedAt = nowStr()
          st.checksMode = 'real'
          st.checksError = null
        } else {
          st.checksMode = 'err'
          st.checksError = (res && res.error) ? String(res.error).slice(0, 160) : tr('err.statusEmpty')
        }
        emit(st)
      }).catch(function (e) {
        st.checking = false
        st.checksMode = 'err'
        st.checksError = String((e && e.message) || e).slice(0, 160)
        emit(st)
      })
    }
    const activeChecks = (st) => (st.checksMode === 'real' && st.checks && st.checks.length) ? st.checks : []
    const readyCount = (st) => { const cs = activeChecks(st); return cs.length ? cs.filter(function (c) { return c.level === 'ok' }).length : -1 }
    // v14-22锛氳繑鍥炵函鏁板瓧涓诧紙'6/9' / '--/9'锛夛紝鐢辩姸鎬佹爮 num() 鍥哄畾瀹藉害娓叉煋锛涘垎姣?= 瀹為檯妫€鏌ラ」鏁帮紙鍔ㄦ€侊紝涓嶅啀纭紪鐮侊級
    const envTotal = (st) => { const cs = activeChecks(st); return cs.length || CHECKS_TOTAL }
    const envLabel = (st) => { const n = readyCount(st); const t = envTotal(st); return n < 0 ? '--/' + t : n + '/' + t }
    const setupCheck = (st) => (st.checks || []).find(function (c) { return c.id === 2 })

    // #370锛歜lockerNames 鍙垪銆屼粛 OPEN銆嶇殑闃诲鑰咃紙GitHub 渚濊禆杈瑰湪闃诲鑰呭叧闂悗浠嶄繚鐣欙紝闇€鎸夌姸鎬佽繃婊わ級
    const openBlockers = (t, m) => t.blockedBy.filter(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt !== undefined && bt.state === 'OPEN'
    })
    const blockerNames = (t, m) => openBlockers(t, m).map(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt ? bt.title : ('#' + b)
    }).join('锛?)

    // v10锛氫粠浼氳瘽蹇収鎺㈡祴褰撳墠宸ヤ綔鐩綍锛圕onversationSnapshot 瀛楁鍚嶅鎺㈠嚑涓級
    const detectCwd = function (ss) {
      try {
        if (ss && typeof ss === 'object') {
          for (const k of ['cwd', 'workspacePath', 'projectPath', 'path', 'dir', 'root']) {
            if (typeof ss[k] === 'string' && ss[k]) return ss[k]
          }
        }
      } catch (e) { /* 鎺㈡祴澶辫触璧?host 榛樿 */ }
      return ''
    }
    // v11锛歭abel 鐢?GitHub 閰嶇疆鑹叉覆鏌?鈥斺€?hex 鈫?rgba锛?18 鑳屾櫙锛夛紝鏃犳晥 hex 杩斿洖 null 璧板厹搴?
    const hexA = function (hex, a) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
        const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
      } catch (e) { return null }
    }
    // v14-18锛歨ex 鈫?HSL 浜害涓嬭皟 amt锛?-1锛夆啋 hex锛坈hips 杈规姣?label 鑹叉繁涓€妗ｏ級
    const darken = function (hex, amt) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
        const r = parseInt(hh.slice(0, 2), 16) / 255, g = parseInt(hh.slice(2, 4), 16) / 255, b = parseInt(hh.slice(4, 6), 16) / 255
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        const l = (mx + mn) / 2
        let hue = 0, sat = 0
        if (mx !== mn) {
          const d = mx - mn
          sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
          if (mx === r) hue = ((g - b) / d + (g < b ? 6 : 0))
          else if (mx === g) hue = ((b - r) / d + 2)
          else hue = ((r - g) / d + 4)
          hue *= 60
        }
        const l2 = Math.max(0, l - amt)
        const hue2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }
        const q2 = l2 < 0.5 ? l2 * (1 + sat) : l2 + sat - l2 * sat
        const p2 = 2 * l2 - q2
        const rr = Math.round(hue2rgb(p2, q2, hue / 360 + 1 / 3) * 255)
        const gg = Math.round(hue2rgb(p2, q2, hue / 360) * 255)
        const bb = Math.round(hue2rgb(p2, q2, hue / 360 - 1 / 3) * 255)
        return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1)
      } catch (e) { return null }
    }

    // ============================================================
    // 4. 鏂囨湰鐢熸垚 + 澶嶅埗/娉ㄥ叆
    // ============================================================
    const nowStr = () => {
      try { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (e) { return '' }
    }
    // 瀹氱 1A锛氭椂闂村浐瀹氭牸寮?MM-DD HH:MM锛堟湰鍦帮級
    const timeOf = (snap) => {
      if (!snap) return ''
      try {
        const ms = (typeof snap.generatedMs === 'number' && snap.generatedMs) || Date.parse(snap.updatedAt || '')
        if (!ms) return ''
        const d = new Date(ms)
        return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      } catch (e) { return '' }
    }
    // ============================================================
    // 4. 閰嶇疆骞挎挱锛坴25-50锛氶厤缃繚瀛樺悗鍚屾鎵€鏈変細璇?store 鐨勯潰鏉垮昂瀵革紱澶栬瀹氭涓嶅箍鎾級
    // ============================================================
    const broadcastCfg = function () {
      const applyTo = function (st) {
        if (!st) return
        st.size = { w: st.size ? st.size.w : 460, h: Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) }
        emit(st)
      }
      applyTo(shared)
      Object.keys(stores).forEach(function (k) { applyTo(stores[k]) })
    }

    // v1.5 T10 R4锛堢敤鎴锋媿鏉匡級锛氭暟鎹眰澧為噺 diff 鈥斺€?鍙樻洿/鏂板/鍒犻櫎 鎸夌エ鍙峰姣旓紙鍚?map 瀛愮エ绾у彉鍖栵級锛?
    //   澶氳鍥撅紙鍒楄〃/map璇︽儏/鐘舵€佹爮璁℃暟/杩囨护缁撴灉锛夋暟鎹┍鍔ㄨ嚜鍔ㄥ閲忥紱diff 缁撴灉渚?R5 瑙嗚娑堣垂
    const diffSnapshots = function (oldS, newS) {
      const out = { added: [], removed: [], changed: [], issueFlash: {}, ts: Date.now() }
      if (!oldS || !oldS.ok || !Array.isArray(oldS.maps)) return out
      if (!newS || !newS.ok || !Array.isArray(newS.maps)) return out
      const lbl = function (x) { return (x.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name }).sort().join(',') }
      const idx = function (snap) { const m = {}; snap.maps.forEach(function (x) { m[x.number] = x }); return m }
      const a = idx(oldS), b = idx(newS)
      // 瀛愮エ绾у彉鍖栵細閫愮エ瀵规瘮锛堟柊澧?鍙樻洿鏍?issueFlash锛涗换涓€鍙樺寲 鈫?璇?map 璁″叆 changed锛宮ap 璇︽儏瑙嗗浘澧為噺锛?
      //   瀛楁瀹炶瘉锛?458 鏍搁獙锛夛細map 瀛愮エ鍦ㄥ揩鐓ч噷鏄?tickets锛堥潪 issues锛夛紱绁ㄧ骇鍙樺寲 = state/progress/claimedBy/labels
      Object.keys(b).forEach(function (n) {
        if (!a[n]) { out.added.push(Number(n)); return }
        var x = a[n], y = b[n]
        var sub = false
        var ix = {}; (x.tickets || []).forEach(function (i) { ix[i.number] = i })
        var iy = {}; (y.tickets || []).forEach(function (i) { iy[i.number] = i })
        Object.keys(iy).forEach(function (k) {
          if (!ix[k]) { sub = true; out.issueFlash[Number(k)] = 'added'; return }
          var a2 = ix[k], b2 = iy[k]
          if (a2.state !== b2.state || a2.progress !== b2.progress || a2.claimedBy !== b2.claimedBy || lbl(a2) !== lbl(b2)) { sub = true; out.issueFlash[Number(k)] = 'changed' }
        })
        if (Object.keys(ix).length !== Object.keys(iy).length) sub = true
        if (x.state !== y.state || x.title !== y.title || lbl(x) !== lbl(y) || sub) out.changed.push(Number(n))
      })
      Object.keys(a).forEach(function (n) { if (!b[n]) out.removed.push(Number(n)) })
      return out
    }
    // R5锛氶珮浜畾鏃舵竻闄わ紙闃插爢绉紱涓€娆″彧鎺掍竴涓?timer锛?
    let _flashClearPending = false
    const scheduleFlashClear = function (st) {
      if (_flashClearPending) return
      _flashClearPending = true
      if (timer === undefined) { _flashClearPending = false; return }
      timer.timeout(function () {
        _flashClearPending = false
        st.rowFlash = {}
        st.issueFlash = {}
        emit(st)
      }, 2600)
    }
    // 蹇収锛?346锛氶潰鏉挎暟鎹簮锛沠orce 璧?wf.refresh 鍏ㄩ噺閲嶅缓锛泈f.snapshot 渚?5s 缂撳瓨锛?
    // #58 缂撳瓨浼樺厛锛氭寜 cwd 鍐呭瓨蹇収 + 绌?cwd 鍚屾锛岄伩鍏嶉寮€绌?cwd 鎺㈣矾 miss 缂撳瓨瀵艰嚧 100-400ms 闂?loading
    const loadSnapshot = function (st, force, silent) {
      const doLoad = function () {
        // #370 娆¤瑙傚療锛歠orce 鍒锋柊鏃惰烦杩?snapLoading 瀹堝崼锛堝姞杞戒腑鐐瑰嚮銆屽埛鏂般€嶄笉鍐?no-op锛?
        if (st.snapLoading && !force) return Promise.resolve()
        if (typeof host === 'undefined' || typeof host.call !== 'function') {
          st.snapMode = 'err'
          st.snapError = tr('err.hostUnavailable')
          emit(st)
          return Promise.resolve()
        }
        // #58 鍏堟按鍚?per-cwd 缂撳瓨锛屽疄鐜扮寮€
        hydrateFromCache(st)
        const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
        st.snapLoading = true
        // v1.5 T9锛歴ilent锛堝悗鍙伴潤榛樺埛鏂帮級涓嶆樉绀哄姞杞介伄缃┿€佷笉寮归敊璇?toast
        // #58 缂撳瓨浼樺厛锛氬凡鏈夌紦瀛樻椂涓嶆樉绀哄叏灞?loading锛岄潤榛樺埛鏂?
        if (force && !silent && !hasCache) st.snapMode = 'loading'
        emit(st)
        const args = st.cwd ? { cwd: st.cwd } : {}
        const p = force ? host.call('wf.refresh', args) : host.call('wf.snapshot', args)
        return p.then(function (snap) {
          st.snapLoading = false
          if (snap && snap.ok === true && Array.isArray(snap.maps)) {
            // v1.5 T10 R4锛氭暟鎹眰澧為噺 diff锛堟柊鏃у揩鐓у姣旓級鈥斺€?渚涘瑙嗗浘澧為噺涓?R5 瑙嗚
            st.lastDiff = diffSnapshots(st.snapshot, snap)
            st.rowFlash = {}
            st.issueFlash = {}
            var _df = st.lastDiff
            _df.added.forEach(function (n) { st.rowFlash[n] = 'added' })
            _df.changed.forEach(function (n) { st.rowFlash[n] = 'changed' })
            if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k) { st.issueFlash[Number(k)] = _df.issueFlash[k] })
            // R5 瑙嗚锛氭湁鍙樺寲鎵嶆彁绀?+ 瀹氭椂娓呴櫎楂樹寒锛堥槻鍫嗙Н锛?
            if (_df.removed.length) flash(st, tr('panel.diffRemoved', { n: _df.removed.length }), 'info')
            scheduleFlashClear(st)
            st.snapshot = snap
            st.snapMode = 'real'
            st.snapError = null
            // #58 缂撳瓨浼樺厛锛氳惤 per-cwd 鍐呭瓨琛紝渚涙柊 store 绉掑紑
            try { const c = snap.repoRoot || st.cwd; if (c) setCachedSnapshot(c, snap) } catch (e) { /* 蹇界暐 */ }
            try { if (st.cwd) setCachedSnapshot(st.cwd, snap) } catch (e) { /* 蹇界暐 */ }
            // v1.5 T10锛氬惎鍔ㄨ嚜鍔ㄥ彉鍖栨帰娴嬶紙骞傜瓑锛涘揩鐓у氨缁悗鐢熸晥锛?
            startAutoProbe()
            // v1.5 B5 淇锛氱鐩樼紦瀛樼寮€锛坒romCache锛夆啋 涓嶅啀 400ms 寮哄埗鍏ㄩ噺鍒锋柊銆?
            //   鍘熼€昏緫姣忔鎵撳紑闈㈡澘 = 1 娆￠澶?wf.refresh锛坅liases 澶ф煡璇?鈮?18 GraphQL 鐐癸級锛?
            //   澶氫粨搴撲細璇濅笅鎴愬€嶆斁澶э紱鍙樺寲妫€娴嬪凡鐢变綆棰?probe锛?min + focus 闄愭祦锛夋帴绠★紝
            //   纾佺洏缂撳瓨鏈韩鏄渶鏂板叏閲忓揩鐓э紝绉掑紑鐩存帴灞曠ず鍗冲彲锛屾棤闇€绔嬪嵆閲嶅缓銆?
          } else {
            st.snapMode = 'err'
            st.snapError = (snap && snap.error) ? String(snap.error).slice(0, 160) : tr('err.snapshotEmpty')
            if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
          }
          emit(st)
        }).catch(function (e) {
          st.snapLoading = false
          st.snapMode = 'err'
          st.snapError = String((e && e.message) || e).slice(0, 160)
          if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
          emit(st)
        })
      }
      // #58 鑻?cwd 浠嶇┖涓斿彲鍚屾琛ラ綈锛屽厛琛?cwd 鍐嶅姞杞斤紝閬垮厤绌?cwd miss 纾佺洏缂撳瓨
      if (!st.cwd) {
        const sync = getCwdSync(st.sessionId)
        if (sync) { st.cwd = sync; hydrateFromCache(st) }
      }
      if (!st.cwd && st.sessionId && typeof host !== 'undefined' && typeof host.call === 'function') {
        return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
          if (res && res.ok && res.cwd && !st.cwd) { st.cwd = res.cwd; hydrateFromCache(st); emit(st) }
          return doLoad()
        }).catch(function () { return doLoad() })
      }
      return doLoad()
    }

    // v1.5 R2锛?2 MVP 路 2026-08-18锛夛細鑷姩鍒锋柊 鈥?probe 璧?since 鏃堕棿鎴虫帰娴嬪叏 issue 澧為噺
    //   锛?348 + v1.5 T10 B5銆岄厤棰濇琛€ 路 绗竴鎬у師鐞嗐€嶅欢缁級锛氣憼 probe 闄嶅埌 60s锛堢敤鎴锋劅鐭ラ槇鍊?路 R1 鏄?5min锛夛紱
    //   鈶?changed 鍙埛鏂颁笌鏈鎺㈡祴 cwd 鐩稿悓鐨?store锛堝浠撳簱浼氳瘽骞跺彂涓嶄簰涓诧級锛?
    //   鈶?focus 瑙﹀彂闄愭祦 鈮?0s锛堢獥鍙ｆ潵鍥炲垏鎹笉鍐嶇柉鐙傜儳锛夈€?
    //   涓?R1 鍖哄埆锛歱robe 鑼冨洿浠?`labels=wayfinder:map`锛堜粎鍦板浘锛夋墿鍒?`since=<ISO>`锛堝叏 issue锛屽惈瀛愮エ锛夆€斺€?瑙?host 渚?`case 'probe'`銆?
    const PROBE_MS = 60000
    const FOCUS_PROBE_MIN_MS = 60000
    let lastFocusProbe = 0
    // v1.5 T10 R9锛圦4 鎷嶆澘 路 DESIGN.md 12.2锛夛細鍏抽敭鍔ㄤ綔鍚庡欢杩熸帰娴?鈥斺€?瀹屾垚/鎵ц/浜ゆ帴鍚庨潰鏉垮敖蹇弽鏄?GitHub 鍙樺寲锛?
    //   闃叉姈锛堜竴娆″彧鎺掍竴涓級+ 鎺㈡祴鏈韩 1 娆¤交閲?REST锛岄厤棰濆畨鍏?
    let _actionProbePending = false
    const probeNow = function (fromFocus) {
      if (typeof host === 'undefined' || typeof host.call !== 'function') return
      if (fromFocus) {
        const now = Date.now()
        if (now - lastFocusProbe < FOCUS_PROBE_MIN_MS) return
        lastFocusProbe = now
      }
      // #45 淇锛?026-08-20锛夛細澶氬伐浣滃尯寮傛鍥炶皟瀵艰嚧鍙充晶闈㈡澘涓插彴
      // 鏍瑰洜锛氬師瀹炵幇缁?shared锛堝崟渚嬶級骞挎挱鏂板揩鐓у埌鎵€鏈?stores锛圤bject.keys(stores).forEach锛夛紝涓?shared.cwd 浠呴鍐欙紝
      //   瀵艰嚧宸ヤ綔鍖?A 鐨勫紓姝ュ彉鏇达紙probe changed锛夋妸 A 鐨勫揩鐓у啓鍏?B 鐨?store锛屽彸渚ч潰鏉库€滀覆鍙扳€濇樉绀洪潪褰撳墠宸ヤ綔鍖哄唴瀹广€?
      // 淇锛氭寜 cwd 鍒嗙粍闅旂 鈥斺€?鍚?cwd 缁勫唴鍏变韩 1 娆?GraphQL锛坧rimary load 鈫?浣欎笅鎷疯礉锛夛紝缁勯棿闆舵薄鏌擄紱
      //   鍏滃簳璺緞鎸?sessionId鈫抍wd 绮剧‘鏄犲皠璧嬪€硷紝閬垮厤鎶婁换鎰忛涓?cwd 閿欑粦鍒版墍鏈夌┖ store銆?
      const refreshGroup = function (cwd) {
        return host.call('wf.probe', { cwd: cwd }).then(function (res) {
          if (!(res && res.ok && res.changed)) return
          const group = []
          if (shared.cwd === cwd) group.push(shared)
          Object.keys(stores).forEach(function (k) {
            const st = stores[k]
            if (st.cwd === cwd) group.push(st)
          })
          if (!group.length) {
            if (typeof host !== 'undefined' && typeof host.call === 'function') {
              host.call('wf.refresh', { cwd: cwd }).catch(function () {})
            }
            return
          }
          const primary = group[0]
          if (!primary.cwd) primary.cwd = cwd
          const rest = group.slice(1)
          return loadSnapshot(primary, true, true).then(function () {
            const newSnap = primary.snapshot
            if (!newSnap || newSnap.ok !== true || !Array.isArray(newSnap.maps)) return
            rest.forEach(function (st2) {
              st2.lastDiff = diffSnapshots(st2.snapshot, newSnap)
              st2.rowFlash = {}
              st2.issueFlash = {}
              var _df = st2.lastDiff
              _df.added.forEach(function (n) { st2.rowFlash[n] = 'added' })
              _df.changed.forEach(function (n) { st2.rowFlash[n] = 'changed' })
              if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (ki) { st2.issueFlash[Number(ki)] = _df.issueFlash[ki] })
              st2.snapshot = newSnap
              st2.snapMode = 'real'
              st2.snapError = null
              scheduleFlashClear(st2)
              emit(st2)
            })
          }).catch(function () { /* 蹇界暐 */ })
        }).catch(function () { /* 鎺㈡祴澶辫触蹇界暐 */ })
      }
      const cwds = []
      if (shared.cwd) cwds.push(shared.cwd)
      Object.keys(stores).forEach(function (k) {
        const c = stores[k] && stores[k].cwd
        if (c && cwds.indexOf(c) < 0) cwds.push(c)
      })
      if (!cwds.length) {
        const sids = []
        if (shared.sessionId) sids.push(shared.sessionId)
        Object.keys(stores).forEach(function (k) { if (stores[k].sessionId && sids.indexOf(stores[k].sessionId) < 0) sids.push(stores[k].sessionId) })
        if (!sids.length) return
        Promise.all(sids.map(function (sid) { return host.call('wf.cwd', { sessionId: sid }).catch(function () { return null }) })).then(function (results) {
          const sidToCwd = {}
          const foundCwds = []
          for (let i = 0; i < sids.length; i++) {
            const r = results[i]
            if (r && r.ok && r.cwd) {
              sidToCwd[sids[i]] = r.cwd
              if (foundCwds.indexOf(r.cwd) < 0) foundCwds.push(r.cwd)
            }
          }
          if (!foundCwds.length) return
          Object.keys(stores).forEach(function (k) {
            const st = stores[k]
            if (!st.cwd && st.sessionId && sidToCwd[st.sessionId]) {
              st.cwd = sidToCwd[st.sessionId]
              // #58 绌?cwd 琛ラ綈鍚庣珛鍗虫按鍚?per-cwd 缂撳瓨锛岀寮€
              if (hydrateFromCache(st)) emit(st)
            }
          })
          if (!shared.cwd && foundCwds.length) {
            shared.cwd = foundCwds[0]
            if (hydrateFromCache(shared)) emit(shared)
          }
          foundCwds.forEach(function (cwd) { refreshGroup(cwd) })
        })
        return
      }
      cwds.forEach(function (cwd) { refreshGroup(cwd) })
    }
    const scheduleActionProbe = function () {
      if (_actionProbePending) return
      _actionProbePending = true
      if (timer === undefined) { _actionProbePending = false; return }
      timer.timeout(function () {
        _actionProbePending = false
        probeNow(false)
      }, 8000)
    }
    const startAutoProbe = function () {
      if (shared._probeTimer) return
      // v1.5 R2-fix锛氳法 reload 娓呯悊鏃?timer锛坉ev_reload_package 鍚?JS setInterval 涓嶈嚜鍔ㄦ竻鐞嗭紝
      //   澶氫釜 timer 骞惰瑙﹀彂 probe 娴垂閰嶉锛?
      if (typeof globalThis !== 'undefined' && globalThis.__dswsOldProbeTimer) {
        try { clearInterval(globalThis.__dswsOldProbeTimer) } catch (e) { /* 蹇界暐 */ }
        globalThis.__dswsOldProbeTimer = null
      }
      shared._probeTimer = setInterval(function () { probeNow(false) }, PROBE_MS)
      if (typeof globalThis !== 'undefined') globalThis.__dswsOldProbeTimer = shared._probeTimer
      if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', function () { probeNow(true) })
    }

    // v1.5 T10 R7锛堢敤鎴锋媿鏉匡級锛氭墜鍔ㄥ埛鏂帮紙鐘舵€佹爮銆屾洿鏂般€? 鍒楄〃銆屽埛鏂般€? 妫€鏌ラ〉銆岄噸鏂版鏌ャ€嶏級
    //   璧伴潤榛樿矾寰?鈥斺€?鏃犲叏灞忛伄缃┿€佷笉绂佺偣锛涙寜閽?spinner 鍗虫椂鍙嶉锛堝懡浠ゅ紡 DOM 鐩存搷浣滐紝涓嶇瓑 React 閲嶆覆鏌擄級
    //   CSS 鍔ㄧ敾璧板悎鎴愮嚎绋嬶細鍗充娇涓荤嚎绋嬭閲嶆覆鏌撳崰鐢紝杞湀鐓у父鍙
    const spinAll = function (on) {
      if (typeof document === 'undefined') return
      try {
        const els = document.querySelectorAll('[data-dsws-host] .dsws-rficon')
        for (let i = 0; i < els.length; i++) els[i].classList.toggle('dsws-spin', on)
      } catch (e) { /* 蹇界暐 */ }
    }
    const refreshAll = function (st) {
      if (st.refreshing) return
      st.refreshing = true
      // 鍏堝彂 RPC锛堝紓姝ュ嵆杩斿洖锛夛紝鍐嶈Е鍙戞覆鏌?鈥斺€?閬垮厤閲嶆覆鏌撴尅浣忔暟鎹姹?
      var p1 = loadChecks(st, true, true)
      var p2 = loadSnapshot(st, true, true)
      spinAll(true)
      emit(st)
      Promise.all([p1, p2]).then(function () {
        st.refreshing = false
        spinAll(false)
        emit(st)
      }).catch(function () { st.refreshing = false; spinAll(false); emit(st) })
    }

    // #376锛氭墦寮€闈㈡澘鍗充繚璇佹柊椴?鈥斺€?鏈氨缁?澶辫触 鈫?force 鍔犺浇锛堟湁銆屽姞杞戒腑銆嶅弽棣堬級锛?
    //   宸插氨缁絾杩囨湡锛?60s锛夆啋 瑙﹀彂鍔犺浇锛涘凡灏辩华涓旀柊椴滐紙鈮?0s锛夆啋 鐩存帴灞曠ず涓嶉噸澶嶈姹傦紙閰嶉鍙嬪ソ锛夈€?
    //   force 涓嶈 snapLoading 瀹堝崼涓㈠純锛?370 宸蹭慨锛夛紝鍔犺浇涓墦寮€闈㈡澘鏈€缁堜篃浼氬畬鎴愬苟灞曠ず銆?
    const SNAP_FRESH_MS = 60000
    const snapFresh = function (st) {
      if (!st.snapshot || !st.snapshot.generatedMs) return false
      try { return (Date.now() - st.snapshot.generatedMs) <= SNAP_FRESH_MS } catch (e) { return false }
    }
    // 鎵撳紑褰㈠紡锛?373 鐢ㄦ埛鎷嶆澘 2026-08-14锛夛細浠呭彸渚?details 鍒楋紙鍋滈潬锛変竴绉嶅舰寮忋€?
    //   宸茬Щ闄わ細鈶?Document PiP 鐙珛灏忕獥锛圗lectron 鏃犳硶鍒涘缓 PiP 绐楀彛銆佹浘鑷存闈㈠崱姝?鈥斺€?浠ｇ爜涓嶅啀鍚?pip 褰㈡€侊級锛?
    //   鈶?鍋滈潬/鎮诞鍙屾ā寮忚蹇嗭紙PANEL_MODE_KEY锛夛紱鈶?鐘舵€佹爮銆屽仠闈犮€峴eg 涓庡彸鏍忋€屾偓娴€嶆寜閽€?
    //   鎵撳紑涓€寰嬭蛋 layout.openDetails()锛沴ayout 鏈嶅姟涓嶅彲鐢ㄦ椂閫€鍥為〉鍐呮偓娴潰鏉匡紙浠呭厹搴曪紝鏃犱换浣曞叆鍙ｆ寜閽級銆?
    const openPagePanel = function (st) {
      // #58 缂撳瓨浼樺厛锛氬厛鍚屾琛?cwd + 姘村悎 per-cwd 缂撳瓨锛屽疄鐜板垏鎹㈤潰鏉跨寮€锛堟棤 loading 閬僵锛?
      if (!st.cwd) {
        const sync = getCwdSync(st.sessionId)
        if (sync) { st.cwd = sync; hydrateFromCache(st) }
      } else {
        hydrateFromCache(st)
      }
      const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
      const isReal = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
      st.open = true
      if (isReal && snapFresh(st)) {
        // v1.3.3 #5锛氭暟鎹柊椴滅洿鎺ュ睍绀猴紝涓?loading 涓嶅埛鏂帮紙鐢ㄦ埛涓嶅啀鐧界瓑锛?
        // #58 鑻ユ湰 store 灏氭湭璁剧疆 snapshot 浣?per-cwd 缂撳瓨瀛樺湪锛屽凡鍦?hydrateFromCache 绉掑紑
        if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
        emit(st)
      } else if (isReal || hasCache) {
        // v1.3.3 #5锛氭暟鎹繃鏈?鈫?淇濈暀鏃ф暟鎹睍绀?+ 鍚庡彴闈欓粯鍒锋柊锛堥潪 force 路 璧?5s 缂撳瓨锛夛紝涓嶅脊鍏ㄥ睆閬僵
        // #58 杩囨湡涔熺寮€ + 鍚庡彴闈欓粯锛屼笉闂?loading
        if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
        emit(st)
        loadSnapshot(st, false)
      } else {
        // 棣栧紑鏃犳暟鎹笖鏃?per-cwd 缂撳瓨 鈫?鍔犺浇鎬?+ 闈?force 鎷夊彇
        st.snapMode = 'loading'
        emit(st)
        loadSnapshot(st, false)
      }
    }
    // 鎵撳紑闈㈡澘锛氫竴寰嬪彸渚у仠闈狅紙details 鍒楋級锛沴ayout 鏈嶅姟涓嶅彲鐢?鈫?椤靛唴鍏滃簳
    const openDockPanel = function (st) {
      const ls = ctx.get('layout')
      if (ls && typeof ls.openDetails === 'function') {
        ls.openDetails()
        // #58 缂撳瓨浼樺厛锛氫笌 openPagePanel 鍚岄€昏緫锛岄伩鍏嶅垏闈㈡澘闂?loading
        if (!st.cwd) {
          const sync = getCwdSync(st.sessionId)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        } else { hydrateFromCache(st) }
        const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
        const isReal = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
        if (isReal && snapFresh(st)) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
        } else if (isReal || hasCache) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
          loadSnapshot(st, false)
        } else {
          loadSnapshot(st, false)
        }
        return
      }
      openPagePanel(st)  // layout 鏈嶅姟涓嶅彲鐢?鈫?閫€鍥炴偓娴?
    }
    // v1.4锛氭墦寮€浣嶇疆鍙€?鈥斺€?cfg.openIn: 'dock'锛坉etails 鍒楋紝榛樿锛? 'sidebar'锛坉sh-better-sidebar tab锛?
    //   better-sidebar 宸茶鏃跺彲鐢紱鏈鎴栨湇鍔′笉鍙敤 鈫?鍥為€€ details 鍒?
    // v1.4.1 淇銆屽垏渚ц竟鏍忔病鍙嶅簲銆嶏細
    //   鈶?ensureSidebarTab 骞傜瓑娉ㄥ唽 鈥斺€?better-sidebar 鐨?client 鍙兘鏅氫簬鏈ā鍧楀姞杞斤紙鏈０鏄?inject 渚濊禆锛夛紝
    //      娉ㄥ唽蹇呴』鍙噸璇曪紱openTab 鍓?ensure 涓€娆′繚璇佸凡娉ㄥ唽锛堝惁鍒?openTab 闈欓粯 no-op锛夈€?
    //   鈶?openTab 甯?path seed 璧般€屽唴瀹瑰瀷鎵撳紑銆嶁啋 渚ц竟鏍忛潰鏉挎姌鍙犳椂鑷姩灞曞紑
    //      锛堢被鍨嬪瀷鎵撳紑涓嶅睍寮€闈㈡澘锛屼晶杈规爮鏀剁潃灏便€岀湅涓嶈 = 娌″弽搴斻€嶏級銆?
    let sidebarTabDisposer = null
    let sidebarTabRetry = null
    const ensureSidebarTab = function () {
      if (sidebarTabDisposer) return true
      try {
        const bs = ctx.get('betterSidebar')
        if (!(bs && typeof bs.registerTab === 'function')) return false
        const WaystationSidebarTab = function (props) {
          const scope = props && props.scope
          const sessionId = scope ? scope.sessionId : undefined
          return h('div', { style: { height: '100%', overflow: 'hidden' } }, h(DetailsDock, { sessionId: sessionId }))
        }
        sidebarTabDisposer = bs.registerTab({
          id: 'waystation:map',
          title: function () { return tr('panel.title') },
          icon: function () { return Ic({ n: 'map', size: 14 }) },
          order: 60,
          single: true,
          component: WaystationSidebarTab,
        })
        return true
      } catch (e) { return false }
    }
    const openInSidebar = function (st) {
      const bs = ctx.get('betterSidebar')
      if (bs && typeof bs.openTab === 'function') {
        if (!ensureSidebarTab()) { openDockPanel(st); return }  // 娉ㄥ唽澶辫触 鈫?鍥為€€ details 鍒?
        // #2-fix锛?026-08-19 鐢ㄦ埛鍙嶉銆屾柊浼氳瘽鐐圭姸鎬佹爮闈㈡澘涓嶅紑銆嶏級锛氬繀椤讳紶 scope={sessionId}銆?
        //   better-sidebar 鐨?openTab(seed, scope) 鍐呴儴 `targetSessionId = scope?.sessionId ?? store.getSnapshot().sessionId`锛?
        //   鏂颁細璇濇椂瀹夸富灏氭湭 setSession(璇?id) 鈫?store sessionId 涓?undefined 鈫?openTab 闈欓粯 return锛岄潰鏉夸笉寮€銆?
        //   鏄惧紡浼犲綋鍓?store 鐨?sessionId 鍚庤蛋 reduceFor(scope.sessionId) 璺緞锛堟寜缁欏畾 id 鍒濆鍖栧竷灞€锛夛紝闈㈡澘姝ｅ父灞曞紑銆?
        //   浠呭綋 st.sessionId 鏈夊€兼椂浼?scope锛堟棤鍊兼椂浼?{sessionId:undefined} 浼氫护 targetsInactiveSession=true 璧伴敊鍒嗘敮锛夈€?
        bs.openTab({ type: 'waystation:map', path: 'waystation:map' }, st.sessionId ? { sessionId: st.sessionId } : undefined)  // path seed 鈫?鍐呭鍨嬫墦寮€ 鈫?鑷姩灞曞紑闈㈡澘
        // 鎵撳紑 tab 鍗宠涓洪潰鏉垮凡寮€锛堟暟鎹柊椴滅洿鎺ュ睍绀猴級
        // #58 缂撳瓨浼樺厛锛氫笌 openPagePanel 鍚岄€昏緫锛屽惈 per-cwd 姘村悎
        if (!st.cwd) {
          const sync = getCwdSync(st.sessionId)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        } else { hydrateFromCache(st) }
        const hasCache2 = !!(st.snapshot || getCachedSnapshot(st.cwd))
        const isReal2 = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
        if (isReal2 && snapFresh(st)) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st); return
        }
        if (isReal2 || hasCache2) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st); loadSnapshot(st, false); return
        }
        loadSnapshot(st, false)
        return
      }
      openDockPanel(st)  // better-sidebar 涓嶅彲鐢?鈫?鍥為€€ details 鍒?
    }
    const openPanel = function (st) {
      // #2-fix锛?026-08-19 鐢ㄦ埛鍙嶉銆屾柊浼氳瘽鐐圭姸鎬佹爮鎸夐挳鍙充晶闈㈡澘涓嶅紑銆嶏級锛?
      //   cfg.openIn 鍦?apply 鏃跺浐鍖栵紱瑁呴厤绔炴€侊紙better-sidebar 鏅氫簬鏈ā鍧楀姞杞斤級浼氫护 bsInstalled=false 鈫?openIn 璇垽涓?'dock'锛?
      //   鐐瑰嚮姘歌繙璧?openDockPanel锛堝涓?details 鍒楋級锛宐etter-sidebar 闈㈡澘涓嶅睍寮€ 鈫?鐢ㄦ埛鐪嬩笉鍒板垪琛紙鏁版嵁鍏跺疄涓€鐩村湪娓叉煋锛夈€?
      //   瀹炴椂妫€娴嬶細better-sidebar 褰撳墠鍙敤锛坥penTab 瀛樺湪锛変笖鐢ㄦ埛鏈樉寮忛€夎繃 dock 鈫?璧?sidebar 灞曞紑 better-sidebar銆?
      const bs = ctx.get('betterSidebar')
      const bsReady = !!(bs && typeof bs.openTab === 'function')
      const explicitDock = (function () {
        try {
          const raw = localStorage.getItem(CFG_KEY)
          if (!raw) return false
          return JSON.parse(raw).openIn === 'dock'
        } catch (e) { return false }
      })()
      if (cfg.openIn === 'sidebar' || (bsReady && cfg.openIn === 'dock' && !explicitDock)) openInSidebar(st)
      else openDockPanel(st)
    }
    const togglePanel = function (st) {
      if (st.open) { st.open = false; emit(st); return }
      openPanel(st)
    }

    const repoStr = (st) => (st.snapshot && st.snapshot.repo)
      ? st.snapshot.repo.owner + '/' + st.snapshot.repo.name
      : 'FeatherHunter/SKILLS'

    // v21锛氬紑濮?prompt 绮剧畝 鈥斺€?/wayfinder + URL + 缁熶竴寮曞鍙ワ紙鎶€鑳藉唴閮ㄧ粏鑺傝嚜甯︼紝涓嶅啀閲嶅鐏岃緭锛?
    // v25 路 T2b锛歟xecute 璧版ā鏉挎覆鏌擄紙templates.execute 鎴栭粯璁わ級锛屽墠缂€寮€鍏?= cfg.withWayfinder
    // v1.3.3 #10锛氬墠缂€鍘婚噸 鈥斺€?妯℃澘锛堝惈鐢ㄦ埛鑷畾涔夋棫妯℃澘锛夎嫢宸蹭互 /wayfinder 寮€澶村垯涓嶅啀閲嶅鎷兼帴
    const withWayfinderPrefix = function (body) {
      if (!cfg.withWayfinder) return body
      if (/^\/wayfinder\b/.test(String(body || '').trim())) return body
      return '/wayfinder\n' + body
    }
    const startText = (st, t) => {
      const url = 'https://github.com/' + repoStr(st) + '/issues/' + t.number
      // v1.4锛圱2 #443锛夛細map 鐢ㄦ帹杩涘紡 prompt锛堝姞杞芥妧鑳解啋鍒嗘瀽map鈫掓寫涓嬩竴涓猧ssue鈫掓墽琛岋級锛涙櫘閫?issue 鐢?execute 妯℃澘
      const isMap = (t.labels || []).some(function (l) { return (typeof l === 'string') ? l === 'wayfinder:map' : l.name === 'wayfinder:map' })
      // v1.5 B2 淇锛堢敤鎴锋媿鏉匡級锛氭柊浼氳瘽/鎵ц prompt 璺熼殢琛岀姸鎬?鈥斺€?map 瀹屾垚鎬?鈫?瀹屾垚纭 prompt锛堜笌宸︺€屽畬鎴愩€嶆寜閽悓璇箟锛夛紱
      //   鏈畬鎴?鈫?鎺ㄨ繘寮忥紱缁熶竴甯?map 鏍囪瘑锛堢紪鍙?鏍囬/閾炬帴锛夛紝鏂颁細璇濅笉鍐嶃€屾壘涓嶅埌瀵瑰簲 ISSUE銆?
      if (isMap) {
        const stats = t.stats || (function () {
          const mo = ((st.snapshot && st.snapshot.maps) || []).find(function (m) { return m.number === t.number })
          return mo ? mo.stats : null
        })()
        const done = !!(stats && stats.total > 0 && stats.closed === stats.total)
        const head = '\n\n' + promptText('mapHead', { n: String(t.number || ''), title: (t.title || ''), url: url })
        if (done) {
          return completePrompt(st, t.number, stats.total, stats.closed) + head
        }
        // v1.5锛氭妧鑳?+ 閾炬帴鍓嶇疆锛堢敤鎴疯鍒欙細鍏蜂綋鎿嶄綔 prompt 寮€澶?= /wayfinder + ISSUE 閾炬帴锛?
        // T13锛歮ap 鎺ㄨ繘鍚屾牱鎸傞樁娈甸椄闂紙鎺ㄨ繘鐨勭エ鑻ュ甫 needs-triage 蹇呴』鍏堣瘖鏂級
        const gateText = promptText('stageGate')
        return '/wayfinder\n' + url + '\n\n' + MAP_EXECUTE_PROMPT() + (gateText ? '\n\n' + gateText : '') + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + head
      }
      const body = renderTemplate('execute', { number: String(t.number), url: url, title: t.title })
      return withWayfinderPrefix(body)
    }
    const SESSION_TITLE_PREFIX = '[MattSkills]'
    const newSessionTitle = (t) => SESSION_TITLE_PREFIX + ' ' + t.title + ' #' + t.number
    // v1.5 T6锛氭柊澧?wayfinder prompt 鈥斺€?/wayfinder + 浠撳簱淇℃伅 + 闇€姹傚紩瀵硷紙鐢ㄦ埛鎷嶆澘锛歱rompt 甯︿粨搴撲俊鎭級
    // T16 琛ュ己锛?463 澶嶆牳 F2锛夛細寤哄浘鍏ュ彛鍚屾牱鎸傛鏂囨牸寮忓绾︼紙鏂板缓 map 姝ｆ枃浠庢簮澶撮槻瀛楅潰 \\n / BOM锛?
    // v7锛?62 grill锛夛細杈撳叆浣嶇粷瀵规湯灏?鈥斺€?BODY_FORMAT 鍦ㄤ腑娈碉紝鏈熬杩藉姞 闇€姹傛弿杩帮細/ Requirement:锛堟弧瓒?Q4锛?
    const newWayfinderText = (st) => promptText('newWayfinder', { repo: 'https://github.com/' + repoStr(st) }) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + (promptLang() === 'en' ? '\n\nRequirement: ' : '\n\n闇€姹傛弿杩帮細')
    // issue #4锛氭柊澧?BUG 鍗?鈥斺€?涓庛€? 鏂板缓闇€姹傘€嶅悓鏋勶紙鏂颁細璇?+ 棰勫～ /wayfinder prompt + 姝ｆ枃鏍煎紡濂戠害锛?
    // v2锛?1 BUG3 琛ュ己锛夛細杈撳叆浣嶆尓鍒?BODY_FORMAT 涔嬪悗锛屾ā鏉挎湯灏撅紙閬垮厤涓€旇緭鍏ヤ綅锛?
    // v3锛?14 鍐宠 #13 [T7]锛夛細瀛楁闆嗙簿绠€涓?4 椤?+ 渚嬭鎸囧紩锛坴3.4锛氭瘡瀛楁銆屽瓧娈靛悕锛氥€嶈 + 涓嬫柟銆屼緥锛氱ず渚嬨€嶈绱ц创锛寊h/en 鍒嗙璺熼殢璇█锛夛紱EN locale 鍒囨崲锛圢EW_BUG_FIELDS_BODY_EN锛?
    // v4锛?63 grilling 瀹氱増 2026-08-20锛夛細鍘诲唴閮ㄨ鍒欏杩?+ 瀛楁鎷彿鍗曡 + 椤哄簭瀹為檯鈫掓湡鏈涳紙hit #63 鍐宠锛?
    const newBugWayfinderText = (st) => promptText('newBugWayfinder', { repo: 'https://github.com/' + repoStr(st) }) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + (promptLang() === 'en' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY())

    // v10锛氭矇娣€ = 浼氳瘽绾у姩浣?鈥斺€?娉ㄥ叆銆岄浂涓㈠け蹇収銆峱rompt锛堥粯璁ゆ枃鏈 搂2.5 FIXATE_PROMPT锛孴2b 鍙紪杈戯級
    const injectFixate = (st) => { inject(st, fixateText()) }

    // v24-48锛氫氦鎺?鈥斺€?绗竴鍑昏嚜鍔ㄦ敞鍏?/handoff 妯℃澘锛堝甫鏃堕棿鎴虫枃浠跺悕 + 寮曞鍙ワ級骞惰蹇嗚鏃堕棿鎴筹紱
    // 绗簩鍑讳紭鍏堣銆岀涓€鍑绘ā鏉块噷鐨勫悓涓€涓枃浠躲€嶏紙妯℃澘鍐欎粈涔堝悕灏辫浠€涔堝悕锛屼笉鍐嶆煡鐩綍瀵艰嚧鏃ф枃浠跺悕锛夛紱
    // 浠呭綋鏈偣杩囩涓€鍑伙紙濡傚埛鏂板悗锛夋墠鍥為€€ host 鏌ユ渶鏂板疄闄呮枃妗ｏ紱+ 澶嶅埗 + 寮€鏂扮┖鐧戒細璇?
    // v25 路 T2b锛團1 淇锛夛細浜ゆ帴涓ゅ嚮璧版ā鏉挎覆鏌擄紱{ts} 绗竴鍑绘敞鍏ユ椂鐢熸垚骞惰蹇嗭紱
    //   {file} = 绗竴鍑绘ā鏉挎覆鏌撳悗瑙ｆ瀽鍑虹殑瀹為檯鏂囦欢鍚嶏紙鐢ㄦ埛鏀规枃浠跺悕缁撴瀯涔熶竴鑷达級锛岃В鏋愬け璐ュ厹搴?handoffTs + '.md'
    let handoffTs = null  // v24锛氱涓€鍑绘ā鏉夸娇鐢ㄧ殑鏃堕棿鎴筹紙绗簩鍑讳紭鍏堝鐢ㄥ悓涓€鏂囦欢鍚嶏級
    let handoffFile = null  // v25 F1锛氱涓€鍑绘覆鏌撳悗瑙ｆ瀽鍑虹殑瀹為檯浜ゆ帴鏂囦欢鍚嶏紙鍚敤鎴疯嚜瀹氫箟缁撴瀯锛?
    const handoffPrompt = function (ts) {
      return renderTemplate('handoff1', { ts: ts })
    }
    // 浠庣涓€鍑绘敞鍏ユ枃鏈В鏋?.scratch/handoff/<name>.md 鐨勫疄闄呮枃浠跺悕锛圱1 瑙勬牸 搂2 鍙戠幇 1锛?
    const extractHandoffFile = function (text) {
      const m = String(text || '').match(/\.scratch\/handoff\/([^\s"'`]+\.md)/)
      return m ? m[1] : null
    }
    const handoffReadText = function (file) {
      if (file) return renderTemplate('handoff2', { file: file })
      return promptText('handoffRead')
    }
    // 璺ㄤ細璇濋濉紙issue #12 BUG4 r3 缁堟瀬淇锛夛細鍗曞彉閲忎繚鐣欙紝浣嗘秷璐逛晶褰诲簳閿佹 deps 涓?[props.sessionId]锛?
//   褰撳墠浼氳瘽鐨?props 閲嶆覆鏌撲笉浼氬啀瑙﹀彂 effect 閲嶈窇锛屼粠鏍规湰涓婃秷闄ゃ€屽綋鍓嶄細璇?effect 鎶㈠厛娑堣垂銆嶇珵鎬併€?
// r4锛?62/#63 鍥炲綊 2026-08-21锛夛細鏃?r3 鐢?boolean consumedDraftRef 瀵艰嚧棣栨娑堣垂鍚?ref=true 甯搁┗锛屼换浣曟柊浼氳瘽 effect 鐩存帴 return锛?2/63 鏂板紑浼氳瘽涓嶆敞鍏ワ級锛涗笖 pendingDraft 涓哄叏灞€鍗曞彉閲忥紝鏃т細璇濋噸娓叉煋鑻?deps 鍚?props 鍙兘鎶㈠厛娑堣垂銆俽4 鏀逛负 sid 閿氬畾锛歱endingDraftTargetSid 璁板綍鏂颁細璇?sid锛屾秷璐逛晶浠呭綋 pendingDraftTargetSid===props.sessionId 鎵嶆秷璐癸紝涓?ref 鎸?sid 瀛樺偍銆?
let pendingDraft = null
let pendingDraftTargetSid = null
    // 闇€姹?锛?026-08-18锛夛細浜ゆ帴鎸夐挳 = 绗竴鍑伙紙娉ㄥ叆 /handoff 妯℃澘锛屼笉鍐嶅彉瀛楋級锛涖€屾柊浼氳瘽浜ゆ帴銆嶅皬鎸夐挳 = 鍘熺浜屽嚮閫昏緫
    // 闇€姹?路浜岄樁娈?rev锛?026-08-18锛夛細鐏?浜弻鎬佺殑鐪熷疄渚濇嵁 = 纾佺洏涓婄‘瀹炲瓨鍦ㄤ氦鎺ユ枃妗ｏ紙wf.handoffLatest 鎺㈡祴锛夈€?
    //   probeHandoffReady锛氭帰娴?鈫?鍐?st.handoffReady + emit锛堝彸鍗婁寒钃?鐏?+ 鍏佽/绂佹 鐨勫紑鍏筹級锛涗换浣曡矾寰勯兘涓嶅緱鍦ㄦ棤鏂囨。鏃跺紑鏂颁細璇濄€?
    // issue #12 BUG4 路 涓昏矾寰勶紙r2 缁堟瀬褰㈡€侊級锛氱敤鎴峰垰鐐硅繃绗竴鍑伙紙handoffFile 宸茶锛夆啋 鐩存帴鐢?handoffFile 浣滀负 prompt
    //   鏂囦欢鍚?+ 浜摑锛?*涓嶆煡纾佺洏**銆傜悊鐢憋細prompt 蹇呴』涓庣涓€鍑绘敞鍏ョ殑 `/handoff` 妯℃澘鏃堕棿鎴充竴鑷达紙鐢ㄦ埛瑙嗚鐨勩€屼袱娈垫枃鏈簲璇ュ搴斿悓涓€浠芥枃妗ｃ€嶏級锛?
    //   鍗充究 AI 杩樻病钀界洏锛宧andoff-open 浠嶅簲棰勫～ handoffFile锛堜繚璇佷袱娈?prompt 涓€鑷达級銆傝嫢 AI 鐪熸病鍐欙紝鏂颁細璇?`/read` 浼氬け璐?鈥斺€?閭ｆ槸 AI 琛屼负闂銆?
    //   鏈偣杩囩涓€鍑伙紙handoffFile=null锛屽鍒锋柊鍚?/ 鐩存帴鐐瑰彸鍗婏級鈫?璋?wf.handoffLatest 鎺㈢鐩樺彇 mtime 鏈€鏂般€?
    //   濮嬬粓杩斿洖 Promise.resolve(done(...))锛岃璋冪敤鏂癸紙doHandoffOpen / probe chain锛夎兘绋冲畾 .then銆?
    const probeHandoffReady = function (st) {
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const done = function (file) { st.handoffReady = !!file; emit(st); return file }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { done(null); return Promise.resolve(null) }
      // 涓昏矾寰勶細handoffFile 宸茶 鈫?鐩存帴杩斿洖瀹冿紙prompt 鍐呭涓庣涓€鍑绘ā鏉挎椂闂存埑涓€鑷?路 r2锛?
      if (handoffFile) return Promise.resolve(done(handoffFile))
      // 鍓矾寰勶細handoffFile=null锛堝埛鏂板悗 / 浠庢湭鐐圭涓€鍑伙級鈫?璧?wf.handoffLatest 鎺㈢鐩?
      return host.call('wf.handoffLatest', cwdArg).then(function (res) {
        return done((res && res.ok && res.file) ? res.file : null)
      }).catch(function () { return done(null) })
    }
    const doHandoff = function (st) {
      handoffTs = timeStampStr()
      const text = handoffPrompt(handoffTs)
      handoffFile = extractHandoffFile(text) || (handoffTs + '.md')
      inject(st, text)
      flash(st, tr('toast.injectedHandoff'), 'ok')
      // r2锛歨andoffFile 宸茶鍚?probeHandoffReady 鐩存帴浜摑锛堜笉鍐嶇瓑纾佺洏钀界洏锛?
      probeHandoffReady(st)
    }
    const doHandoffOpen = function (st) {
      const ws = ctx.get('workspaces')
      const finish = function (file, msg) {
        const text = handoffReadText(file)
        pendingDraft = text
        pendingDraftTargetSid = null
        copyText(st, text, msg || tr('toast.copiedHandoff'))
        if (ws && typeof ws.startSession === 'function') {
          ws.startSession()
        } else {
          pendingDraft = null
          pendingDraftTargetSid = null
        }
      }
      // 寮曞闂?v3锛?026-08-18 rev锛夛細鏃犺鏈細璇濇槸鍚︾偣杩囩涓€鍑伙紝涓€寰嬪厛鎺㈡祴纾佺洏鐪熷疄鏂囨。鈥斺€?
      //   鏈?latest 鈫?缃?ready + 鏀捐寮€鏂颁細璇濓紱娌℃湁 鈫?toast 寮曞銆岃鍏堢偣銆屼氦鎺ャ€嶇敓鎴愪氦鎺ユ枃妗ｃ€嶏紝缁濅笉鎵撳紑绌轰細璇?
      probeHandoffReady(st).then(function (file) {
        if (file) finish(file, tr('toast.copiedHandoffFile', { file: file }))
        else flash(st, tr('toast.handoffGrey'), 'warn')
      })
    }

    // #361锛氬湪鏂颁細璇濅腑鎵撳紑 鈥斺€?鍚?cwd + 鑷姩鍛藉悕 + 棰勫～鎸囦护
    //   濂戠害锛坉sh-client-runtime ISessions锛夛細create({cwd}) 鈫?SessionId锛泂cope(sid) 鈫?AgentContext锛?
    //   sessionOf(ctx) 鈫?SessionFace.rename(title)锛沷pen(sid) 鍒囨崲銆備换涓€姝ュけ璐ラ檷绾т负褰撳墠浼氳瘽娉ㄥ叆 + 鎻愰啋銆?
    const openTextInNewSession = function (st, text, title) {
      const sessions = ctx.get('sessions')
      const workspaces = ctx.get('workspaces')
      const doFallback = function () {
        inject(st, text)
        flash(st, tr('toast.newSessionManual', { title: title }), 'warn')
      }
      if (!sessions || typeof sessions.create !== 'function') { doFallback(); return }
      // v1.5锛氭柊浼氳瘽榛樿缁ф壙銆岀偣鍑绘椂鎵€鍦ㄤ細璇濄€嶇殑宸ヤ綔鍖猴紙st.cwd锛夛紱
      //   缂哄け鏃讹細1) 鍚屾璇?sessions.list锛堟潈濞?cwd锛岄伩鍏?host 寮傛绐楀彛锛?) 鍐嶅悜 host 瑙ｆ瀽鍏滃簳
      const ensureCwd = function () {
        const sync = getCwdSync(st.sessionId)
        if (sync) {
          if (sync !== st.cwd) st.cwd = sync
          return Promise.resolve(sync)
        }
        if (st.cwd) return Promise.resolve(st.cwd)
        if (typeof host !== 'undefined' && typeof host.call === 'function' && st.sessionId) {
          return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
            if (res && res.ok && res.cwd) { st.cwd = res.cwd; return res.cwd }
            return null
          }).catch(function () { return null })
        }
        return Promise.resolve(null)
      }
      // #60 淇锛歝wd 鈫?workspaceId 瑙ｆ瀽锛坰ession.create({cwd}) 涓嶄細鑷姩褰掑睘宸ヤ綔鍖猴紝闇€鏄惧紡 workspaceId锛?
      const ensureWorkspaceId = function (cwd) {
        if (!workspaces || !cwd) return Promise.resolve(null)
        try {
          let items = []
          if (workspaces.list) {
            let snap = null
            try {
              if (typeof workspaces.list.getSnapshot === 'function') snap = workspaces.list.getSnapshot()
              else if (typeof workspaces.list.getCurrent === 'function') snap = workspaces.list.getCurrent()
            } catch (e2) {}
            if (snap) {
              if (Array.isArray(snap.items)) items = snap.items
              else if (Array.isArray(snap)) items = snap
              else if (snap.byId) {
                items = snap.items || []
              }
            }
          }
          const norm = function (p) {
            const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
            const isWin = /\\/.test(String(p || '')) || /^[a-zA-Z]:\//.test(s)
            return isWin ? s.toLowerCase() : s
          }
          const targetNorm = norm(cwd)
          for (let i = 0; i < items.length; i++) {
            const w = items[i]
            const wPath = w.path || w.cwd
            if (wPath && norm(wPath) === targetNorm) {
              const wid = w.workspaceId || w.id
              if (wid) return Promise.resolve(wid)
            }
          }
          if (typeof workspaces.create === 'function') {
            return workspaces.create({ path: cwd }).then(function (ws) {
              const wid = ws && (ws.workspaceId || ws.id)
              return wid || null
            }).catch(function () { return null })
          }
        } catch (e) {}
        return Promise.resolve(null)
      }
      ensureCwd().then(function (cwd) {
        if (!cwd) { doFallback(); return }
        ensureWorkspaceId(cwd).then(function (workspaceId) {
          const createOpts = workspaceId ? { workspaceId: workspaceId } : { cwd: cwd }
          sessions.create(createOpts).then(function (sid) {
          // v1.5锛氭柊浼氳瘽缁ф壙褰撳墠蹇収锛堝悓浠撳簱鍚?cwd锛夆€斺€?闈㈡澘/鐘舵€佹爮绉掓樉锛岄伩鍏嶅喎缂撳瓨鍏ㄩ噺閲嶅缓鍗￠】
          const ns = storeOf(sid)
          if (ns && st.snapshot) { ns.snapshot = st.snapshot; ns.snapMode = 'real'; ns.cwd = cwd }
          // issuePath 路 鏂颁細璇濋敋鐐癸細鎶婃湰娆℃墦寮€鐨?issue 璁颁负鏂颁細璇濈殑璧风偣锛圦10 A+B锛?
          try {
            const __refs = (function (t) { const o=[]; const s=String(t||''); const re=/github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g; let mm; while((mm=re.exec(s))!==null) o.push(Number(mm[1])); return o })(text)
            if (__refs.length && ns) {
              const __tg = String(title || '').slice(0,80)
              recordIssuePath(ns, __refs[0], 'claim', __tg)
              for (let _i=1; _i<__refs.length; _i++) recordIssuePath(ns, __refs[_i], 'mention', '')
            }
          } catch (e) {}
          // 鑷姩鍛藉悕锛堝け璐ヤ笉闃诲鎵撳紑锛?
          try {
            const scopeCtx = sessions.scope(sid)
            const face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined
            if (face && typeof face.rename === 'function') face.rename(title).catch(function () { /* 鍛藉悕澶辫触蹇界暐 */ })
          } catch (e) { /* 鍛藉悕澶辫触蹇界暐 */ }
          // 棰勫～锛坮4锛夛細鍐欏叆 pendingDraft + 鐩爣 sid 閿氬畾锛屾秷璐逛晶浠呮柊浼氳瘽娑堣垂锛屾潨缁濇棫浼氳瘽鎶㈠厛
          pendingDraft = text
          pendingDraftTargetSid = sid
          sessions.open(sid)
          flash(st, tr('toast.newSessionOpened'), 'ok')
        }).catch(function () { doFallback() })
        })
      })
    }
    // #361 鍘熷叆鍙ｏ細琛岀骇銆屽湪鏂颁細璇濇墦寮€銆嶄繚鐣欙紙rowActionText 鏂囨湰 + 绁ㄦ爣棰樺懡鍚嶏級
    const openInNewSession = function (st, x) {
      openTextInNewSession(st, rowActionText(st, x), newSessionTitle(x))
    }
    const extractIssueRefs = function (text) {
      const out = []
      const s = String(text || '')
      const urlRe = /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g
      let m
      while ((m = urlRe.exec(s)) !== null) out.push(Number(m[1]))
      return out
    }
    const inject = (st, text) => {
      if (st.injector) { st.injector(text); flash(st, tr('toast.injected'), 'ok') }
      else copyText(st, text, tr('toast.copiedFallback'))
      // issuePath 路 1C 鎻愬強璇嗗埆锛堜富璺緞 URL 鎵弿锛岄浂璇垽锛?\d+ 杈呰矾寰勫緟 toast 纭锛岄鐗堜粎 URL 鑷姩璁帮級
      try {
        const refs = extractIssueRefs(text)
        if (refs.length) {
          const titleGuess = (text && text.split('\n').slice(0, 3).join(' ').slice(0, 80)) || ''
          recordIssuePath(st, refs[0], 'mention', titleGuess)
          for (let i = 1; i < refs.length; i++) recordIssuePath(st, refs[i], 'mention', '')
          try { if (typeof host !== 'undefined' && typeof host.call === 'function') host.call('wf.issuePathPush', { number: refs[0], source: 'mention', title: titleGuess }).catch(function () {}) } catch (e) {}
        }
      } catch (e) {}
      // v1.5 T10 R9锛圦4 鎷嶆澘锛夛細鍏抽敭鍔ㄤ綔锛堝畬鎴?鎵ц/浜ゆ帴/璁ら锛夊悗寤惰繜鎺㈡祴锛岄潰鏉垮敖蹇弽鏄犲彉鍖?
      scheduleActionProbe()
    }
    // v1.6锛氭妧鑳藉畨瑁呭紩瀵煎凡鏀剁紪杩?PROMPTS 娉ㄥ唽琛紙installSkills 鏉＄洰锛夛紝瑙佷笅鏂?promptText('installSkills') 寮曠敤
    // v1.5 寮曞閾撅細鎵撳紑澶栭儴 URL锛坓h 瀹夎/鐧诲綍鏂囨。锛?
    const openUrl = function (url) { try { if (typeof window !== 'undefined' && window.open) window.open(url, '_blank') } catch (e) { /* 蹇界暐 */ } }
    const copyText = (st, text, okMsg) => {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash(st, okMsg || tr('toast.copied'), 'ok') }).catch(function () { flash(st, tr('toast.copyFailed'), 'warn') })
      } else flash(st, tr('toast.clipboardUnavailable'), 'warn')
    }

    // ============================================================
    // 5. 缁勪欢
    // ============================================================
    const Dot = ({ level }) => h('span', { className: 'dsws-dot', style: { background: level === 'ok' ? '#4ade80' : level === 'warn' ? '#f59e0b' : level === 'bad' ? '#f87171' : '#52525b' } })
    const TypeChip = ({ type }) => {
      const t = TYPE_LABEL[type] || [type, '', type]
      const cls = { research: 'dsws-chip-r', prototype: 'dsws-chip-p', grilling: 'dsws-chip-g', task: 'dsws-chip-t' }[type] || ''
      return h('span', { className: 'dsws-chip ' + cls }, [
        Ic({ n: TYPE_ICON[type] || 'dot', size: 11 }),
        h('span', null, tr('type.' + type)),
      ])
    }

    // ---- 5.2 杈撳叆鍖虹姸鎬佹爮锛堝畾绋?1A 灞呬腑鑳跺泭 路 鍙嶉涓嶈繘鐘舵€佹爮 路 cwd 鍏宠仈 路 v14 鏁板瓧鍖虹瓑瀹?+ 浜ゆ帴娈碉級----
    const StatusBar = (props) => {
      const sid = props && props.sessionId
      const s = useStore(sid)
      // v15-27锛氬涓绘潈濞?cwd 鈥斺€?SessionSummary.cwd锛堜細璇濆垪琛ㄥ伐浣滃尯鏍囬鍚屾簮锛夛紝鏇挎崲瀛楁鍚嶇寽娴嬮摼
      const summaryCwd = props.useSessions(function (x) {
        return (sid && x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined
      })
      // v14-20 鈫?r3锛氳法浼氳瘽棰勫～锛堜氦鎺ュ紑鏂颁細璇濆悗锛屾柊 dock 鎸傝浇鍗虫秷璐癸級銆?
      // issue #12 BUG4 r3 缁堟瀬淇锛堟渶绠€褰㈠紡锛夛細
      //   鍏抽敭鏀瑰姩锛歟ffect deps 浠?[props] 鏀逛负 [props.sessionId]銆?
      //   鏃у疄鐜?[props] 渚濊禆浼氬洜 ws.startSession 瑙﹀彂鐖剁骇閲嶆覆鏌?鈫?褰撳墠浼氳瘽鐨?props 寮曠敤鍙?鈫?褰撳墠浼氳瘽 effect 閲嶈窇 鈫?鎶㈠厛娑堣垂 pendingDraft銆?
      //   鏂板疄鐜?[props.sessionId] 鍙湪 sid 鍙樺寲鏃惰窇锛堝嵆姣忎釜浼氳瘽鍙湪鍒濇 mount 璺戜竴娆★級锛?
      //     路 褰撳墠浼氳瘽锛歴id 闀挎湡涓嶅彉 鈫?effect 涓嶉噸璺?鈫?涓嶆姠鍏堟秷璐?
      //     路 鏂颁細璇濓細sid 鍒濇璁剧疆 鈫?effect 璺戜竴娆?鈫?娑堣垂 pendingDraft
      //   consumedDraftRef 瀹堝崼淇濈暀浣滀负 belt-and-suspenders锛氬嵆浣跨粍浠?remount锛堝悓 sid 瀛楃涓诧級锛?
      //     ref 浠嶈兘闃叉 effect 閲嶅叆銆?
      // r4锛歝onsumedDraftRef 鎸?sid 瀛樺偍 + pendingDraftTargetSid 閿氬畾鏂颁細璇濓紝闃叉 boolean 甯搁┗闃绘柇鍚庣画娉ㄥ叆
      const consumedDraftRef = React.useRef(null)
      // 娉ㄥ叆鍣ㄥ父椹伙細鍙 inputActions 灏变綅灏辨寕鍒?s.injector锛堜笉渚濊禆 pendingDraft锛?
      React.useEffect(function () {
        if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
          s.injector = props.inputActions.setDraft
        }
      }, [props.sessionId, props.inputActions])
      React.useEffect(function () {
        if (!props || !props.sessionId) return
        if (consumedDraftRef.current === props.sessionId) return
        if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
        s.injector = props.inputActions.setDraft
        if (pendingDraft) {
          // 鑻ユ湁鐩爣 sid 閿氬畾锛屽垯浠呯洰鏍囦細璇濇秷璐癸紱鏃犻敋瀹氾紙handoff 鍏煎锛夊垯浠绘剰鏂颁細璇濆彲娑堣垂
          if (pendingDraftTargetSid && pendingDraftTargetSid !== props.sessionId) return
          consumedDraftRef.current = props.sessionId
          const text = pendingDraft
          pendingDraft = null
          pendingDraftTargetSid = null
          props.inputActions.setDraft(text)
        }
      }, [props.sessionId, props.inputActions])
      React.useEffect(function () {
        probeHandoffReady(s)  // 闇€姹?路浜岄樁娈?rev锛氭寕杞藉嵆鎺㈡祴 .scratch/handoff/锛屼互鐪熷疄鏂囨。鏈夋棤鍐冲畾鍙冲崐鐏?浜?
        ensureIssuePath(s); startIssuePathPoll(s)
      }, [])
      // v13锛氫細璇濆伐浣滅洰褰曟帰娴?鈥斺€?渚濊禆 sessionId 鍙樺寲閲嶈窇锛堝垏鎹㈠璇濆繀瑙﹀彂锛夈€?
      // v15-27锛氫紭鍏?SessionSummary.cwd锛堝涓绘潈濞侊級锛涙閫?props.session 鐩村彇锛涙渶鍚?host wf.cwd 鍏滃簳銆?
      // cwd 鍙樺寲鍚庝富鍔ㄩ噸鎷夊揩鐓т笌妫€鏌ワ紙鍚﹀垯闈㈡澘/鐘舵€佹爮浠嶆樉绀烘棫浠撳簱鏁版嵁锛夈€?
      React.useEffect(function () {
        const apply = function (cwd) {
          if (cwd && cwd !== s.cwd) {
            s.cwd = cwd
            // #58 缂撳瓨浼樺厛锛氬悓姝ユ按鍚?per-cwd 鍐呭瓨蹇収锛岀寮€
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChecks(s, false)
            // #58 宸叉按鍚堜笖鏂伴矞鍒欐棤闇€鍐?load锛屼繚鎸佺寮€锛涜繃鏈熷垯鍚庡彴闈欓粯鍒锋柊
            if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
          }
        }
        if (summaryCwd) { apply(summaryCwd); return }
        const cwd0 = detectCwd(props && props.session)
        if (cwd0) { apply(cwd0); return }
        if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.cwd', { sessionId: sid }).then(function (res) {
            if (res && res.ok && res.cwd) apply(res.cwd)
          }).catch(function () { /* 淇濇寔鐜版湁 cwd */ })
        }
      }, [sid, summaryCwd])
      // v1.5锛氭寕杞芥椂鏂伴矞鏁版嵁锛堚墹60s锛屽惈鏂颁細璇濈户鎵跨殑蹇収锛夎烦杩囬噸杞斤紝閬垮厤鍐风紦瀛樺叏閲忛噸寤哄崱椤?
      React.useEffect(function () { loadChecks(s, false); if (!snapFresh(s)) loadSnapshot(s, false) }, [])
      // v18-30锛氬彲鎺?鍗犵敤 = 鍒楄〃 open issue 鍙ｅ緞锛堜笌闈㈡澘鍒楄〃涓€鑷达級
      const fr = frontierCount(s)
      const bugN = bugCount(s)
      const triageN = triageCount(s)
      const n = readyCount(s)
      const timeStr = timeOf(s.snapshot) || (s.checksUpdatedAt ? s.checksUpdatedAt.slice(5, 16) : '') || '-- --:--'
      const setup = setupCheck(s)
      const amber = s.checksMode === 'real' && setup && setup.level !== 'ok'
      // v1.5 T11锛氭牳蹇冩妧鑳藉浠舵娴嬶紙妫€鏌?9锛?
      const skillsCheck = (s.checks || []).find(function (c) { return c.id === 9 })
      const skillsBad = s.checksMode === 'real' && skillsCheck && skillsCheck.level !== 'ok'
      // v1.5 寮曞渚濊禆閾撅紙鐢ㄦ埛鎷嶆澘 2026-08-17锛夛細gh CLI 鈫?gh 鐧诲綍 鈫?setup 鈫?鎶€鑳?鈥斺€?banner 鏄剧ず渚濊禆閾句笂绗竴涓己澶遍」
      const ghCliCheck = (s.checks || []).find(function (c) { return c.id === 4 })
      const ghAuthCheck = (s.checks || []).find(function (c) { return c.id === 5 })
      const ghCliBad = s.checksMode === 'real' && ghCliCheck && ghCliCheck.level !== 'ok'
      const ghAuthBad = s.checksMode === 'real' && ghAuthCheck && ghAuthCheck.level !== 'ok'
      const go = function (tab) { s.tab = tab; openPanel(s) }
      // v14-22锛氭暟瀛楀尯鍥哄畾涓や綅鏁扮瓑瀹斤紙鐜 5ch 瀹?'98/99'锛涘彲鎺?鍗犵敤 2ch锛?
      const num = (txt, minW) => h('span', { className: 'dsws-num', style: minW ? { minWidth: minW } : null }, txt)
      const seg = (icon, label, color, onGo, title) => h('span', { className: 'dsws-seg', onClick: function (e) { e.stopPropagation(); onGo() }, title: title || '', style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: color } }, [
        Ic({ n: icon, size: 12 }),
        label,
      ])
      // #16 V2锛?026-08-18 澶嶇幇鍚庨噸璁捐锛夛細dn/dw 闃堝€间綋绯诲簾寮冣€斺€攄n 淇″彿婧?R5 璧锋敼涓鸿緭鍏ュ尯锛坵rapper锛夊锛?
      //   榛樿 1280 瑙嗗彛涓嬭緭鍏ュ尯浠?812px锛宒n=0 姘镐笉鍑虹幇 鈫?瀹藉睆榛樿缂哄搧鐗屽瓧銆?
      //   鏀逛负鍐呭鑷€傚簲娓愯繘鏀剁缉锛堜豢 #15 tabs锛夛細applyFold 鍏ㄥ睍寮€鍚庢寜 data-fold-priority 鍗囧簭
      //   閫愪釜鎶樺彔鏂囧瓧 span锛?dsws-folded 鈫?display:none锛夛紝鐩村埌 scrollWidth 鈮?clientWidth銆?
      //   浼樺厛绾?= 淇℃伅浠峰€硷細鍝佺墝(1) 鈫?娌夋穩(2)/浜ゆ帴(3)/鍒锋柊瀛?4) 鈫?鍙帴(5)/BUG(6)/璇婃柇(7)/鐜(8) 鈫?鏃堕棿(9)銆?
      //   鎶樺彔鐢?React 澶栭儴 DOM class 椹卞姩锛圧eact 閲嶆覆鏌撴椂 className prop 涓嶅彉 鈫?classList 鎵嬪姩鍙樺寲淇濈暀锛夈€?
      const inputRef = React.useRef(null)
      const foldRef = React.useRef(null)
      const bugAnchorRef = React.useRef(null)
      const skillAnchorRef = React.useRef(null)
      const bugCloseRef = React.useRef(null)
      const skillCloseRef = React.useRef(null)
      const issuePathAnchorRef = React.useRef(null)
      const issuePathCloseRef = React.useRef(null)
      const [iw, setIw] = React.useState(780)
      // issue #22锛氬竷灞€ wrapper 淇濇寔瑁佸壀鑱岃矗锛涙诞灞備綅缃互閿氱偣 viewport rect 琛ㄧず銆?
      const placeOverlay = function (el, align) {
        if (!el || typeof window === 'undefined') return null
        const r = el.getBoundingClientRect()
        if (!r || (!r.width && !r.height)) return null
        const p = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
        if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
        else p.left = Math.max(0, Math.round(r.left))
        return p
      }
      const placeBugMenu = function () {
        const p = placeOverlay(bugAnchorRef.current, 'left')
        if (!p) return false
        const old = s.bugMenuPos
        if (old && old.left === p.left && old.bottom === p.bottom) return false
        s.bugMenuPos = p
        return true
      }
      const placeSkillPop = function () {
        const p = placeOverlay(skillAnchorRef.current, 'right')
        if (!p) return false
        const old = s.skillPopPos
        if (old && old.right === p.right && old.bottom === p.bottom) return false
        s.skillPopPos = p
        return true
      }
      const placeIssuePathPop = function () {
        const p = placeOverlay(issuePathAnchorRef.current, 'left')
        if (!p) return false
        const old = s.issuePathPos
        if (old && old.left === p.left && old.bottom === p.bottom) return false
        s.issuePathPos = p
        return true
      }
      const clearClose = function (ref) {
        if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
      }
      const closeBugMenu = function () {
        clearClose(bugCloseRef)
        if (!s.bugMenuOpen && !s.bugMenuPos && !s.bugMenuHover) return
        s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; emit(s)
      }
      const closeSkillPop = function () {
        clearClose(skillCloseRef)
        if (!s.skillsOpen && !s.skillPopPos && !s.skillHover && !s.skillTip) return
        s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; emit(s)
      }
      const closeIssuePath = function () {
        clearClose(issuePathCloseRef)
        if (!s.issuePathHover && !s.issuePathPos) return
        s.issuePathHover = false; s.issuePathPos = null; emit(s)
      }
      const scheduleClose = function (ref, fn) {
        clearClose(ref)
        ref.current = setTimeout(function () { ref.current = null; fn() }, 160)
      }
      const showBugMenu = function () {
        clearClose(bugCloseRef); clearClose(skillCloseRef)
        let changed = false
        if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
        if (!s.bugMenuOpen) { s.bugMenuOpen = true; changed = true }
        if (placeBugMenu()) changed = true
        if (changed) emit(s)
      }
      const showSkillPop = function () {
        clearClose(skillCloseRef); clearClose(bugCloseRef); clearClose(issuePathCloseRef)
        let changed = false
        if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
        if (s.issuePathHover || s.issuePathPos) { s.issuePathHover = false; s.issuePathPos = null; changed = true }
        if (!s.skillsOpen) { s.skillsOpen = true; changed = true }
        if (placeSkillPop()) changed = true
        if (changed) emit(s)
      }
      const showIssuePath = function () {
        clearClose(issuePathCloseRef); clearClose(bugCloseRef); clearClose(skillCloseRef)
        let changed = false
        if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
        if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
        if (!s.issuePathHover) { s.issuePathHover = true; changed = true }
        if (placeIssuePathPop()) changed = true
        if (changed) emit(s)
      }
      React.useEffect(function () {
        if (!s.bugMenuOpen && !s.skillsOpen && !s.issuePathHover) return undefined
        let raf = null
        let disposed = false
        const reposition = function () {
          if (disposed || raf !== null) return
          const run = function () {
            raf = null
            if (disposed) return
            let changed = false
            if (s.bugMenuOpen && placeBugMenu()) changed = true
            if (s.skillsOpen && placeSkillPop()) changed = true
            if (s.issuePathHover && placeIssuePathPop()) changed = true
            if (changed) emit(s)
          }
          if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(run)
          else raf = setTimeout(run, 0)
        }
        document.addEventListener('scroll', reposition, { capture: true, passive: true })
        window.addEventListener('resize', reposition)
        const ro = new ResizeObserver(reposition)
        if (bugAnchorRef.current) ro.observe(bugAnchorRef.current)
        if (skillAnchorRef.current) ro.observe(skillAnchorRef.current)
        if (issuePathAnchorRef.current) ro.observe(issuePathAnchorRef.current)
        reposition()
        return function () {
          disposed = true
          ro.disconnect()
          if (raf !== null) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
            else clearTimeout(raf)
          }
          document.removeEventListener('scroll', reposition, true)
          window.removeEventListener('resize', reposition)
          clearClose(bugCloseRef); clearClose(skillCloseRef); clearClose(issuePathCloseRef)
        }
      }, [s.bugMenuOpen, s.skillsOpen, s.issuePathHover])
      const applyFold = function () {
        const cap = foldRef.current
        if (!cap) return
        const targets = Array.from(cap.querySelectorAll('[data-fold-priority]'))
        if (!targets.length) return
        cap.classList.add('dsws-no-anim')
        targets.forEach(function (el) { el.classList.remove('dsws-folded') })
        void cap.offsetWidth
        const items = targets.map(function (el) {
          return { el: el, p: Number(el.getAttribute('data-fold-priority') || 99) }
        }).sort(function (a, b) { return a.p - b.p })
        for (const it of items) {
          if (cap.scrollWidth <= cap.clientWidth + 1) break
          it.el.classList.add('dsws-folded')
          void cap.offsetWidth
        }
        cap.dataset.fold = String(targets.filter(function (el) {
          return el.classList.contains('dsws-folded')
        }).length)
        cap.classList.remove('dsws-no-anim')
      }
      React.useEffect(function () {
        const ta = document.querySelector('textarea.uV2eYG_input')
        if (ta) inputRef.current = ta
        const applyInput = function () {
          if (!inputRef.current) return
          try { setIw(inputRef.current.getBoundingClientRect().width) } catch (e) { /* 蹇界暐 */ }
        }
        applyInput()
        const roInput = new ResizeObserver(applyInput)
        if (inputRef.current) roInput.observe(inputRef.current)
        // 鎶樺彔閲嶇畻锛歝apsule 瀹斤紙=iw锛夊彉鍖?/ 绐楀彛 resize / 瀛椾綋鍔犺浇鍚庯紙闃插瓧浣撳宸鍒わ級
        const roFold = new ResizeObserver(function () { applyFold() })
        const applyAll = function () { applyInput(); applyFold() }
        applyFold()
        if (foldRef.current) roFold.observe(foldRef.current)
        window.addEventListener('resize', applyAll)
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyFold)
        // DSH shell 鍋跺皵浼氬湪瀵硅瘽鍒囨崲鏃堕噸鏂版寕杞?textarea锛岃疆璇㈠厹搴曢噸璇?
        const poll = setInterval(applyAll, 2000)
        return function () {
          try { roInput.disconnect() } catch (e) { /* 蹇界暐 */ }
          try { roFold.disconnect() } catch (e) { /* 蹇界暐 */ }
          window.removeEventListener('resize', applyAll)
          clearInterval(poll)
        }
      }, [])
      const capsule = h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { openPanel(s) }, style: { position: 'relative', width: iw + 'px', maxWidth: iw + 'px' } }, [
        h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
          Icon({ scheme: s.ui.icon, size: 14 }),
          h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
        ]),
        // issuePath 路 鐘舵€佹爮褰撳墠 Issue 鑳跺泭涓绘锛坴1.7.0 map #79 路 涓轰富瑕佺洰鐨勶級鈥斺€?甯搁┗鏄剧ず褰撳墠 #N锛宧over 鍚戜笂寮瑰眰灞曠ず璺緞
        h('span', { ref: issuePathAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showIssuePath, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) } }, [
          h('span', { className: 'dsws-seg' + (s.issuePathHover ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.issuePath && s.issuePath.current) { s.tab='list'; openPanel(s) } }, title: s.issuePath && s.issuePath.current ? '褰撳墠澶勭悊 #' + s.issuePath.current + ' 路 hover 鏌ョ湅璺緞 路 鐐瑰嚮鎵撳紑鍒楄〃' : '灏氭湭閫夋嫨褰撳墠 Issue 路 鐐瑰嚮鎿嶄綔浼氳嚜鍔ㄨ褰?, style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: s.issuePath && s.issuePath.current ? '#4ade80' : '#6b7280', border: s.issuePathHover ? '1px solid rgba(74,222,128,.45)' : '1px solid transparent', background: s.issuePathHover ? 'rgba(74,222,128,.12)' : 'transparent', borderRadius: 99, padding: '2px 7px' } }, [
            Ic({ n: 'target', size: 12 }),
            h('span', { 'data-fold-priority': 10 }, s.issuePath && s.issuePath.current ? '馃搶 #' + s.issuePath.current : '馃搶 --'),
          ]),
          s.issuePathHover ? PortalOverlay({ className: 'dsws-issuepath-pop', onMouseEnter: function () { clearClose(issuePathCloseRef) }, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.issuePathPos ? s.issuePathPos.left : 0, bottom: s.issuePathPos ? s.issuePathPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.45)', minWidth: 260, maxWidth: 380 } }, [
            h('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--dsw-alias-label-primary,#e6edf3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', null, '馃搶 褰撳墠璺緞'),
              h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', fontWeight: 400 } }, s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length ? 'anchor #' + s.issuePath.anchor + ' 路 ' + s.issuePath.nodes.length + ' 鑺傜偣' : '绌?),
              h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 4 } }, [
                h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); clearIssuePath(s); closeIssuePath() }, style: { fontSize: 10, padding: '2px 6px' } }, '娓呯┖'),
              ]),
            ]),
            (s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length) ? h('div', { style: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } }, s.issuePath.nodes.slice(-20).reverse().map(function (nd) {
              const isCur = nd.ref === s.issuePath.current
              const isAnchor = nd.ref === s.issuePath.anchor
              const t = new Date(nd.ts || Date.now()); const tm = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0')
              const srcColor = nd.source === 'claim' ? '#4ade80' : nd.source === 'gh-edit' ? '#58a6ff' : nd.source === 'mention' ? '#f59e0b' : '#8b8b95'
              const srcLabel = nd.source === 'claim' ? 'claim' : nd.source === 'gh-edit' ? 'gh-edit' : nd.source === 'mention' ? 'mention' : nd.source
              return h('div', { key: nd.ts + '-' + nd.ref, onClick: function (e) { e.stopPropagation(); reanchorIssuePath(s, nd.ref) }, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: isCur ? 'rgba(74,222,128,.14)' : 'transparent', border: isCur ? '1px solid rgba(74,222,128,.35)' : '1px solid transparent', cursor: 'pointer' } }, [
                h('span', { style: { fontSize: 11, fontFamily: 'Consolas,Menlo,monospace', color: isCur ? '#4ade80' : 'var(--dsw-alias-label-primary,#e6edf3)', fontWeight: isCur ? 700 : 500 } }, '#' + nd.ref + (isAnchor ? ' 鈿? : '')),
                h('span', { style: { fontSize: 10, color: srcColor, border: '1px solid ' + srcColor, borderRadius: 4, padding: '0 4px', lineHeight: 1.6 } }, srcLabel),
                h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tm),
                nd.title ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, nd.title) : null,
                isCur ? h('span', { style: { fontSize: 10, color: '#4ade80', fontWeight: 700 } }, '鈫?褰撳墠') : null,
              ])
            })) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '6px 0' } }, '鏆傛棤璺緞 路 鐐瑰嚮浠绘剰 issue 琛岀殑鈥滄墽琛?璇婃柇/淇鈥濇垨鍦ㄦ柊浼氳瘽涓墦寮€ issue 浼氳嚜鍔ㄨ褰?),
            h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 6, paddingTop: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [
              h('span', null, '鐐瑰嚮鑺傜偣鍙噸閿氳捣鐐?),
              h('span', { style: { marginLeft: 'auto' } }, '涓婇檺 100 路 鏈湴鎸佷箙'),
            ]),
          ]) : null,
        ]),
        seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; go('list') }, tr('nav.takeableTitle')),
        // issue #4锛欱UG 璁℃暟娈?鈥斺€?鐐瑰嚮浠嶅紑 bug 杩囨护鍒楄〃锛涙偓鍋滃脊銆屾柊澧炪€嶈彍鍗曪紙鏂颁細璇濋濉?/wayfinder 鏂板 BUG 鍗?prompt锛?
        h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
          seg('alert', [h('span', { 'data-fold-priority': 6 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') }, tr('nav.bugTitle')),
          s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
            h('div', { onClick: function (e) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
              Ic({ n: 'bug', size: 12, color: s.bugMenuHover ? '#fca5a5' : '#f87171' }),
              h('span', null, tr('nav.bugNew')),
            ]),
          ]) : null,
        ]),
        seg('search', [h('span', { 'data-fold-priority': 7 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') }, tr('nav.triageTitle')),
        // #16 V2锛歯ote 娈碉紙娌夋穩 / Consolidate锛夋枃瀛?span 鎵?data-fold-priority=2锛堟棤鏁板瓧鎿嶄綔娈碉紝淇℃伅浠峰€间綆锛屾棭鏀讹級
        seg('note', h('span', { 'data-fold-priority': 2 }, tr('nav.word')), '#c084fc', function () { injectFixate(s) }, tr('nav.fixateTitle')),
        // 闇€姹?路浜岄樁娈碉紙2026-08-18锛夛細浜ゆ帴鍒嗗壊鎸夐挳 鈥斺€?鍏卞妗?+ 缁嗗垎闅旂嚎锛涘乏鍗娿€屼氦鎺ャ€? 绗竴鍑荤敓鎴愩€?
        //   鍙冲崐銆屼氦鎺ュ嚭鍘汇€? 鍘熺浜屽嚮锛堟帰娴嬬鐩樻渶鏂版枃妗?鈫?棰勫～ + 寮€鏂颁細璇濓級銆傚悇鑷偣鍑诲尯/tooltip 淇濈暀锛宧over 娌跨敤 seg 鑳屾櫙銆?
        //   鍙冲崐鐏?浜弻鎬侊細handoffReady 鈫?浜摑 #58a6ff锛坱ooltip nav.handoffReadyTitle锛夛紱鏈?ready 鈫?鍗婇€忔槑鐏帮紙tooltip nav.handoffGreyTitle锛?
        // #16 V2锛歴plit-part 宸﹀崐銆屼氦鎺ャ€嶆枃瀛?span 鎵?data-fold-priority=3锛堟棤鏁板瓧鎿嶄綔娈碉級
        h('span', { className: 'dsws-split' }, [
          h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoff(s) }, title: tr('nav.handoffTitle'), style: { color: '#58a6ff' } }, [
            Ic({ n: 'handoff', size: 12 }),
            h('span', { 'data-fold-priority': 3 }, tr('nav.handoff')),
          ]),
          h('span', { className: 'dsws-split-div' }),
          h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }, title: s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'), style: s.handoffReady ? { color: '#58a6ff' } : { color: '#8b8b95', opacity: 0.55, cursor: 'default' } }, [
            Ic({ n: s.handoffReady ? 'handoff-open' : 'handoff-off', size: 12 }),
          ]),
        ]),
        // v19-36锛氱幆澧冩绉昏嚦鏈熬锛堟洿鏂板乏渚э級锛岀敤鎴峰皯鐐?
        seg('dot', [h('span', { 'data-fold-priority': 8 }, tr('nav.env')), num(envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') }, tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) })),
        // v1.5 T10锛氬埛鏂板弽棣?= 鍥炬爣杞湀锛堟枃瀛楁亽瀹氫笉鎹?路 鎺т欢瀹藉害闆跺彉鍖栵級
        // #16 V2锛歵imebtn 涓ゆ鏂囧瓧鍚勬墦 priority锛堝埛鏂板瓧=4 鏃犳暟瀛楁搷浣滄 / 鏃堕棿=9 绾弬鑰冩椂闂存埑鏈€鍚庢敹锛?
        h('span', { className: 'dsws-timebtn', onClick: function (e) { e.stopPropagation(); refreshAll(s) }, title: tr('nav.refreshTitle') }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 4 }, tr('nav.refresh')), h('span', { 'data-fold-priority': 9 }, ' ' + timeStr)]),
        // 闇€姹?锛?026-08-18锛夛細鐘舵€佹爮鏈熬鎶€鑳藉垪琛ㄦ寜閽?鈥斺€?鍚戜笂灞曞紑鎶€鑳藉悕鍒楄〃锛岀偣鍑绘妧鑳藉悕鎻掑叆 /<鎶€鑳藉悕> 鍒板綋鍓嶄細璇?
        // issue #3锛圖2锛夛細瀵归綈 BUG 娈垫偓娴彍鍗?鈥斺€?鎮仠鍗冲睍寮€銆佺Щ鍑恒€屾寜閽?+ 鍒楄〃銆嶆暣浣撳尯鍩熷嵆鍏抽棴锛?
        //   鎸夐挳涓庡垪琛ㄤ箣闂寸殑 4px 闂撮殭鐢卞灞?paddingTop 妗ユ帴锛堜笉鍐嶇敤 marginBottom锛夛紝榧犳爣绌胯秺涓嶈鍏炽€?
        h('span', {
          style: { position: 'relative', display: 'inline-flex' },
          ref: skillAnchorRef, onMouseEnter: showSkillPop,
          onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) },
        }, [
          h('span', { className: 'dsws-skillbtn' + (s.skillsOpen ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.skillsOpen) closeSkillPop(); else showSkillPop() }, title: tr('nav.skillsTitle'), style: { display: 'inline-flex', alignItems: 'center', padding: '1px 4px', borderRadius: 4, cursor: 'pointer', color: s.skillsOpen ? '#c084fc' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [Ic({ n: 'skills', size: 12 })]),
          s.skillsOpen ? PortalOverlay({ className: 'dsws-skillpop-bridge', onMouseEnter: function () { clearClose(skillCloseRef) }, onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) }, style: { position: 'fixed', right: s.skillPopPos ? s.skillPopPos.right : 0, bottom: s.skillPopPos ? s.skillPopPos.bottom : 0, paddingTop: 4, paddingBottom: 4, zIndex: 2147483000 }, onClick: function (e) { e.stopPropagation() } }, [
            h('div', { className: 'dsws-skillpop', style: { minWidth: 150, maxHeight: 'min(300px, calc(100vh - 24px))', overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)', padding: 4 } }, [
              // 鎮诞璁板繂锛氶紶鏍囩Щ鍒拌涓婄珛鍗冲嚭鐜版诞灞傦紙鏇夸唬娴忚鍣ㄥ師鐢?title 鐨勬參寤惰繜锛?
              SKILLS.map(function (sk) {
                return h('div', {
                  key: sk.name,
                  onClick: function (e) { e.stopPropagation(); inject(s, '/' + sk.name); closeSkillPop() },
                  onMouseEnter: function (e) {
                    const r = e.currentTarget.getBoundingClientRect()
                    // 娴眰瀹炲 = maxWidth 220 + 宸﹀彸鍐呰竟璺?16 + 杈规 2 = 238锛堢炕杞槇鍊间笌瀹炲瀵归綈锛岄伩鍏嶈创杈癸級
                    let tip = { x: r.right + 8, y: r.top + r.height / 2, name: sk.name }
                    if (typeof window !== 'undefined' && tip.x + 238 > window.innerWidth) tip = { x: r.left - 8 - 238, y: r.top + r.height / 2, name: sk.name }
                    s.skillHover = sk.name
                    s.skillTip = tip
                    emit(s)
                  },
                  onMouseLeave: function () { if (s.skillHover !== null) { s.skillHover = null; s.skillTip = null; emit(s) } },
                  style: { padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.skillHover === sk.name ? 'var(--dsw-alias-label-primary,#e6edf3)' : 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace', background: s.skillHover === sk.name ? 'var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))' : 'transparent', borderLeft: s.skillHover === sk.name ? '2px solid #c084fc' : '2px solid transparent' }
                }, sk.name)
              }),
              // 搴曢儴鎿嶄綔鎻愮ず锛堟浛浠ｈ绉婚櫎鐨勫垪琛ㄦ爣棰樹綅锛屼繚鎸侀《閮ㄧ函鎶€鑳藉悕锛?
              h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '5px 8px 2px', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 2, whiteSpace: 'nowrap' } }, tr('nav.skillHint')),
            ]),
          ]) : null,
        ]),
        // 蹇€熸偓娴彁绀猴細portal 鍒?document.body锛坕ssue #3路D1锛夆€斺€旇劚绂荤姸鎬佹爮瀛愭爲锛宲osition:fixed 鐨?
        //   瑙嗗彛鍧愭爣涓?z-index 鍏ㄥ眬鐢熸晥锛屼笉鍐嶈瀹夸富杈撳叆鍖哄鍣ㄨ鍓垨鍘嬪眰
        s.skillTip && s.skillHover ? portalTop(h('div', { style: { position: 'fixed', left: s.skillTip.x, top: s.skillTip.y, transform: 'translateY(-50%)', maxWidth: 220, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)' } }, tr('skilldesc.' + s.skillTip.name))) : null,
      ])
      // 鐢ㄦ埛鎷嶆澘 2026-08-16 + 2026-08-17锛氭í骞呯Щ鍒扮姸鎬佹爮涓婃柟锛涗緷璧栭摼 gh 鈫?鐧诲綍 鈫?setup 鈫?鎶€鑳斤紝鏄剧ず绗竴涓己澶遍」
      const firstBlock = ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
      // #16 v1.6.4 R4锛歸rapper 鍔?overflow:hidden 鎴帀 capsule 婧㈠嚭 wrapper 閮ㄥ垎锛坉n=0..3 涓棿鐘舵€佹椂 children 灞呬腑鍚庡乏鍙冲彲鑳芥孩鍑?wrapper锛?
      // #16 R6b锛氬幓鎺?alignItems:'stretch'锛堜箣鍓嶄负浜嗘媺浼?capsule 鎾戞弧 wrapper 楂樺害锛屽弽鑰岃鐖剁骇
//   composerHero 297px 楂樹紶缁?wrapper 鍚庯紝capsule 琚媺鎴愪笌 wrapper 鍚岄珮 鈮?.5px锛屾枃瀛楄鎴帀锛?
      // #16 R12锛堟湰娆★級锛氬涓?conversation.input.dock 鎻掓Ы = composerStack锛坈olumn flex锛夛紝wrapper 鏄?flex item锛?
//   榛樿 flex-shrink:1 鈫?杈撳叆鍖洪珮搴﹁鍘嬬缉鏃?wrapper 琚帇鎵侊紙wrapper 11px 鈫?capsule 8px 鈫?overflow:hidden 瑁佹枃瀛楋級銆?
//   R6b 鍙槻浜嗐€岃鎷夐珮銆嶏紝娌￠槻銆岃鍘嬬煯銆嶏紱鏁呭姞 flex:'none'锛坒lex:0 0 auto锛夊弻淇濋櫓銆?
// #22锛氭甯歌矾寰勭敱 portal 鑴辩瑁佸壀锛涜嫢 ReactDOM 涓嶅彲鐢紝閫€鍖栬妭鐐瑰繀椤讳笉鍐嶈鏈?wrapper 绔嬪嵆瑁佹帀銆?
      if (!firstBlock) return h('div', { style: { display: 'flex', flex: 'none', justifyContent: 'center', width: '100%', boxSizing: 'border-box', padding: '3px 8px 0', overflow: RDOM ? 'hidden' : 'visible' } }, [capsule])
      const bann = function (text, btnLabel, onBtn) {
        return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
          Ic({ n: 'alert', size: 13 }),
          h('span', { style: { flex: 1 } }, text),
          h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: onBtn }, btnLabel),
        ])
      }
      return h('div', { style: { display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '3px 8px 0' } }, [
        firstBlock === 'ghcli'
          ? bann(tr('banner.ghcli'), tr('banner.ghcliBtn'), function () { openUrl('https://cli.github.com/') })
          : firstBlock === 'ghauth'
            ? bann(tr('banner.ghauth'), tr('banner.ghauthBtn'), function () { openUrl('https://cli.github.com/manual/gh_auth_login') })
            : firstBlock === 'setup'
              ? bann(tr('banner.setup'), tr('banner.setupBtn'), function () { inject(s, promptText('setupRun')) })
              : bann(tr('banner.skills', { list: (skillsCheck && skillsCheck.detail) || '' }), tr('banner.skillsBtn'), function () { inject(s, promptText('installSkills')) }),
        capsule,
      ])
    }

    // ============================================================
    // T17锛歩ssue 姝ｆ枃 markdown 鐧藉悕鍗曟覆鏌擄紙mdToHtml锛?
    //   鍙鐧藉悕鍗曡娉曪紝鍏朵綑涓€寰嬬函鏂囨湰锛堜笉娓叉煋鍘熷 HTML锛岄槻 XSS锛?
    //   杈撳嚭鏍囧噯 HTML 鏍囩 鈫?opencode-palette 涓婚鑷姩涓婅壊锛坢arkdownHeading/Link/Code/Emph/Strong锛?
    //   杩斿洖鍊硷細React 鍏冪礌鏁扮粍锛堝彲鐩存帴浣滀负 h(...) children锛?
    // ============================================================
    const MD_LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/g
    const MD_TASK_RE = /^- \[([ xX])\]\s*(.*)$/
    const mdEsc = function (s) { return String(s == null ? '' : s) }
    const mdInline = function (text, keyBase) {
      const out = []
      let rest = mdEsc(text)
      let k = 0
      // 鍏堟彁鍙栭摼鎺ワ紙闃插唴閮?** 娣锋穯锛沀RL 鍗忚鐧藉悕鍗曢槻 javascript:/data: 绛夊嵄闄╁崗璁級
      const linkParts = []
      const mdSafeUrl = function (u) {
        const s = String(u == null ? '' : u).trim()
        if (!s) return null
        if (/^(https?:|mailto:)/i.test(s)) return s
        if (/^[#/]/.test(s) || /^\.\.?\//.test(s)) return s
        if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s
        return null
      }
      rest = rest.replace(MD_LINK_RE, function (m, label, url) {
        const u = mdSafeUrl(url)
        if (u === null) return label
        linkParts.push(h('a', { key: 'l' + (k++), href: u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, mdInline(label, 'll' + k)))
        return '\u0001L' + (linkParts.length - 1) + '\u0001'
      })
      // 鍐嶅鐞嗗姞绮?/ 鏂滀綋 / 琛屽唴浠ｇ爜锛堝厛瑙ｆ瀽娈靛唴閾炬帴鍗犱綅绗︹€斺€旈摼鎺ュ彲宓屽湪鏂囨湰浠绘剰浣嶇疆锛?
      rest.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60)/g).forEach(function (seg, si) {
        if (!seg) return
        if (seg.indexOf('\u0001') >= 0) {
          const re = /\u0001L(\d+)\u0001/g
          let last = 0
          let m
          while ((m = re.exec(seg)) !== null) {
            if (m.index > last) out.push(seg.slice(last, m.index))
            const n = parseInt(m[1], 10)
            if (!isNaN(n) && linkParts[n]) out.push(linkParts[n])
            else out.push(m[0])
            last = m.index + m[0].length
          }
          if (last < seg.length) out.push(seg.slice(last))
          return
        }
        const em = /^\*\*([^*]+)\*\*$/.exec(seg)
        if (em) { out.push(h('strong', { key: (keyBase || '') + 's' + (si) }, em[1])); return }
        const it = /^\*([^*]+)\*$/.exec(seg)
        if (it) { out.push(h('em', { key: (keyBase || '') + 'i' + (si) }, it[1])); return }
        const cd = /^\x60([^\x60]+)\x60$/.exec(seg)
        if (cd) { out.push(h('code', { key: (keyBase || '') + 'c' + (si), style: { fontFamily: 'var(--ds-font-family-code,Consolas,Menlo,monospace)', fontSize: '0.92em', padding: '0 3px', borderRadius: 4, background: 'var(--dsw-alias-markdown-code-block,rgba(255,255,255,.07))' } }, cd[1])); return }
        out.push(seg)
      })
      return out
    }
    const mdToHtml = function (md, opts) {
      const o = opts || {}
      const nodes = []
      const lines = String(md == null ? '' : md).split(/\r?\n/)
      let i = 0
      let k = 0
      const pushList = function (items) {
        if (!items.length) return
        nodes.push(h('ul', { key: 'ul' + (k++), style: { margin: '2px 0', paddingLeft: 16 } }, items.map(function (it, ii) {
          if (it.task !== null) {
            return h('li', { key: 'li' + ii, style: { listStyle: 'none', marginLeft: -14 } }, [
              h('input', { type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true, style: { marginRight: 5, verticalAlign: 'middle' } }),
              h('span', null, mdInline(it.text, 't' + ii)),
            ])
          }
          return h('li', { key: 'li' + ii }, mdInline(it.text, 't' + ii))
        })))
      }
      while (i < lines.length) {
        const line = lines[i]
        const trim = line.trim()
        const h2 = /^##\s+(.+)$/.exec(trim)
        if (h2) { nodes.push(h('div', { key: 'h' + (k++), style: { fontSize: 14, fontWeight: 700, margin: '6px 0 3px', color: 'var(--dsw-alias-markdown-heading,var(--dsw-alias-label-primary,#e6edf3))', fontFamily: 'var(--dsw-font-markdown-h2,var(--dsw-font-family))' } }, mdInline(h2[1], 'h' + k))); i++; continue }
        const hr = /^---+$/.test(trim) || /^\*\*\*+$/.test(trim)
        if (hr) { nodes.push(h('hr', { key: 'hr' + (k++), style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', margin: '4px 0' } })); i++; continue }
        const q = /^>\s?(.*)$/.exec(trim)
        if (q) { nodes.push(h('blockquote', { key: 'bq' + (k++), style: { margin: '2px 0', paddingLeft: 8, borderLeft: '3px solid var(--dsw-alias-border-l1,#2a2d35)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, mdInline(q[1], 'q' + k))); i++; continue }
        // 鍒楄〃锛堣繛缁褰掔粍锛?
        const listItems = []
        let j = i
        while (j < lines.length) {
          const lt = lines[j].trim()
          const taskM = MD_TASK_RE.exec(lt)
          const bullet = /^-\s+(.+)$/.exec(lt) || /^\*\s+(.+)$/.exec(lt)
          if (taskM) { listItems.push({ task: taskM[1], text: taskM[2] }); j++; continue }
          if (bullet) { listItems.push({ task: null, text: bullet[1] }); j++; continue }
          break
        }
        if (listItems.length) { pushList(listItems); i = j; continue }
        // 绌鸿 / 鏅€氭钀?
        if (trim === '') { i++; continue }
        nodes.push(h('div', { key: 'p' + (k++), style: { margin: '1px 0' } }, mdInline(line, 'p' + k)))
        i++
      }
      if (o.single) return nodes[0] || null
      return nodes
    }
    // ============================================================
    // v1.5 T12锛氱エ杩涘害娓叉煋锛堢姸鎬佸窘绔?+ 杩涘害鏉★級鈥斺€?open/close 鍘熺敓 + 杩涘害鑷瘎
    const tStatus = function (t) {
      if (t.state === 'CLOSED') return { key: 'done', color: '#3fb950', icon: 'check' }
      if (t.progress === null || t.progress === undefined || t.progress <= 0) return { key: 'todo', color: '#8b8b95', icon: 'dot' } // B4锛?% = 鏈姩宸ワ紙濂戠害锛夛紝涓嶈繘 doing
      if (t.progress >= 100) return { key: 'accept', color: '#f59e0b', icon: 'alert' }
      if (t.progress >= 95) return { key: 'confirm', color: '#f59e0b', icon: 'alert' }
      return { key: 'doing', color: '#58a6ff', icon: 'dot' }
    }
    const tStatusLabel = function (t) {
      const s = tStatus(t)
      if (s.key === 'done') return tr('progress.done')
      if (s.key === 'accept') return tr('progress.accept')
      if (s.key === 'confirm') return tr('progress.confirm')
      if (s.key === 'doing') return tr('progress.doing', { n: t.progress })
      return tr('progress.todo')
    }
    const tProgressBar = function (t) {
      const p = (t.state === 'CLOSED') ? 100 : (t.progress === null || t.progress === undefined ? 0 : t.progress)
      const color = (t.state === 'CLOSED') ? '#3fb950' : (t.progress === null || t.progress === undefined ? '#52525b' : '#58a6ff')
      const label = (t.state === 'CLOSED') ? '100%' : (t.progress === null || t.progress === undefined ? '鈥? : t.progress + '%')
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 } }, [
        h('div', { style: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' } }, [
          h('div', { style: { width: String(p) + '%', height: '100%', background: color, borderRadius: 2 } }),
        ]),
        h('span', { style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right' } }, label),
      ])
    }
    const tStatusBadge = function (t) {
      if (t.state === 'CLOSED') return null
      const s = tStatus(t)
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 2, color: s.color, fontSize: 9, flex: 'none' } }, [
        Ic({ n: s.icon, size: 8 }),
        h('span', null, tStatusLabel(t)),
      ])
    }

    // ---- 5.3 绁ㄥ姟琛岋紙鍦板浘璇︽儏鍐咃細鏍囬/闃诲鏉ユ簮 ellipsis锛泇19锛氭寜鏍囩缁?璇婃柇/淇/璁ㄨ/鎵ц 鍔ㄤ綔锛岄濉緭鍏ユ锛?---
    const TicketRow = ({ st, g, t, indent, colorOf }) => {
      const openBlocker = function (b) { const bt = g.m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' }
      const blocked = t.state === 'OPEN' && t.blockedBy.some(openBlocker)
      const subItem = (icon, color, text) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, color: color, minWidth: 0 } }, [
        Ic({ n: icon, size: 11 }),
        h('span', { className: 'dsws-ellip', style: { maxWidth: 200 }, title: text }, text),
      ])
      return h('div', { className: 'dsws-trow', style: indent ? { paddingLeft: 18 } : null }, [
        h('div', { className: 'dsws-tt' }, [
          h('div', { className: 'dsws-tt-name' }, [
            // T2 #3锛氱紪鍙峰墠缃?
            h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, flex: 'none' } }, '#' + t.number),
            TypeChip({ type: t.type }),
            h('span', { className: 'dsws-tt-wrap', style: { flex: 1 }, title: t.title }, t.title),
          ]),
          h('div', { className: 'dsws-tt-sub', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
            t.claimedBy ? subItem('person', '#58a6ff', tr('map.subClaimed', { who: t.claimedBy })) : null,
            // #370锛氳闃诲 chip 鍙樉绀轰粛 OPEN 鐨勯樆濉炶€咃紙涓?compute/涓诲垪琛?鎸夐挳鎶戝埗鍙ｅ緞涓€鑷达級
            blocked ? subItem('lock', '#f0883e', tr('map.subBlocked', { who: blockerNames(t, g.m) })) : null,
            t.state === 'CLOSED' ? subItem('check', '#3fb950', tr('map.subClosed')) : null,
            tStatusBadge(t),
          ]),
          (t.state === 'OPEN') ? tProgressBar(t) : null,
        ]),
        t.state === 'OPEN' ? h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: 'none' } }, [
          blocked ? null : mkRowAction(st, t, false, colorOf),
          // #361 鑳藉姏淇濈暀锛堝悓 cwd + 鑷姩鍛藉悕 + 棰勫～鎸囦护锛夛紱#394锛氬幓 ghost/icon-only锛屼笌 nav.handoff 瑙ｈ€?
          //   marginLeft:4 涓庡乏渚?mkRowAction 褰㈡垚闅愬紡鍒嗙粍锛堝姩浣滅粍 vs 杈呭姪缁勶級
          h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, t) }, title: tr('list.newSessionLabel'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: actionColorOf(t, colorOf), borderColor: 'transparent', color: isLightHex(actionColorOf(t, colorOf)) ? '#140a1e' : '#ffffff' } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))]),
          h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 6px' } }, Ic({ n: 'link', size: 12 })),
        ]) : h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' } }, tr('act.view')),
      ])
    }

    // ---- 5.4 鍦板浘璇︽儏锛坴1.4 路 T2 #443锛氭紡鏂楀垎灞?+ 鎴樹簤杩烽浘 + 72px 浠紡鐜?+ 鍥涙€佸姩浣滐紝D1-D8 瑙勬牸锛?---
    //   灞?= blockedBy DAG 鏈€闀胯矾寰勬繁搴︼紙T1 #442 宸茬畻 stats.levels + 姣忕エ t.level锛?
    const MapDetail = ({ st, g }) => {
      const m = g.m
      const colorOf = buildColorOf(st)
      const tickets = m.tickets || []
      const levels = (m.stats && m.stats.levels) || []
      const totalLayers = levels.length
      // 褰撳墠灞?= 绗竴涓惈 open 绁ㄧ殑灞傦紙鏃?open 鍏?done 鈫?鏈€鍚庝竴灞傦級
      const curLevel = (function () {
        for (let i = 0; i < levels.length; i++) { if (levels[i].open > 0) return i }
        return Math.max(0, levels.length - 1)
      })()
      const passedLayers = levels.filter(function (l, i) { return i < curLevel }).length
      const byLevel = {}
      tickets.forEach(function (t) { const lv = (typeof t.level === 'number') ? t.level : 0; (byLevel[lv] = byLevel[lv] || []).push(t) })
      // 杩烽浘锛歠og 绁紙Not yet specified锛? 琚樆濉炰笖鍏堕樆濉炶€?open 鐨勭エ锛堝崐闆撅級锛汥7 瑙嗚閬斀
      const isFog = function (t) {
        if (t.state !== 'OPEN') return false
        const blk = (t.blockedBy || []).map(function (b) { return tickets.find(function (x) { return x.number === b }) }).filter(Boolean)
        return blk.some(function (b) { return b.state === 'OPEN' })
      }
      const fogTitles = (m.fog || []).map(function (f) { return String(f).trim() })
      const isFogTitle = function (t) { return fogTitles.some(function (f) { return f && t.title && t.title.indexOf(f) >= 0 }) }
      // v1.4锛氬悓灞傚唴鎺掑簭 鈥斺€?鍙墽琛岋紙open 涓旈潪杩烽浘锛夋渶宸?鈫?open 琚樆濉?鈫?宸插叧闂潬鍙筹紙涓€鐪肩湅鍒板綋鍓嶈兘鍋氫粈涔堬級
      Object.keys(byLevel).forEach(function (lv) {
        byLevel[lv].sort(function (a, b) {
          const rank = function (t) {
            if (t.state === 'OPEN') return isFog(t) || isFogTitle(t) ? 1 : 0
            return 2
          }
          return rank(a) - rank(b) || a.number - b.number
        })
      })
      // 杩烽浘鐐瑰嚮鍘婚浘鐘舵€侊紙st 涓婃寜 map 瀛橈級
      st.reveal = st.reveal || {}
      const nodeCls = function (t) {
        let cls = 'dsws-node'
        if (t.state === 'CLOSED') cls += ' done'
        else if (t.level === curLevel) cls += ' now'
        const fog = isFog(t) || isFogTitle(t)
        if (fog) { cls += ' fog'; if (st.reveal[m.number] && st.reveal[m.number][t.number]) cls += ' revealed' }
        // R5锛氬瓙绁ㄧ骇鍙樺寲楂樹寒锛坕ssueFlash锛?
        if (st.issueFlash && st.issueFlash[t.number]) cls += st.issueFlash[t.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed'
        return cls
      }
      const toggleReveal = function (t) {
        st.reveal[m.number] = st.reveal[m.number] || {}
        st.reveal[m.number][t.number] = !(st.reveal[m.number][t.number])
        emit(st)
      }
      const gateState = function (layerIndex) {
        // 闂搁棬锛氳灞傚叏 closed 鈫?open(缁库湏)锛涘眰鍚?open 涓斿湪鍏朵箣鍓嶅眰鍏?closed 鈫?open锛涘惁鍒?lock
        const lv = levels[layerIndex]
        if (!lv) return 'open'
        if (lv.closed === lv.total && lv.total > 0) return 'open'
        const prevAllClosed = levels.slice(0, layerIndex).every(function (p) { return p.closed === p.total })
        return prevAllClosed ? 'open' : 'lock'
      }
      const node = function (t) {
        const blocked = isFog(t)
        // T15锛歛cts 鎭掓覆鏌撳鍣紙CLOSED/fog 绌哄崰浣嶏級鈫?鍗＄墖楂樺害鎭掑畾
        const acts = h('div', { className: 'acts' }, (t.state === 'OPEN' && !blocked) ? [
          mkRowAction(st, t, false, colorOf),
          h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' } }, Ic({ n: 'link', size: 11 })),
        ] : [])
        // v1.4 淇锛氬浘鏍囧悕蹇呴』鐢?Ic 鏀寔鐨勶紙search/hammer/chat/gear锛夛紝鍘?mag/bolt/wrench 涓嶅瓨鍦?鈫?鑺傜偣鍥炬爣绌虹櫧
        const ic = t.type === 'research' ? 'search' : t.type === 'prototype' ? 'hammer' : t.type === 'grilling' ? 'chat' : 'gear'
        return h('div', {
          key: t.number,
          className: nodeCls(t),
          onClick: (isFog(t) || isFogTitle(t)) ? function (e) { e.stopPropagation(); toggleReveal(t) } : undefined,
        }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'icbox' }, Ic({ n: ic, size: 12 })),
            h('div', { style: { flex: 1, minWidth: 0 } }, [
              h('div', { className: 'meta' }, [
                h('span', { className: 'no' }, '#' + t.number),
                TypeChip({ type: t.type }),
              ]),
              h('div', { className: 'tt', title: t.title }, t.title),
              h('div', { className: 'sub', style: { fontSize: 8, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 1, minHeight: 12, display: 'flex', gap: 5, flexWrap: 'wrap' } }, [
                t.state === 'CLOSED' ? h('span', { style: { color: '#3fb950', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'check', size: 8 }), h('span', null, tr('map.subClosed'))]) : null,
                t.claimedBy ? h('span', { style: { color: '#58a6ff', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'person', size: 8 }), h('span', null, t.claimedBy)]) : null,
                blocked ? h('span', { style: { color: '#f0883e', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'lock', size: 8 }), h('span', null, tr('map.subBlocked', { who: blockerNames(t, m) }))]) : null,
              ]),
              // v1.5 T12锛氳繘搴︽潯 + 鐘舵€佸窘绔狅紙open 绁ㄦ樉绀虹湡瀹炶繘搴?路 淇?0/13锛?
              tProgressBar(t),
              h('div', { style: { marginTop: 2, minHeight: 14, display: 'flex', alignItems: 'center', gap: 2 } }, [tStatusBadge(t)]),
            ]),
          ]),
          acts,
          (isFog(t) || isFogTitle(t)) ? h('svg', { className: 'qmark', viewBox: '0 0 24 24' }, [h('path', { d: 'M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.9.4-1.2 1-1.2 1.8' }), h('circle', { cx: '12', cy: '18', r: '.6' })]) : null,
        ])
      }
      const layerBlock = function (layerIndex) {
        const lv = levels[layerIndex]
        if (!lv) return null
        const layerTickets = byLevel[layerIndex] || []
        const gate = gateState(layerIndex)
        const isCur = layerIndex === curLevel
        // T15锛氬眰瀹瑰櫒 + 鏄庢樉灞傚彿锛堝綋鍓嶅眰楂樹寒锛夛紱灞傚唴缃戞牸鑷€傚簲
        return [
          h('div', { className: 'dsws-layerbox' + (isCur ? ' cur' : '') }, [
            h('div', { className: 'dsws-layerTag' }, [
              h('span', { className: 'dsws-layerNo' }, String(layerIndex + 1)),
              h('span', { className: 'dsws-layerTitle' }, tr('map.layer', { n: layerIndex + 1 }) + ' 路 ' + lv.open + ' open'),
              h('span', { className: 'sp' }),
            ]),
            h('div', { className: 'dsws-layer' }, layerTickets.map(function (t) { return node(t) })),
          ]),
          h('div', { className: 'dsws-gate' }, [
            h('span', { className: 'g ' + gate }, Ic({ n: gate === 'open' ? 'check' : 'lock', size: 12 })),
          ]),
        ]
      }
      // 瀹屾垚鎬侊細鍏?closed 鈫?杩涘害鏉″叏缁?+ 鐜弧鍦?
      const allClosed = m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total
      const ringPct = allClosed ? 1 : (totalLayers ? Math.min(1, (passedLayers + 1) / totalLayers) : 0)
      const C = 2 * Math.PI * 31
      const ringOff = C * (1 - ringPct)
      return h('div', null, [
        // 椤堕儴鎿嶄綔琛岋細杩斿洖 + map chip + 鎵ц/瀹屾垚
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, [
          h('button', { className: 'dsws-btn', onClick: function () { st.activeMap = null; emit(st) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            Ic({ n: 'back', size: 12 }),
            h('span', null, tr('list.back')),
          ]),
          h('span', { className: 'dsws-chip dsws-chip-m' }, [Ic({ n: 'map', size: 11 }), h('span', null, 'wayfinder:map')]),
          h('span', { style: { flex: 1 } }),
          (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
            ? h('button', { className: 'dsws-btn primary', title: tr('map.doneTitle'), onClick: function () {
                const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                inject(st, text)
              }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [
                Ic({ n: 'check', size: 10 }),
                h('span', null, tr('act.done')),
              ])
            : h('button', { className: 'dsws-btn primary', title: tr('map.executeTitle'), onClick: function () {
                // v1.4锛歮ap 鎺ㄨ繘寮忔墽琛岋紙startText 妫€娴?wayfinder:map 鈫?MAP_EXECUTE_PROMPT锛?
                inject(st, startText(st, m))
              }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11 } }, [
                Ic({ n: 'play', size: 10 }),
                h('span', null, tr('act.execute')),
              ]),
          // v1.5 B2锛圤5锛夛細璇︽儏椤点€屽湪鏂颁細璇濇墦寮€銆嶁€斺€?涓?鎵ц/瀹屾垚 鍚岃涔夛紝寮€鏂颁細璇濇帹杩涜 map
          h('button', { className: 'dsws-btn ghost', title: tr('map.newSessionTitle'), onClick: function () { openInNewSession(st, m) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, flex: 'none' } }, [
            Ic({ n: 'external-link', size: 10 }),
            h('span', null, tr('list.newSessionLabel')),
          ]),
        ]),
        // T14锛歮ap 缂栧彿寰界珷 鈥斺€?鏍囬鍓嶆柟銆佺传鑹层€佷笌鍒楄〃 map 琛屽悓娆撅紙dsws-idnum锛?
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 } }, [
          h('span', { className: 'dsws-idnum', style: { color: '#c084fc', borderColor: '#c084fc', flex: 'none' } }, '#' + m.number),
          h('div', { className: 'dsws-mtitle dsws-tt-wrap', style: { flex: 1, minWidth: 0 }, title: m.title }, m.title),
        ]),
        m.error ? h('div', { style: { color: '#f87171', fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, String((m.error && m.error.error) || tr('list.loadFail')).slice(0, 160))]) : null,
        // D2锛氬垎娈甸潤鎬佽繘搴︽潯 = 鍦板浘灞傜缉鐣ュ浘锛堟棤鍔ㄧ敾锛屽敮涓€鐪熺浉婧愶級
        (levels.length > 0) ? h('div', { className: 'dsws-layers' }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'cap' }, tr('map.progressCap')),
            h('div', { className: 'segs' }, levels.map(function (l, i) {
              const segCls = i < curLevel ? 'seg past' : (i === curLevel ? 'seg curr' : 'seg future')
              return h('div', { key: i, className: segCls, title: tr('map.layer', { n: i + 1 }) })
            })),
          ]),
          h('div', { className: 'row2' }, [
            h('span', { className: 'cur' }, [Ic({ n: 'play', size: 9 }), h('span', null, tr('map.curLayer', { n: curLevel + 1 }))]),
            h('span', { className: 'pos' }, tr('map.layersPassed', { n: passedLayers, t: totalLayers })),
          ]),
        ]) : null,
        // T17 淇锛欴estination 璧?markdown 娓叉煋锛?*鍔犵矖** 绛変笉鍐嶈８闇诧紱鍘?ellip 鍏佽鎹㈣锛?
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }, [Ic({ n: 'target', size: 12, style: { marginTop: 2, flex: 'none' } }), h('div', { style: { flex: 1, minWidth: 0 } }, m.destination ? mdToHtml(m.destination) : tr('list.noDest'))]),
        // T17 淇锛氭鏂囪鎯咃紙Notes锛夐粯璁ゆ姌鍙?鈥斺€?<details> 鏀惰捣锛岀偣鍑诲睍寮€
        h('details', { style: { margin: '2px 0 4px' } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
            Ic({ n: 'note', size: 11 }),
            h('span', null, tr('map.notesCap')),
          ]),
          m.notes ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } }, mdToHtml(m.notes)) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 4, paddingLeft: 8 } }, tr('list.noNotes')),
        ]),
        // 婕忔枟鍒嗗眰涓讳綋
        h('div', { style: { marginTop: 2 } }, [
          h('div', { className: 'dsws-start' }, [
            h('span', { className: 'cap' }, tr('map.startCap')),
          ]),
          levels.map(function (l, i) { return layerBlock(i) }),
          // D3锛欴estination 72px 浠紡鐜紙鐜績鏃楀笢锛屾棤鏁板瓧锛?
          h('div', { className: 'dsws-dest' }, [
            h('div', { className: 'ring' }, [
              h('svg', { width: 72, height: 72, viewBox: '0 0 72 72' }, [
                h('circle', { className: 'track', cx: 36, cy: 36, r: 31 }),
                h('circle', { className: 'prog', cx: 36, cy: 36, r: 31, strokeDasharray: String(C), strokeDashoffset: String(ringOff) }),
              ]),
              h('div', { className: 'core' }, h('svg', { viewBox: '0 0 24 24' }, [h('path', { d: 'M5 3v18' }), h('path', { d: 'M5 4c4-2 6 2 12 0v9c-6 2-8-2-12 0' })])),
            ]),
            h('div', { className: 'title' }, tr('map.destCap')),
            h('div', { className: 'acts' }, [
              // v1.4锛氬簳閮ㄦ寜閽笌椤堕儴鍚岃涔?鈥斺€?瀹屾垚鎬併€屽畬鎴愩€嶏紙COMPLETE_PROMPT 鍚屽垪琛級/ 鏈畬鎴愩€屾墽琛屻€嶏紙execute 妯℃澘锛?
              (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
                ? h('button', { className: 'dsws-btn primary', title: tr('map.doneTitle'), onClick: function () {
                    const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                    inject(st, text)
                  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 700 } }, [
                    Ic({ n: 'check', size: 11 }),
                    h('span', null, tr('act.done')),
                  ])
                : h('button', { className: 'dsws-btn primary', title: tr('map.executeTitle'), onClick: function () {
                    // v1.4锛歮ap 鎺ㄨ繘寮忔墽琛岋紙startText 妫€娴?wayfinder:map 鈫?MAP_EXECUTE_PROMPT锛?
                    inject(st, startText(st, m))
                  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#4ade80', borderColor: 'transparent', color: '#04120a', fontWeight: 700 } }, [
                    Ic({ n: 'play', size: 11 }),
                    h('span', null, tr('act.execute')),
                  ]),
              h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + m.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))]),
            ]),
          ]),
        ]),
        // 鎶樺彔鍧楋細Decisions / Fog / Out of scope锛堜繚鐣欎俊鎭睍绀猴級
        h('details', { style: { marginTop: 10, marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.decisions', { n: m.decisions.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.decisions.map(function (d, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, [
              h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '路 '),
              (d.url ? h('a', { href: d.url, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, d.title) : h('span', null, d.title)),
              d.gist ? h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, ' 鈥?' + d.gist) : null,
            ])
          })),
        ]),
        h('details', { style: { marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.fog', { n: m.fog.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.fog.map(function (f, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('路 ' + f))
          })),
        ]),
        h('details', { style: { marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.outOfScope', { n: m.outOfScope.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.outOfScope.map(function (o, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('路 ' + o))
          })),
        ]),
      ])
    }

    // ---- 5.5 涓诲垪琛紙v14锛氫笁閫変竴鍔ㄤ綔 / map 琛岀獊鍑?+ 寮€濮嬫墽琛?/ 宸插叧闂姌鍙犺 / chips 娣辫竟妗?/ 绐勫睆鍙屾爮锛?---
    // v1.3.3 UI锛氳2 鏍囩璐績鎶樺彔 鈥斺€?娓叉煋鍚庢祴閲忓彲鐢ㄥ搴︼紝閫愪釜鏀炬爣绛撅紝鏀句笉涓嬬殑闅愯棌杩?+N锛堝崟琛屼笉鎹㈣锛?
    const _tagsFpOf = (typeof WeakMap !== 'undefined') ? new WeakMap() : { get: function () { return undefined }, set: function () { } }
    const fitAllTags = function () {
      if (typeof document === 'undefined') return
      document.querySelectorAll('.dsws-tags').forEach(function (tags) {
        const more = tags.querySelector('.dsws-more')
        if (!more) return
        const chips = Array.prototype.slice.call(tags.querySelectorAll('.dsws-chip:not(.dsws-more):not(.dsws-blocked)'))
        chips.forEach(function (c) { c.style.display = 'inline-flex' })
        more.style.display = 'inline-flex'
        const avail = tags.clientWidth
        const moreW = more.offsetWidth
        const gap = 3
        const room = avail - moreW - gap
        let used = 0, shown = 0
        chips.forEach(function (c, i) {
          const w = c.offsetWidth
          if (used + w <= room || i === 0) { c.style.display = 'inline-flex'; used += w + gap; shown++ }
          else c.style.display = 'none'
        })
        const hidden = chips.length - shown
        more.textContent = '+' + hidden
        more.style.display = hidden > 0 ? 'inline-flex' : 'none'
      })
    }
    // v1.3.3 UI锛?N 寮圭獥 鈥斺€?fixed 瀹氫綅锛屽熀鍑?= 闈㈡澘瀹瑰櫒 rect锛堝乏鍙?clamp 涓嶈秺鐣岋紝涓婁笅鑷姩缈昏浆閬胯锛?
    const showPop = function (trig, host, labels, title) {
      if (typeof document === 'undefined') return
      const old = document.getElementById('dsws-pop')
      if (old && old.parentNode) old.parentNode.removeChild(old)
      const pop = document.createElement('div')
      pop.id = 'dsws-pop'
      pop.className = 'dsws-pop'
      const pt = document.createElement('div'); pt.className = 'pt'
      pt.textContent = tr('list.tagsCount', { n: labels.length })
      const pl = document.createElement('div'); pl.className = 'pl'
      labels.forEach(function (l) {
        const s = document.createElement('span')
        s.className = 'dsws-chip'
        s.style.background = hexA(l.color, 0.18) || 'rgba(188,140,255,.16)'
        s.style.color = l.color ? '#' + l.color : '#bc8cff'
        s.style.border = '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)')
        s.textContent = l.name
        pl.appendChild(s)
      })
      const ptitle = document.createElement('div'); ptitle.className = 'ptitle'
      ptitle.innerHTML = '<b>' + tr('list.popTitle') + '锛?/b>' + String(title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      pop.appendChild(pt); pop.appendChild(pl); pop.appendChild(ptitle)
      document.body.appendChild(pop)
      const pr = host ? host.getBoundingClientRect() : { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 }
      const pad = 8
      const maxW = Math.max(120, pr.right - pr.left - pad * 2)
      pop.style.maxWidth = maxW + 'px'
      pop.style.display = 'block'
      const r = trig.getBoundingClientRect()
      const pw = pop.offsetWidth, ph = pop.offsetHeight
      let left = Math.max(pr.left + pad, Math.min(r.left, pr.right - pw - pad))
      let top = r.bottom + 10, flip = false
      if (top + ph > window.innerHeight - 8) { top = r.top - ph - 10; flip = true }
      if (top < 8) { top = r.bottom + 10; flip = false }
      if (top < pr.top + pad && !flip) { top = pr.top + pad }
      pop.style.left = left + 'px'
      pop.style.top = top + 'px'
      const caret = document.createElement('div'); caret.className = 'caret'
      const cx = r.left + r.width / 2 - left
      caret.style.left = Math.max(6, Math.min(cx - 5, pw - 16)) + 'px'
      caret.style.top = flip ? 'auto' : '-6px'
      caret.style.bottom = flip ? '-6px' : 'auto'
      if (flip) {
        caret.style.borderLeft = 'none'; caret.style.borderTop = 'none'
        caret.style.borderRight = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderBottom = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
        caret.style.transform = 'rotate(225deg)'
      } else {
        caret.style.borderLeft = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderTop = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
        caret.style.borderRight = 'none'; caret.style.borderBottom = 'none'
        caret.style.transform = 'rotate(45deg)'
      }
      pop.appendChild(caret)
      const close = function () { if (pop.parentNode) pop.parentNode.removeChild(pop); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('scroll', onScroll, true) }
      const onDoc = function (ev) { if (pop.contains(ev.target)) return; close() }
      const onScroll = function () { close() }
      document.addEventListener('mousedown', onDoc, true)
      document.addEventListener('scroll', onScroll, true)
      pop._close = close
    }
    // ============ T2 #35 路 NoRepo 绾㈠崱 + 琛ㄥ崟锛圠istTab 棣栧睆鏈€浼樺厛 路 瑙﹀彂= checkRepo:bad && !dismissed锛?===========
    const NoRepoCard = function (props) {
      const st = props.st
      const card = ensureNoRepoCard(st)
      const cs = activeChecks(st)
      const checkRepo = cs.find(function (c) { return c.id === 1 })
      const repoBad = !!(checkRepo && checkRepo.level === 'bad')
      const dismissed = isNoRepoDismissed(st.cwd)
      const show = repoBad && !dismissed
      if (!show) return null
      const isValid = isNoRepoNameValid(card.name)
      const doDismiss = function () { setNoRepoDismissed(st.cwd, true); card.expanded = false; emit(st) }
      const doExpand = function () { if (!card.name) card.name = cwdBasename(st.cwd); card.expanded = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doCollapse = function () { card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doSubmit = function () {
        if (!isNoRepoNameValid(card.name)) { card.errorKind = 'bad-name'; card.error = tr('panel.noRepoErr.bad-name'); card.errorRepoUrl = ''; emit(st); return }
        if (typeof host === 'undefined' || typeof host.call !== 'function') { card.errorKind = 'unknown'; card.error = tr('err.hostUnavailable'); card.errorRepoUrl = ''; emit(st); return }
        card.loading = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
        host.call('wf.initPublish', { cwd: st.cwd, name: card.name, visibility: card.visibility }).then(function (res) {
          card.loading = false
          if (res && res.ok) {
            const repoStr2 = res.repo && res.repo.owner ? res.repo.owner + '/' + res.repo.name : (res.repo && res.repo.name ? res.repo.name : card.name)
            flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
            card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
            loadSnapshot(st, true, true); loadChecks(st, true, true)
          } else {
            const kind = (res && res.errorKind) || 'unknown'
            const raw = (res && res.error) || ''
            card.errorKind = kind
            card.errorRepoUrl = (res && res.repoUrl) || ''
            const key = 'panel.noRepoErr.' + kind
            const mapped = tr(key)
            const base = (mapped !== key) ? mapped : (raw ? String(raw).slice(0, 160) : tr('panel.noRepoErr.unknown'))
            card.error = base + (raw && base !== String(raw).slice(0, 160) && mapped !== raw ? ' 路 ' + String(raw).slice(0, 120) : '')
            emit(st)
          }
        }).catch(function (e) {
          card.loading = false; card.errorKind = 'unknown'; card.error = String((e && e.message) || e).slice(0, 200); card.errorRepoUrl = ''; emit(st)
        })
      }
      return h('div', { className: 'dsws-no-repo-card' }, [
        h('div', { className: 'head' }, [
          Ic({ n: 'alert', size: 13, color: '#f87171' }),
          h('div', { style: { flex: 1, minWidth: 0 } }, [
            h('div', { className: 'ttl' }, tr('panel.noRepoCardTitle')),
            h('div', { className: 'desc' }, tr('panel.noRepoCardDesc')),
          ]),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.noRepoCardDismiss'), onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { padding: '2px 6px', flex: 'none' } }, Ic({ n: 'x', size: 12 })),
        ]),
        h('div', { className: 'acts' }, !card.expanded ? [
          h('button', { className: 'dsws-btn primary', onClick: doExpand, style: { background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardAction')),
          h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardDismiss')),
        ] : null),
        card.expanded ? h('div', { className: 'dsws-no-repo-form' }, [
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormName')),
            h('input', { type: 'text', value: card.name, placeholder: cwdBasename(st.cwd), onChange: function (e) { card.name = e.target.value; if (card.errorKind === 'bad-name') { card.error = ''; card.errorKind = '' } emit(st) } }),
          ]),
          h('div', { className: 'hint', style: (!isValid && card.name) ? { color: '#f87171' } : null }, tr('panel.noRepoFormNameHint')),
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormVisibility')),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'private', onChange: function () { card.visibility = 'private'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPrivate')),
            ]),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 12 } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'public', onChange: function () { card.visibility = 'public'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPublic')),
            ]),
          ]),
          card.error ? (function () {
            const kind = card.errorKind || 'unknown'
            const isWarn = kind === 'no-git' || kind === 'no-gh' || kind === 'not-logged-in' || kind === 'network'
            const bg = isWarn ? 'rgba(245,158,11,.12)' : 'rgba(248,113,113,.12)'
            const bd = isWarn ? 'rgba(245,158,11,.45)' : 'rgba(248,113,113,.45)'
            const col = isWarn ? '#fbbf24' : '#f87171'
            return h('div', { className: 'err', style: { background: bg, border: '1px solid ' + bd, color: col, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
              Ic({ n: 'alert', size: 11, color: col }),
              h('span', { style: { marginLeft: 4, flex: '1 1 auto' } }, card.error),
              kind === 'no-git' ? h('a', { href: 'https://git-scm.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '涓嬭浇') : null,
              kind === 'no-gh' ? h('a', { href: 'https://cli.github.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '涓嬭浇') : null,
              kind === 'not-logged-in' ? h('a', { href: 'https://cli.github.com/manual/gh_auth_login', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '鍘荤櫥褰?) : null,
              kind === 'already-exists' ? h('a', { href: card.errorRepoUrl || ('https://github.com/search?q=' + encodeURIComponent(card.name)), target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '鍘绘煡鐪?) : null,
              kind === 'network' ? h('button', { onClick: doSubmit, disabled: card.loading, style: { marginLeft: 8, background: 'transparent', color: col, border: '1px solid ' + col, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, '閲嶈瘯') : null,
            ])
          })() : null,
          h('div', { className: 'row', style: { marginTop: 8 } }, [
            h('button', { className: 'dsws-btn primary', disabled: card.loading || !isValid, onClick: doSubmit, style: { opacity: (!isValid || card.loading) ? 0.6 : 1, background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
              card.loading ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, display: 'inline-block', verticalAlign: '-2px' } }) : null,
              h('span', null, card.loading ? tr('panel.noRepoFormSubmitting') : tr('panel.noRepoFormSubmit')),
            ]),
            h('button', { className: 'dsws-btn', onClick: doCollapse, disabled: card.loading, style: { marginLeft: 6, fontSize: 11, padding: '4px 10px' } }, tr('panel.noRepoFormCancel')),
          ]),
        ]) : null,
      ])
    }
    const ListTab = ({ st, narrow }) => {
      // v1.3.3 UI锛氭瘡娆℃覆鏌撳悗鎵ц璐績鎶樺彔锛堝惈绐楀彛/鍒楀鍙樺寲鍚庣殑閲嶆覆鏌擄級
      // v1.5 T10 鎻愰€燂細鎸夊唴瀹规寚绾硅烦杩?鈥斺€?浠呭揩鐓у唴瀹?tab/杩囨护鍙樺寲鎵嶉噸鎺掞紙refreshing 鎬佺瓑鏃犲叧娓叉煋涓嶈Е鍙戝竷灞€娴嬮噺锛?
      React.useLayoutEffect(function () {
        const fp = String((st.snapshot && st.snapshot.generatedMs) || '') + '|' + st.tab + '|' + st.stateFilter + '|' + (st.lblFilters || []).join(',')
        if (_tagsFpOf.get(st) === fp) return
        _tagsFpOf.set(st, fp)
        fitAllTags()
      })
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' })
      const closedIssues = issues.filter(function (x) { return x.state === 'CLOSED' })
      // #374锛氬缁存帓搴?鈥斺€?map 琛屾亽缃《锛宮ap 缁勪笌鏅€氱粍鍚勮嚜鎸夋墍閫夌淮搴︽帓搴忥紱榛樿 鏇存柊鏃堕棿鈫擄紙涓庣幇鐘朵竴鑷达級
      const sortIssues = function (arr) {
        const dir = st.sortDir === 'asc' ? 1 : -1
        return arr.slice().sort(function (a, b) {
          let c
          if (st.sortKey === 'number') { c = a.number - b.number; if (c !== 0) return dir * c }
          else if (st.sortKey === 'title') {
            c = String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase())
            if (c !== 0) return dir * c
          } else {
            c = String(a[st.sortKey] || '').localeCompare(String(b[st.sortKey] || ''))
            if (c !== 0) return dir * c
          }
          return a.number - b.number  // 鍚岄敭鍏滃簳锛氱紪鍙峰崌搴忥紙绋冲畾锛?
        })
      }
      const isMapIssue = function (x) { return (x.labels || []).some(function (l) { return l.name === 'wayfinder:map' }) }
      const sortedMaps = sortIssues(openIssues.filter(isMapIssue))
      const sortedOpen = sortIssues(openIssues.filter(function (x) { return !isMapIssue(x) }))
      const closedSorted = sortIssues(closedIssues)
      const groups = compute(st)
      const occ = groups.reduce(function (n, g) { return n + g.blocked.length + g.claimed.length }, 0)
      const cs = activeChecks(st)
      const nBad = cs.filter(function (c) { return c.level === 'bad' }).length
      // 鏍囩缁熻锛坥pen + closed 鍏ㄩ噺锛変笌閰嶈壊
      const stat = {}
      const colorOf = {}
      issues.forEach(function (x) {
        (x.labels || []).forEach(function (l) {
          stat[l.name] = (stat[l.name] || 0) + 1
          if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color
        })
      })
      const tagNames = Object.keys(stat).sort(function (a, b) { return stat[b] - stat[a] })
      // #375锛氬叏閲?label锛堝揩鐓?labels 瀛楁浼樺厛锛涙棫蹇収鏃犺瀛楁闄嶇骇 issue 缁熻锛夛紱閰嶈壊骞跺叆 label 鍒楄〃鑹?
      const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : null
      if (snapLabels) snapLabels.forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
      const labelNames = snapLabels ? snapLabels.map(function (l) { return l.name }) : tagNames.slice()
      // 鐐瑰嚮璁板繂鍙岄敭鎺掑簭锛氭鏁伴檷搴?鈫?鏈€杩戠偣鍑婚檷搴?鈫?鍑虹幇棰戞闄嶅簭 鈫?鍚嶇О搴?
      const sortedLabels = labelNames.slice().sort(function (a, b) {
        const ca = labelClicks[a], cb = labelClicks[b]
        const na = ca ? ca.n : 0, nb = cb ? cb.n : 0
        if (na !== nb) return nb - na
        const ta = ca ? ca.ts : 0, tb = cb ? cb.ts : 0
        if (ta !== tb) return tb - ta
        const fa = stat[a] || 0, fb = stat[b] || 0
        if (fa !== fb) return fb - fa
        return String(a).localeCompare(String(b))
      })
      // v15-26锛氫富鍒楄〃鍏宠仈 map 瀛愮エ闃诲淇℃伅锛坥pen 闃诲鑰呮墠绠楅樆濉烇紱鏁版嵁鏉ヨ嚜蹇収 maps.tickets.blockedBy锛屾棤闇€棰濆璇锋眰锛?
      const blockOf = {}
      ;(st.snapshot && st.snapshot.maps || []).forEach(function (m) {
        const byNum = {}
        m.tickets.forEach(function (t) { byNum[t.number] = t })
        m.tickets.forEach(function (t) {
          if (!t.blockedBy || !t.blockedBy.length) return
          const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
          if (openBlockers.length) blockOf[t.number] = { map: m.number, mapTitle: m.title, by: openBlockers }
        })
      })
      // #374锛氱姸鎬佽繃婊わ紙鍏ㄩ儴/Open/闃诲/宸插叧闂級涓?label 杩囨护鍙犲姞
      // v1.3.3 T3锛歜locked 杩囨护鐪熸瀹炵幇 鈥斺€?open 涓斿瓨鍦?open 闃诲鑰咃紙blockOf 鍛戒腑锛?
      const showOpen = st.stateFilter !== 'closed'
      const showClosedList = st.stateFilter === 'closed'
      // v1.5锛氬閫夋爣绛捐繃婊わ紙OR 璇箟锛氬懡涓换涓€閫変腑鏍囩鍗虫樉绀猴級
      const byLabel = function (x) {
        const ls = st.lblFilters || []
        if (!ls.length) return true
        return (x.labels || []).some(function (l) { return ls.indexOf(l.name) >= 0 })
      }
      const openRows = sortedMaps.concat(sortedOpen)
      const openFiltered = (st.lblFilters && st.lblFilters.length) ? openRows.filter(byLabel) : openRows
      // v1.3.3 #6锛氶樆濉?= 琚崰鐢ㄥ彛寰勶紙isOccupied锛氭湁 assignee 鎴栧瓨鍦?open 闃诲鑰咃級鈥斺€斾笌 KPI銆屽崰鐢?N銆嶄竴鑷达紝
      //   鐢ㄦ埛鐐广€岄樆濉炪€嶅簲绛涘嚭鍏ㄩ儴琚崰鐢ㄩ」锛堟鍓?blockOf 鍙鐩?map 瀛愮エ鐨?blockedBy锛屾紡鎺?assignee 鍗犵敤鐨勶級
      const filteredOpen = showOpen ? (st.stateFilter === 'blocked' ? openFiltered.filter(function (x) { return isOccupied(st, x) })
        : (st.stateFilter === 'frontier' ? openFiltered.filter(function (x) { return !isOccupied(st, x) }) : openFiltered)) : []
      const filteredClosed = showClosedList ? ((st.lblFilters && st.lblFilters.length) ? closedSorted.filter(byLabel) : closedSorted) : []
      const has = function (x, nm) { return (x.labels || []).some(function (l) { return l.name === nm }) }
      const findMap = function (num) { return (st.snapshot && st.snapshot.maps || []).find(function (m) { return m.number === num }) }
      const openBlocked = function (blk) { st.activeMap = blk.map; emit(st) }
      // v14-18锛歝hips 甯告樉娣变竴妗ｈ竟妗嗭紙杈规鑹?= label 鑹?HSL 浜害 -16%锛?
      const chip = (nm, withCount, on, isAll) => {
        const c = colorOf[nm]
        const borderColor = isAll ? 'rgba(255,255,255,.35)' : (darken(c, 0.16) || 'rgba(188,140,255,.6)')
        const selColor = isAll ? 'rgba(255,255,255,.65)' : (c ? '#' + c : '#bc8cff')
        return h('span', {
          key: nm,
          className: 'dsws-chip',
          // v14-1锛氥€屽叏閮ㄣ€嶆亽娓呯┖杩囨护骞朵繚鎸侀€変腑锛屼笌鏅€氭爣绛?toggle 璇箟鍒嗙
          // #375锛氱偣閫夊嵆璁扮偣鍑昏蹇嗭紙娆℃暟 + 鏈€杩戠偣鍑绘椂闂达紝鍙岄敭鎺掑簭锛?
          onClick: function (e) {
            e.stopPropagation()
            // v1.5锛氬閫?toggle 鈥斺€?閫変腑/鍙栨秷鍗曚釜鏍囩锛屼簰涓嶈鐩?
            const cur = st.lblFilters || []
            st.lblFilters = isAll ? [] : (cur.indexOf(nm) >= 0 ? cur.filter(function (x) { return x !== nm }) : cur.concat([nm]))
            if (!isAll) {
              const c = labelClicks[nm] || { n: 0, ts: 0 }
              labelClicks[nm] = { n: c.n + 1, ts: Date.now() }
              saveLabelClicks()
            }
            emit(st)
          },
          style: {
            cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10,
            background: isAll ? 'rgba(255,255,255,.08)' : (hexA(c, 0.18) || 'rgba(188,140,255,.16)'),
            color: isAll ? 'var(--dsw-alias-label-secondary,#a1a1aa)' : (c ? '#' + c : '#bc8cff'),
            border: '1px solid ' + (on ? selColor : borderColor),
          },
        }, nm)
      }
      const copyUrl = function (x) { copyText(st, 'https://github.com/' + repoStr(st) + '/issues/' + x.number, tr('toast.copiedLink', { n: x.number })) }
      // v14-4锛氳绾у姩浣滄寜 label 鍥涢€変竴锛堣瘖鏂?淇/璁ㄨ/鎵ц锛夛紝鍏ㄩ儴棰勫～杈撳叆妗嗭紱
      // v19锛氬叡浜?mkRowAction锛堝垪琛ㄤ笌 map 璇︽儏鍚岄€昏緫锛屾寜閽壊鍔ㄦ€佸彇 label 閰嶇疆鑹诧級锛泇14-3 鎸夐挳 80%锛泇14-19 绐勫睆鎶樺彔涓虹函鍥炬爣
      // v1.3.3 UI 瀹氱锛堢敤鎴烽€愮増纭锛夛細涓よ缁撴瀯 路 鍗＄墖椋庯紙C锛壜?缂栧彿/map 绔栨帓锛坕dcol锛壜?
      //   琛? = 缂栧彿(涓?+map寰界珷(涓? 绔栨帓 + 鏍囬(鍗犳弧,闄?琛? + 杩蜂綘鍦嗙幆杩涘害(鍙充笂)锛?
      //   琛? = 鏍囩鍗曡璐績鎶樺彔锛堝澶氱獎灏?鏈€灏?涓?鏀句笉涓嬭繘 +N 寮圭獥锛? 鎸夐挳缁勶紙鎵ц/瀹屾垚/鏂颁細璇濆父鏄?澶嶅埗/澶栭摼 hover锛?
      //   +N 寮圭獥锛歠ixed 瀹氫綅,鍩哄噯=闈㈡澘瀹瑰櫒,clamp 宸﹀彸涓嶈秺鐣?鍐呭瀹屾暣鍙锛堢敤鎴烽獙鏀?A 鏂规锛?
      const ringOf = function (stats) {
        const total = stats.total || 0, closed = stats.closed || 0
        const pct = total ? Math.round(closed / total * 100) : 0
        const C = 2 * Math.PI * 7
        const off = C * (1 - pct / 100)
        const color = pct >= 100 ? '#4ade80' : '#bc8cff'
        return h('span', { className: 'dsws-ring' }, [
          h('svg', { width: 18, height: 18, viewBox: '0 0 18 18' }, [
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: 'rgba(255,255,255,.12)', strokeWidth: 2.4 }),
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round', strokeDasharray: String(C), strokeDashoffset: String(off) }),
          ]),
          h('span', { className: 'dsws-ring-txt', style: { color: color } }, closed + '/' + total),
        ])
      }
      const issueRow = function (x, isOpen, narrow) {
        const isMap = has(x, 'wayfinder:map')
        const mapObj = isMap ? findMap(x.number) : null
        // v15-26锛氳闃诲鍒ゅ畾锛坥pen 闃诲鑰咃級鈫?闅愯棌鍔ㄤ綔鎸夐挳 + 绾㈣壊銆岃闃诲銆嶆爣绛撅紙鐐瑰嚮璺虫墍灞?map 璇︽儏锛?
        const blk = blockOf[x.number]
        const blocked = !!(blk && blk.by && blk.by.length)
        // v1.3.3 #8锛歮ap 琛屽畬鎴愭€?鈥斺€?瀛愮エ鍏ㄥ叧锛坱otal>0 涓?closed===total锛夆啋 涓绘寜閽垏銆屽畬鎴愩€嶏紙缁匡級锛屾敞鍏ユ敹灏剧‘璁?prompt
        const mapDone = !!(isMap && mapObj && mapObj.stats && mapObj.stats.total > 0 && mapObj.stats.closed === mapObj.stats.total)
        // v1.5锛氱紪鍙峰窘绔犻鑹?= 鍙充晶鍔ㄤ綔鎸夐挳鍚屼竴閫昏緫锛坙abel 鑹诧紱map 瀹屾垚鎬佺豢锛?
        const numColor = mapDone ? '#3fb950' : actionColorOf(x, colorOf)
        // v1.3.3 UI锛氬叏閮ㄦ爣绛炬覆鏌擄紙娓叉煋鍚庤椽蹇冩姌鍙狅紝鏀句笉涓嬬殑闅愯棌杩?+N锛?N 寮圭獥鏄剧ず鍏ㄩ儴锛?
        const labels = x.labels || []
        const allNames = labels.map(function (l) { return l.name }).join('銆?)
        const openPop = function (e) {
          e.stopPropagation()
          const trig = e.currentTarget
          const host = trig.closest('.dsws-panel') || trig.closest('[data-dsws-host]')
          showPop(trig, host, labels, x.title)
        }
        // R5锛氬彉鍖栬瑙嗚锛堝彉鏇寸惀鐝€娓愰殣 / 鏂板缁块棯锛?
        const _flashCls = (st.rowFlash && st.rowFlash[x.number]) ? (st.rowFlash[x.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed') : ''
        return h('div', {
          key: x.number,
          className: 'dsws-aggrow' + _flashCls,
          onClick: function () { if (isMap && mapObj) { st.activeMap = x.number; emit(st) } },
          title: (isMap && mapObj) ? tr('list.mapTitle') : undefined,
          style: isMap ? { cursor: 'pointer', borderLeft: '3px solid #c084fc', background: 'rgba(188,140,255,.07)' } : undefined,
        }, [
          // 琛?锛歩dcol 绔栨帓锛堢紪鍙蜂笂 map 寰界珷涓嬶級+ 鏍囬 + 鍦嗙幆杩涘害
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%' } }, [
            h('span', { className: 'dsws-idcol' }, [
              isMap ? h('span', { className: 'dsws-chip dsws-chip-m', style: { fontSize: 11, fontWeight: 600, lineHeight: 1.7, padding: '0 8px' } }, [Ic({ n: 'map', size: 11 }), h('span', null, tr('list.mapChip'))]) : null,
              h('span', { className: 'dsws-idnum', style: { color: numColor, borderColor: numColor } }, '#' + x.number),
            ]),
            h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontWeight: isMap ? 600 : undefined, color: isOpen ? undefined : 'var(--dsw-alias-label-secondary,#a1a1aa)' }, title: x.title }, x.title),
            (isMap && mapObj && mapObj.stats) ? ringOf(mapObj.stats) : null,
            !isOpen ? h('span', { className: 'dsws-chip', style: { fontSize: 10, marginRight: 0, flex: 'none', background: 'rgba(139,139,149,.12)', color: '#8b8b95', border: '1px solid rgba(139,139,149,.35)' } }, [Ic({ n: 'check', size: 9 }), h('span', null, tr('map.subClosed'))]) : null,
          ]),
          // 琛?锛氭爣绛捐椽蹇冩姌鍙狅紙鍗曡涓嶆崲琛岋級+ 鎸夐挳缁勶紙甯告樉锛?
          h('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, width: '100%' } }, [
            h('div', { className: 'dsws-tags', 'data-dsws-labels': JSON.stringify(labels.map(function (l) { return l.name })) }, [
              labels.map(function (l, i) {
                return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA(l.color, 0.18) || 'rgba(188,140,255,.16)', color: l.color ? '#' + l.color : '#bc8cff', border: '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)') } }, l.name)
              }),
              labels.length > 0 ? h('span', { key: 'more', className: 'dsws-chip dsws-more', onClick: openPop, title: tr('list.tagsTitle', { names: allNames }) }, '+0') : null,
              blocked ? h('span', { key: 'blk', className: 'dsws-chip dsws-blocked', onClick: function (e) { e.stopPropagation(); openBlocked(blk) }, title: tr('list.blockedTitle', { by: blk.by.map(function (b) { return '#' + b }).join('銆?) }), style: { fontSize: 10, background: 'rgba(248,113,113,.16)', color: '#f87171', border: '1px solid rgba(248,113,113,.55)', cursor: 'pointer' } }, [Ic({ n: 'lock', size: 10 }), h('span', null, tr('list.blocked'))]) : null,
            ]),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', marginLeft: 'auto' } }, [
              isOpen && !blocked ? h('div', { style: { display: 'flex', gap: 3, alignItems: 'center', flex: 'none' } }, [
                mapDone
                  ? h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''), title: tr('map.doneTitle'), onClick: function (e) {
                      e.stopPropagation()
                      const text = completePrompt(st, x.number, mapObj.stats.total, mapObj.stats.closed)
                      inject(st, text)
                    }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [Ic({ n: 'check', size: 10 }), narrow ? null : h('span', null, tr('act.done'))])
                  : mkRowAction(st, x, narrow, colorOf),
                h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''), onClick: function (e) { e.stopPropagation(); openInNewSession(st, x) }, title: tr('list.newSessionLabel'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: mapDone ? '#3fb950' : actionColorOf(x, colorOf), borderColor: 'transparent', color: mapDone ? '#0c1a10' : (isLightHex(actionColorOf(x, colorOf)) ? '#140a1e' : '#ffffff') } }, [Ic({ n: 'external-link', size: 10 }), narrow ? null : h('span', null, tr('list.newSessionLabel'))]),
              ]) : null,
              isOpen ? h('div', { className: 'dsws-aux', style: { display: 'flex', gap: 2, alignItems: 'center', flex: 'none' } }, [
                // v1.3.3锛氬鍒?澶栭摼鍥炬爣澧炲ぇ 11 鈫?13
                h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); copyUrl(x) }, title: tr('list.copyLinkTitle'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 })),
                h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: x.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + x.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 })),
              ]) : null,
            ]),
          ]),
        ])
      }
      const kpi = (num, lab, icon, color) => h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [Ic({ n: icon, size: 11, color: color }), h('span', null, String(num) + ' ' + lab)])
      return h('div', null, [
        // v1.5锛氬凡閫夋爣绛捐繃婊ゆ潯锛堜粎鏍囩 路 棰滆壊 = 璇ユ爣绛鹃厤缃壊 路 鐐?鉁?鍏抽棴锛?
        (st.lblFilters && st.lblFilters.length) ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 } }, [
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none' } }, tr('list.filterActive')),
          (st.lblFilters || []).map(function (nm) {
            const c = colorOf[nm]
            const hex = c ? '#' + c : '#bc8cff'
            return h('span', { key: 'f-label-' + nm, className: 'dsws-chip', style: { fontSize: 10, background: hexA(c, 0.18) || 'rgba(188,140,255,.16)', color: hex, border: '1px solid ' + (darken(c, 0.16) || 'rgba(188,140,255,.6)') } }, [
              nm,
              h('span', { onClick: function (e) { e.stopPropagation(); st.lblFilters = (st.lblFilters || []).filter(function (x) { return x !== nm }); emit(st) }, style: { cursor: 'pointer', marginLeft: 4, fontWeight: 700 } }, '鉁?),
            ])
          }),
          h('span', { key: 'f-label-clear', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.lblFilters = []; emit(st) }, style: { fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid rgba(255,255,255,.15)' } }, tr('list.filterClear')),
        ]) : null,
        // T2 #35 路 棣栧睆鏈€浼樺厛绾㈠崱锛圠istTab 椤堕儴 路 KPI 涔嬩笂 路 鍞竴闂搁棬 checkRepo:bad && !dismissed锛?
        h(NoRepoCard, { st: st }),
        // KPI 琛?+ 鐜鎻愮ず锛坴18-30锛氬彲鎺?鍗犵敤 = 鍒楄〃 open issue 鍙ｅ緞锛?
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap', position: 'relative' } }, [
          kpi(frontierCount(st), tr('list.kpi.takeable'), 'target', '#4ade80'),
          kpi(occCount(st), tr('list.kpi.occupied'), 'lock', '#f0883e'),
          kpi(closedIssues.length, tr('list.kpi.closed'), 'check', '#52525b'),
          h('span', { style: { flex: 1 } }),
          // T2 #2锛氬埛鏂版寜閽凡涓婄Щ鑷?OverlayPanel tabs 琛岋紙L1932锛?
        ]),
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); if (cr && cr.level === 'bad' && !isNoRepoDismissed(st.cwd)) return null; return nBad > 0 ? h('div', { className: 'dsws-banner bad', onClick: function () { st.tab = 'checks'; emit(st) } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('list.envWarn', { n: nBad }))]) : null })(),
        // #374/#375锛氱姸鎬佽繃婊?+ 鎺掑簭 + label 杩囨护 chips锛堝叏閮ㄥ皬鍙风揣鍑戝悓鎺掞紝绐勫睆鎹㈣涓嶅楂橈紱灞曞紑鎬佺偣閫?label 涓嶆敹璧凤級
        h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0, marginBottom: 6 } }, [
          ['all', 'open', 'closed', 'blocked', 'frontier'].map(function (k) {
            const on = st.stateFilter === k
            return h('span', { key: 'stf-' + k, className: 'dsws-chip', onClick: function (e) {
              e.stopPropagation(); st.stateFilter = k; listPrefs.stateFilter = k; saveListPrefs(); emit(st)
            }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(188,140,255,.18)' : 'rgba(255,255,255,.06)', color: on ? '#c084fc' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(188,140,255,.6)' : 'rgba(255,255,255,.15)') } }, tr('list.state.' + k))
          }),
          h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
          ['updatedAt', 'createdAt', 'number', 'title'].map(function (k) {
            const on = st.sortKey === k
            const arrow = on ? (st.sortDir === 'asc' ? '鈫? : '鈫?) : ''
            return h('span', { key: 'srt-' + k, className: 'dsws-chip', onClick: function (e) {
              e.stopPropagation()
              if (st.sortKey === k) { st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc' }
              else { st.sortKey = k; st.sortDir = (k === 'title') ? 'asc' : 'desc' }
              listPrefs.sortKey = st.sortKey; listPrefs.sortDir = st.sortDir; saveListPrefs(); emit(st)
            }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(88,166,255,.16)' : 'rgba(255,255,255,.06)', color: on ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(88,166,255,.55)' : 'rgba(255,255,255,.15)') } }, tr('list.sort.' + k) + arrow)
          }),
          h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
          chip(tr('list.all'), false, !st.lblFilters || !st.lblFilters.length, true),
          // #405锛歠ilter row 榛樿鍙鏁?9 鈫?4锛堜笌 per-row 涓€鑷达級锛?N 瑙﹀彂鏉′欢 + 鏁板瓧鍚屾
          (st.expLabels ? sortedLabels : sortedLabels.slice(0, 4)).map(function (nm) { return chip(nm, true, (st.lblFilters || []).indexOf(nm) >= 0, false) }),
          (!st.expLabels && sortedLabels.length > 4) ? h('span', { key: 'lbl-more', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = true; emit(st) }, title: tr('list.tagsTitle', { names: sortedLabels.join('銆?) }), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px dashed rgba(188,140,255,.55)', cursor: 'pointer' } }, '+' + (sortedLabels.length - 4)) : null,
          st.expLabels ? h('span', { key: 'lbl-less', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = false; emit(st) }, title: tr('list.tagsCollapseTitle'), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-caption,#8b8b95)', border: '1px dashed rgba(255,255,255,.3)', cursor: 'pointer' } }, tr('list.collapse')) : null,
        ]),
        // T3 #5锛氬姞杞介伄缃╋紙鏇夸唬鍗曡鏂囨湰锛屽叏灞忛伄缃?+ 杞湀 + 绂佺偣锛?
        // v1.3.3 淇锛氬姞杞介伄缃╀粎棣栧紑鏃犳暟鎹椂鏄剧ず锛堟墜鍔ㄥ埛鏂板凡璧伴潤榛樿矾寰勶紝涓嶅啀鍙犲姞锛?
        // #58 缂撳瓨浼樺厛锛氬凡鏈夊揩鐓э紙鏈?store 鎴?per-cwd 缂撳瓨锛夋椂涓嶆樉绀哄叏灞?loading锛岀寮€鏃у垪琛?+ 鍚庡彴闈欓粯鍒锋柊
        (st.snapMode === 'loading' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { className: 'dsws-loading-shade', style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 5, pointerEvents: 'auto' } }, [
          h('div', { className: 'dsws-spinner' }),
          h('span', { style: { fontSize: 12, color: '#e6edf3' } }, tr('list.loading')),
        ]) : null,
        (st.snapMode === 'err' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { style: { color: '#f87171', fontSize: 12, padding: '14px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 12 }), h('span', null, tr('list.errFull', { err: st.snapError }))]) : null,
        st.snapMode === 'real' && st.snapshot && st.snapshot.fallback === 'rest' ? h('div', { style: { color: '#f59e0b', fontSize: 11, padding: '6px 12px', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, background: 'rgba(245,158,11,.08)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('list.restFallback'))]) : null,
        // #374锛氱姸鎬佽繃婊ゆ覆鏌?鈥斺€?open 涓讳綋 / closed 鍒楄〃 / 銆屽叏閮ㄣ€嶆€佷繚鐣欏凡鍏抽棴鎶樺彔琛?
        showOpen ? (filteredOpen.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredOpen.map(function (x) { return issueRow(x, true, narrow) })) : null,
        showClosedList ? (filteredClosed.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredClosed.map(function (x) { return issueRow(x, false, narrow) })) : null,
        // v14-4鈶わ細鍒楄〃搴曢儴銆屽凡鍏抽棴 (N)銆嶆姌鍙犺锛堜粎銆屽叏閮ㄣ€嶇姸鎬佹樉绀猴紱榛樿鏀惰捣锛屽彧鍗犱竴琛岋紝灞曞紑鍙锛?
        (st.stateFilter === 'all' && closedIssues.length) ? h('details', { style: { marginTop: 8 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 2px', userSelect: 'none' } }, [
            Ic({ n: 'check', size: 11 }),
            h('span', null, tr('list.closedN', { n: closedIssues.length })),
          ]),
          h('div', null, closedSorted.map(function (x) { return issueRow(x, false, narrow) })),
        ]) : null,
      ])
    }

    // ---- 5.6 鎶€鑳介浄杈撅紙瀹氱 4A 鎺ㄨ崘+鍒楄〃 路 4B 鍦嗗舰鎶€鑳界幆锛孉/B 鍒囨崲锛?---
    const RingSkills = ({ st, rec, list }) => {
      const cx = 110, cy = 108, R2 = 88
      const center = rec[0] || 'ask-matt'
      const ring = list.filter(function (sk) { return sk.name !== center }).slice(0, 8)
      const nodes = ring.map(function (sk, i) {
        const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2
        const x = cx + R2 * Math.cos(a), y = cy + R2 * Math.sin(a)
        const filled = sk.level === 'ok'
        return h('div', { key: sk.name, title: tr('skilldesc.' + sk.name), onClick: function () { inject(st, '/' + sk.name) }, style: { position: 'absolute', left: x - 15, top: y - 15, width: 30, height: 30, borderRadius: '50%', border: filled ? '2px solid #4ade80' : '2px solid #52525b', background: filled ? 'rgba(74,222,128,.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, cursor: 'pointer', color: filled ? '#4ade80' : '#8b8b95', lineHeight: 1.2, textAlign: 'center' } }, sk.name.length > 4 ? sk.name.slice(0, 4) + '鈥? : sk.name)
      })
      return h('div', null, [
        h('div', { style: { position: 'relative', width: 220, height: 220, margin: '0 auto 6px' } }, [
          h('div', { onClick: function () { inject(st, '/' + center) }, title: tr('skill.centerTitle', { skill: center }), style: { position: 'absolute', left: cx - 30, top: cy - 30, width: 60, height: 60, borderRadius: '50%', background: 'rgba(188,140,255,.18)', border: '2px solid #c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#c084fc', cursor: 'pointer', textAlign: 'center', lineHeight: 1.3 } }, '/' + center),
          nodes,
        ]),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', textAlign: 'center', marginBottom: 8 } }, tr('skill.centerRing')),
        h('div', { className: 'dsws-grp' }, [Ic({ n: 'compass', size: 12 }), h('span', null, tr('skill.all'))]),
        list.map(function (sk) {
          const on = rec.indexOf(sk.name) >= 0
          return h('div', { key: sk.name, className: 'dsws-skill', style: on ? { background: 'rgba(188,140,255,.12)', borderRadius: 6 } : null }, [
            Dot({ level: sk.level }),
            h('div', { className: 'dsws-tt' }, [
              h('div', { className: 'dsws-tt-name', style: on ? { color: '#c084fc' } : null }, [h('span', null, '/' + sk.name), on ? Ic({ n: 'star', size: 11, color: '#c084fc' }) : null]),
              h('div', { className: 'dsws-tt-sub dsws-ellip', title: tr('skilldesc.' + sk.name) }, tr('skilldesc.' + sk.name)),
            ]),
            h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + sk.name) } }, tr('act.load')),
          ])
        }),
      ])
    }

    const SkillsTab = ({ st }) => {
      const groups = compute(st)
      let rec = []
      let recTitle = tr('skill.generic')
      if (st.activeMap !== null) {
        const g = groups.find(function (x) { return x.m.number === st.activeMap })
        if (g && /research/.test(g.m.notes)) rec = ['research']
        if (g && /grill/.test(g.m.notes)) rec = ['grilling', 'domain-modeling']
        recTitle = tr('skill.notes', { m: g.m.title })
      }
      if (!rec.length) rec = ['ask-matt']
      const list = SKILLS.map(function (sk) {
        const on = rec.indexOf(sk.name) >= 0
        return h('div', { key: sk.name, className: 'dsws-skill', style: on ? { background: 'rgba(188,140,255,.12)', borderRadius: 6 } : null }, [
          Dot({ level: sk.level }),
          h('div', { className: 'dsws-tt' }, [
            h('div', { className: 'dsws-tt-name', style: on ? { color: '#c084fc' } : null }, [
              h('span', null, '/' + sk.name),
              on ? Ic({ n: 'star', size: 11, color: '#c084fc' }) : null,
            ]),
            h('div', { className: 'dsws-tt-sub dsws-ellip', title: sk.use }, sk.use),
          ]),
          h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + sk.name) } }, tr('act.load')),
        ])
      })
      const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, [
        h('div', { className: 'dsws-grp', style: { margin: 0 } }, [Ic({ n: 'compass', size: 12 }), h('span', null, recTitle)]),
        h('span', { style: { flex: 1 } }),
        h('span', { className: 'dsws-seg' + (st.skillView === 'list' ? ' on' : ''), onClick: function () { st.skillView = 'list'; emit(st) }, style: { fontSize: 11 } }, tr('skill.list')),
        h('span', { className: 'dsws-seg' + (st.skillView === 'ring' ? ' on' : ''), onClick: function () { st.skillView = 'ring'; emit(st) }, style: { fontSize: 11 } }, tr('skill.ring')),
      ])
      if (st.skillView === 'ring') return h('div', null, [head, h(RingSkills, { st: st, rec: rec, list: SKILLS })])
      return h('div', null, [
        head,
        h('div', { style: { marginBottom: 8 } }, rec.map(function (r, i) {
          return h('span', { key: i, className: 'dsws-chip dsws-chip-m' }, '/' + r)
        })),
        list,
      ])
    }

    // ---- 5.7 鐜妫€鏌ワ紙瀹氱 5A锛氭í骞?+ 绾?榛?缁垮垎缁勫崱锛泇12 澶辫触涓嶅厹鍋囨暟鎹級----
    const ChecksTab = ({ st }) => {
      React.useEffect(function () { loadChecks(st, false) }, [])
      const cs = activeChecks(st)
      const bad = cs.filter(function (c) { return c.level === 'bad' })
      const warn = cs.filter(function (c) { return c.level === 'warn' })
      const ok = cs.filter(function (c) { return c.level === 'ok' })
      // #373锛歨int 鏀寔涓ょ褰㈡€?鈥斺€?URL锛堝彲鎵撳紑/澶嶅埗锛夋垨 /鍛戒护锛堛€岀敤 /xxx 澶勭悊銆嶆寜閽紝淇濈暀鍏煎锛?
      const actBtn = (c) => {
        const hint = c.hint || ''
        // v1.5锛歱rompt: 鍗忚 鈥斺€?澶嶅埗/娉ㄥ叆涓€娈靛紩瀵?prompt 璁?AI 鎵ц锛堝鎶€鑳藉畨瑁呭紩瀵硷級
        if (hint.indexOf('prompt:') === 0) {
          const ptext = hint.slice(7)
            // v1.6锛歱rompt: 閿悕鍗忚 鈥斺€?浼樺厛浠?PROMPTS 娉ㄥ唽琛ㄥ彇鍙岃鏂囨湰锛堣窡闅忚瑷€锛夛紝鏈煡閿洖閫€鍘熸枃
            const resolved = promptText(ptext) || ptext
          return h('button', { className: 'dsws-btn', onClick: function () { inject(st, resolved) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('env.installBtn'))
        }
        if (/^https?:\/\//i.test(hint)) {
          return h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
            h('a', { href: hint, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('env.openUrl'))]),
            h('button', { className: 'dsws-btn', onClick: function () { copyText(st, hint, tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('env.copyUrl'))]),
          ])
        }
        const m = hint.match(/\/([a-z0-9-]+)/i)
        if (!m) return null
        return h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + m[1]) } }, tr('skill.treat', { s: m[1] }))
      }
      const card = (c) => h('div', { key: c.id, className: 'dsws-ccard' }, [
        h('div', { className: 'nm' }, c.name),
        h('div', { className: 'dt dsws-ellip', title: c.detail }, c.detail),
        c.hint ? h('div', { className: 'act' }, [actBtn(c)]) : null,
      ])
      const grp = (title, color, items) => items.length ? h('div', null, [
        h('div', { className: 'dsws-cgroup' }, [h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' } }), h('span', null, title + ' ' + items.length)]),
        items.map(card),
      ]) : null
      // 鐜妫€鏌ラ〉椤堕儴妯箙锛堢敤鎴锋媿鏉?2026-08-16 + 2026-08-17锛氫緷璧栭摼 gh 鈫?鐧诲綍 鈫?setup 鈫?鎶€鑳斤紝鏄剧ず绗竴涓己澶遍」锛?
      const ghCli2 = activeChecks(st).find(function (c) { return c.id === 4 })
      const ghAuth2 = activeChecks(st).find(function (c) { return c.id === 5 })
      const skillsCheck2 = activeChecks(st).find(function (c) { return c.id === 9 })
      const setupCheck2 = activeChecks(st).find(function (c) { return c.id === 2 })
      const skillsOk = !skillsCheck2 || skillsCheck2.level === 'ok'
      const setupOk = !setupCheck2 || setupCheck2.level === 'ok'
      const ghCliOk2 = !ghCli2 || ghCli2.level === 'ok'
      const ghAuthOk2 = !ghAuth2 || ghAuth2.level === 'ok'
      const topBanner = (!ghCliOk2)
        ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
            Ic({ n: 'alert', size: 13 }),
            h('span', { style: { flex: 1 } }, tr('banner.ghcli')),
            h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { openUrl('https://cli.github.com/') } }, tr('banner.ghcliBtn')),
          ])
        : (!ghAuthOk2)
          ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
              Ic({ n: 'alert', size: 13 }),
              h('span', { style: { flex: 1 } }, tr('banner.ghauth')),
              h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { openUrl('https://cli.github.com/manual/gh_auth_login') } }, tr('banner.ghauthBtn')),
            ])
          : (!setupOk)
            ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                Ic({ n: 'alert', size: 13 }),
                h('span', { style: { flex: 1 } }, tr('banner.setup')),
                h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { inject(st, promptText('setupRun')) } }, tr('banner.setupBtn')),
              ])
            : (!skillsOk)
              ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                  Ic({ n: 'star', size: 13 }),
                  h('span', { style: { flex: 1 } }, tr('banner.skills', { list: (skillsCheck2 && skillsCheck2.detail) || '' })),
                  h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(188,140,255,.55)' }, onClick: function () { inject(st, promptText('installSkills')) } }, tr('banner.skillsBtn')),
                ])
              : null
      // v1.5 閰嶇疆寮曞椤哄簭鍖猴紙鐢ㄦ埛鎷嶆澘 2026-08-17锛夛細渚濊禆閾?1-2-3-4锛屽畬鎴愯嚜鍔ㄥ嬀閫?
      const okOf = function (c) { return !c || c.level === 'ok' }
      const guideSteps = [
        { done: okOf(ghCli2), label: tr('env.g1'), act: function () { openUrl('https://cli.github.com/') }, btn: tr('banner.ghcliBtn') },
        { done: okOf(ghAuth2), label: tr('env.g2'), act: function () { openUrl('https://cli.github.com/manual/gh_auth_login') }, btn: tr('banner.ghauthBtn') },
        { done: okOf(setupCheck2), label: tr('env.g3'), act: function () { inject(st, promptText('setupRun')) }, btn: tr('banner.setupBtn') },
        { done: okOf(skillsCheck2), label: tr('env.g4'), act: function () { inject(st, promptText('installSkills')) }, btn: tr('banner.skillsBtn') },
      ]
      const guideAll = guideSteps.every(function (s) { return s.done })
      const guideBlock = guideAll ? null : h('div', { className: 'dsws-ccard', style: { marginBottom: 8 } }, [
        h('div', { className: 'dsws-cgroup' }, [h('span', { style: { fontWeight: 600 } }, tr('env.guide'))]),
        guideSteps.map(function (s, i) {
          return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' } }, [
            h('span', { style: { width: 16, height: 16, borderRadius: '50%', border: '1px solid ' + (s.done ? '#4ade80' : '#8b8b95'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: s.done ? '#4ade80' : 'transparent', flex: 'none' } }, s.done ? '\u2713' : String(i + 1)),
            h('span', { style: { flex: 1 } }, s.label),
            s.done ? null : h('button', { className: 'dsws-btn', onClick: s.act, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, s.btn),
          ])
        }),
      ])
      return h('div', null, [
        topBanner,
        guideBlock,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 } }, [
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'gear', size: 12 }), h('span', null, tr('env.title', { n: envLabel(st) }))]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn', disabled: st.checking || st.refreshing, onClick: function () { refreshAll(st) }, style: { fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            h('span', { className: 'dsws-rficon' + ((st.checking || st.refreshing) ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]),
            h('span', null, tr('env.recheck')),
          ]),
        ]),
        // T2 #35 路 ChecksTab 寮卞寲锛氱孩鍗℃樉绀烘椂 checkRepo:bad 琛屽急鍖栦负鈥滃凡鍦ㄩ灞忓紩瀵?路 鍒囨崲鍒?ListTab 瀹屾垚鈥濓紱dismiss 鍚庢彁渚涒€滈噸缃拷鐣モ€濆叆鍙?
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); if (!showRed) return null; return h('div', { className: 'dsws-ccard', style: { opacity: 0.85, borderColor: 'rgba(139,139,149,.35)', background: 'rgba(139,139,149,.08)', marginBottom: 6 } }, [h('div', { className: 'nm', style: { color: '#8b8b95' } }, cr.name), h('div', { className: 'dt', style: { color: '#8b8b95' } }, tr('panel.noRepoCardDone')), h('div', { className: 'act' }, [h('button', { className: 'dsws-btn', onClick: function () { st.tab = 'list'; emit(st) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('panel.tabList'))])]) })(),
        (function () { const dismissed = isNoRepoDismissed(st.cwd); if (!dismissed) return null; const cr = cs.find(function (c) { return c.id === 1 }); if (!cr || cr.level !== 'bad') return null; return h('div', { className: 'dsws-ccard', style: { borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.06)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 } }, [h('span', { style: { fontSize: 11, color: '#f87171', flex: 1 } }, tr('panel.noRepoCardDismiss') + ' 路 ' + (cr.detail || '')), h('button', { className: 'dsws-btn', onClick: function () { setNoRepoDismissed(st.cwd, false); emit(st) }, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, tr('panel.noRepoReset'))]) })(),
        st.checksMode === 'err' ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.failFull', { err: st.checksError }))]) : null,
        st.checksMode === 'loading' ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, marginBottom: 6 } }, tr('env.detecting')) : null,
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; const cnt = displayBad.length; return cnt ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.missingBanner', { n: cnt }))]) : null })(),
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; return grp(tr('env.missing'), '#f87171', displayBad) })(),
        grp(tr('env.partial'), '#f59e0b', warn),
        grp(tr('env.ready'), '#4ade80', ok),
      ])
    }

    // ---- 5.8b 鍙充晶鍋滈潬锛坉etails 妲戒綅 路 涓夎鍥惧畬鏁村唴瀹癸紱寮€鍚?鎷栨嫿/瀹藉害璁板繂鐢卞３绠＄悊锛?---
    // 濂戠害锛歞etails 妲?= 澹冲彸渚х涓夊垪锛圓ppFrame grid锛夛紝scope session锛涘叧闂?= ctx.layout.closeDetails()
    //   锛堝崰浣嶈€?props 浜︽敞鍏?closeDetails锛夛紱瀹藉害 300-520px 鍙嫋鎷斤紱鍏抽棴鏃跺瓙鏍戜笉鍗歌浇锛堢姸鎬佷繚鐣欙級銆?
    // issue #15锛歵abs 琛屽唴瀹规斁涓嶄笅鏃舵姌鍙犱负绾浘鏍囷紙鍐呭鑷€傚簲 + 婊炲洖闃叉姈锛?
    const TABS_FOLD_HYST = 4
    const TABS_LEVELS = 3
    const tabsLevelDecide = function (level, avail, nats) {
      if (!Array.isArray(nats) || !nats.length) return 0
      let cur = level < 0 ? 0 : level
      while (cur < nats.length - 1 && nats[cur] > avail + 1) cur++
      while (cur > 0 && avail >= nats[cur - 1] + TABS_FOLD_HYST) cur--
      return cur
    }
    // issue#15 淇锛歴crollWidth 浼氳瀹瑰櫒瀹藉害閽冲埗锛堝鍣ㄥ浜庡唴瀹规椂 scrollWidth===clientWidth锛夛紝
    // 瀵艰嚧鎶樺彔鍚庡睍寮€鍒ゅ畾 avail>=nats[cur-1]+4 姘镐笉鎴愮珛锛堟閿侊級銆傛敼娴嬪唴瀹?children 鐨勭湡瀹炴í璺ㄥ銆?
    const measureContentWidth = function (t) {
      if (!t || !t.children || t.children.length === 0) return 0
      const tr = t.getBoundingClientRect()
      let minX = Infinity, maxX = -Infinity
      for (let i = 0; i < t.children.length; i++) {
        const c = t.children[i]
        const r = c.getBoundingClientRect()
        if (r.width > 0) { if (r.x < minX) minX = r.x; if (r.x + r.width > maxX) maxX = r.x + r.width }
      }
      if (minX === Infinity) return 0
      return maxX - tr.x
    }
    const DetailsDock = (props) => {
      // #45 鍥炲綊锛?026-08-20 缁級锛氬垏缁樼敾/宸ヤ綔鍖哄悗鍙抽潰鏉夸覆鍙?
      // 鏍瑰洜锛氬師 DetailsDock 浠呭湪鎸傝浇鏃惰窇涓€娆″壇浣滅敤锛坉eps []锛夛紝涓旂洿鎺ュ彇 props.sessionId锛坉etails 妲戒綅鍦ㄥ涓婚噷甯镐负绌?鈫?閫€鍥?shared 鍗曚緥锛夛紝
      //   瀵艰嚧锛氣憼 鍒囩粯鐢伙紙sessionId 鍙樺寲锛変笉閲嶈窇姘村悎/鍔犺浇锛屾棫缁樼敾鐨?polluted snapshot 甯搁┗锛涒憽 闈?current 宸ヤ綔鍖虹殑 snapshot 缁?shared 骞挎挱鍚庯紝details 甯告樉 shared.cwd锛堥宸ヤ綔鍖猴級蹇収銆?
      // 淇锛氣憼 鐢?props.useSessions 鏉冨▉淇″彿璺熼殢褰撳墠浼氳瘽锛坔ookCurrent锛変笌绮剧‘ cwd锛坰ummaryCwd锛夛紝props.sessionId / scope.sessionId 浼樺厛锛涒憽 鍓綔鐢?deps 鏀逛负 [sid]/[sid,summaryCwd]锛屽垏缁樼敾鍗宠Е鍙?cwd 鍚屾 + 姘村悎锛涒憿 绌?deps 鏍归櫎銆?
      const hookCurrent = (props && typeof props.useSessions === 'function') ? props.useSessions(function (x) { return x.current }) : undefined
      const propSid = props && (props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id))
      const sid = propSid || hookCurrent
      const summaryCwd = (props && typeof props.useSessions === 'function' && sid) ? props.useSessions(function (x) { return (x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined }) : undefined
      const s = useStore(sid)
      const layoutSvc = ctx.get('layout')
      const dockRef = React.useRef(null)
      const [dw, setDw] = React.useState(460)
      // 鍒楀鎰熺煡锛歞etails 鍒?300-520px锛涚獎浜?380 鏃跺姩浣滄寜閽姌鍙犱负绾浘鏍囷紙涓庢偓娴潰鏉垮悓闃堝€硷級
      React.useEffect(function () {
        if (!dockRef.current) return
        const el = dockRef.current
        const ro = new ResizeObserver(function (entries) {
          try { setDw(entries[0].contentRect.width) } catch (e) { /* 蹇界暐 */ }
        })
        ro.observe(el)
        return function () { try { ro.disconnect() } catch (e) { /* 蹇界暐 */ } }
      }, [])
      // 鍝嶅簲寮忓伐浣滃尯鍚屾锛堝榻?StatusBar锛夛細褰?host 鏉冨▉鐨?summaryCwd / session 鍙樺寲锛岀珛鍗虫妸 s.cwd 鍒囧埌姝ｇ‘宸ヤ綔鍖哄苟姘村悎 per-cwd 缂撳瓨
      React.useEffect(function () {
        const apply = function (cwd) {
          if (cwd && cwd !== s.cwd) {
            s.cwd = cwd
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChecks(s, false)
            if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
          }
        }
        if (summaryCwd) { apply(summaryCwd); return }
        const cwd0 = detectCwd(props && props.session)
        if (cwd0) { apply(cwd0); return }
        if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.cwd', { sessionId: sid }).then(function (res) {
            if (res && res.ok && res.cwd) apply(res.cwd)
          }).catch(function () { /* 淇濇寔鐜版湁 cwd */ })
        }
      }, [sid, summaryCwd])
      // 鍒濆鏁版嵁锛氶殢 sid 鍙樺寲閲嶈窇锛堜慨澶嶇┖ deps 瀵艰嚧鍒囩粯鐢讳笉鍒锋柊锛涘惈 per-cwd 姘村悎绉掑紑 + 姹℃煋娈嬬暀鑷剤锛?
      React.useEffect(function () {
        if (!s.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { s.cwd = sync; hydrateFromCache(s) }
        } else { hydrateFromCache(s) }
        // 姹℃煋鑷剤锛氳嫢褰撳墠 store 鐨?snapshot 浠嶆槸涔嬪墠宸ヤ綔鍖轰覆鍙版畫鐣欙紙repoRoot 涓?cwd 鍓嶇紑涓嶅尮閰嶏紝鎴?repo 鍚嶄笌 cwd 灏炬涓嶄竴鑷达級锛屽己鍒跺悗鍙板埛鏂?
        const isPolluted = (function(){
          if (!s.snapshot || !s.cwd) return false
          const snap = s.snapshot
          if (snap.repoRoot) {
            const rr = String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,'')
            const cw = String(s.cwd).replace(/\\/g,'/').replace(/\/+$/,'')
            if (cw === rr) return false
            if (cw.startsWith(rr + '/')) return false
            if (rr.startsWith(cw + '/')) return false
            return true
          }
          if (snap.repo && snap.repo.name) {
            const base = cwdBasename(s.cwd)
            if (base && snap.repo.name !== base) {
              // 浠呭綋 repoRoot 缂哄け鏃剁敤 basename 杈呭姪鍒ゆ柇锛岄伩鍏嶅瓙鐩綍 repo 鍚嶄笌鐩綍鍚嶄笉涓€鑷磋鍒わ紱姝ゅ鏀惧锛氫笉鍚屽悕涓斾笉鍚?cwd 鍗宠涓哄彲鐤?
              // 淇濆畧锛氳嫢 cwdBasename 涓?repo.name 瀹屽叏涓嶅悓涓?snapshot 闈炵┖锛岃涓烘薄鏌?
              return true
            }
          }
          return false
        })()
        if (isPolluted) { loadSnapshot(s, false); loadChecks(s, false); return }
        if (!snapFresh(s)) loadSnapshot(s, false); loadChecks(s, false)
      }, [sid])
      const closeDock = function () {
        if (props && typeof props.closeDetails === 'function') props.closeDetails()
        else if (layoutSvc && typeof layoutSvc.closeDetails === 'function') layoutSvc.closeDetails()
      }
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      const narrow = dw < 380
      const tabsRef = React.useRef(null)
      const headRef = React.useRef(null)
      const [tabTip, setTabTip] = React.useState(null)
      React.useEffect(function () {
        const applyFold = function () {
          const t = tabsRef.current
          if (!t) return
          const btns = t.querySelectorAll('[data-priority]')
          const ver = t.querySelector('.dsws-ver')
          // 娴嬮噺闃舵涓存椂绂佺敤 transition锛坢ax-width 鍔ㄧ敾浼氭薄鏌?scrollWidth 娴嬮噺 鈫?0/6 鎶栧姩锛?
          t.classList.add('dsws-no-anim')
          // 1) 鍏ㄥ睍寮€ + 寮哄埗 reflow锛堟嬁鍒?鍐呭鐪熷疄鏀惧緱涓?鐨勫熀鍑嗭級
          for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
          if (ver) ver.classList.remove('collapsed')
          void t.offsetWidth
          // 2) 浠庢渶涓嶉噸瑕侊紙priority 澶э級閫愪釜鎶樺彔锛岀洿鍒版斁寰椾笅锛坰crollWidth 婧㈠嚭鍒ゅ畾锛?
          const items = Array.from(btns)
            .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
            .sort(function (a, b) { return b.p - a.p })
          for (const it of items) {
            if (t.scrollWidth <= t.clientWidth + 1) break
            it.el.classList.add('collapsed')
            void t.offsetWidth
          }
          // 3) 鐗堟湰鍙疯窡闅忋€屽埛鏂般€?priority=3) 鎶樺彔锛涜褰曟姌鍙犳暟渚?tooltip 闂ㄦ帶
          if (ver) {
            const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
            ver.classList.toggle('collapsed', !!refreshCollapsed)
          }
          t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
          t.classList.remove('dsws-no-anim')
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
        let observed = null
        const apply = function () {
          const t = tabsRef.current
          if (!t) return
          if (ro && observed !== t) {
            if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
            ro.observe(t)
            observed = t
          }
          applyFold()
        }
        apply()
        if (typeof window !== 'undefined') window.addEventListener('resize', apply)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
        return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
      }, [])
      // 澶撮儴鑷€傚簲锛氱┖闂村厖瓒虫椂瀹屾暣锛屾尋鍘嬫椂鍏堥殣钘?MATT skills 鏂囧瓧锛堜繚鐣欏浘鏍囷級锛屾渶鍚庝粎鐣?repo锛?28锛?
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : ''
          const short = repo ? repo.name : ''
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          // 鍩哄噯锛氭爣棰樺彲瑙?+ 瀹屾暣浠撳簱鍚嶏紙鍥哄娴嬭嚜鐒跺锛?
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 闃舵1锛氶殣钘忔爣棰橈紝浼樺厛淇濅粨搴撳悕
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 闃舵2锛氭瀬绐勬椂浠呯暀 repo
          if (full && short) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 浠嶆斁涓嶄笅锛氬厑璁?chip 寮规€?ellipsis 鏀剁缉
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try {
          ro2 = new ResizeObserver(function () { applyHead() })
          if (headRef.current) ro2.observe(headRef.current)
        } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), dw])
      const tabsTip = function (e, text, priority) {
        const t = tabsRef && tabsRef.current
        setTabTip(null)
        if (!t || !text || typeof e === 'undefined') return
        // 闂ㄦ帶锛氫粎褰撹 priority 鐨勬寜閽嚜韬凡鎶樺彔鏃舵墠鏄剧ず tooltip锛堟枃瀛楄钘忋€侀渶鎮诞鎻愮ず锛?
        const btn = t.querySelector('[data-priority="' + priority + '"]')
        if (!btn || !btn.classList.contains('collapsed')) return
        if (typeof window === 'undefined') return
        const W = 238
        let x = e.clientX + 12, y = e.clientY + 12
        if (x + W > window.innerWidth) x = e.clientX - 12 - W
        setTabTip({ x: x, y: y, text: text })
      }
      const tabsTipOff = function () { setTabTip(null) }
      const tabBtn = (id, icon, label, priority) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
        Ic({ n: icon, size: 12 }),
        h('span', null, label),
      ])
      return h('div', { ref: dockRef, 'data-dsws-host': '1', className: narrow ? 'dsws-narrow' : undefined, style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--dsw-font-family)', fontSize: 12, color: 'var(--dsw-alias-label-primary,#e6edf3)', background: 'var(--dsw-alias-bg-layer-1,#10131a)' } }, [
        // 澶撮儴锛堟爣棰?+ 鍏抽棴锛夛細妯嚎涓嶆斁鍦ㄨ繖琛岋紝涓嬬Щ鍒版爣绛捐涓嬫柟涓庡璇?杞ㄨ抗瀵归綈
        // #28 鑷€傚簲锛歠lex 瀹瑰櫒 minWidth 0 + 鑺墖 flex 鑷€傚簲锛屾爣棰樹紭鍏堥殣钘忥紝鏋佺獎浠呯暀 repo
        h('div', { ref: headRef, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px', flex: 'none', minWidth: 0 } }, [
          Icon({ scheme: 'compass', size: 15 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, fontSize: 13, flex: 'none', whiteSpace: 'nowrap' } }, tr('panel.title')),
          // v1.5 T7锛氫粨搴撹韩浠界粍浠?鈥斺€?褰撳墠妫€娴嬪埌鐨?git 浠撳簱锛坥wner/name锛夛紝鐐瑰嚮鎵撳紑 GitHub
          (s.snapshot && s.snapshot.repo) ? h('a', { href: 'https://github.com/' + s.snapshot.repo.owner + '/' + s.snapshot.repo.name, target: '_blank', rel: 'noreferrer', title: tr('panel.repoTitle'), 'data-repo-chip': 1, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#58a6ff', background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.45)', borderRadius: 6, padding: '1px 8px', flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace' } }, [
            h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'currentColor', style: { flex: 'none' } }, [h('path', { d: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 8h8.5V1.5z' })]),
            h('span', { 'data-repo-text': 1, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapshot.repo.owner + '/' + s.snapshot.repo.name),
          ]) : h('span', { title: tr('panel.noRepoTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [
            Ic({ n: 'alert', size: 11 }),
            h('span', null, tr('panel.noRepo')),
          ]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: closeDock, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 6px', fontSize: 11 } }, Ic({ n: 'x', size: 12 })),
        ]),
        // 鏍囩琛屼笅娌?= 涓庡璇?杞ㄨ抗涓€鑷寸殑妯嚎锛涘彸渚э細鍒锋柊鎸夐挳 + 鐗堟湰鍙凤紙v1.3.3锛?
        h('div', { className: 'dsws-tabs', ref: tabsRef, style: { padding: '0 12px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', flex: 'none', display: 'flex', alignItems: 'center', gap: 4 } }, [
          tabBtn('list', 'list', tr('panel.tabList'), 4),
          tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
          tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
          h('span', { style: { flex: 1 } }),
          // v1.5 T6 淇锛圴2 鎻忚竟绱?路 鍒锋柊宸︿晶锛夛細鏂板 wayfinder 鈥斺€?娉ㄥ叆 /wayfinder + 浠撳簱淇℃伅 + 闇€姹傚紩瀵?
          // issue #4锛氭柊澧?BUG 鍗?鈥斺€?鍚屾瀯鎸夐挳锛堟柊浼氳瘽棰勫～ /wayfinder 鏂板 BUG 鍗?prompt锛?
          h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
            Ic({ n: 'map', size: 11 }),
            h('span', null, tr('panel.newWayfinder')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
            Ic({ n: 'bug', size: 11 }),
            h('span', null, tr('panel.newBug')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 3, onMouseMove: function (e) { tabsTip(e, tr('list.refresh'), 3) }, onMouseLeave: tabsTipOff, onClick: function () { refreshAll(s) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' } }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', null, tr('list.refresh'))]),
          (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
          h('span', { className: 'dsws-ver', style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION),
        ]),
        h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '10px 12px' } }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        // v1.5 T10 R7锛氬埛鏂伴伄缃╁凡搴熼櫎锛堟墜鍔ㄥ埛鏂拌蛋闈欓粯璺緞锛屾棤銆屽埛鏂颁腑銆嶏級
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }

    // ---- 5.8 涓婚潰鏉匡紙鍙嫋鍔?路 8 鍚戠缉鏀?路 涓夎鍥?路 v14 璺熼殢褰撳墠浼氳瘽 + 鍒锋柊閬僵锛?---
    const OverlayPanel = (props) => {
      const cur = props.useSessions((x) => x.current)
      const s = useStore(cur)
      const panelRef = React.useRef(null)
      const tabsRef = React.useRef(null)
      const headRef = React.useRef(null)
      const [tabTip, setTabTip] = React.useState(null)
      React.useEffect(function () {
        const applyFold = function () {
          const t = tabsRef.current
          if (!t) return
          const btns = t.querySelectorAll('[data-priority]')
          const ver = t.querySelector('.dsws-ver')
          // 娴嬮噺闃舵涓存椂绂佺敤 transition锛坢ax-width 鍔ㄧ敾浼氭薄鏌?scrollWidth 娴嬮噺 鈫?0/6 鎶栧姩锛?
          t.classList.add('dsws-no-anim')
          // 1) 鍏ㄥ睍寮€ + 寮哄埗 reflow锛堟嬁鍒?鍐呭鐪熷疄鏀惧緱涓?鐨勫熀鍑嗭級
          for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
          if (ver) ver.classList.remove('collapsed')
          void t.offsetWidth
          // 2) 浠庢渶涓嶉噸瑕侊紙priority 澶э級閫愪釜鎶樺彔锛岀洿鍒版斁寰椾笅锛坰crollWidth 婧㈠嚭鍒ゅ畾锛?
          const items = Array.from(btns)
            .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
            .sort(function (a, b) { return b.p - a.p })
          for (const it of items) {
            if (t.scrollWidth <= t.clientWidth + 1) break
            it.el.classList.add('collapsed')
            void t.offsetWidth
          }
          // 3) 鐗堟湰鍙疯窡闅忋€屽埛鏂般€?priority=3) 鎶樺彔锛涜褰曟姌鍙犳暟渚?tooltip 闂ㄦ帶
          if (ver) {
            const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
            ver.classList.toggle('collapsed', !!refreshCollapsed)
          }
          t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
          t.classList.remove('dsws-no-anim')
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
        let observed = null
        const apply = function () {
          const t = tabsRef.current
          if (!t) return
          if (ro && observed !== t) {
            if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
            ro.observe(t)
            observed = t
          }
          applyFold()
        }
        apply()
        if (typeof window !== 'undefined') window.addEventListener('resize', apply)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
        return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
      }, [s.open])
      // 澶撮儴鑷€傚簲锛圤verlay锛夛細鍚?Dock 閫昏緫锛岀┖闂村厖瓒冲畬鏁达紝鎸ゅ帇鍏堣棌鏍囬鏂囧瓧锛屾渶鍚庝粎鐣?repo锛?28锛?
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : (s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : '')
          const short = repo ? repo.name : full
          const isRepo = !!(repo && repo.owner && repo.name)
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          if (isRepo) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try { ro2 = new ResizeObserver(function () { applyHead() }); if (headRef.current) ro2.observe(headRef.current) } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), s.snapMode, s.size && s.size.w, s.open])
      // #376锛氬姞杞界敱 openPanel 缁熶竴鍒嗘淳锛堟湭灏辩华/杩囨湡 force锛屾柊椴滅洿鎺ュ睍绀猴級锛涙澶勪笉鍐嶉噸澶嶅姞杞?
      if (!s.open) return null
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      // v14-19锛氱獎灞忛槇鍊硷紙闈㈡澘瀹?<380px 鏃跺姩浣滄寜閽姌鍙犱负绾浘鏍囷級
      const narrow = s.size.w < 380
      const tabsTip = function (e, text, priority) {
        const t = tabsRef && tabsRef.current
        setTabTip(null)
        if (!t || !text || typeof e === 'undefined') return
        // 闂ㄦ帶锛氫粎褰撹 priority 鐨勬寜閽嚜韬凡鎶樺彔鏃舵墠鏄剧ず tooltip锛堟枃瀛楄钘忋€侀渶鎮诞鎻愮ず锛?
        const btn = t.querySelector('[data-priority="' + priority + '"]')
        if (!btn || !btn.classList.contains('collapsed')) return
        if (typeof window === 'undefined') return
        const W = 238
        let x = e.clientX + 12, y = e.clientY + 12
        if (x + W > window.innerWidth) x = e.clientX - 12 - W
        setTabTip({ x: x, y: y, text: text })
      }
      const tabsTipOff = function () { setTabTip(null) }
      const tabBtn = (id, icon, label, priority) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
        Ic({ n: icon, size: 12 }),
        h('span', null, label),
      ])

      const startDrag = function (e) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return
        if (!panelRef.current) return
        e.preventDefault()
        const rect = panelRef.current.getBoundingClientRect()
        const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, sx: e.clientX, sy: e.clientY }
        const mm = function (ev) { s.pos = { x: r0.x + ev.clientX - r0.sx, y: r0.y + ev.clientY - r0.sy }; emit(s) }
        const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
        document.addEventListener('mousemove', mm)
        document.addEventListener('mouseup', mu)
      }
      const onBodyDown = function (e) {
        if (e.target === e.currentTarget) startDrag(e)
      }

      const onResizeDown = function (dir) {
        return function (e) {
          e.stopPropagation()
          e.preventDefault()
          if (typeof document === 'undefined' || typeof window === 'undefined' || !panelRef.current) return
          const rect = panelRef.current.getBoundingClientRect()
          const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, w: s.size.w || rect.width, h: s.size.h || rect.height, sx: e.clientX, sy: e.clientY }
          const mm = function (ev) {
            const dx = ev.clientX - r0.sx, dy = ev.clientY - r0.sy
            let w = r0.w, h = r0.h
            if (dir.indexOf('e') >= 0) w = r0.w + dx
            if (dir.indexOf('s') >= 0) h = r0.h + dy
            if (dir.indexOf('w') >= 0) w = r0.w - dx
            if (dir.indexOf('n') >= 0) h = r0.h - dy
            w = Math.min(900, Math.max(340, w))
            h = Math.min(920, Math.max(240, h))
            let x = r0.x, y = r0.y
            if (dir.indexOf('w') >= 0) x = r0.x + (r0.w - w)
            if (dir.indexOf('n') >= 0) y = r0.y + (r0.h - h)
            s.pos = { x: x, y: y }
            s.size = { w: w, h: h }
            emit(s)
          }
          const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
          document.addEventListener('mousemove', mm)
          document.addEventListener('mouseup', mu)
        }
      }

      const panelStyle = { width: s.size.w, ...(s.size.h ? { height: s.size.h } : {}), ...(s.pos ? { left: s.pos.x, top: s.pos.y, right: 'auto' } : { left: 16, top: 76, right: 'auto' }) }
      return h('div', { ref: panelRef, className: 'dsws-panel', style: panelStyle }, [
        // #28 鑷€傚簲澶撮儴锛歮inWidth 0 鍏佽鏀剁缉锛屽厛钘忔爣棰樻枃瀛楋紙鐣欏浘鏍囷級锛屾渶鍚庝粎鐣?repo
        h('div', { ref: headRef, className: 'dsws-head', onMouseDown: startDrag, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
          Icon({ scheme: s.ui.icon, size: 17 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' } }, tr('panel.title')),
          // v19-35锛氥€岀湡鏁版嵁銆嶁啋 鏄剧ず repo 鍚嶏紙瀵规湭鏉ョ敤鎴锋洿鏈夋剰涔夛紱寮傚父鏃剁孩鑹叉彁绀猴級
          h('span', { 'data-repo-chip': 1, className: 'dsws-chip ' + (s.snapMode === 'err' ? 'dsws-chip-t' : 'dsws-chip-m'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [
            Ic({ n: s.snapMode === 'err' ? 'alert' : 'info', size: 11 }),
            h('span', { 'data-repo-text': 1, className: 'dsws-ellip', title: repoStr(s), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : repoStr(s)),
          ]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: function () { s.open = false; emit(s) }, style: { display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 12 })),
        ]),
                h('div', { className: 'dsws-tabs', ref: tabsRef, style: { display: 'flex', alignItems: 'center', gap: 4 } }, [
          tabBtn('list', 'list', tr('panel.tabList'), 4),
          tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
          tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
          h('span', { style: { flex: 1 } }),
          // v1.5 T6 淇锛圴2 鎻忚竟绱?路 鍒锋柊宸︿晶锛夛細鏂板 wayfinder
          // issue #4锛氭柊澧?BUG 鍗?鈥斺€?鍚屾瀯鎸夐挳锛堟柊浼氳瘽棰勫～ /wayfinder 鏂板 BUG 鍗?prompt锛?
          h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
            Ic({ n: 'map', size: 11 }),
            h('span', null, tr('panel.newWayfinder')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
            Ic({ n: 'bug', size: 11 }),
            h('span', null, tr('panel.newBug')),
          ]),
          // T2 #2锛氬埛鏂版寜閽笂绉昏嚦 tabs 琛?路 绱ц创鐜妫€鏌ュ彸杈癸紙鐢ㄦ埛闇€姹傦細鍒楄〃 / 鎶€鑳?/ 鐜妫€鏌?/ 鍒锋柊锛?
          h('button', { className: 'dsws-btn', 'data-priority': 3, onMouseMove: function (e) { tabsTip(e, tr('list.refresh'), 3) }, onMouseLeave: tabsTipOff, onClick: function () { refreshAll(s) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' } }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', null, tr('list.refresh'))]),
          (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
          h('span', { className: 'dsws-ver', style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION),
        ]),
        h('div', { className: 'dsws-body', onMouseDown: onBodyDown }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        h('div', { className: 'dsws-rz dsws-rz-n', onMouseDown: onResizeDown('n'), title: tr('rz.n') }),
        h('div', { className: 'dsws-rz dsws-rz-s', onMouseDown: onResizeDown('s'), title: tr('rz.s') }),
        h('div', { className: 'dsws-rz dsws-rz-e', onMouseDown: onResizeDown('e'), title: tr('rz.e') }),
        h('div', { className: 'dsws-rz dsws-rz-w', onMouseDown: onResizeDown('w'), title: tr('rz.w') }),
        h('div', { className: 'dsws-rz dsws-rz-ne', onMouseDown: onResizeDown('ne'), title: tr('rz.ne') }),
        h('div', { className: 'dsws-rz dsws-rz-nw', onMouseDown: onResizeDown('nw'), title: tr('rz.nw') }),
        h('div', { className: 'dsws-rz dsws-rz-se', onMouseDown: onResizeDown('se'), title: tr('rz.se') }),
        h('div', { className: 'dsws-rz dsws-rz-sw', onMouseDown: onResizeDown('sw'), title: tr('rz.sw') }),
        // v1.5 T10 R7锛氬埛鏂伴伄缃╁凡搴熼櫎锛堟墜鍔ㄥ埛鏂拌蛋闈欓粯璺緞锛屾棤銆屽埛鏂颁腑銆嶏級
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }

    // ---- 5.9 閰嶇疆椤碉紙v25 路 settings.plugins.tab銆學aystation銆嶏細鍔熻兘閰嶇疆 + 鍔ㄤ綔妯℃澘缂栬緫鍣級----
    // 寮€濮嬫ā鏉匡紙鍓嶇紑寮€鍏?+ execute 妯℃澘锛? 鍔ㄤ綔妯℃澘缂栬緫鍣紙鍏朵綑 6 鍔ㄤ綔锛?
    // T3锛氭ā鏉垮悕/鎻忚堪鍦ㄦ覆鏌撴椂 tr('tpl.name.*')/tr('tpl.desc.*')锛堟澶勪繚鐣欎腑鏂囬潤鎬佽〃渚涢粯璁ゆ枃妗堝弬鑰冿級
    const TPL_NAMES = {
      diagnose: '璇婃柇', fix: '淇', discuss: '璁ㄨ', handoff1: '浜ゆ帴绗竴鍑?, handoff2: '浜ゆ帴绗簩鍑?, fixate: '娌夋穩',
    }
    const TPL_DESC = {
      diagnose: 'needs-triage 绁ㄧ殑琛岀骇鍔ㄤ綔',
      fix: 'bug 绁ㄧ殑琛岀骇鍔ㄤ綔',
      discuss: 'wayfinder:grilling 绁ㄧ殑琛岀骇鍔ㄤ綔',
      handoff1: '鐢熸垚浜ゆ帴鏂囨。锛堝惈鏃堕棿鎴筹紝涓ゅ嚮鏂囦欢鍚嶄竴鑷达級',
      handoff2: '璇诲彇浜ゆ帴鏂囨。',
      fixate: '闆朵涪澶卞揩鐓?prompt',
    }
    const TPL_EDIT_IDS = ['diagnose', 'fix', 'discuss', 'handoff1', 'handoff2', 'fixate']  // execute 鍦ㄣ€屽紑濮嬫ā鏉裤€嶈妭
    const PREVIEW_VALUES = { url: 'https://github.com/FeatherHunter/SKILLS/issues/365', number: '365', title: tr('cfg.previewTitle'), ts: '20260814-172113', file: '20260814-172113.md' }
    const SettingsPage = (props) => {
      // T5 淇锛氳闃?store锛堣缃〉鐙珛浜庨潰鏉?dock锛岄渶鑷繁璁㈤槄 shared 鎵嶈兘娓叉煋 flash toast锛?
      const sharedSt = useStore(props && props.sessionId)
      const [openIn, setOpenIn] = React.useState(cfg.openIn || 'dock')
      const [openInNote, setOpenInNote] = React.useState(false)
      const [wf, setWf] = React.useState(cfg.withWayfinder)
      const [tpls, setTpls] = React.useState(function () {
        const o = {}
        o.execute = templates.execute || ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = templates[id] || '' })
        return o
      })
      const [saved, setSaved] = React.useState(false)
      const [errs, setErrs] = React.useState([])
      const [resetNote, setResetNote] = React.useState(null)
      const taRefs = React.useRef({})
      // v1.4.1锛氭墦寮€浣嶇疆鍗虫椂鐢熸晥 鈥斺€?seg 鐐瑰嚮鍗冲啓鍏?cfg + localStorage + 骞挎挱锛堟棤闇€婊氬埌搴曢儴鐐逛繚瀛樺叏閮級
      const pickOpenIn = function (v) {
        setOpenIn(v)
        cfg.openIn = v
        saveCfg()
        broadcastCfg()
        setOpenInNote(true)
        if (timer !== undefined) timer.timeout(function () { setOpenInNote(false) }, 2600)
      }
      // v1.3.3 T1锛氭ā鏉?textarea 鑷€傚簲楂樺害锛堝唴瀹瑰叏灞曞紑 路 鏃犲唴灞傛粴鍔?路 鏈€澶栧眰婊戝姩锛?
      const autoGrowTa = function (el) {
        if (!el) return
        el.style.height = 'auto'
        el.style.height = (el.scrollHeight + 2) + 'px'
      }
      // 鏍￠獙鍏ㄩ儴 7 涓ā鏉匡紙鐢熸晥鏂囨湰 = 鑷畾涔?|| 榛樿锛?
      const validateAll = function (executeText) {
        const errList = []
        const check = function (id, text) {
          const v = validateTemplate(id, text || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''))
          if (!v.ok) {
            const bits = []
            if (v.missing.length) bits.push(tr('tpl.missing', { list: v.missing.map(function (n) { return '{' + n + '}' }).join('銆?) }))
            if (v.unknown.length) bits.push(tr('tpl.unknown', { list: v.unknown.map(function (n) { return '{' + n + '}' }).join('銆?) }))
            errList.push('銆? + tr('tpl.name.' + id) + '銆? + bits.join('锛?))
          }
        }
        check('execute', executeText)
        TPL_EDIT_IDS.forEach(function (id) { check(id, tpls[id]) })
        return errList
      }
      const save = function () {
        const errList = validateAll(custom)
        if (errList.length) { setErrs(errList); return }
        setErrs([])
        cfg.openIn = openIn
        cfg.withWayfinder = wf
        templates.execute = custom
        TPL_EDIT_IDS.forEach(function (id) { templates[id] = tpls[id] })
        saveCfg(); saveTemplates(); broadcastCfg()
        setSaved(true)
        if (timer !== undefined) timer.timeout(function () { setSaved(false) }, 2000)
      }
      const setTpl = function (id, val) { setTpls(function (p) { const o = Object.assign({}, p); o[id] = val; return o }) }
      const resetExecute = function () { setTpl('execute', ''); setErrs([]) }
      const resetTpl = function (id) { setTpl(id, ''); setErrs([]) }
      // 椤甸潰绾ф仮澶嶅叏閮ㄩ粯璁わ紙T1 瑙勬牸 搂5锛氭竻绌?= 娉ㄥ叆鏃惰蛋鍐呯疆榛樿鏂囨湰锛?
      const resetAll = function () {
        const o = {}
        o.execute = ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = '' })
        setTpls(o)
        setWf(true)
        setErrs([])
      }
      // 鐐瑰嚮鍗犱綅绗?chip 鍦ㄥ厜鏍囧鎻掑叆
      const insertPh = function (id, name) {
        const ta = taRefs.current[id]
        const cur = tpls[id] || ''
        if (!ta) { setTpl(id, cur + '{' + name + '}'); return }
        const start = (ta.selectionStart != null) ? ta.selectionStart : cur.length
        const end = (ta.selectionEnd != null) ? ta.selectionEnd : cur.length
        const next = cur.slice(0, start) + '{' + name + '}' + cur.slice(end)
        setTpl(id, next)
        const pos = start + name.length + 2
        setTimeout(function () { try { ta.focus(); ta.setSelectionRange(pos, pos) } catch (e) { /* 蹇界暐 */ } }, 0)
      }
      const chip = function (id, n, req) {
        return h('span', { key: n, className: 'dsws-cfg-chip' + (req ? ' req' : ''), title: req ? tr('cfg.chipReq') : tr('cfg.chipInsert'), onClick: function () { insertPh(id, n) } }, [
          h('span', null, '{' + n + '}'),
          req ? h('span', { className: 'must' }, tr('cfg.must')) : null,
        ])
      }
      const tplCard = function (id) {
        const val = tpls[id] || ''
        const preview = renderTemplate(id, PREVIEW_VALUES)
        const req = (TPL_REQUIRED[id] || []).slice()
        return h('div', { key: id, className: 'dsws-cfg-card' }, [
          h('div', { className: 'dsws-cfg-card-head' }, [
            h('span', { className: 'dsws-cfg-card-name' }, tr('tpl.name.' + id)),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-cfg-btn', onClick: function () { resetTpl(id) } }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-card-desc' }, tr('tpl.desc.' + id)),
          h('div', { className: 'dsws-cfg-chips' }, (TPL_PH[id] || []).map(function (n) { return chip(id, n, req.indexOf(n) >= 0) })),
          h('textarea', { ref: function (el) { taRefs.current[id] = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''), value: val, onChange: function (e) { setTpl(id, e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), preview]),
        ])
      }
      const custom = tpls.execute || ''
      // T5 淇锛氳缃〉鍐?toast锛堢嫭绔嬩簬闈㈡澘 dock 鐨?notice 娓叉煋锛?
      const cfgNotice = sharedSt.notice
      return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
        cfgNotice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
          Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
          h('span', null, cfgNotice.text),
        ]) : null,
        h('div', { className: 'dsws-cfg-head' }, [
          Icon({ scheme: 'compass', size: 20 }),
          h('span', { className: 't' }, tr('panel.title')),
          h('span', { className: 's', style: { color: saved ? 'var(--dsw-alias-state-success-primary,#4ade80)' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
            Ic({ n: saved ? 'check' : 'dot', size: 12 }),
            h('span', null, saved ? tr('cfg.saved') : tr('cfg.status')),
          ]),
        ]),
        h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
        // v1.5 T4锛歁att 鎶€鑳戒粙缁嶅崱锛堝伐绋嬮鍩?+ 閫氱敤棰嗗煙 skills 路 GitHub 閾炬帴 + 瀹夎 prompt 澶嶅埗/娉ㄥ叆锛?
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'star', size: 13 }), h('span', null, tr('matte.title'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('matte.desc')),
          h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6 } }, [
            h('a', { href: MATT_REPO, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('matte.openRepo'))]),
            h('button', { className: 'dsws-btn', onClick: function () { copyText(sharedSt, promptText('installSkills'), tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('matte.copyPrompt'))]),
          ]),
        ]),
        // v1.4锛氭墦寮€浣嶇疆锛坉etails 鍒?/ better-sidebar锛夆€斺€?better-sidebar 鏈鏃朵粎鏄剧ず dock 閫夐」
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'map', size: 13 }), h('span', null, tr('cfg.openIn'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.openInDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('span', { className: 'dsws-cfg-label' }, tr('cfg.openInLabel')),
            h('div', { className: 'dsws-cfg-seg' }, [
              h('button', { key: 'dock', className: openIn === 'dock' ? 'on' : '', onClick: function () { pickOpenIn('dock') } }, tr('cfg.openInDock')),
              (function () { try { return !!ctx.get('betterSidebar') } catch (e) { return false } })()
                ? h('button', { key: 'sidebar', className: openIn === 'sidebar' ? 'on' : '', onClick: function () { pickOpenIn('sidebar') } }, tr('cfg.openInSidebar'))
                : null,
            ]),
            openInNote ? h('div', { style: { fontSize: 11, color: '#4ade80', marginTop: 6 } }, tr('cfg.openInHint')) : null,
          ]),
        ]),
        // 1.5 闈㈡澘瀹藉害閲嶇疆锛?398 鎷嗙エ A 路 涓?#397 鍗忚皟 路 绛?layoutSvc.resetDetails API锛涚己澶辨椂鍙嬪ソ鎻愮ず涓嶈 UI 宕╂簝锛?
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'refresh', size: 13 }), h('span', null, tr('cfg.panelWidth'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.resetPanelWidthDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('button', { className: 'dsws-cfg-btn', onClick: function () {
              const ls = ctx.get('layout')
              if (ls && typeof ls.resetDetails === 'function') {
                try { ls.resetDetails(); setResetNote({ kind: 'ok', text: tr('toast.resetPanelWidthDone') }) }
                catch (e) { setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') }) }
              } else {
                setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') })
              }
              if (timer !== undefined) timer.timeout(function () { setResetNote(null) }, 2800)
            } }, tr('cfg.resetPanelWidth')),
            resetNote ? h('span', { style: { marginLeft: 10, fontSize: 11, color: resetNote.kind === 'ok' ? '#4ade80' : '#fbbf24' } }, resetNote.text) : null,
          ]),
        ]),
        // 2. 寮€濮嬫ā鏉匡紙execute 鍞竴缂栬緫鐐癸紱id 渚涘姩浣滄ā鏉跨紪杈戝櫒閿氱偣璺宠浆锛?
        h('div', { id: 'dsws-cfg-exec-group', className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'play', size: 13 }), h('span', null, tr('cfg.startTpl'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.startTplDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('label', { className: 'dsws-cfg-sw' }, [
              h('input', { type: 'checkbox', checked: wf, onChange: function (e) { setWf(e.target.checked) } }),
              h('span', { className: 'tr' }),
              h('span', null, tr('cfg.withPrefix')),
            ]),
          ]),
          h('textarea', { ref: function (el) { taRefs.current.execute = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT.execute ? TPL_DEFAULT.execute() : ''), value: custom, onChange: function (e) { setTpl('execute', e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-chips' }, [
            (TPL_PH.execute || []).map(function (n) { return chip('execute', n, (TPL_REQUIRED.execute || []).indexOf(n) >= 0) }),
            h('button', { className: 'dsws-cfg-btn', style: { marginLeft: 'auto' }, onClick: resetExecute }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), renderTemplate('execute', PREVIEW_VALUES)]),
        ]),
        // 3. 鍔ㄤ綔妯℃澘缂栬緫鍣紙鍏朵綑 6 鍔ㄤ綔 路 T1锛氶粯璁ゅ睍寮€鍙墜鍔ㄦ姌鍙狅級
        h('details', { open: true, className: 'dsws-cfg-group dsws-cfg-details' }, [
          h('summary', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 650, marginBottom: 4, cursor: 'pointer', listStyle: 'none' } }, [Ic({ n: 'note', size: 13 }), h('span', null, tr('cfg.tplEditor'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, [
            h('span', null, tr('cfg.tplEditorDesc')),
            h('a', { href: 'javascript:void(0)', onClick: function () { const el = document.getElementById('dsws-cfg-exec-group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, style: { color: '#bc8cff', cursor: 'pointer', flex: 'none', textDecoration: 'none' } }, tr('cfg.execHint')),
          ]),
          TPL_EDIT_IDS.map(tplCard),
        ]),
        // 鏍￠獙閿欒鎻愮ず
        errs.length ? h('div', { className: 'dsws-cfg-err' }, [
          h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.saveRejected'))]),
          errs.map(function (e, i) { return h('div', { key: i }, '路 ' + e) }),
        ]) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-end' } }, [
          h('button', { className: 'dsws-cfg-btn', onClick: resetAll }, tr('cfg.resetAll')),
          h('button', { className: 'dsws-cfg-save', onClick: save }, [Ic({ n: 'check', size: 13 }), h('span', null, tr('cfg.saveAll'))]),
        ]),
      ])
    }

    // ---- 5.10 Run 鍗℃帶鍒堕潰鏉匡紙v25锛氱姸鎬佸睍绀?+ 蹇嵎鎵撳紑閰嶇疆椤碉紱澶栬鍒囨崲宸茶縼鍏ヨ缃〉锛?---
    const RunPanel = (props) => {
      const cur = props.useSessions((x) => x.current)
      const s = useStore(cur)
      return h('div', { style: { border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1,#10131a)', fontFamily: 'var(--dsw-font-family)', fontSize: 13, color: 'var(--dsw-alias-label-primary,#e6edf3)', lineHeight: 1.6 } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
          h('strong', null, tr('panel.title')),
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, color: '#4ade80', fontSize: 12 } }, [Ic({ n: 'dot', size: 10 }), h('span', null, tr('run.loaded'))]),
        ]),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', margin: '6px 0' } }, tr('run.desc')),
        h('div', { className: 'dsws-uirow' }, [
          h('button', { className: 'dsws-btn', onClick: function () { openPanel(s) } }, tr('run.openPanel')),
          // v25锛氳缃潰鏉夸负 shell 缁勪欢鏈湴鐘舵€併€佹棤鍏紑鎵撳紑 API锛堝凡鏌ヨ瘉锛夆啋 鎸夐挳寮曞璺緞锛堝亸绂昏褰曡 T2a resolution锛?
          h('button', { className: 'dsws-btn', onClick: function () { flash(s, tr('run.cfgGuide'), 'info') } }, tr('run.openCfg')),
        ]),
      ])
    }

    // ============================================================
    // 6. 鎻掓Ы娉ㄥ唽
    // ============================================================
    slots.inject('shell.overlay', function () {
      return slots.register({ name: 'shell.overlay', id: 'dsws-overlay-v5', order: 10 }, OverlayPanel)
    })
    slots.inject('conversation.input.dock', function () {
      return slots.register({ name: 'conversation.input.dock', id: 'dsh-mattpocock-skills-deck', order: 40 }, StatusBar)
    })
    slots.inject('tool.view.cordis', function () {
      return slots.register({ name: 'tool.view.cordis', key: 'self' }, RunPanel)
    })
    // v25-50锛氶厤缃〉锛堣缃?鈫?鎻掍欢 鈫?Waystation锛涗笌 opencode 涓婚鍚屾ā寮忥級
    slots.inject('settings.plugins.tab', function () {
      return slots.register({ name: 'settings.plugins.tab', id: 'dsws-settings', order: 40, label: function () { return tr('panel.title') } }, SettingsPage)
    })
    // v1.5 T2锛氳缃乏渚х洿杈?鈥斺€?settings.section 宸︽爮鏉＄洰锛堜笌鎻掍欢椤?tab 鍙屽叆鍙ｏ紝澶嶇敤鍚屼竴 SettingsPage锛?
    //   order 18 = 绱ц窡 鎻掍欢椤?5 涔嬪悗锛堢敤鎴锋媿鏉?2026-08-16锛?5 < 18 < AgentPresets20 < better-sidebar100锛?
    slots.inject('settings.section', function () {
      return slots.register({ name: 'settings.section', id: 'dsws-settings-section', order: 18, label: function () { return tr('panel.title') } }, SettingsPage)
    })
    // 鍘熷瀷锛氬彸渚у仠闈狅紙details 妲戒綅 路 鏇挎崲鍐呯疆宸ュ叿璇︽儏闈㈡澘锛泂ingle 妲藉姩鎬佹敞鍐屼紭鍏堢骇浣?鈫?鑳滃嚭锛?
    // priority: -1 浣庝簬鍐呯疆璇︽儏闈㈡澘鐨勯粯璁?0 鈫?鏃犲啿绐佷笖銆屼綆鑰呰儨鍑恒€嶆浛鎹㈠唴缃潰鏉?
    slots.inject('details', function () {
      return slots.register({ name: 'details', id: 'dsws-details', order: 10, priority: -1 }, DetailsDock)
    })

    // v1.4.1锛歛pply 鏃跺敖鍔涙敞鍐屻€學aystation銆峵ab锛沚etter-sidebar 鏈嶅姟鏈氨缁紙鍔犺浇鏅氫簬鏈ā鍧楋級鈫?瀹氭椂閲嶈瘯锛堟渶澶?10 娆★級
    //   鍗歌浇锛圚MR / 鎻掍欢绂佺敤锛夋椂娓呯悊 disposer + 閲嶈瘯瀹氭椂鍣?
    if (!ensureSidebarTab()) {
      let tries = 0
      sidebarTabRetry = setInterval(function () {
        tries++
        if (ensureSidebarTab() || tries >= 10) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
      }, 1000)
    }
    ctx.effect(function () {
      return function () {
        try { if (sidebarTabDisposer) sidebarTabDisposer() } catch (e) { /* 蹇界暐 */ }
        sidebarTabDisposer = null
        if (sidebarTabRetry) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
      }
    }, 'dsh-mattpocock-skills-deck: better-sidebar tab')

    // #347锛氬姞杞界湡鏁版嵁蹇収锛坮epo 閾炬帴 + 鍓嶇疆妫€娴嬪厹搴曪級锛屽け璐ラ潤榛?
    loadSnapshot(shared, false)
  },
}

