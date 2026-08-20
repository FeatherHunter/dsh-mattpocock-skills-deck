/**
 * dsh-mattpocock-skills-deck ������루Client bundle �� v1.2.0-dev = ��̬�� v25 ͬԴ��
 *
 * ��ʽ��DSH client-modules �Ķ��� CJS bundle ���� ����ű�ִ��ʱֻע�� factory��
 * ��������ںˣ�vendored Cordis Loader���ڹ��ظò����Ŀʱ�ﻯִ�С�
 * ������״��ٷ� client ��һ�£�named exports { inject, apply }��
 *
 * �붯̬�� client.js��cordis_define �� code.client �����壩���죺
 *   1. React ���� require('react')����̬��Ϊ runner ע��ȫ�֣�
 *   2. styles.insert����̬ runner ר�� builtin���� �ֶ� <style data-plugin> ע�룬
 *      ctx.effect ����������ж�أ��ο� dsh-opencode-tui-theme v1.1.0 ��ѵ��
 *      effect fn ����ִ�С�����ֵ������������
 *   3. host.call('wf.xxx', args)����̬ runner ר����� rpcCall('xxx', args)��
 *      ctx.connection.rpc.call('/dsws', endpoint, args) �� RpcResult ���
 *   4. timer ���񲻿���ʱ setTimeout ���ף���̬�� runner ��ע�� timer��
 *
 * ����ͬ��̬�� v26��״̬������ / �Ҳ� details ����壨Ψһ����ʽ �� ����ͼ��/
 * �м����������/�޸�/����/ִ�У�/ map ���� / �������� prompt��ʱ������䣩/
 * �����䡸�ӵ�һ��ԭ�����������񣬲��Կ�ʽ��顣��/ ����ҳ��settings.plugins.tab��Waystation����
 * ���߶����� + ��ʼģ�� + ����ģ��༭����dsws.cfg/dsws.templates �־û� + �� startCfg Ǩ�ƣ�/
 * ��Ӣ˫�dsws locale �����ռ� zh/en������ harness ���ԣ�
 * v26��#373 �û��İ� 2026-08-14��������ʽ����Ϊ���Ҳ� details �� ���� �Ƴ� Document PiP
 * ����С����Electron �����ã���ͣ��/����˫ģʽ���䡢״̬����ͣ����seg����������������ť��
 */
window.__ModuleLoader__.load({
  id: 'dsh-mattpocock-skills-deck',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let React = require('react')

    // ���� ��ʽ����̬�� styles.insert �ĵȼ����ݣ�����
    const STYLE_TEXT = [
      '.dsws-panel{position:fixed;left:16px;top:76px;width:460px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.45);z-index:9999;font-family:var(--dsw-font-family);font-size:13px;color:var(--dsw-alias-label-primary,#e6edf3);line-height:1.6;overflow:hidden}',
      '.dsws-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2d35);cursor:move;user-select:none}',
      '.dsws-tabs{display:flex;flex-wrap:nowrap;gap:4px;padding:8px 12px 0;overflow:hidden;white-space:nowrap}',
      '.dsws-tab{padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;white-space:nowrap;flex:none;line-height:1.5}',
      '.dsws-tab.on{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // v0.3 ����ʽ�۵�����ť�� data-priority ����۵���priority С=��Ҫ=���۵�����max-width ����ƽ������
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
      // v27��#396����������Ⱦ���ԡ�
      // ��ʷ��word-break:break-all + �� span �� .dsws-ellip{white-space:nowrap} ���³����ⱻ��Ĭʡ�ԺŽضϡ�
      // ���ڣ��� .dsws-tt-name ����ǿ�� break-all������ span �� .dsws-tt-wrap���滻 .dsws-ellip����
      //   ������ո�/���ı�㻻�У�hover ͨ������ title=... ������ʾ�����ı���
      '.dsws-tt-name{font-size:12.5px;display:flex;align-items:center;gap:5px}',
      '.dsws-tt-wrap{min-width:0;overflow-wrap:break-word;word-break:normal;line-break:auto;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dsws-tt-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-btn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);background:var(--dsw-alias-bg-layer-1,#10131a);color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;cursor:pointer}',
      '.dsws-btn:hover{border-color:var(--dsw-alias-border-l2,#3a3f4a)}',
      // ��ɫ��ť�̶����ⰲȫɫ���������� alias ��������ǰ�����»��������ɫ���ºڵ׺��֣�
      '.dsws-btn.primary{background:#c084fc;border-color:transparent;color:#140a1e;font-weight:600}',
      '.dsws-btn.primary:hover{border-color:rgba(20,10,30,.55)}',
      // v1.3.3��խ��ֻʣͼ��ʱ���ְ�ť�߶ȡ����������Σ���=��=��ť�ߣ���ͼ�����
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
      // ����2��2026-08-18�������ܸ������⻯������
      '.dsws-skillpop{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#3a3f4a) transparent}',
      '.dsws-skillpop::-webkit-scrollbar{width:8px}',
      '.dsws-skillpop::-webkit-scrollbar-track{background:transparent}',
      '.dsws-skillpop::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#3a3f4a);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
      '.dsws-skillpop::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-caption,#8b8b95);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
      '.dsws-seg{cursor:pointer;padding:2px 7px;border-radius:99px;border:1px solid transparent;display:inline-flex;align-items:center;gap:4px}',
      '.dsws-seg:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // ����1�����׶� rev��2026-08-18�������ӷָť ���� ���߿�/ϸ�ָ��� hover ʱ����ʾ���� seg ��פ͸��һ�£������Ұ���Ե���� + hover ���� seg ����
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
      // �������̶���λ���ȿ��98/99 5 �ַ���--/8 �ȿ��δ�� 9/10 ������
      '.dsws-num{display:inline-block;min-width:5ch;text-align:center;font-variant-numeric:tabular-nums;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:11px;line-height:1.5;white-space:nowrap}',
      // ���ҿ���������ݣ�fit-content ��ѹ�������У����޷ſ��
      // #372 �޸���2026-08-14 Ӣ��̬�������ԭ���� min(92vw,640px) ��Ӣ�ĳ��İ����硸Handoff �� new session�����´�����
      //   ���ݴӱ�����Ե������ſ�� min(96vw,1400px)��width:fit-content + margin:0 auto �� ����ʼ��
      //   ��״̬������Ϊ�����������������������������ݣ������ٽض�/�����
      // #16 �޸���2026-08-18 խ�����У���v15 ���� white-space:nowrap + flex:none + width:fit-content ��©�� flex-wrap:wrap��
      //   ���� < 920px ʱ������Ȼ�� > 96vw �� children ��ǿ�л��г���/���У��ƻ����о��й۸С�
      //   ��Ϊ flex-wrap:nowrap + white-space:nowrap ���ף�����ʼ�յ��С�
      //   ����·� 5 �� [data-narrow] ����ѡ������JSX �� renderStatusBar д data-narrow={dn||null}��
      //   ���ӿڿ������� children ���� span������ͼ��+���֣�children ȫ�� flex:none + nowrap ��ֹ���С�
      // #16 �û����շ�����2026-08-18 R2�������ҿ�Ӧ�������������ұߣ������ǰ��ӿ� 96vw �ţ�����
      //   max-width �ĳ� max-width:100% ����������������ܷⶥ������ max-width:1400px �������������
      //   ȥ�� margin:0 auto����� wrapper ������У���
      // #16 v1.6.3 ���Թ��ӣ��� v1.6.3 ��ʱ������¸��汾�Ƴ�����
      //   �� .dsws-capsule �� outline:2px dashed magenta + ��� wrapper outline:2px dashed cyan��
      // #16 v1.6.7 R7 �޸����û����շ��� 2026-08-18����magenta ��ԶС�� cyan ������û�����������롣
      //   ֮ǰ capsule width:fit-content �� Ĭ�ϰ�������Ȼ���Լ 700px����С�� wrapper 1300px�����к����Ҹ�300px�հס�
      //   ��Ϊ����ʽ��ȣ�dn=0 (���ӿ�) �� width:100% ���� wrapper�����ұ� = �������ߣ�
      //                  dn>=1 �� width:fit-content ��Ȼ����У��û�֮ǰ�ѽ��ܡ�dn=4 ʱ capsule ������������ B����
      //   max-width:min(100%,1400px) �Ա�������������������
      // #16 R10���û����շ��� 2026-08-18 R9 �󣩣�capsule ���ݿ� = textarea ���iw px������ capsule �Դ�
      //   padding:3px 6px + border:1px��CSS Ĭ�� content-box���� capsule border-box ��� = iw + 9 + 2 = iw + 11��
      //   �� textarea ���iw���� 11px�����Ҹ� 5.5px������Ϊ box-sizing:border-box���� capsule border-box = textarea ���
      // #16 R11���û����շ��� 2026-08-18 R10 �󣩣�capsule �̶��� = iw �� children ���к����ҿհ��� children ��С�����
      //   ��Ϊ CSS width:fit-content��Ĭ�� children ��Ȼ�����inline maxWidth:iw ��ֹ capsule ���������pixel ���� R10 �������
      '.dsws-capsule{max-width:min(100%,1400px);width:100%;box-sizing:border-box;display:flex;flex-wrap:nowrap;white-space:nowrap;justify-content:center;align-items:center;gap:2px 6px;background:var(--dsw-alias-bg-layer-1,#10131a);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:14px;padding:3px 6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);cursor:pointer;user-select:none}',
      // dn>=1 ʱ capsule �� fit-content ��Ȼ����У��û� B ������dn=4 �� capsule ��������
      '',
      '.dsws-capsule .dsws-capsule-word{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:99px;font-weight:600;color:var(--dsw-alias-label-primary,#e6edf3);flex:none}',
      '.dsws-capsule .dsws-capsule-word:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsws-capsule .dsws-seg{flex:none}',
      '.dsws-capsule .dsws-timebtn{flex:none}',
      // #16 V2��2026-08-18 ���ֺ�����ƣ���5 �� [data-narrow-N] ��ֵ��ϵ�нṹ�� bug����
      //   dn �ź�Դ R5 ���Ϊ��������wrapper�����Ĭ�� 1280 �ӿ����������� 812px �� dn=0 �������֣�
      //   ����Ĭ��ȱƷ���֣��� .dsws-seg.note ѡ�������ò����ڵ� class��seg() �ײ���ͼ�������� class����
      //   �������ֶΡ�����δ��Ч����Ϊ��������Ӧ������������ #15����
      //   ÿ������������ span �� data-fold-priority��1=�����ա�9=����գ���applyFold ��
      //   ȫչ�������ϰ� priority ��������� .dsws-folded��ֱ�� scrollWidth �� clientWidth��
      //   ���ȼ� = ��Ϣ��ֵ��Ʒ��(1) �� ����(2)/����(3)/ˢ����(4) �� �ɽ�(5)/BUG(6)/���(7)/����(8) �� ʱ��(9)��
      //   ͼ��+����������������խ̬ = ͼ��+���ֽ������wrapper overflow:hidden ����Ե����ֹ���У���
      '.dsws-capsule [data-fold-priority].dsws-folded{display:none}',
      '.dsws-banner{display:flex;align-items:center;gap:8px;border-radius:8px;padding:6px 10px;font-size:12px;margin:6px 0;cursor:pointer}',
      '.dsws-banner.bad{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.45);color:#f87171}',
      '.dsws-banner.warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);color:#fbbf24}',
      '.dsws-banner.ok{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.35);color:#4ade80}',
      // v1.3.3 UI �޸���aggrow �ֺ������ӿ飨��1 idcol+����+Բ�� / ��2 ��ǩ+��ť������������ѵ�
      // v1.3.3�����Ԥ��հ׼� 20%��8px �� 6.4px��map ��/��ͨ��һ�¸���գ�
      '.dsws-aggrow{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:6px 6.4px;border-radius:6px;border:1px solid transparent}',
      '.dsws-aggrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // v1.3.3 UI��������ť������/���������ԣ��û�Ҫ��һֱ��ʾ���� hover��
      '.dsws-aggrow .dsws-aux{display:inline-flex;align-items:center;gap:2px;flex:none}',
      // v1.3.3 UI����2 ��ǩ̰���۵������в����У����խ�٣�+N ����չ����
      '.dsws-tags{display:flex;align-items:center;gap:3px;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap}',
      '.dsws-tags .dsws-chip{flex:none}',
      // v1.3.3��+N չ������������С 20%��padding 8��6px �� font 11��9px �� line-height 1.7��1.8��
      '.dsws-more{background:rgba(188,140,255,.1);color:#bc8cff;border:1px dashed rgba(188,140,255,.55);cursor:pointer;flex:none;transition:background .12s,border-color .12s;padding:0 6px;font-size:9px;line-height:1.8}',
      '.dsws-more:hover{background:rgba(188,140,255,.22);border-color:rgba(188,140,255,.8)}',
      // v1.3.3 UI����1 ��� + map �������ţ������ø���չʾ����
      '.dsws-idcol{display:flex;flex-direction:column;align-items:flex-start;gap:3px;flex:none}',
      '.dsws-idnum{display:inline-block;font-family:Consolas,Menlo,monospace;font-weight:700;font-size:11px;line-height:1.4;padding:2px 7px;border-radius:6px;border:1px solid;font-variant-numeric:tabular-nums}',
      // v1.3.3 UI��map ������Բ�����ȣ�������� + ?��
      '.dsws-ring{flex:none;display:inline-flex;align-items:center;gap:0}',
      '.dsws-ring svg{transform:rotate(-90deg)}',
      // v1.3.3 �����޸���Բ�����������϶��gap 0 + �ı�������������
      //   �ı��̶���С��ȣ�5 �ַ��� 26/27���� ������Ե���룻
      //   v1.3.3 ΢����min-width 38 �� 35px��26/27 �Ҳ��϶���룩
      '.dsws-ring-txt{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.5;flex:none;letter-spacing:.2px;min-width:35px;text-align:left}',
      // v1.3.3 UI��+N ������fixed ��λ������Ӧ������ұ߽磩
      '.dsws-pop{position:fixed;z-index:1000;background:#1c1f26;border:1px solid var(--dsw-alias-border-l2,#3a3f4a);border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.55);padding:10px 12px;display:none}',
      '.dsws-pop .caret{position:absolute;width:10px;height:10px;background:#1c1f26;border-left:1px solid var(--dsw-alias-border-l2,#3a3f4a);border-top:1px solid var(--dsw-alias-border-l2,#3a3f4a);transform:rotate(45deg)}',
      '.dsws-pop .pt{font-size:10px;color:var(--dsw-alias-label-caption,#8b8b95);letter-spacing:1px;margin-bottom:6px;text-transform:uppercase}',
      '.dsws-pop .pl{display:flex;flex-wrap:wrap;gap:4px}',
      '.dsws-pop .ptitle{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#2a2d35);padding-top:7px;line-height:1.55;overflow-wrap:break-word;word-break:break-word}',
      '.dsws-pop .ptitle b{color:var(--dsw-alias-label-primary,#e6edf3);font-weight:600}',
      // v1.4��T2 #443����Map ����ҳ©���ֲ���̬��D1-D8 ���
      '.dsws-layers{display:flex;flex-direction:column;gap:4px;margin:10px 0;padding:8px 10px;border-radius:10px;background:linear-gradient(90deg,rgba(74,222,128,.05),rgba(255,255,255,.015));border:1px solid rgba(74,222,128,.2)}',
      '.dsws-layers .row1{display:flex;align-items:center;gap:8px}',
      '.dsws-layers .cap{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);letter-spacing:.5px;text-transform:uppercase;flex:none}',
      '.dsws-layers .segs{flex:1;display:flex;gap:3px;height:12px}',
      '.dsws-layers .seg{flex:1;border-radius:3px;position:relative;background:rgba(255,255,255,.06);border:1px dashed rgba(255,255,255,.14)}',
      '.dsws-layers .seg.past{background:linear-gradient(180deg,rgba(74,222,128,.7),rgba(74,222,128,.4));border:none}',
      '.dsws-layers .seg.past::after{content:"?";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:7px;color:#04120a;font-weight:700}',
      '.dsws-layers .seg.curr{background:linear-gradient(180deg,#4ade80,#2dd45f);border:none;box-shadow:0 0 8px rgba(74,222,128,.5)}',
      '.dsws-layers .row2{display:flex;justify-content:space-between;font-size:8.5px;color:var(--dsw-alias-label-caption,#8b8b95);align-items:center}',
      '.dsws-layers .row2 .cur{color:#4ade80;font-weight:700;display:inline-flex;align-items:center;gap:4px}',
      '.dsws-start{display:flex;gap:8px;align-items:flex-start;margin:6px 0 2px}',
      '.dsws-start .cap{font-size:13px;font-weight:700;color:#fff;line-height:1.1}',
      '.dsws-start .desc{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);font-style:italic;line-height:1.3}',
      // T15�������� + ���Բ�ţ���ǰ���������������������Ӧ��������Ƭ�߶Ⱥ㶨
      '.dsws-layerbox{border-radius:12px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.008));padding:8px 10px 10px;margin-top:6px}',
      '.dsws-layerbox.cur{border-color:rgba(74,222,128,.5);box-shadow:0 0 16px rgba(74,222,128,.14);background:linear-gradient(180deg,rgba(74,222,128,.05),rgba(255,255,255,.008))}',
      '.dsws-layerTag{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary,#e6edf3);letter-spacing:.5px;margin:0 0 8px}',
      '.dsws-layerTag .layerNo{width:22px;height:22px;flex:none;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);background:rgba(255,255,255,.08);border:1.5px solid var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-secondary,#a1a1aa);font-variant-numeric:tabular-nums}',
      '.dsws-layerbox.cur .dsws-layerNo{background:rgba(74,222,128,.16);border-color:rgba(74,222,128,.7);color:#4ade80}',
      '.dsws-layerTag .layerTitle{flex:none}',
      '.dsws-layerTag .sp{flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l1,#2a2d35),transparent)}',
      // T15���������� ���� ��ȱ���Զ����У�minmax 190px ��֤��խ ��1 �У������ٺ������
      '.dsws-layer{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;padding:0 0 2px}',
      // խ��壨<380px���п����޽��� 150px���Ա�֤ ��1 ��
      '.dsws-narrow .dsws-layer{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}',
      // T15����Ƭ����������������ٹ̶� 200px�����ڲ��й̶�ռλ��֤�߶Ⱥ㶨
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
      // v1.4 �޸���rotate(-90deg) ֻ�����ڽ��Ȼ� svg��ֱ����Ԫ�أ��������� core ���ģ����ı�����ֱ��
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
      // v1.5 T10 R7��ˢ�������ѷϳ����ֶ�ˢ���߾�Ĭ·������spinner ���׿� loading ��
      '.dsws-spinner{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#c084fc;animation:dsws-spin .8s linear infinite;flex:none}',
      '@keyframes dsws-spin{to{transform:rotate(360deg)}}',
      // v1.5 T10��ˢ����ڰ�ť����תȦ������������ �� R7 �����룩+ R5 �仯�и�����������꽥�� / ����������
      '.dsws-spin{display:inline-flex;animation:dsws-spin .8s linear infinite}',
      '@keyframes dsws-flash-amber{0%{background-color:rgba(251,191,36,.20)}100%{background-color:transparent}}',
      '@keyframes dsws-flash-green{0%{background-color:rgba(74,222,128,.20)}100%{background-color:transparent}}',
      '.dsws-row-changed{animation:dsws-flash-amber 2.4s ease-out 1}',
      '.dsws-row-added{animation:dsws-flash-green 2.4s ease-out 1}',
      // v25 �� T2b������ҳ��settings.plugins.tab��ר����ʽ
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
      // T2 #35 �� �޲ֿ�쿨��ListTab ���������ȣ��� ��ʽ���� dsws-banner bad �Ӿ�����
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
    ].join('')

    exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions']

    exports.apply = function (ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const timer = ctx.get('timer')
      const h = React.createElement
      // issue #3������Ҷ��� ���� createPortal �� document.body���� position:fixed ���ӿ�������
      //   z-index ����ȫ����Ч������������������� transform / filter / backdrop-filter /
      //   will-change / contain��fixed �İ�����ή��Ϊ�����ȣ�����ƫ�� + �� overflow �ü����
      //   �����Ǽ��� tooltip ���ڵ�/�ضϵĸ���ȡ���� react-dom ʱ�˻�Ϊԭ����Ⱦ����������״����
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
      // v1.3.3�����汾�ţ�tabs �����Ҳ���ʾ�����ں˶��Ѹ��£�
      // issue #22����������ͳһ�ҵ� body�����ⱻ״̬������ wrapper �ü��
      const PortalOverlay = function (props, children) {
        return portalTop(h('div', props || {}, children))
      }
      const DSW_VERSION = 'v1.6.15'

      // ��ʽע�루��̬���û�� styles.insert builtin���ֶ� <style> + ctx.effect �����
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin', 'dsh-mattpocock-skills-deck')
      styleEl.textContent = STYLE_TEXT
      document.head.appendChild(styleEl)
      ctx.effect(function () {
        return function () {
          try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* ���������ڴ��� */ }
        }
      }, 'dsh-mattpocock-skills-deck: styles')

      // RPC �����connection.rpc.call('/dsws', endpoint, args) �� RpcResult ���
      const conn = ctx.get('connection')
      const rpcCall = async function (endpoint, args) {
        if (conn === undefined || conn.rpc === undefined) throw new Error('connection ���񲻿���')
        const res = await conn.rpc.call('/dsws', endpoint, args)
        if (res && res.ok) return res.value
        throw new Error((res && res.error && res.error.message) || ('RPC ʧ�ܣ�' + endpoint))
      }
      // timer ���ף�client ���񲻿���ʱ setTimeout��
      const later = function (fn, ms) {
        if (timer !== undefined && timer.timeout) return timer.timeout(fn, ms)
        return setTimeout(fn, ms)
      }

      // ============================================================
      // 0.5 locale��T3 #366 �� dsws �����ռ� zh/en������ harness ���ԣ�GitHub ���ݲ����룩
      // ��Լ��ctx.locale��dsh-client-locale����register(ns, {zh, en}) + bind(ns) �ȶ����ã�����ʱ����ǰ���ԣ�
      // ���� outlet �� locale �л�ʱ�Զ�����Ⱦ��useLocaleRevision����ģ�鼶 t ������Ч��
      // ģ��Ĭ���ı���GUIDE_LINE/FIXATE_PROMPT/TPL_DEFAULT��= ע�����ݶ��ǿؼ��İ��������루T3 ���ߣ���
      // ============================================================
      const L = {
        zh: {
          'nav.word': '����',
          'nav.takeable': '�ɽ�',
          'nav.occupied': '����',
          'nav.env': '����',
          'nav.envTitle': '������� ({n}/{t})',
          'panel.title': 'MattSkills',
          'nav.takeableTitle': '�ɽ� = δ�����ִ�е�������',
          'nav.occupiedTitle': '���� = ������δ�رյ�������',
          'nav.bug': 'BUG',
          'nav.bugTitle': '���ˣ�open + bug ��ǩ',
          'nav.bugNew': '����',
          'nav.bugNewTitle': '�»Ự�д� /wayfinder ���� BUG �� prompt',
          'nav.triage': '���',
          'nav.triageTitle': '���ˣ�open + needs-triage ��ǩ',
          'nav.refresh': '����',
          'nav.refreshing': '�����С�',
          'nav.refreshTitle': '���¼�� + ˢ�¿���',
          'nav.fixateTitle': '������ȿ��� �� ע���㶪ʧ prompt',
          'nav.handoff': '����',
          'nav.handoffReady': '���Ӹ��»Ự',
          'nav.handoffTitle': '���ӣ����� /handoff ���ɽ����ĵ�',
          'nav.handoffReadyTitle': '���»Ự��Ԥ����ĵ�·��',
          'nav.handoffGreyTitle': '��δ���ɽ����ĵ����ȵ㡸���ӡ�����',
          'nav.skillsTitle': '�����׼������չ�������б��������������뵱ǰ�Ự',
          'nav.skillHint': '��������� �� ���뵽��ǰ�Ự',
          'banner.setup': 'setup δִ��',
          'banner.skills': 'δ��⵽���ļ����׼���wayfinder / triage / grilling / grill-me / implement / ask-matt �ȣ���{list}����װ�����ʹ��ȫ���̹��ܡ�',
          'banner.skillsBtn': '���Ұ�װ Matt �����׼�',
          'banner.setupBtn': '����ִ�� /setup-matt-pocock-skills',
          'banner.ghcli': 'δ��װ GitHub CLI ���� ����������ݶ����� gh�����Ȱ�װ',
          'banner.ghcliBtn': '�򿪰�װҳ',
          'banner.ghauth': 'δ��¼ GitHub ���� ���� gh auth login���������Ȩ������ʹ��',
          'banner.ghauthBtn': '�鿴��¼ָ��',
          'env.installBtn': '��װ����',
          'env.guide': '�������� �� ��˳�����',
          'env.g1': '��װ GitHub CLI',
          'env.g2': '��¼ GitHub',
          'env.g3': '���� setup ��ʼ����ѡ GitHub tracker��',
          'env.g4': '��װ Matt skills �����׼�',
          'act.diagnose': '���',
          'act.fix': '�޸�',
          'act.discuss': '����',
          'act.execute': 'ִ��',
          'act.view': '�鿴',
          'act.load': '����',
          'act.done': '���',
          'type.research': '�о�',
          'type.prototype': 'ԭ��',
          'type.grilling': '����',
          'type.task': '����',
          'list.back': '�����б�',
          'list.mapChip': '��ͼ',
          'list.loadFail': '����ʧ��',
          'list.noDest': '��δ��д Destination��',
          'list.noNotes': '��δ��д Notes��',
          'list.kpi.takeable': '�ɽ�',
          'list.kpi.occupied': '����',
          'list.kpi.closed': '�ѹر�',
          'list.refresh': 'ˢ��',
          'list.refreshing': 'ˢ���С�',
          'list.envWarn': '{n} ���δ��������˲鿴',
          'list.all': 'ȫ��',
          'list.loading': '�����С�',
          'list.errFull': '���ռ���ʧ�ܣ�{err}',
          'list.restFallback': '? GraphQL ����Ѻľ������л� REST ͨ�������ݿ����Ծɣ����ָ����Զ����У�',
          'list.none': '����',
          'list.closedN': '�ѹر� {n}',
          'list.collapse': '����',
          'list.blocked': '������',
          'list.blockedTitle': '�� {by} ����������鿴��ͼ���飩',
          'list.tagsTitle': 'ȫ����ǩ��{names}�����չ����',
          'list.tagsCount': 'ȫ����ǩ �� {n} ��',
          'list.popTitle': '����',
          'cfg.previewTitle': 'ʾ�� issue ����',
          'list.tagsCollapseTitle': '�����ǩ',
          'list.copyLinkTitle': '��������',
          'list.openInGithubTitle': '�� GitHub �ϲ鿴 #{n}',
          'list.mapTitle': '�鿴��ͼ����',
          'list.state.all': 'ȫ��', 'list.state.open': 'Open', 'list.state.closed': '�ѹر�', 'list.state.blocked': '����', 'list.state.frontier': '�ɽ�',
          'list.filterActive': '��ǰ���ˣ�', 'list.filterClear': '���ȫ��',
          'list.sort.updatedAt': '����', 'list.sort.createdAt': '����', 'list.sort.number': '���', 'list.sort.title': '����',
          'map.decisions': 'Decisions so far��{n}��',
          'map.fog': 'Not yet specified��ս�� {n}��',
          'map.outOfScope': 'Out of scope��{n}��',
          'map.grpTakeable': '�ɽ� {n}',
          'map.grpClaimed': '������ {n}',
          'map.grpBlocked': '������ {n}',
          'map.grpClosed': '�ѹر� {n}',
          'map.layer': '�� {n}',
          'map.progressCap': '��ͼ����',
          'map.curLayer': '��ǰ���� {n}',
          'map.layersPassed': '{n}/{t} ����ͨ��',
          'map.notesCap': '��������',
          'map.startCap': 'Start',
          'map.destCap': 'Destination',
          'map.startBtn': '��ʼ #{n}',
          'map.archive': '����',
          'map.subClaimed': '������ {who}',
          'map.subBlocked': '��������{who}',
          'map.subClosed': '�ѹر�',
          'map.executeTitle': 'ִ�� �� ע���ͼ��ʼ��ʾ��',
          'map.doneTitle': '��� �� ע����βȷ�� prompt',
          'skill.centerRing': '���� = �Ƽ� �� ���� = ��أ�ʵ����װ/����δװ���� ���ע�� /skill',
          'skill.centerTitle': '�Ƽ� {skill} �� ע�� /{skill}',
          'skill.all': 'ȫ������',
          'skill.generic': 'ͨ�ý���',
          'skill.notes': '��{m}��Notes ָ��',
          'skill.treat': '�� /{s} ����',
          'skill.list': '�б�',
          'skill.ring': 'Բ��',
          'env.title': '������� {n}',
          'env.recheck': '���¼��',
          'env.checking': '����С�',
          'env.missing': 'ȱʧ',
          'env.partial': '���־���',
          'env.ready': '����',
          'env.failFull': '�������ʧ�ܣ�{err}',
          'env.detecting': '����С�',
          'env.missingBanner': '{n} ��ȱʧ���Ȳ����ٿ�ʼ wayfinder ����',
          'env.openUrl': '����ַ',
          'env.copyUrl': '������ַ',
          'panel.snapErr': '�����쳣',
          'panel.loading': '�����С�',
          'panel.tabList': '�б�',
          'panel.tabSkills': '����',
          'panel.tabChecks': '�������',
          'panel.refreshing': 'ˢ���С�',
          'panel.closeTitle': '�ر����',
          'rz.n': '���ϱ� = �Ӹ����', 'rz.s': '���±� = �Ӹ����', 'rz.e': '���ұ� = �ӿ����', 'rz.w': '����� = �ӿ����',
          'rz.ne': '���Ͻ�����', 'rz.nw': '���Ͻ�����', 'rz.se': '���½�����', 'rz.sw': '���½�����',
          'toast.injectedHandoff': '��ע�� /handoff ����ģ�壨��ʱ����ļ�������ȷ�Ϻ���',
          'toast.copiedHandoff': '�Ѹ��ƽ����ĵ�ָ��',
          'toast.copiedHandoffFile': '�Ѹ��ƽ����ĵ�ָ�{file}',
          'toast.handoffGrey': '���ȵ㡸���ӡ����ɽ����ĵ�',
          'toast.injected': '��ע�������ȷ�Ϻ���',
          'toast.copiedFallback': '�Ѹ��Ƶ������壨����򲻿��ã����ף�',
          'toast.copied': '�Ѹ���',
          'toast.copyFailed': '����ʧ�ܣ����ֶ�����',
          'toast.clipboardUnavailable': '�����岻����',
          'toast.snapFail': '����ˢ��ʧ�ܣ�{err}',
          'toast.copiedLink': '�Ѹ������� #{n}',
          'toast.newSessionOpened': '�����»Ự�д򿪲�Ԥ��ָ�ͬ cwd��',
          'toast.newSessionManual': '���ֶ��½��Ự������Ϊ��{title}����ָ����Ԥ�ǰ�����',
          'toast.resetPanelWidthDone': '����������� �� �´δ���Ч',
          'toast.resetPanelWidthFail': 'layout �����ݲ�֧������ �� ����� DSH harness',
          // #394���»Ự��ť�ɼ����� + hover title��ȥ������ detail���� #361 doc + ��Ϊ������ͣ�
          'list.newSessionLabel': '�»Ự',
          'panel.newWayfinder': '+ ����',
          'panel.newWayfinderTitle': '�»Ự�д� /wayfinder �������� prompt���̳е�ǰ��������',
          'panel.newBug': '+ bug',
          'panel.newBugTitle': '�»Ự�д� /wayfinder ���� BUG �� prompt���̳е�ǰ��������',
          'panel.diffRemoved': '{n} ���ѹر�/�Ƴ�',
          'panel.repoTitle': '��ǰ�ֿ⣬����� GitHub',
          'panel.noRepo': 'û�вֿ�',
          'panel.noRepoTitle': '��ǰ���������� Git �ֿ� ���� ���� git init �����ֿ�Ŀ¼',
          'panel.noRepoCardTitle': '��ǰ���������� Git �ֿ� �� ��˳�ʼ��������',
          'panel.noRepoCardDesc': '���������� GitHub �ֿⲢ����',
          'panel.noRepoCardAction': '����������',
          'panel.noRepoCardDismiss': '����',
          'panel.noRepoCardDone': '������������ �� �л��� ListTab ���',
          'panel.noRepoFormName': '�ֿ���',
          'panel.noRepoFormNameHint': '��֧����ĸ�����֡�._- �� ��100',
          'panel.noRepoFormVisibility': '�ɼ���',
          'panel.noRepoFormPublic': '����',
          'panel.noRepoFormPrivate': '˽��',
          'panel.noRepoFormSubmit': '����������',
          'panel.noRepoFormCancel': 'ȡ��',
          'panel.noRepoFormSubmitting': '�����С�',
          'panel.noRepoErr.bad-name': '�ֿ�����֧����ĸ/����/._- �� ��100',
          'panel.noRepoErr.no-git': 'δ�ҵ� git�����Ȱ�װ Git',
          'panel.noRepoErr.no-gh': 'δ�ҵ� gh�����Ȱ�װ GitHub CLI',
          'panel.noRepoErr.not-logged-in': 'δ��¼ GitHub������ִ�� gh auth login',
          'panel.noRepoErr.already-exists': 'ͬ���ֿ��Ѵ��ڣ�ȥ GitHub �鿴',
          'panel.noRepoErr.network': '�����쳣��������',
          'panel.noRepoErr.permission': 'Ȩ�޲��㣬�����¼�˺�',
          'panel.noRepoErr.unknown': '����ʧ�ܣ���鿴��������',
          'panel.noRepoErr.git-commit-failed': 'Git �ύʧ��',
          'panel.noRepoReset': '���ú���',
          'panel.noRepoCreateSuccess': '�Ѵ��� {repo}',
          'map.newSessionTitle': '���»Ự�򿪣��ƽ��� map��',
          'progress.todo': 'δ����', 'progress.doing': '������ {n}%', 'progress.confirm': '95% �� ��ȷ��', 'progress.accept': '100% �� ������', 'progress.done': '���',
          'err.hostUnavailable': 'host.call �����ã�Host ��δ���أ�',
          'err.connUnavailable': 'connection ���񲻿��ã�Host ��δ���أ�',
          'err.statusEmpty': 'wf.status ���ؿս��',
          'err.snapshotEmpty': 'wf.snapshot �����쳣',
          'cfg.status': '����',
          'cfg.saved': '�ѱ���',
          'cfg.sub': '��������붯����ʾ�ʣ���̬�ı������ɱ༭��ռλ����ϵͳע����ֵ��������ɲ��롣',
          'matte.title': 'Matt Pocock ���ܼ�',
          'matte.desc': '�������� + ͨ������� AI agent ���ܼ���wayfinder / triage / grilling / handoff �� 25 �����ļ��ܣ�',
          'matte.openRepo': '�� GitHub',
          'matte.copyPrompt': '���ư�װ prompt',
          'cfg.openIn': '��λ��',
          'cfg.openInDesc': '������ĸ�����򿪡�better-sidebar �Ѱ�װʱĬ�ϲ������������Сʱ��������ȡ�',
          'cfg.openInLabel': '��λ��',
          'cfg.openInDock': 'ͣ����',
          'cfg.openInSidebar': '�����',
          'cfg.openInHint': '�Ѽ�ʱ��Ч���´δ����ʱ����λ�ô�',
          'cfg.panelWidth': '�����',
          'cfg.resetPanelWidth': '���������',
          'cfg.resetPanelWidthDesc': '�´δ����ʱʹ�� layout ����Ĭ�Ͽ�ȣ�����ϴε���ק���䣩',
          'cfg.startTpl': '��ʼģ�壨ִ�ж�����',
          'cfg.startTplDesc': '��ִ�С���ťע�����ʾ�ʣ����ʹ��Ĭ��ģ�塣',
          'cfg.withPrefix': '�� /wayfinder ǰ׺',
          'cfg.tplEditor': '����ģ��༭��',
          'cfg.tplEditorDesc': '��ִ�С��������������ťע�����ʾ�ʡ�����·�ռλ�����뵽��괦����ɫ�����ռλ��ɾ�����޷����档',
          'cfg.execHint': '��ִ�С�ģ���ڿ�ʼģ��ڱ༭ ��',
          'cfg.saveRejected': '���汻�ܾ�',
          'cfg.saveAll': '����ȫ��',
          'cfg.resetAll': '�ָ�ȫ��Ĭ��',
          'cfg.reset': '�ָ�Ĭ��',
          'cfg.preview': 'Ч��Ԥ��',
          'cfg.must': '����',
          'cfg.chipReq': '����ռλ����ɾ�����޷�����',
          'cfg.chipInsert': '������뵽��괦',
          'tpl.missing': 'ȱ��ǿ��ռλ�� {list}',
          'tpl.unknown': 'δ֪ռλ�� {list}',
          'tpl.name.diagnose': '���', 'tpl.name.fix': '�޸�', 'tpl.name.discuss': '����',
          'tpl.name.handoff1': '���ӵ�һ��', 'tpl.name.handoff2': '���ӵڶ���', 'tpl.name.fixate': '����',
          'tpl.desc.diagnose': 'needs-triage Ʊ���м�����',
          'tpl.desc.fix': 'bug Ʊ���м�����',
          'tpl.desc.discuss': 'wayfinder:grilling Ʊ���м�����',
          'tpl.desc.handoff1': '���ɽ����ĵ�����ʱ����������ļ���һ�£�',
          'tpl.desc.handoff2': '��ȡ�����ĵ�',
          'tpl.desc.fixate': '�㶪ʧ���� prompt',
          'run.loaded': '�Ѽ���',
          'run.desc': '������飨wf.status��+ ��壨wf.snapshot�����ѽ��档',
          'run.openPanel': '�����',
          'run.openCfg': '������',
          'run.cfgGuide': '����ҳ������ �� ��� �� MattSkills',
          'skilldesc.ask-matt': '����·��������֪�������ĸ� skill ʱ����',
          'skilldesc.setup-matt-pocock-skills': '�ֿ��ʼ����issue tracker / ��ǩ / �ĵ�·��',
          'skilldesc.wayfinder': 'Ϊ��������Ŀ�����ߵ�ͼ����Ʊ���',
          'skilldesc.triage': 'issue �������������֤��׷�ʣ�ֱ�� ready-for-agent',
          'skilldesc.grilling': '�����İ�ǰ����׷�ʳ��壬ֱ��������',
          'skilldesc.domain-modeling': '������������ô��� / �ĵ� / �Ի���ͬһ�״�',
          'skilldesc.research': '��̨���У�д�� repo �� markdown ����Դ',
          'skilldesc.prototype': 'һ����ԭ�ͻش��������',
          'skilldesc.implement': '�ѹ���ĵ���ɴ�����������ʵ��',
          'skilldesc.code-review': '���ֿ�淶 + ԭ���˫�������ĸĶ�',
          'skilldesc.codebase-design': 'Ϊ������������ģ��߽���ӿ�',
          'skilldesc.diagnosing-bugs': 'Ӳ bug / ���ܻع飺��λ���������֤��ѭ������',
          'skilldesc.improve-codebase-architecture': 'ɨ������������ᣬ��� HTML ����',
          'skilldesc.tdd': '����������������дʧ�ܲ��ԣ���д��Сʵ��',
          'skilldesc.handoff': '�ѵ�ǰ�Ի�ѹ���ɽ����ĵ�',
          'skilldesc.teach': '�� session �����¼���',
          'skilldesc.to-spec': '����ɢ���۹̻��ɿ�ִ�еĹ���ĵ�',
          'skilldesc.to-tickets': '�ѹ���� tickets',
          'skilldesc.resolving-merge-conflicts': '����ϲ���ͻ',
          'skilldesc.writing-great-skills': 'Ϊ AI д���ɸ��á��ɲ��Եļ�������',
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
          'nav.refreshing': 'Updating��',
          'nav.refreshTitle': 'Re-check + refresh snapshot',
          'nav.fixateTitle': 'Save a snapshot �� inject the zero-loss prompt',
          'nav.handoff': 'Handoff',
          'nav.handoffReady': 'Handoff �� new session',
          'nav.handoffTitle': 'Handoff: send /handoff to generate the handoff doc',
          'nav.handoffReadyTitle': 'Open a new session with the handoff doc path prefilled',
          'nav.handoffGreyTitle': 'No handoff doc yet �� click Handoff first to generate one',
          'nav.skillsTitle': 'Skill suite: expand the skill list; click a skill to insert it into this session',
          'nav.skillHint': 'Click a skill to insert it into this session',
          'banner.setup': 'setup not run yet',
          'banner.skills': 'Core skill suite missing (wayfinder / triage / grilling / grill-me / implement / ask-matt ��): {list}. Install them to use the full workflow.',
          'banner.skillsBtn': 'Install the Matt skill suite for me',
          'banner.setupBtn': 'Run /setup-matt-pocock-skills for me',
          'banner.ghcli': 'GitHub CLI not installed �� all panel data depends on gh, install it first',
          'banner.ghcliBtn': 'Open install page',
          'banner.ghauth': 'Not signed in to GitHub �� run gh auth login (browser auth) first',
          'banner.ghauthBtn': 'View sign-in guide',
          'env.installBtn': 'Install guide',
          'env.guide': 'Setup guide �� complete in order',
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
          'list.refreshing': 'Refreshing��',
          'list.envWarn': '{n} check(s) not ready �� click to view',
          'list.all': 'All',
          'list.loading': 'Loading��',
          'list.errFull': 'Snapshot failed: {err}',
          'list.restFallback': '? GraphQL quota exhausted �� switched to REST channel (data may be slightly stale; auto-reverts when quota resets)',
          'list.none': 'None',
          'list.closedN': 'Closed {n}',
          'list.collapse': 'Collapse',
          'list.blocked': 'Blocked',
          'list.blockedTitle': 'Blocked by {by} (click for map details)',
          'list.tagsTitle': 'All labels: {names} (click to expand)',
          'list.tagsCount': 'All labels �� {n}',
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
          'map.executeTitle': 'Execute �� inject the map\'s start prompt',
          'map.doneTitle': 'Complete �� inject the wrap-up confirmation prompt',
          'skill.centerRing': 'Center = recommended �� Ring = related (filled = installed / hollow = not) �� click to inject /skill',
          'skill.centerTitle': 'Recommended {skill} �� click to inject /{skill}',
          'skill.all': 'All skills',
          'skill.generic': 'General suggestion',
          'skill.notes': 'Specified by "{m}" Notes',
          'skill.treat': 'Handle with /{s}',
          'skill.list': 'List',
          'skill.ring': 'Ring',
          'env.title': 'Environment checks {n}',
          'env.recheck': 'Re-check',
          'env.checking': 'Checking��',
          'env.missing': 'Missing',
          'env.partial': 'Partial',
          'env.ready': 'Ready',
          'env.failFull': 'Environment check failed: {err}',
          'env.detecting': 'Detecting��',
          'env.missingBanner': '{n} missing �� fix them before starting wayfinder work',
          'env.openUrl': 'Open URL',
          'env.copyUrl': 'Copy URL',
          'panel.snapErr': 'Snapshot error',
          'panel.loading': 'Loading��',
          'panel.tabList': 'List',
          'panel.tabSkills': 'Skills',
          'panel.tabChecks': 'Checks',
          'panel.refreshing': 'Refreshing��',
          'panel.closeTitle': 'Close panel',
          'rz.n': 'Drag the top edge up = grow taller', 'rz.s': 'Drag the bottom edge down = grow taller', 'rz.e': 'Drag the right edge right = grow wider', 'rz.w': 'Drag the left edge left = grow wider',
          'rz.ne': 'Resize NE', 'rz.nw': 'Resize NW', 'rz.se': 'Resize SE', 'rz.sw': 'Resize SW',
          'toast.injectedHandoff': '/handoff template injected (timestamped filename) �� confirm before sending',
          'toast.copiedHandoff': 'Handoff command copied',
          'toast.copiedHandoffFile': 'Handoff command copied: {file}',
          'toast.handoffGrey': 'Click Handoff first to generate the handoff doc',
          'toast.injected': 'Injected into the input box �� confirm before sending',
          'toast.copiedFallback': 'Copied to clipboard (input box unavailable)',
          'toast.copied': 'Copied',
          'toast.copyFailed': 'Copy failed �� copy manually',
          'toast.clipboardUnavailable': 'Clipboard unavailable',
          'toast.snapFail': 'Snapshot refresh failed: {err}',
          'toast.copiedLink': 'Link # {n} copied',
          'toast.newSessionOpened': 'Opened in a new session with the prompt prefilled (same cwd)',
          'toast.newSessionManual': 'Please create a new session manually and name it "{title}"; the prompt is prefilled in the current input',
          'toast.resetPanelWidthDone': 'Panel width reset �� takes effect on next open',
          'toast.resetPanelWidthFail': 'Layout service doesn\'t support reset yet �� please update DSH harness',
          // #394��visible label + hover title for new-session button
          'list.newSessionLabel': 'New session',
          'panel.newWayfinder': '+ Requirement',
          'panel.newWayfinderTitle': 'Open a /wayfinder new-requirement prompt in a new session (same workspace)',
          'panel.newBug': '+ BUG',
          'panel.newBugTitle': 'Open a /wayfinder new-BUG prompt in a new session (same workspace)',
          'panel.diffRemoved': '{n} closed/removed',
          'panel.repoTitle': 'Current repo �� open on GitHub',
          'panel.noRepo': 'No repo',
          'panel.noRepoTitle': 'Current workspace is not a Git repo �� run git init or open a repo directory',
          'panel.noRepoCardTitle': 'Current workspace is not a Git repo �� click to init and publish',
          'panel.noRepoCardDesc': 'Turn this workspace into a GitHub repo and publish it',
          'panel.noRepoCardAction': 'Create and publish',
          'panel.noRepoCardDismiss': 'Ignore',
          'panel.noRepoCardDone': 'Already guided on first screen �� switch to ListTab',
          'panel.noRepoFormName': 'Repository name',
          'panel.noRepoFormNameHint': 'Letters, digits, ._- only �� ��100',
          'panel.noRepoFormVisibility': 'Visibility',
          'panel.noRepoFormPublic': 'Public',
          'panel.noRepoFormPrivate': 'Private',
          'panel.noRepoFormSubmit': 'Create and publish',
          'panel.noRepoFormCancel': 'Cancel',
          'panel.noRepoFormSubmitting': 'Creating��',
          'panel.noRepoErr.bad-name': 'Name supports only letters/digits/._- ��100',
          'panel.noRepoErr.no-git': 'git not found �� please install Git',
          'panel.noRepoErr.no-gh': 'gh not found �� please install GitHub CLI',
          'panel.noRepoErr.not-logged-in': 'Not logged into GitHub �� run gh auth login',
          'panel.noRepoErr.already-exists': 'Repository already exists �� view on GitHub',
          'panel.noRepoErr.network': 'Network error �� please retry',
          'panel.noRepoErr.permission': 'Permission denied �� check login account',
          'panel.noRepoErr.unknown': 'Creation failed �� see error details',
          'panel.noRepoErr.git-commit-failed': 'Git commit failed',
          'panel.noRepoReset': 'Reset ignore',
          'panel.noRepoCreateSuccess': 'Created {repo}',
          'map.newSessionTitle': 'Open in a new session (advance this map)',
          'progress.todo': 'Not started', 'progress.doing': 'In progress {n}%', 'progress.confirm': '95% �� confirming', 'progress.accept': '100% �� acceptance', 'progress.done': 'Done',
          'err.hostUnavailable': 'host.call unavailable (host half not loaded)',
          'err.connUnavailable': 'connection service unavailable (host half not loaded)',
          'err.statusEmpty': 'wf.status returned an empty result',
          'err.snapshotEmpty': 'wf.snapshot returned an error',
          'cfg.status': 'Config',
          'cfg.saved': 'Saved',
          'cfg.sub': 'Configure the panel and action prompts: static text is freely editable; placeholders are filled in by the system �� click to insert.',
          'matte.title': 'Matt Pocock skills',
          'matte.desc': 'Engineering + general-purpose AI agent skills (25 core skills: wayfinder / triage / grilling / handoff ��)',
          'matte.openRepo': 'Open GitHub',
          'matte.copyPrompt': 'Copy install prompt',
          'cfg.openIn': 'Open in',
          'cfg.openInDesc': 'Where the panel opens. Defaults to the sidebar when dsh-better-sidebar is installed; the sidebar stays put when the window shrinks.',
          'cfg.openInLabel': 'Open location',
          'cfg.openInDock': 'Details column',
          'cfg.openInSidebar': 'Sidebar',
          'cfg.openInHint': 'Applied instantly �� next panel open uses this location',
          'cfg.panelWidth': 'Panel width',
          'cfg.resetPanelWidth': 'Reset panel width',
          'cfg.resetPanelWidthDesc': 'Next panel open will use the layout service default width (clears the persisted drag memory).',
          'cfg.startTpl': 'Start template (execute)',
          'cfg.startTplDesc': 'Prompt injected by the Execute button; leave empty for the default template.',
          'cfg.withPrefix': 'Prefix with /wayfinder',
          'cfg.tplEditor': 'Action template editor',
          'cfg.tplEditorDesc': 'Prompts for the six action buttons other than Execute. Click a placeholder below to insert at the cursor; deleting a red Required placeholder blocks saving.',
          'cfg.execHint': 'Edit the Execute template in the Start template section ��',
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
          'tpl.name.handoff1': 'Handoff �� first hit', 'tpl.name.handoff2': 'Handoff �� second hit', 'tpl.name.fixate': 'Consolidate',
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
          'run.cfgGuide': 'Config: Settings �� Plugins �� MattSkills',
          'skilldesc.ask-matt': 'Skill router: ask it when unsure which skill to use',
          'skilldesc.setup-matt-pocock-skills': 'Repo bootstrap: issue tracker / labels / doc paths',
          'skilldesc.wayfinder': 'Build decision maps + sub-ticket breakdowns for big projects',
          'skilldesc.triage': 'Route issues: classify �� verify �� grill, until ready-for-agent',
          'skilldesc.grilling': 'Relentlessly question you until the design is locked down',
          'skilldesc.domain-modeling': 'Lock down domain terms so code, docs and chat use one language',
          'skilldesc.research': 'Background research written into repo markdown with sources',
          'skilldesc.prototype': 'One-off prototype answering a design question',
          'skilldesc.implement': 'Break a spec into code tasks and implement them one by one',
          'skilldesc.code-review': 'Review your diff on both repo standards and the originating spec',
          'skilldesc.codebase-design': 'Find clean module boundaries and interfaces for your code',
          'skilldesc.diagnosing-bugs': 'Hard bugs / perf regressions: locate �� hypothesize �� verify, loop',
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
      // tr��locale �󶨣��ȶ����ã�����ʱ����ǰ���ԣ����� tr ������Ʊ����� t ��ͻ��������ȱʧʱ�˻� zh �ֵ䣨�� locale ͬ���壺{name} �����滻��
      const tr = (localeSvc && typeof localeSvc.bind === 'function')
        ? localeSvc.bind('dsws')
        : function (key, params) {
            let s = (L.zh[key] !== undefined) ? L.zh[key] : key
            if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return name in params ? String(params[name]) : m })
            return s
          }

      // ============================================================
      // 1. ����Ŀ¼ + �����Ƽ�ӳ��
      // ============================================================
      // T3����������Ⱦʱ tr('skilldesc.<name>')���˴� use �ֶ�Ϊ���ľ�̬�ο���
      const SKILLS = [
        { name: 'ask-matt', level: 'warn', use: '����·��������֪�������ĸ� skill ʱ����' },
        { name: 'setup-matt-pocock-skills', level: 'ok', use: '�ֿ��ʼ����issue tracker / ��ǩ / �ĵ�·��' },
        { name: 'wayfinder', level: 'warn', use: '������Ŀ���ߵ�ͼ�����������Ķ���' },
        { name: 'triage', level: 'ok', use: 'issue ״̬����ת��categorise��verify��grill' },
        { name: 'grilling', level: 'ok', use: '��׷����Ķ������ʣ��������' },
        { name: 'domain-modeling', level: 'ok', use: '����������ͳһ����' },
        { name: 'research', level: 'ok', use: '��̨���У�д�� repo �� markdown ����Դ' },
        { name: 'prototype', level: 'ok', use: 'һ����ԭ�ͻش��������' },
        { name: 'implement', level: 'warn', use: '�ѹ����ɴ��루task �� ticket��' },
        { name: 'code-review', level: 'ok', use: '����׼ + ���˫�����Ķ�' },
        { name: 'codebase-design', level: 'ok', use: '��ģ����ƴʻ�' },
        { name: 'diagnosing-bugs', level: 'ok', use: 'Ӳ bug �����ܻع����ѭ��' },
        { name: 'improve-codebase-architecture', level: 'ok', use: 'ɨ deepening opportunities �� HTML ����' },
        { name: 'tdd', level: 'ok', use: '��-��-�ع�' },
        { name: 'handoff', level: 'warn', use: '�ѵ�ǰ�Ի�ѹ���ɽ����ĵ�' },
        { name: 'teach', level: 'ok', use: '�� session �����¼���' },
        { name: 'to-spec', level: 'warn', use: '�����۹̻��ɹ��' },
        { name: 'to-tickets', level: 'warn', use: '�ѹ���� tickets' },
        { name: 'resolving-merge-conflicts', level: 'ok', use: '����ϲ���ͻ' },
        { name: 'writing-great-skills', level: 'warn', use: 'д�����㼼��' },
      ]
      const TYPE_SKILLS = {
        research: ['research'],
        prototype: ['prototype'],
        grilling: ['grilling', 'domain-modeling'],
        task: ['implement'],
      }
      const TYPE_LABEL = {
        research: ['research', 'r', '�о�'],
        prototype: ['prototype', 'p', 'ԭ��'],
        grilling: ['grilling', 'g', '����'],
        task: ['task', 't', '����'],
      }
      const TYPE_ICON = { research: 'search', prototype: 'hammer', grilling: 'chat', task: 'gear' }

      // ============================================================
      // 2. ��۷�����ͼ�� + �����ʣ����л���
      // ============================================================
      const ICON_SCHEMES = [
        { id: 'compass', label: '����' },
        { id: 'beacon', label: '����' },
        { id: 'radar', label: '�״�' },
        { id: 'pin', label: 'ͼ��' },
      ]
      const WORD_SCHEMES = ['����', '��ֽ', '�浵', '����']

      const Icon = ({ scheme, size }) => {
        const s = size || 16
        const common = { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'inline-block', verticalAlign: '-2px', flex: 'none' } }
        if (scheme === 'beacon') return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 4, fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })])
        if (scheme === 'radar') return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('circle', { cx: 12, cy: 12, r: 5 }), h('circle', { cx: 12, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M12 12L19 8' }), h('circle', { cx: 16.5, cy: 6.5, r: 1.1, fill: 'currentColor', stroke: 'none' })])
        if (scheme === 'pin') return h('svg', common, [h('path', { d: 'M12 21s-6-5.1-6-10a6 6 0 1112 0c0 4.9-6 10-6 10z' }), h('circle', { cx: 12, cy: 11, r: 2.2, fill: 'currentColor', stroke: 'none' })])
        return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('polygon', { points: '15.5 8.5 13 13 8.5 15.5 11 11', fill: 'currentColor', stroke: 'none' })])
      }

      // ---- ͨ��ͼ�꼯��ͳһ SVG stroke ���----
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
          // #394���� nav.handoff ͬͼ����ɡ����� / �¿��Ự�����壻�»Ự��ť�� external-link ����
          // ����1��2026-08-18���������ĵ� + ����ͷ ���� ���»Ự���ӡ�С��ť
        case 'handoff-open': return h('svg', common, [h('path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }), h('path', { d: 'M14 3v5h5' }), h('path', { d: 'M10 15l4-4' }), h('path', { d: 'M11 11h3v3' })])
        // ����1��rev��2026-08-18��������̬���ĵ��ݲ��ɿ��� ���� �����ĵ� + б�ܣ�δ����ʱ�Ҳఴť�ľ�ֹ��ʽ��
        case 'handoff-off': return h('svg', common, [h('path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }), h('path', { d: 'M14 3v5h5' }), h('path', { d: 'M8 16l8-8' })])
        // ����2��2026-08-18����2��2 ���� ���� �����б��ť
        case 'skills': return h('svg', common, [h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }), h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 })])
        case 'external-link': return h('svg', common, [h('path', { d: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6' }), h('polyline', { points: '15 3 21 3 21 9' }), h('line', { x1: 10, y1: 14, x2: 21, y2: 3 })])
        // ����BUG��ڣ�issue #4��������ͼ�� ���� ��+ ����BUG������ť / ״̬�� BUG ��ͣ�˵���������
        case 'bug': return h('svg', common, [h('path', { d: 'M8 2l1.88 1.88' }), h('path', { d: 'M14.12 3.88L16 2' }), h('path', { d: 'M9 7.13v-1a3.003 3.003 0 116 0v1' }), h('path', { d: 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6' }), h('path', { d: 'M12 20v-9' }), h('path', { d: 'M6.53 9C4.6 8.8 3 7.1 3 5' }), h('path', { d: 'M6 13H2' }), h('path', { d: 'M3 21c0-2.1 1.7-3.9 3.8-4' }), h('path', { d: 'M20.97 5c0 2.1-1.6 3.8-3.5 4' }), h('path', { d: 'M22 13h-4' }), h('path', { d: 'M17.2 17c2.1.1 3.8 1.9 3.8 4' })])
          default: return null
        }
      }

      // ============================================================
      // 2.5 ����ģ�ͣ�v25 �� T2a��dsws.cfg + dsws.templates���� dsws.startCfg �Զ�Ǩ�ƣ�
      // ����λ�� ��3 store ֮ǰ��DEFAULT_PANEL_H �̶� 1/2��
      // ============================================================
      // v22��ͳһ�����䣨T1 �İ壺��ͨ��̬�ı����û��ɸģ�����ռλ����
      // ��prompts��prompt ע�������ݲ� �� ������ UI �İ� i18n������ ���� A
      //   ÿ����{ version, placeholders, use, zh, en }������ʱ����ǰ���Ծ� promptText(id, params) ȡ��
      //   ռλ����Լ���ı��� {x} ���������� placeholders��promptText ֻ�滻������������δ֪�����
      //   ԭ������ prompt ��������ü��ܣ�wayfinder/grilling/triage �ȣ�ֻ����׷����չҪ�󡹣��������Ǽ����������
      //   ���ģ�docs/prompts-review.html / .md �� ��ԼУ�飺tests/verify-prompts.js
      // ============================================================
          const PROMPTS = {
        "guide": { version: 1, placeholders: [], use: 'ͳһ�����䣨׷���ڸ����� prompt ĩβ��', zh: '�ӵ�һ��ԭ�����������񣬲��Կ�ʽ��顣', en: 'Approach tasks from first principles, and review adversarially.' },
        "mapExecute": { version: 4, placeholders: [], use: 'map ִ�� / �»Ự��δ���̬���� �ƽ�ʽ', zh: '�밴���������ƽ��� map����ѭ wayfinder ���ܹ��򣩣�\n1. ���� wayfinder ���ܣ���δ���أ���\n2. ������� map��Destination / Notes / ������ϵ / ��ǰ frontier����\n3. ����һ��ԭ�������ǰ���ʺ��ƽ�����һ�� issue��frontier �м�ֵ��ߡ�������͡������ģ���\n4. ȥִ������������ �� ���� issue �� Description / Notes / ������ϵ �� �ƶ����� �� ʵʩ �� ���գ�\n5. ����ǰ��������Լ���¸� issue ���ģ�## ���ȣ�N% + ��һ�����������ƽ����������ͨ�� �� 100% + close��\n������ƽ��йرյ�Ʊ���� wayfinder ����ͬ�� map ��¼��Decisions so far ׷�� gist / �����ҵ / Out of scope����', en: 'Please advance this map:\n1. Load the wayfinder skill (if not loaded);\n2. Analyze this map (Destination / Notes / blocking relationships / current frontier);\n3. From first principles, pick the most valuable next issue on the frontier (highest value, lowest risk, most unblocking);\n4. Go execute it: read the issue Description / Notes / blocking relationships �� plan �� implement �� verify.\n\nApproach tasks from first principles, and review adversarially.\nIf this advance closes any ticket, sync the map records per wayfinder rules (Decisions so far gist / fog graduation / Out of scope).' },
        "complete": { version: 3, placeholders: ['n', 'closed', 'total'], use: 'map ���̬ �� ���ȷ�ϣ���β close / ����©��', zh: '## ���ȷ�� �� MAP #{n}\n\n��ǰ��ͼ��ʾ 100% ��ɣ�{closed}/{total} �� issue �ѹرգ��� map ������ open��\n\n�밴�������̴����\n\n1. ������״̬�Ƿ���ʵ��{closed}/{total} �� CLOSED ���� �� map ������ OPEN�����飺\n   - ��Ʊ�Ƿ���Ľ����ԭ Destination��\n   - �Ƿ��� Not yet specified ��δ��ҵ�����\n   - ʵ�������ȴ©�� CLOSED �� issue��©��/�󿪣����� ����˶� ticket �����״̬��ر�״̬�Ƿ�һ�£�\n   - �Ƿ��� issue ���ڸ� map ��δ���� sub-issue ��ϵ��\n2. ȷ�Ϻ����\n   - ȷʵȫ����� �� ���� close + �� Decisions so far ׷���ܽᣨÿ�� closed ticket һ�� gist����\n   - ������© �� �г�δ�����Ƚ���������жϣ�\n   - ��ȷ�� �� ѯ���û����õ�ͼ��ȫ�������Ƿ�����ɣ���Ҫ����β�𣿡���Ҫ���� close��\n3. ����Ŀ�꣺Ҫô close map + д Decisions so far �ܽᣬҪô��ȷָ��δ����\n\n�ӵ�һ��ԭ�����������񣬲��Կ�ʽ��顣\n��β������ʵʩ��ɡ������̡������û�ȷ�ϵ�Ʊ ���� ��ȷ���� close��δȷ�����ע������ 100% �� �����ա���������ʾΪδ������\nά����ͼ��¼��wayfinder ���򣩣�\n- �ر�һ��Ʊʱ�������� map �� Decisions so far ׷��һ�� gist��Ʊ�� + ���� + һ�仰���ۣ���\n- ��� map �� Not yet specified������ȷ�������ҵΪ��Ʊ��create-then-wire������������������\n- Խ��Ŀ�ĵط�Χ��Ʊ �� ���� Out of scope��д��ԭ�򣩣������� frontier��', en: '## Completion check �� MAP #{n}\n\nThe map shows 100% complete: {closed}/{total} issues closed, but the map itself is still open.\n\nHandle it as follows:\n\n1. Verify the completion is real: {closed}/{total} are CLOSED �� but the map is still OPEN. Check:\n   - Did the sub-issues really resolve the original Destination?\n   - Are there ungraduated items left in Not yet specified?\n   - Any issue actually completed but missing CLOSED (missed/erroneous) �� verify each ticket completion vs close state;\n   - Any issue belonging to this map without a sub-issue relationship;\n2. Then act:\n   - All truly done �� close the map + append a summary to Decisions so far (one-line gist per closed ticket);\n   - Gaps found �� list the unfinished items, resolve them first, then re-judge;\n   - Unsure �� ask the user \\"Has all the work on this map been completed? Should we wrap up?\\" �� do not close on your own;\n3. Goal: either close the map + write the Decisions-so-far summary, or clearly list the unfinished items.\n\nApproach tasks from first principles, and review adversarially.\nMaintain map records (wayfinder rules):\n- When closing a ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion);\n- Check the map Not yet specified: graduate specifiable items into new tickets (create-then-wire) and clear them from the fog section;\n- Tickets beyond the destination scope �� move to Out of scope (with reason), never left on the frontier.' },
        "fixate": { version: 1, placeholders: [], use: '���� �� �㶪ʧ����', zh: '��̱��̻��㡣��ͣ�ƽ���ִ�С��㶪ʧ���ա����ӵ�һ��ԭ�������\n\n1. ȫ�����������ҴӻỰ��ʼ������˵����ȫ����Ϣ������Ŀ�ĵ� / Լ����ƫ�� / ��ȷ�ϵľ��� / �������� / ��������Լ�ɼ������������������࣬�����г�������ѹ�������ϲ������Ɇ��²���ʡ�ԡ�\n2. ÿ�������ע���������ҵ�ԭ�����ã�����֪�����������ľ仰��\n3. ������һ�ڡ�������©�����������������������������޹ء�̫ģ������ִ��ϸ�ڶ�û����ģ�ȫ���ڳ�����д���㵱������������ɣ����Ҳþ���\n4. �����ͣ�µ��������˶ԡ���ȷ�ϻ�������Ϻ����ٰ��嵥���̣����е�ͼ��д�� map ���ĺͶ�Ӧ ISSUE��ֻ��ISSUE��д����ӦISSUE����û�о�������һ�ݿ��ձʼǲ������Ҵ��ģ��Ƚ�ͼʱ���롣', en: 'Milestone checkpoint. Pause progress and take a "zero-loss snapshot", from first principles:\n\n1. Restate everything I have said since the session started, in five categories: "Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)" �� list every item, no compression, no merging, rather verbose than omitted.\n2. Annotate each item with its source: quote my original words so I know which sentence it came from.\n3. Add a separate "Suspected omissions" section: everything I mentioned but you deemed off-topic, too vague, or execution detail and did not include �� list them all with your reason, and let me decide.\n4. Stop and wait for my item-by-item review after listing. Once I confirm or correct, persist the list: if a map exists, write into the map body and the corresponding ISSUEs; if only ISSUEs, write into those ISSUEs; if neither, create a snapshot note and tell me where it is, to migrate when a map is created.' },
        "progress": { version: 2, placeholders: [], use: '������Լ�����ж��� prompt ���ã�', zh: '���ȱ�ÿ�ζ�������ǰ������� ���� ���Ƕ�����һ���֣����ǿ�ѡ���\n1. issue ����ά���̶���������`## ���ȣ�N%`��N Ϊ 0-100 ��������ֹ����� / ��������ģ���ʣ���\n2. ����ǰ�ȶ����ĵ�ǰ���ȣ���������״̬д��ʵ��ǰֵ�����ϵ�Ҳ���µ�����\n3. δ���� = 0%�������� = 1-94%��95% = ����ɴ��û�ȷ�ϣ���һ��ע������ȷ��ʲô������ȷ�Ϻ�����д 100% �� close��\n4. 100% = ȷ����ɣ�close �����������Ϊ��ʷ����\n5. �״νӴ��޽�������Ʊ���Ȱ���״��дһ����ʵʩ��¼����Ľ��ȡ�', en: 'Progress expression (must update before finishing every action �� it is part of the action, not optional):\n1. Keep a fixed progress section in the issue body: `## Progress: N%` (N is an integer 0-100; no vague words like "about / basically");\n2. Before updating, read the body current progress and write the true current value based on the latest state (can go up or down);\n3. Not started = 0%; in progress = 1-94%; 95% = done, awaiting user confirmation (note "what is pending" in the next step); once confirmed, immediately write 100% and close;\n4. 100% = confirmed done (the section stays as history after close);\n5. On first contact with a ticket lacking the section, write a progress matching its implementation record.' },
        "bodyFormat": { version: 1, placeholders: [], use: '���ĸ�ʽ��Լ��T16 �� ͳһ׷���� map/ticket д���ĵĶ�����', zh: '���ĸ�ʽ��д/�� issue ����ʱ�������أ���\n1. ����ʵ������д��`## �½�` ��ռһ�У����������У�\n2. ��ֹ���� \\n ת�壨��Ҫ�ѻ���д�� \\n �����ַ�������ֹ������ BOM��\\ufeff����ͷ��\n3. д�� issue ������ gh issue edit --body-file <�ļ�>���ļ���Ϊ��ʵ���У�����Ҫ�� JSON ת���ַ���ƴ�����', en: 'Body format (mandatory when writing/editing an issue body):\n1. Use real newlines: each `## section` on its own line, blank line between paragraphs;\n2. No literal \\n escapes (do not write newlines as the two characters backslash-n), no BOM (\\ufeff) at the start;\n3. Write issue bodies with gh issue edit --body-file <file> (real newlines in the file), never a JSON-escaped string inline in a command.' },
        "grill": { version: 1, placeholders: [], use: '�������grilling ���ܣ�', zh: '����ǰ����һ�£���Ҫ���������û���Ĳ����ǡ��Ҳ��û���Ҫ�������ģ�����У���� ���� �� grilling ���ܰѲµĵط�������ٶ��֡�', en: 'Before you start, check: is any part of what you are about to do based on a guess about what the user wants? If so, do not guess �� use the grilling skill to settle those guesses before acting.' },
        "newMap": { version: 2, placeholders: [], use: '��ͼ�滮��Լ', zh: '��ͼǰ����ɣ�д�� map body �����½ڣ���ѭ wayfinder ���ܹ��򣩣�\n0. ���� grilling ����Ŀ�ĵ��뷶Χ�����Լ��� scope��\n1. ���� / ���У��� Notes ��һ�仰��������ЩƱ���У�������������Щ�ɲ��С���\n2. ��֪ / ������ / �������ȷ�� �� Decisions so far�������� �� ��Ʊ��ģ������ �� Not yet specified����������������ҵΪ��Ʊ����\n3. �����ÿ��Ʊ�������� owner��agent ���� �� HITL����grilling ������ HITL��\n4. ÿ���½�Ʊд�� `## ���ȣ�0%` ��׼��', en: 'Complete before building a map (write into the map body existing sections, follow the wayfinder skill rules):\n0. Clarify the destination and scope with grilling first; do not set scope yourself;\n1. Parallel / serial: summarize in Notes in one sentence "which tickets are serial (blocked) and which run in parallel";\n2. Known / to-investigate / fog: confirmed �� Decisions so far; to investigate �� create tickets; vague pending �� Not yet specified (the fog zone, later graduating into new tickets);\n3. Ownership: declare a suggested owner per ticket (agent or human �� HITL); grilling tickets must be marked HITL;\n4. Write a `## Progress: 0%` baseline into every new ticket.' },
        "tpl.diagnose": { version: 3, placeholders: ['url'], use: '������ť����ϡ���needs-triage Ʊ��', zh: '/triage\n{url}\n\n������ issue�����������ѭ /triage ����������򣩣�\n1. ��Ū�������׳���ʲô���⣨���� / Ӱ�췶Χ / ���ֲ��裩��\n2. �г����ܵĸ��򣨶����ѡ����ע���Կ����ԣ���\n3. ���������飨�޸� / �ر� / ����� / �ȴ������� ����������жϣ���������ֱ��ִ�У�\n4. ����ǰ���С��Ҳ��û���Ҫ�������ĵط������� grilling ���ܳ��壻\n5. ����ǰ��������Լ���� issue ���ġ�', en: '/triage\n{url}\n\nDiagnose this issue (follow the /triage skill own rules):\n1. Pin down what is actually wrong (symptoms / impact / repro steps);\n2. List possible root causes (multiple candidates, with confidence);\n3. Propose triage (fix / close / redesign / wait) �� a recommendation for the user, not a license to execute;\n4. Before acting, if any part rests on a guess about what the user wants, settle it with the grilling skill first;\n5. Update the issue body per the progress contract before finishing.' },
        "tpl.fix": { version: 2, placeholders: ['url'], use: '������ť���޸�����bug Ʊ��', zh: '/implement\n{url}\n\n�޸���� bug����ѭ wayfinder ���ܹ��򣩣�\n1. �ȸ��֣��ٶ�λ�����޴�ط� = ���ޣ���\n2. ʵʩ�޸���\n3. �Ӳ��Բ���ͨ��\n4. �Կ�ʽ����Լ��ĸĶ����һ�©���������\n5. �м������� grilling ���ܳ��壬��Ĭ�ϣ�\n6. ����ǰ��������Լ���£��޸���ɵ�δ���� �� 95% �� ��ȷ�ϣ���', en: '/implement\n{url}\n\nFix this bug (follow the wayfinder skill rules):\n1. Reproduce it first, then find the root cause (fixing the wrong spot is wasted work);\n2. Implement the fix;\n3. Add tests and get them green;\n4. Adversarially review your own change (where did I miss?);\n5. Settle assumptions with the grilling skill first, never assume;\n6. Update per the progress contract before finishing (fix done, unverified �� 95% �� awaiting confirmation).' },
        "tpl.discuss": { version: 2, placeholders: ['url'], use: '������ť�����ۡ���grilling Ʊ��', zh: '/grill-me\n{url}\n\n��� issue ��Ҫ���۶��ᣬ�� grilling ���ܺ��ҶԻ����Ի���ʽ��ѭ grilling ����������򣩣�\n1. ����Χ��Ŀ�� / �߽� / ���� / ѡ��Ȩ�� / ���ߣ�\n2. ������������������ȷ�Ͻ��ۣ�\n3. �����н���ʱ���ѽ���д�� issue ���ģ��������Ʊ / ���߼�¼����\n4. ����ǰ��������Լ���¡�', en: '/grill-me\n{url}\n\nThis issue needs discussion before a decision �� use the grilling skill to talk with me (follow the grilling skill own dialogue rules):\n1. Keep the discussion on goal / boundary / risks / options-tradeoffs / decision;\n2. Do not decide for me; wait for my confirmation of conclusions;\n3. When a conclusion emerges, write it into the issue body (or propose it as a ticket / decision record);\n4. Update per the progress contract before finishing.' },
        "tpl.execute": { version: 4, placeholders: ['url'], use: '������ť��ִ�С�����ͨƱ��', zh: '/wayfinder\n{url}\n\nִ����� issue����ѭ wayfinder ���ܹ��򣩣�\n1. �����죨��δ���죩���� Description / Notes / ������ϵ��ȷ��������Ҫ����ʲô��\n2. ��Ŀ�겻�����Ҫ�û����� �� ���� grilling ���ܳ��壻\n3. �ƶ����� �� ʵʩ �� �����ձ�׼�Բ飻\n4. �����ͨ������ �� 100% + close��δ��� �� ��������Լ��ʵ���£�����һ������\n��ִ�к�ر��˸�Ʊ�������� map �� Decisions so far ׷��һ�� gist��Ʊ�� + ���� + һ�仰���ۣ���', en: '/wayfinder\n{url}\n\nExecute this issue (follow the wayfinder skill rules):\n1. Claim it first (if unclaimed); read Description / Notes / blocking relationships; confirm what it must deliver;\n2. If the goal is unclear or needs the user call, settle it with the grilling skill first;\n3. Plan �� implement �� self-check against acceptance criteria;\n4. Done and verified �� 100% + close; otherwise update honestly per the progress contract (with next step).\nIf this execution closes the ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion).' },
        "tpl.handoff1": { version: 1, placeholders: ['ts'], use: '���ӵ�һ����д�����ĵ���', zh: '/handoff\n\n��ѵ�ǰ�Ự���ɽ����ĵ���д�� .scratch/handoff/{ts}.md����Ե�ǰ����Ŀ¼�������������֣�\n1. ���ۣ����λỰ��ȷ�ϵľ�����ɹ���\n2. δ��������һ��Ҫ�������£�\n3. ���� skill���»Ự����ʱ������صļ��ܡ�\n\n�ӵ�һ��ԭ�����������񣬲��Կ�ʽ��顣', en: '/handoff\n\nCreate a handoff doc from this session, written to .scratch/handoff/{ts}.md (relative to the current working directory), with three parts:\n1. Conclusion: decisions and outcomes confirmed this session;\n2. Unfinished: what to continue next;\n3. Suggested skills: skills the next session should load.\n\nApproach tasks from first principles, and review adversarially.' },
        "tpl.handoff2": { version: 1, placeholders: ['file'], use: '���ӵڶ������������ĵ���', zh: '/read .scratch/handoff/{file}\n\n�����Ķ���ݽ����ĵ�������ȷ����⣨���� / δ������� / ���� skill����Ȼ��ӵ�һ��ԭ�����������񣬲��Կ�ʽ��顣', en: '/read .scratch/handoff/{file}\n\nRead this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.' },
        "handoffRead": { version: 1, placeholders: [], use: '���ӵڶ������ף����ļ�ʱ��', zh: '/read .scratch/handoff/latest.md\n\n�����Ķ���ݽ����ĵ�������ȷ����⣨���� / δ������� / ���� skill����Ȼ��ӵ�һ��ԭ�����������񣬲��Կ�ʽ��顣', en: '/read .scratch/handoff/latest.md\n\nRead this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.' },
        "installSkills": { version: 1, placeholders: [], use: '���ܰ�װ���� �� DSH ר�ã���� / ���� g4 / ����ҳ���ƣ�', zh: '��Ϊ DSH ��װ Matt Pocock �� skills �����׼���mattpocock/skills����\n1. ��¡ https://github.com/mattpocock/skills��\n2. ���ٷ� README ������������ͨ�������ȫ�� skills ��װ�� DSH ��ȡ�ļ���Ŀ¼���û���Ŀ¼�µ� ~/.agents/skills�����׼������� DSH����Ҫ��װ������ AI ���ߣ���\n3. ��װ����֤ wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills �ȼ����ļ��Ѿ�λ��\n4. ��ɺ�㱨��װ�������װ�����嵥��', en: 'Install the Matt Pocock skills collection (mattpocock/skills) for DSH:\n1. Clone https://github.com/mattpocock/skills;\n2. Per the official README, install all engineering and general-purpose skills into the skill directory DSH reads: ~/.agents/skills under the user home (this collection is for DSH only �� do not install it into other AI tools);\n3. After install, verify wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills are in place;\n4. Report the result and the installed skill list when done.' },
        "setupRun": { version: 6, placeholders: [], use: '��������� �� setup δִ�а�ť������ʼ��������װ���ܣ�', zh: '/setup-matt-pocock-skills\n\n��ʼ�����ֿ⣨�����׼��Ѱ�װ�������¡��װ����\n1. issue tracker ѡ�� GitHub Issues��\n2. ��ʼ��ʱ�� setup-matt-pocock-skills ������������ִ�У�issue tracker ѡ�� GitHub Issues��triage ��ǩ����Ĭ�����ɫ������ȷ���ֿ��м��������ǩ��ȫ��triage ���ɫ + wayfinder ��ǩ wayfinder:map / research / prototype / grilling / task������Ҫֻ�������������������ǩ�ϸ���ѭ���ܹ��򣬲�����ǿ���κα�ǩ��\n3. ��ʼ����ɺ󸴲黷����飨setup ���̼���ɣ���', en: '/setup-matt-pocock-skills\n\nBootstrap this repo (the skill suite is already installed �� no need to clone or reinstall):\n1. Choose GitHub Issues as the issue tracker;\n2. During init, follow the setup-matt-pocock-skills skill own flow (choose GitHub Issues as the tracker; keep the default triage-role labels), and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) �� not just a few; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;\n3. After init, re-run the environment check (setup turns green when done).' },
        "newWayfinder": { version: 6, placeholders: ['repo'], use: '��+ �½����󡹰�ť', zh: '/wayfinder\n����Ҵ���һ�������ϸ���ѭ wayfinder ���ܹ��򣩡�\n�ֿ⣺{repo}\n\n�յ�������������̣�\n1. �ȳ��壺��Ŀ�� / ��Χ / ƫ���м���ʱ������ grilling ���ܳ��壬��Ĭ�ϣ�\n2. �жϷ��ࣨ���� / map ά�ȣ������Ȳ�ֿ����� wayfinder:map �� issue��ȷ���Ƿ�������\n   - ������ȫ������֮ǰû���� �� ����ͼ�滮��Լ�½� map��Destination + Notes + �滮�� + Ʊ����\n   - ���ã��������֮ǰ������������ map / issue���� �򿪸����������ظ�����\n   - ֱ��ʵ�֣������С �� ��һ�� issue ֱ��ʵ�֣������� map��\n3. ִ�к󰴽�����Լ���¡�\n\n����������', en: '/wayfinder\nPlease handle a requirement (strictly follow the wayfinder skill rules).\nRepo: {repo}\n\nAfter receiving the requirement, follow this flow:\n1. Clarify first: if you hold assumptions about the goal / scope / preferences, settle them with the grilling skill, never assume;\n2. Decide the case (at the requirement / map level) �� first check existing wayfinder:map and issues in the repo to confirm whether it has been done:\n   - Add: a brand-new requirement never done before �� build a new map per the planning contract (Destination + Notes + plan + tickets);\n   - Reuse: this requirement has been done before (existing map / issue) �� open and reuse it, do not build a new one;\n   - Directly implement: the requirement is small �� create a single issue and implement it directly, no big map;\n3. Update per the progress contract after execution.\n\nRequirement: ' },
        "newBugWayfinder": { version: 4, placeholders: ['repo'], use: '��+ ����BUG������ť / ״̬�� BUG ��ͣ�˵�����������issue #4 �� v2 �� #1 BUG3������λ�Ƶ�ĩβ �� v3 #14������Ϊ 4 �ֶ� �� v4 #63��ȥ�ڲ�����+ʵ�ʡ�����+���ŵ��У�', zh: '/wayfinder\n���������һ�� BUG ������ wayfinder ���ܹ��������\n�ֿ⣺{repo}', en: '/wayfinder\nPlease help me file a new BUG ticket (follow the wayfinder skill rules).\nRepo: {repo}' },
        "mapHead": { version: 1, placeholders: ['n', 'title', 'url'], use: '�»Ự/ִ�� �� map ��ʶͷ��B2��', zh: '## Ŀ�� map\n- ��ţ�#{n}\n- ���⣺{title}\n- ���ӣ�{url}', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}' },
        "stageGate": { version: 2, placeholders: [], use: '�׶�բ�����T13 �� ͳһ׷���� ���/�޸�/ִ��/map�ƽ� ������needs-triage ��������ϲ��ж���״��', zh: '�׶�բ�ţ�������ʼǰ�ض������Ƕ�����һ���֣����ǿ�ѡ���\n1. �ȶ��� issue ��״����������## ���ȣ�N%��/ ����ʵʩ��¼ / ���� / ��ǩ���ж��������ĸ��׶Σ�\n2. ��� needs-triage ��ǩ�������������ϣ�����ǰ�ò��裬��������ֱ��ʵʩ����\n3. ���ʱ�жϵ�ǰ��չ��\n   - ����ʵʩ����ʵ �� �����Ƿ�������ձ�׼����ʵ��ά�� 95% ��ȷ�� + ժ needs-triage��ת ready-for-agent����\n   - ����ʵʩ�����/���Ʒ �� ���Ⱦ�ʵ�ص�����ʵֵ���� 30%����������ϣ�\n   - δ���� �� ������ϣ����� �� ���� �� ���� �� д�� issue����\n4. ������ժ needs-triage ����������ʵʩ�׶Ρ�', en: 'Stage gate (must read before starting the action �� it is part of the action, not optional):\n1. First read the issue current state: progress section (## Progress: N%) / existing implementation record / comments / labels �� determine which stage it is in;\n2. If it carries the needs-triage label: diagnosis MUST be completed first (a prerequisite step �� do not skip straight to implementation);\n3. During diagnosis, judge current progress:\n   - Existing implementation and it is real �� verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (move to ready-for-agent);\n   - Existing implementation but fake/partial �� revise progress back to the true value (e.g. 30%) and continue diagnosing;\n   - Not started �� normal diagnosis (reproduce �� root cause �� plan �� write into the issue);\n4. Only after diagnosis is done and needs-triage removed may implementation begin.' },
      }
      // ��ǰ���ԣ����� DSH locale ���� active��ȱʡ zh��
      const promptLang = function () {
        try {
          const l = (localeSvc && typeof localeSvc.getSnapshot === 'function') ? localeSvc.getSnapshot().active : null
          return (l === 'en' || String(l || '').indexOf('en') === 0) ? 'en' : 'zh'
        } catch (e) { return 'zh' }
      }
      // ȡ prompt��promptText(id) �� promptText(id, { ռλ��: ֵ })
      const promptText = function (id, params) {
        const p = PROMPTS[id]
        if (!p) return ''
        let s = (promptLang() === 'en' && p.en) ? p.en : (p.zh || '')
        if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m })
        return s
      }
      // �����������������ò��䣩
      const GUIDE_LINE = promptText('guide')
      // v1.5 T4/T5��Matt ���ֿܲ⣨���ܿ� GitHub ���ӣ�
      const MATT_REPO = 'https://github.com/mattpocock/skills'
      const MAP_EXECUTE_PROMPT = function () { return promptText('mapExecute') }
      const COMPLETE_PROMPT = function () { return promptText('complete') }
      // T16�����ĸ�ʽ��Լ��д/�� issue ���ĵĶ���ͳһ׷�ӣ�
      const BODY_FORMAT = function () { return promptText('bodyFormat') }
      // v3.4��#14 2026-08-19 ���շ�������ָ��������дλ ���� ÿ�ֶΡ��ֶ��������� + �·�һ�С�����ʾ������v3.2/3.3 ����ָ�������ڱ���Ϸ��������д�����������ǣ����������ݣ�
      //   �ֶμ�����һ��ԭ���Bug = ���� vs ʵ��ƫ������� / ʵ�ʣ���������+Ӱ�췶Χ��/ ���ֲ��裨���ձ���+���� preamble��/ ������Ϣ��������
      //   ��̬���飨v3.0 ����ʽ �� v3.1 �ֶ���+����˵�� �� v3.2/3.3 ָ����+����� �� v3.4 ���н����ֶΣ���zh ֻ���ġ�en ֻӢ�ģ����� DSH ����һ��ֻ��һ��
      const NEW_BUG_FIELDS_BODY = function () { return '\n\nʵ�ʣ�����ʲô���ɺ�Ӱ�췶Χ����\n������Ӧ����ʲô / Ԥ�ڽ������\n���ֲ��裨[ǰ�� / ����] + ��Ų��裩��\n������Ϣ��OS + ����� + ����汾����' }
      // v3.4��#14����EN locale �� ���� ÿ�ֶΡ��ֶ��������� + �·� "e.g." ʾ���У�DSH ΪӢ��ʱ���������
      const NEW_BUG_FIELDS_BODY_EN = function () { return '\n\nActual (what happened; may include impact):\nExpected (what should happen / expected result):\nReproduction ([Preamble / Scenario] + numbered steps):\nEnvironment (OS + browser + plugin version):' }
      // v1.5�����ȷ�� prompt ���� ����+����ǰ�ã�/wayfinder + map ���ӣ�����ƴ���ȷ�����ģ���� = wayfinder��
      const completePrompt = function (st, num, total, closed) {
        return '/wayfinder\n' + 'https://github.com/' + repoStr(st) + '/issues/' + String(num || '') + '\n\n' +
          COMPLETE_PROMPT().split('{n}').join(String(num || '')).split('{total}').join(String(total)).split('{closed}').join(String(closed)) +
          (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '')
      }
      const FIXATE_PROMPT = function () { return promptText('fixate') }

      const CFG_KEY = 'dsws.cfg'
      // �������ã��û��İ� 2026-08-14�����ͼ��/����������ƶ��������ṩ�����
      // v1.4����λ�� cfg.openIn ���� ��⵽ dsh-better-sidebar ��װ��Ĭ�� 'sidebar'������ 'dock'��
      //   localStorage ����ֵ�������û�ѡ�񣨲����ǣ�
      const cfg = (function () {
        const bsInstalled = !!(ctx.get('betterSidebar') && typeof ctx.get('betterSidebar').registerTab === 'function')
        const d = { withWayfinder: true, openIn: bsInstalled ? 'sidebar' : 'dock' }
        try {
          const raw = localStorage.getItem(CFG_KEY)
          if (raw) {
            const saved = JSON.parse(raw)
            if (typeof saved.openIn === 'string') d.openIn = saved.openIn  // �û���ѡ�� �� ����
            else d.openIn = bsInstalled ? 'sidebar' : 'dock'              // �״� �� ����װ���Ĭ��
          }
          return Object.assign({ withWayfinder: true, openIn: 'dock' }, d)
        } catch (e) { /* �洢��������Ĭ�� */ }
        return d
      })()
      const saveCfg = function () { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) {} }
      // ģ��洢��T2b ��չȫ��������T2a �ȳ��� execute = �� custom��
      const TPL_KEY = 'dsws.templates'
      const templates = (function () {
        const d = { diagnose: '', fix: '', discuss: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
        try {
          const raw = localStorage.getItem(TPL_KEY)
          if (raw) return Object.assign(d, JSON.parse(raw))
        } catch (e) { /* �洢��������Ĭ�� */ }
        return d
      })()
      const saveTemplates = function () { try { localStorage.setItem(TPL_KEY, JSON.stringify(templates)) } catch (e) {} }
      // Ǩ�ƣ��� dsws.startCfg��{withWayfinder, custom}���� cfg.withWayfinder + templates.execute���ɹ������ key
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
        } catch (e) { /* Ǩ��ʧ�ܱ���� key���´����� */ }
      }
      migrateStartCfg()

      // ---- v25 �� T2b������ģ�����棨T1 ��� ��2-��4��----
      // ռλ��ȫ����{url} {number} {title} {ts} {file}������������ͨ��̬�ı�������ռλ����
      const PH = ['url', 'number', 'title', 'ts', 'file']
      // ��ģ�����ռλ�����༭�� chips չʾ��
      const TPL_PH = {
        diagnose: ['url'], fix: ['url'], discuss: ['url'], execute: ['number', 'url', 'title'],
        handoff1: ['ts'], handoff2: ['file'], fixate: [],
      }
      // ǿ��ռλ�����T1 ��� ��3����ȱʧ�ܾ�����
      const TPL_REQUIRED = {
        diagnose: ['url'], fix: ['url'], discuss: ['url'], execute: ['url'],
        handoff1: ['ts'], handoff2: ['file'], fixate: [],
      }
      // Ĭ��ģ���ı����� = ��Ĭ�ϣ�T1 ��� ��3 Ĭ���ı� = ��״�����ı���
      const TPL_DEFAULT = {
        // T4 #9-12��4 ��������ť prompt ��ȷ��
        diagnose: function () { return promptText('tpl.diagnose') },
        fix: function () { return promptText('tpl.fix') },
        discuss: function () { return promptText('tpl.discuss') },
        execute: function () { return promptText('tpl.execute') },
        handoff1: function () { return promptText('tpl.handoff1') },
        handoff2: function () { return promptText('tpl.handoff2') },
        fixate: function () { return promptText('fixate') },
      }
      const tplText = (id) => templates[id] || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : '')
      // ��Ⱦ��ת�� {{x}} �� ���� {x}�����滻�ڱ������滻�������滻��֪ռλ����δ֪ռλ������ԭ��������������أ�
      // T13 �޶����׶�բ��ͳһ׷�� ���� ���/�޸�/ִ�� ���ද��**ĩβ**ƴ stageGate����������+���ӱ��ֿ�ͷ���Զ���ģ��Ҳ��Ч�����߸��ǣ�
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
      // У�飺ת��Ԥ���� �� δ֪ռλ����� �� ǿ��ռλ��ȱʧ��⣨T1 ��� ��4 ˳��
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
      // 3. store��v14�����Ự���룻�� sid ʱ�� shared��
      // ============================================================
      // v24-48�����Ĭ�ϸ߶� = ��ĻԼ 1/2
      // v1.5 T3�����Ĭ�ϸ߶ȹ̶� 1/2���û��İ峹���Ƴ� panelHeight ���� ���� details �и߶������޹أ����ò���Ч��
      const DEFAULT_PANEL_H = (function () {
        try { return Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) } catch (e) { return 400 }
      })()
      // #374�����б�ƫ�ã�����/״̬���ˣ��־û���localStorage ������ʱ����Ĭ��ֵ��
      const LIST_PREFS_KEY = 'dsws.listPrefs'
      const listPrefs = (function () {
        const d = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
        try {
          const raw = localStorage.getItem(LIST_PREFS_KEY)
          if (raw) return Object.assign(d, JSON.parse(raw))
        } catch (e) { /* �洢��������Ĭ�� */ }
        return d
      })()
      const saveListPrefs = function () { try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(listPrefs)) } catch (e) {} }
      // #375��label ������䣨���� + ������ʱ�䣬˫������
      const LABEL_CLICKS_KEY = 'dsws.labelClicks'
      const labelClicks = (function () {
        try {
          const raw = localStorage.getItem(LABEL_CLICKS_KEY)
          if (raw) { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {} }
        } catch (e) { /* �洢�����ý�����Ƶ�� */ }
        return {}
      })()
      const saveLabelClicks = function () { try { localStorage.setItem(LABEL_CLICKS_KEY, JSON.stringify(labelClicks)) } catch (e) {} }
      // T2 #35 �� �޲ֿ�쿨״̬������ cwd ά�ȳ־û� dismiss�����̬ expanded/name/visibility/loading/error��
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
        // ��۶������û��İ壺ͼ��/�����ʲ������ã�
        ui: { icon: 'compass', word: '����' },
        snapshot: null,
        cwd: '', lblFilters: [], skillView: 'list', expLabels: false,
        // #374��״̬���� + ����Ĭ�� ����ʱ���������״һ�£�
        stateFilter: listPrefs.stateFilter, sortKey: listPrefs.sortKey, sortDir: listPrefs.sortDir,
        checks: null, checksUpdatedAt: '', checksMode: 'loading', checksError: null, checking: false,
        snapMode: 'loading', snapError: null, snapLoading: false,
        refreshing: false, rowFlash: {}, issueFlash: {}, handoffReady: false, skillsOpen: false, skillHover: null, skillTip: null, bugMenuOpen: false, bugMenuHover: false, bugMenuPos: null, skillPopPos: null, expTags: {}, subs: [],
        noRepoCard: { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' },
      })
      const shared = makeStore()
      const stores = {}
      // #58 �������ȣ��� cwd ���ڴ���ձ���� store �뿪 + ��Ựͬ cwd ���������� cwd ̽· miss��
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
          if (sessions && typeof sessions.get === 'function' && sid) {
            const s = sessions.get(sid)
            const meta = s && s.meta
            const cwd = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
            if (typeof cwd === 'string' && cwd) return cwd
          }
        } catch (e) { /* ���� */ }
        return ''
      }
      const storeOf = (sid) => {
        if (!sid) return shared
        let st = stores[sid]
        if (!st) {
          st = makeStore(); st.sessionId = sid; stores[sid] = st
          if (!st.cwd) {
            const sync = getCwdSync(sid)
            if (sync) st.cwd = sync
          }
          if (st.cwd) hydrateFromCache(st)
        } else {
          if (!st.cwd) {
            const sync = getCwdSync(sid)
            if (sync) { st.cwd = sync; hydrateFromCache(st) }
          }
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
        later(function () { if (st.notice && st.notice.text === msg) { st.notice = null; emit(st) } }, 2800)
      }

      // ������Ʊ����飨frontier/claimed/blocked/closed��
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

      // v18-30��״̬���ɽ�/ռ�ø��á��б� open issue���ھ���������б�һ�£���
      //   �ɽ� = open issue ��δ������δ�� open ������ռ�� = ������ + ������������֮�� = ȫ�� open issue
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
      // v1.5 T1��BUG / ��ϼ�����open �Ҵ���Ӧ��ǩ���롸�ɽӡ�ͬ�ھ���
      const hasLabelOf = function (x, nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const bugCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'bug') }).length
      const triageCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'needs-triage') }).length

      // v19������ ���� ��ǩ����ɫӳ�䣨�ӿ��� issues �ռ� GitHub label ����ɫ����̬��ѯ��д����
      const buildColorOf = function (st) {
        const colorOf = {}
        const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
        issues.forEach(function (x) {
          (x.labels || []).forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
        })
        return colorOf
      }
    // T9���м�������ɫ���㣨�� mkRowAction ���� �� ���»Ự��ť���ã���ִ�а�ťͬ label ��ɫ��
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
    // #361���м�����ע���ı��ĵ�һ��Դ�����/�޸�/����/ִ�У����� �»Ự�������ڶ�������
      const rowActionText = function (st, x) {
        const url = 'https://github.com/' + repoStr(st) + '/issues/' + x.number
        const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
        if (has('needs-triage')) return renderTemplate('diagnose', { url: url })
        if (has('bug')) return renderTemplate('fix', { url: url })
        if (has('wayfinder:grilling')) return renderTemplate('discuss', { url: url })
        return startText(st, x)
      }
      // v19������ ���� �м��������б��� map ���鹲�ã����� label ��ѡһ�����/�޸�/����/ִ�У���Ԥ�������
      // ��ť����ɫ = ��Ӧ label �� GitHub ����ɫ��YIQ ��֪���ȶ�����ɫ��
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
        // v21���������� + URL + ͳһ�����䣨�����ظ����似���ڲ����̣�
        // v25 �� T2b�����/�޸�/������ģ����Ⱦ���û����Զ��徲̬�ı���{url} ע�룩
        if (has('needs-triage')) return mk('chat', tr('act.diagnose'), rowActionText(st, x), btnColor('needs-triage', '#f59e0b'))
        if (has('bug')) return mk('hammer', tr('act.fix'), rowActionText(st, x), btnColor('bug', '#f87171'))
        if (has('wayfinder:grilling')) return mk('chat', tr('act.discuss'), rowActionText(st, x), btnColor('wayfinder:grilling', '#d93f0b'))
        return mk('play', tr('act.execute'), rowActionText(st, x), '#c084fc')
      }
      // v19�������ĵ�ʱ����ļ�����YYYYMMDD-HHMMSS��
      const timeStampStr = () => {
        try {
          const d = new Date()
          const p = function (n) { return String(n).padStart(2, '0') }
          return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
        } catch (e) { return 'latest' }
      }

      // ---- ������飨#344 �� rpcCall('status')��host �� 30s ���� / force �ز飩----
      // v12��ʧ�ܲ��ٶ������� ���� �� real ״̬һ����Ϊδ֪��--/8������չʾ���̵�
      const CHECKS_TOTAL = 9   // v1.5 T11 �� 9 ���⣨�����ļ����׼���
      const loadChecks = (st, force, silent) => {
        if (st.checking) return Promise.resolve()
        if (conn === undefined || conn.rpc === undefined) {
          st.checksMode = 'err'
          st.checksError = tr('err.hostUnavailable')
          emit(st)
          return Promise.resolve()
        }
        st.checking = true
        // v1.5 T10 R7��silent���ֶ�ˢ���߾�Ĭ·�������� loading ̬
        if (force && !silent) st.checksMode = 'loading'
        emit(st)
        const args = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, force ? { force: true } : {}, { lang: promptLang() })
        return rpcCall('status', args).then(function (res) {
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
      // v14-22�����ش����ִ���'6/9' / '--/9'������״̬�� num() �̶������Ⱦ����ĸ = ʵ�ʼ����������̬������Ӳ���룩
      const envTotal = (st) => { const cs = activeChecks(st); return cs.length || CHECKS_TOTAL }
      const envLabel = (st) => { const n = readyCount(st); const t = envTotal(st); return n < 0 ? '--/' + t : n + '/' + t }
      const setupCheck = (st) => (st.checks || []).find(function (c) { return c.id === 2 })

      // #370��blockerNames ֻ�С��� OPEN���������ߣ�GitHub �������������߹رպ��Ա�����谴״̬���ˣ�
      const openBlockers = (t, m) => t.blockedBy.filter(function (b) {
        const bt = m.tickets.find(function (x) { return x.number === b })
        return bt !== undefined && bt.state === 'OPEN'
      })
      const blockerNames = (t, m) => openBlockers(t, m).map(function (b) {
        const bt = m.tickets.find(function (x) { return x.number === b })
        return bt ? bt.title : ('#' + b)
      }).join('��')

      // v10���ӻỰ����̽�⵱ǰ����Ŀ¼��ConversationSnapshot �ֶ�����̽������
      const detectCwd = function (ss) {
        try {
          if (ss && typeof ss === 'object') {
            for (const k of ['cwd', 'workspacePath', 'projectPath', 'path', 'dir', 'root']) {
              if (typeof ss[k] === 'string' && ss[k]) return ss[k]
            }
          }
        } catch (e) { /* ̽��ʧ���� host Ĭ�� */ }
        return ''
      }
      // v11��label �� GitHub ����ɫ��Ⱦ ���� hex �� rgba��.18 ����������Ч hex ���� null �߶���
      const hexA = function (hex, a) {
        try {
          const hh = String(hex || '').replace('#', '')
          if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
          const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
          return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
        } catch (e) { return null }
      }
      // v14-18��hex �� HSL �����µ� amt��0-1���� hex��chips �߿�� label ɫ��һ����
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
      // 4. �ı����� + ����/ע��
      // ============================================================
      const nowStr = () => {
        try { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (e) { return '' }
      }
      // ���� 1A��ʱ��̶���ʽ MM-DD HH:MM�����أ�
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
      // 4. ���ù㲥��v25-50�����ñ����ͬ�����лỰ store �����ߴ磻��۶������㲥��
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

      // v1.5 T10 R4���û��İ壩�����ݲ����� diff ���� ���/����/ɾ�� ��Ʊ�ŶԱȣ��� map ��Ʊ���仯����
      //   ����ͼ���б�/map����/״̬������/���˽�������������Զ�������diff ����� R5 �Ӿ�����
      const diffSnapshots = function (oldS, newS) {
        const out = { added: [], removed: [], changed: [], issueFlash: {}, ts: Date.now() }
        if (!oldS || !oldS.ok || !Array.isArray(oldS.maps)) return out
        if (!newS || !newS.ok || !Array.isArray(newS.maps)) return out
        const lbl = function (x) { return (x.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name }).sort().join(',') }
        const idx = function (snap) { const m = {}; snap.maps.forEach(function (x) { m[x.number] = x }); return m }
        const a = idx(oldS), b = idx(newS)
        // ��Ʊ���仯����Ʊ�Աȣ�����/����� issueFlash����һ�仯 �� �� map ���� changed��map ������ͼ������
        //   �ֶ�ʵ֤��#458 ���飩��map ��Ʊ�ڿ������� tickets���� issues����Ʊ���仯 = state/progress/claimedBy/labels
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
      // R5��������ʱ��������ѻ���һ��ֻ��һ�� timer��
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
      // ���գ�#346���������Դ��force �� wf.refresh ȫ���ؽ���wf.snapshot �� 5s ���棩
      // #58 �������ȣ��� cwd �ڴ���� + �� cwd ͬ���������׿��� cwd ̽· miss ���浼�� 100-400ms �� loading
      const loadSnapshot = function (st, force, silent) {
        const doLoad = function () {
          // #370 ��Ҫ�۲죺force ˢ��ʱ���� snapLoading �����������е����ˢ�¡����� no-op��
          if (st.snapLoading && !force) return Promise.resolve()
          if (conn === undefined || conn.rpc === undefined) {
            st.snapMode = 'err'
            st.snapError = tr('err.hostUnavailable')
            emit(st)
            return Promise.resolve()
          }
          // #58 ��ˮ�� per-cwd ���棬ʵ���뿪
          hydrateFromCache(st)
          const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
          st.snapLoading = true
          // v1.5 T9��silent����̨��Ĭˢ�£�����ʾ�������֡��������� toast
          // #58 �������ȣ����л���ʱ����ʾȫ�� loading����Ĭˢ��
          if (force && !silent && !hasCache) st.snapMode = 'loading'
          emit(st)
          const args = st.cwd ? { cwd: st.cwd } : {}
          const p = force ? rpcCall('refresh', args) : rpcCall('snapshot', args)
          return p.then(function (snap) {
            st.snapLoading = false
            if (snap && snap.ok === true && Array.isArray(snap.maps)) {
              // v1.5 T10 R4�����ݲ����� diff���¾ɿ��նԱȣ����� ������ͼ������ R5 �Ӿ�
              st.lastDiff = diffSnapshots(st.snapshot, snap)
              st.rowFlash = {}
              st.issueFlash = {}
              var _df = st.lastDiff
              _df.added.forEach(function (n) { st.rowFlash[n] = 'added' })
              _df.changed.forEach(function (n) { st.rowFlash[n] = 'changed' })
              if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k) { st.issueFlash[Number(k)] = _df.issueFlash[k] })
              // R5 �Ӿ����б仯����ʾ + ��ʱ������������ѻ���
              if (_df.removed.length) flash(st, tr('panel.diffRemoved', { n: _df.removed.length }), 'info')
              scheduleFlashClear(st)
              st.snapshot = snap
              st.snapMode = 'real'
              st.snapError = null
              try { const c = snap.repoRoot || st.cwd; if (c) setCachedSnapshot(c, snap) } catch (e) { /* ���� */ }
              try { if (st.cwd) setCachedSnapshot(st.cwd, snap) } catch (e) { /* ���� */ }
              // v1.5 T10������Զ��仯̽�⣨�ݵȣ����վ�������Ч��
              startAutoProbe()
              // v1.5 B5 �޶������̻����뿪��fromCache���� ���� 400ms ǿ��ȫ��ˢ�£�ԭÿ�δ���� = 1 �ζ��� wf.refresh �� 18 GraphQL �㣬��ֿ�ɱ��Ŵ󣩣��仯����ɵ�Ƶ probe �ӹ�
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
        if (!st.cwd) {
          const sync = getCwdSync(st.sessionId)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        }
        if (!st.cwd && st.sessionId && typeof conn !== 'undefined' && conn.rpc !== undefined) {
          return rpcCall('cwd', { sessionId: st.sessionId }).then(function (res) {
            if (res && res.ok && res.cwd && !st.cwd) { st.cwd = res.cwd; hydrateFromCache(st); emit(st) }
            return doLoad()
          }).catch(function () { return doLoad() })
        }
        return doLoad()
      }

      // v1.5 R2��#2 MVP �� 2026-08-18�����Զ�ˢ�� �� probe �� since ʱ���̽��ȫ issue ����
      //   ��#348 + v1.5 T10 B5�����ֹѪ �� ��һ��ԭ������������� probe ���� 60s���û���֪��ֵ �� R1 �� 5min����
      //   �� changed ֻˢ���뱾��̽�� cwd ��ͬ�� store����ֿ�Ự��������������
      //   �� focus �������� ��60s�����������л����ٷ���գ���
      //   �� R1 ����probe ��Χ�� `labels=wayfinder:map`������ͼ������ `since=<ISO>`��ȫ issue������Ʊ������ �� host �� `case 'probe'`��
      const PROBE_MS = 60000
      const FOCUS_PROBE_MIN_MS = 60000
      let lastFocusProbe = 0
      // v1.5 T10 R9��Q4 �İ� �� DESIGN.md 12.2�����ؼ��������ӳ�̽�� ���� ���/ִ��/���Ӻ���御�췴ӳ GitHub �仯��
      //   ������һ��ֻ��һ����+ ̽�Ȿ�� 1 ������ REST����ȫ
      let _actionProbePending = false
      const probeNow = function (fromFocus) {
        if (conn === undefined || conn.rpc === undefined) return
        if (fromFocus) {
          const now = Date.now()
          if (now - lastFocusProbe < FOCUS_PROBE_MIN_MS) return
          lastFocusProbe = now
        }
        // #45 �޸���2026-08-20�����๤�����첽�ص������Ҳ���崮̨
        // ����ԭʵ�־� shared���������㲥�¿��յ����� stores��Object.keys(stores).forEach������ shared.cwd ����д��
        //   ���¹����� A ���첽�����probe changed���� A �Ŀ���д�� B �� store���Ҳ���塰��̨����ʾ�ǵ�ǰ���������ݡ�
        // �޸����� cwd ������� ���� ͬ cwd ���ڹ��� 1 �� GraphQL��primary load �� ���¿��������������Ⱦ��
        //   ����·���� sessionId��cwd ��ȷӳ�丳ֵ������������׸� cwd ������п� store��
        const refreshGroup = function (cwd) {
          return rpcCall('probe', { cwd: cwd }).then(function (res) {
            if (!(res && res.ok && res.changed)) return
            const group = []
            if (shared.cwd === cwd) group.push(shared)
            Object.keys(stores).forEach(function (k) {
              const st = stores[k]
              if (st.cwd === cwd) group.push(st)
            })
            if (!group.length) {
              if (typeof conn !== 'undefined' && conn.rpc !== undefined) {
                rpcCall('refresh', { cwd: cwd }).catch(function () {})
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
            }).catch(function () { /* ���� */ })
          }).catch(function () { /* ̽��ʧ�ܺ��� */ })
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
          Promise.all(sids.map(function (sid) { return rpcCall('cwd', { sessionId: sid }).catch(function () { return null }) })).then(function (results) {
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
        // v1.5 R2-fix���� reload ����� timer��dev_reload_package �� JS setInterval ���Զ������
        //   ��� timer ���д��� probe �˷���
        if (typeof globalThis !== 'undefined' && globalThis.__dswsOldProbeTimer) {
          try { clearInterval(globalThis.__dswsOldProbeTimer) } catch (e) { /* ���� */ }
          globalThis.__dswsOldProbeTimer = null
        }
        shared._probeTimer = setInterval(function () { probeNow(false) }, PROBE_MS)
        if (typeof globalThis !== 'undefined') globalThis.__dswsOldProbeTimer = shared._probeTimer
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', function () { probeNow(true) })
      }

      // v1.5 T10 R7���û��İ壩���ֶ�ˢ�£�״̬�������¡�/ �б��ˢ�¡�/ ���ҳ�����¼�项��
      //   �߾�Ĭ·�� ���� ��ȫ�����֡������㣻��ť spinner ��ʱ����������ʽ DOM ֱ���������� React ����Ⱦ��
      //   CSS �����ߺϳ��̣߳���ʹ���̱߳�����Ⱦռ�ã�תȦ�ճ��ɼ�
      const spinAll = function (on) {
        if (typeof document === 'undefined') return
        try {
          const els = document.querySelectorAll('[data-dsws-host] .dsws-rficon')
          for (let i = 0; i < els.length; i++) els[i].classList.toggle('dsws-spin', on)
        } catch (e) { /* ���� */ }
      }
      const refreshAll = function (st) {
        if (st.refreshing) return
        st.refreshing = true
        // �ȷ� RPC���첽�����أ����ٴ�����Ⱦ ���� ��������Ⱦ��ס��������
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

      // #376������弴��֤���� ���� δ����/ʧ�� �� force ���أ��С������С���������
      //   �Ѿ��������ڣ�>60s���� �������أ��Ѿ��������ʣ���60s���� ֱ��չʾ���ظ���������Ѻã���
      //   force ���� snapLoading ����������#370 ���ޣ��������д��������Ҳ����ɲ�չʾ��
      const SNAP_FRESH_MS = 60000
      const snapFresh = function (st) {
        if (!st.snapshot || !st.snapshot.generatedMs) return false
        try { return (Date.now() - st.snapshot.generatedMs) <= SNAP_FRESH_MS } catch (e) { return false }
      }
      // ����ʽ��#373 �û��İ� 2026-08-14�������Ҳ� details �У�ͣ����һ����ʽ��
      //   ���Ƴ����� Document PiP ����С����Electron �޷����� PiP ���ڡ��������濨�� ���� ���벻�ٺ� pip ��̬����
      //   �� ͣ��/����˫ģʽ���䣨PANEL_MODE_KEY������ ״̬����ͣ����seg ����������������ť��
      //   ��һ���� layout.openDetails()��layout ���񲻿���ʱ�˻�ҳ��������壨�����ף����κ���ڰ�ť����
      const openPagePanel = function (st) {
        // #58 �������ȣ���ͬ���� cwd + ˮ�� per-cwd ���棬ʵ���л�����뿪���� loading ���֣�
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
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
        } else if (isReal || hasCache) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
          loadSnapshot(st, false)
        } else {
          st.snapMode = 'loading'
          emit(st)
          loadSnapshot(st, false)
        }
      }
      // ����壺һ���Ҳ�ͣ����details �У���layout ���񲻿��� �� ҳ�ڶ���
      const openDockPanel = function (st) {
        const ls = ctx.get('layout')
        if (ls && typeof ls.openDetails === 'function') {
          ls.openDetails()
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
        openPagePanel(st)  // layout ���񲻿��� �� �˻�����
      }
      // v1.4����λ�ÿ�ѡ ���� cfg.openIn: 'dock'��details �У�Ĭ�ϣ�/ 'sidebar'��dsh-better-sidebar tab��
      //   better-sidebar ��װʱ���ã�δװ����񲻿��� �� ���� details ��
      // v1.4.1 �޸����в����û��Ӧ����
      //   �� ensureSidebarTab �ݵ�ע�� ���� better-sidebar �� client �������ڱ�ģ����أ�δ���� inject ��������
      //      ע���������ԣ�openTab ǰ ensure һ�α�֤��ע�ᣨ���� openTab ��Ĭ no-op����
      //   �� openTab �� path seed �ߡ������ʹ򿪡��� ���������۵�ʱ�Զ�չ��
      //      �������ʹ򿪲�չ����壬��������ž͡������� = û��Ӧ������
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
          if (!ensureSidebarTab()) { openDockPanel(st); return }  // ע��ʧ�� �� ���� details ��
          // #2-fix��2026-08-19 �û��������»Ự��״̬����岻�����������봫 scope={sessionId}��
          //   better-sidebar �� openTab(seed, scope) �ڲ� `targetSessionId = scope?.sessionId ?? store.getSnapshot().sessionId`��
          //   �»Ựʱ������δ setSession(�� id) �� store sessionId Ϊ undefined �� openTab ��Ĭ return����岻����
          //   ��ʽ����ǰ store �� sessionId ���� reduceFor(scope.sessionId) ·���������� id ��ʼ�����֣����������չ����
          //   ���� st.sessionId ��ֵʱ�� scope����ֵʱ�� {sessionId:undefined} ���� targetsInactiveSession=true �ߴ��֧����
          bs.openTab({ type: 'waystation:map', path: 'waystation:map' }, st.sessionId ? { sessionId: st.sessionId } : undefined)  // path seed �� �����ʹ� �� �Զ�չ�����
          // �� tab ����Ϊ����ѿ�����������ֱ��չʾ��
          // #58 �������ȣ��� openPagePanel ͬ�߼����� per-cwd ˮ��
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
        openDockPanel(st)  // better-sidebar ������ �� ���� details ��
      }
      const openPanel = function (st) {
        // #2-fix��2026-08-19 �û��������»Ự��״̬����ť�Ҳ���岻��������
        //   cfg.openIn �� apply ʱ�̻���װ�侺̬��better-sidebar ���ڱ�ģ����أ����� bsInstalled=false �� openIn ����Ϊ 'dock'��
        //   �����Զ�� openDockPanel������ details �У���better-sidebar ��岻չ�� �� �û��������б��������ʵһֱ����Ⱦ����
        //   ʵʱ��⣺better-sidebar ��ǰ���ã�openTab ���ڣ����û�δ��ʽѡ�� dock �� �� sidebar չ�� better-sidebar��
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

      // v21����ʼ prompt ���� ���� /wayfinder + URL + ͳһ�����䣨�����ڲ�ϸ���Դ��������ظ����䣩
      // v25 �� T2b��execute ��ģ����Ⱦ��templates.execute ��Ĭ�ϣ���ǰ׺���� = cfg.withWayfinder
      // v1.3.3 #10��ǰ׺ȥ�� ���� ģ�壨���û��Զ����ģ�壩������ /wayfinder ��ͷ�����ظ�ƴ��
      const withWayfinderPrefix = function (body) {
        if (!cfg.withWayfinder) return body
        if (/^\/wayfinder\b/.test(String(body || '').trim())) return body
        return '/wayfinder\n' + body
      }
      const startText = (st, t) => {
        const url = 'https://github.com/' + repoStr(st) + '/issues/' + t.number
        // v1.4��T2 #443����map ���ƽ�ʽ prompt�����ؼ��ܡ�����map������һ��issue��ִ�У�����ͨ issue �� execute ģ��
        const isMap = (t.labels || []).some(function (l) { return (typeof l === 'string') ? l === 'wayfinder:map' : l.name === 'wayfinder:map' })
        // v1.5 B2��map prompt Ƕ�� map ��ʶ�����/����/���ӣ����»Ự���١��Ҳ�����Ӧ ISSUE��
        // v1.5 B2 �޶����û��İ壩���»Ự/ִ�� prompt ������״̬ ���� map ���̬ �� ���ȷ�� prompt��������ɡ���ťͬ���壩��
        //   δ��� �� �ƽ�ʽ��ͳһ�� map ��ʶ�����/����/���ӣ����»Ự���١��Ҳ�����Ӧ ISSUE��
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
          // v1.5������ + ����ǰ�ã��û����򣺾������ prompt ��ͷ = /wayfinder + ISSUE ���ӣ�
          // T13��map �ƽ�ͬ���ҽ׶�բ�ţ��ƽ���Ʊ��� needs-triage ��������ϣ�
          const gateText = promptText('stageGate')
        return '/wayfinder\n' + url + '\n\n' + MAP_EXECUTE_PROMPT() + (gateText ? '\n\n' + gateText : '') + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + head
        }
        const body = renderTemplate('execute', { number: String(t.number), url: url, title: t.title })
        return withWayfinderPrefix(body)
      }
      const SESSION_TITLE_PREFIX = '[MattSkills]'
      const newSessionTitle = (t) => SESSION_TITLE_PREFIX + ' ' + t.title + ' #' + t.number
      // v1.5 T6������ wayfinder prompt ���� /wayfinder + �ֿ���Ϣ + �����������û��İ壺prompt ���ֿ���Ϣ��
      // T16 ��ǿ��#463 ���� F2������ͼ���ͬ�������ĸ�ʽ��Լ���½� map ���Ĵ�Դͷ������ \\n / BOM��
      const newWayfinderText = (st) => promptText('newWayfinder', { repo: 'https://github.com/' + repoStr(st) }) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '')
      // issue #4������ BUG �� ���� �롸+ ��������ͬ�����»Ự + Ԥ�� /wayfinder prompt + ���ĸ�ʽ��Լ��
      // v2��#1 BUG3 ��ǿ��������λŲ�� BODY_FORMAT ֮��ģ��ĩβ��������;����λ��
      // v3��#14 ���� #13 [T7]�����ֶμ�����Ϊ 4 �� + ����ָ����v3.4��ÿ�ֶΡ��ֶ��������� + �·�������ʾ�����н�����zh/en ����������ԣ���EN locale �л���NEW_BUG_FIELDS_BODY_EN��
      const newBugWayfinderText = (st) => promptText('newBugWayfinder', { repo: 'https://github.com/' + repoStr(st) }) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + (promptLang() === 'en' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY())

      // v10������ = �Ự������ ���� ע�롸�㶪ʧ���ա�prompt��Ĭ���ı��� ��2.5 FIXATE_PROMPT��T2b �ɱ༭��
      const injectFixate = (st) => { inject(st, fixateText()) }

      // v24-48������ ���� ��һ���Զ�ע�� /handoff ģ�壨��ʱ����ļ��� + �����䣩�������ʱ�����
      // �ڶ������ȶ�����һ��ģ�����ͬһ���ļ�����ģ��дʲô���Ͷ�ʲô�������ٲ�Ŀ¼���¾��ļ�������
      // ����δ�����һ������ˢ�º󣩲Ż��� host ������ʵ���ĵ���+ ���� + ���¿հ׻Ự
      // v25 �� T2b��F1 ������������������ģ����Ⱦ��{ts} ��һ��ע��ʱ���ɲ����䣻
      //   {file} = ��һ��ģ����Ⱦ���������ʵ���ļ������û����ļ����ṹҲһ�£�������ʧ�ܶ��� handoffTs + '.md'
      let handoffTs = null  // v24����һ��ģ��ʹ�õ�ʱ������ڶ������ȸ���ͬһ�ļ�����
      let handoffFile = null  // v25 F1����һ����Ⱦ���������ʵ�ʽ����ļ��������û��Զ���ṹ��
      const handoffPrompt = function (ts) {
        return renderTemplate('handoff1', { ts: ts })
      }
      // �ӵ�һ��ע���ı����� .scratch/handoff/<name>.md ��ʵ���ļ�����T1 ��� ��2 ���� 1��
      const extractHandoffFile = function (text) {
        const m = String(text || '').match(/\.scratch\/handoff\/([^\s"'`]+\.md)/)
        return m ? m[1] : null
      }
      const handoffReadText = function (file) {
        if (file) return renderTemplate('handoff2', { file: file })
        return promptText('handoffRead')
      }
      // ��ỰԤ�issue #12 BUG4 r3 �ռ��޸���������������������Ѳ೹������ deps Ϊ [props.sessionId]��
        //   ��ǰ�Ự�� props ����Ⱦ�����ٴ��� effect ���ܣ��Ӹ�������������ǰ�Ự effect �������ѡ���̬��
        let pendingDraft = null
let pendingDraftTargetSid = null
      // ����1��2026-08-18�������Ӱ�ť = ��һ����ע�� /handoff ģ�壬���ٱ��֣������»Ự���ӡ�С��ť = ԭ�ڶ����߼�
      // ����1�����׶� rev��2026-08-18������/��˫̬����ʵ���� = ������ȷʵ���ڽ����ĵ���handoffLatest ̽�⣩��
      //   probeHandoffReady��̽�� �� д st.handoffReady + emit���Ұ�����/�� + ����/��ֹ �Ŀ��أ����κ�·�������������ĵ�ʱ���»Ự��
      // issue #12 BUG4 �� ��·����r2 �ռ���̬�����û��յ����һ����handoffFile ���裩�� ֱ���� handoffFile ��Ϊ prompt
      //   �ļ��� + ������**�������**�����ɣ�prompt �������һ��ע��� `/handoff` ģ��ʱ���һ�£��û��ӽǵġ������ı�Ӧ�ö�Ӧͬһ���ĵ�������
      //   ���� AI ��û���̣�handoff-open ��ӦԤ�� handoffFile����֤���� prompt һ�£����� AI ��ûд���»Ự `/read` ��ʧ�� ���� ���� AI ��Ϊ���⡣
      //   δ�����һ����handoffFile=null����ˢ�º� / ֱ�ӵ��Ұ룩�� �� handoffLatest ̽����ȡ mtime ���¡�
      //   ʼ�շ��� Promise.resolve(done(...))���õ��÷���doHandoffOpen / probe chain�����ȶ� .then��
      const probeHandoffReady = function (st) {
        const cwdArg = st.cwd ? { cwd: st.cwd } : {}
        const done = function (file) { st.handoffReady = !!file; emit(st); return file }
        if (conn === undefined || conn.rpc === undefined) { done(null); return Promise.resolve(null) }
        // ��·����handoffFile ���� �� ֱ�ӷ�������prompt �������һ��ģ��ʱ���һ�� �� r2��
        if (handoffFile) return Promise.resolve(done(handoffFile))
        // ��·����handoffFile=null��ˢ�º� / ��δ���һ������ �� handoffLatest ̽����
        return rpcCall('handoffLatest', cwdArg).then(function (res) {
          return done((res && res.ok && res.file) ? res.file : null)
        }).catch(function () { return done(null) })
      }
      const doHandoff = function (st) {
        handoffTs = timeStampStr()
        const text = handoffPrompt(handoffTs)
        handoffFile = extractHandoffFile(text) || (handoffTs + '.md')
        inject(st, text)
        flash(st, tr('toast.injectedHandoff'), 'ok')
        // r2��handoffFile ����� probeHandoffReady ֱ�����������ٵȴ������̣�
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
        // ������ v3��2026-08-18 rev�������۱��Ự�Ƿ�����һ����һ����̽�������ʵ�ĵ�����
        //   �� latest �� �� ready + ���п��»Ự��û�� �� toast ���������ȵ㡸���ӡ����ɽ����ĵ����������򿪿ջỰ
        probeHandoffReady(st).then(function (file) {
          if (file) finish(file, tr('toast.copiedHandoffFile', { file: file }))
          else flash(st, tr('toast.handoffGrey'), 'warn')
        })
      }

      // #361�����»Ự�д� ���� ͬ cwd + �Զ����� + Ԥ��ָ��
      //   ��Լ��dsh-client-runtime ISessions����create({cwd}) �� SessionId��scope(sid) �� AgentContext��
      //   sessionOf(ctx) �� SessionFace.rename(title)��open(sid) �л�����һ��ʧ�ܽ���Ϊ��ǰ�Ựע�� + ���ѡ�
      const openTextInNewSession = function (st, text, title) {
        const sessions = ctx.get('sessions')
        const doFallback = function () {
          inject(st, text)
          flash(st, tr('toast.newSessionManual', { title: title }), 'warn')
        }
        if (!sessions || typeof sessions.create !== 'function') { doFallback(); return }
        // v1.5���»ỰĬ�ϼ̳С����ʱ���ڻỰ���Ĺ�������st.cwd����
        //   ȱʧʱ��ʱ�� host ����������� tab / StatusBar δ���س������ף�
        const ensureCwd = function () {
          if (st.cwd) return Promise.resolve(st.cwd)
          if (conn !== undefined && conn.rpc !== undefined && st.sessionId) {
            return rpcCall('cwd', { sessionId: st.sessionId }).then(function (res) {
              if (res && res.ok && res.cwd) { st.cwd = res.cwd; return res.cwd }
              return null
            }).catch(function () { return null })
          }
          return Promise.resolve(null)
        }
        ensureCwd().then(function (cwd) {
          if (!cwd) { doFallback(); return }
          sessions.create({ cwd: cwd }).then(function (sid) {
            // v1.5���»Ự�̳е�ǰ���գ�ͬ�ֿ�ͬ cwd������ ���/״̬�����ԣ������仺��ȫ���ؽ�����
            const ns = storeOf(sid)
            if (ns && st.snapshot) { ns.snapshot = st.snapshot; ns.snapMode = 'real'; ns.cwd = cwd }
            // �Զ�������ʧ�ܲ������򿪣�
            try {
              const scopeCtx = sessions.scope(sid)
              const face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined
              if (face && typeof face.rename === 'function') face.rename(title).catch(function () { /* ����ʧ�ܺ��� */ })
            } catch (e) { /* ����ʧ�ܺ��� */ }
            // Ԥ��»Ự dock ���غ� StatusBar ���� pendingDraft���뽻�ӿ��»Ựͬ���ƣ�
            pendingDraft = text
          pendingDraftTargetSid = sid
          sessions.open(sid)
            flash(st, tr('toast.newSessionOpened'), 'ok')
          }).catch(function () { doFallback() })
        })
      }
      // #361 ԭ��ڣ��м������»Ự�򿪡������rowActionText �ı� + Ʊ����������
      const openInNewSession = function (st, x) {
        openTextInNewSession(st, rowActionText(st, x), newSessionTitle(x))
      }
      const inject = (st, text) => {
        if (st.injector) { st.injector(text); flash(st, tr('toast.injected'), 'ok') }
        else copyText(st, text, tr('toast.copiedFallback'))
        // v1.5 T10 R9��Q4 �İ壩���ؼ����������/ִ��/����/���죩���ӳ�̽�⣬��御�췴ӳ�仯
        scheduleActionProbe()
      }
      // v1.6�����ܰ�װ�������ձ�� PROMPTS ע����installSkills ��Ŀ�������·� promptText('installSkills') ����
      // v1.5 �����������ⲿ URL��gh ��װ/��¼�ĵ���
      const openUrl = function (url) { try { if (typeof window !== 'undefined' && window.open) window.open(url, '_blank') } catch (e) { /* ���� */ } }
      const copyText = (st, text, okMsg) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { flash(st, okMsg || tr('toast.copied'), 'ok') }).catch(function () { flash(st, tr('toast.copyFailed'), 'warn') })
        } else flash(st, tr('toast.clipboardUnavailable'), 'warn')
      }

      // ============================================================
      // 5. ���
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

      // ---- 5.2 ������״̬�������� 1A ���н��� �� ��������״̬�� �� cwd ���� �� v14 �������ȿ� + ���ӶΣ�----
      const StatusBar = (props) => {
        const sid = props && props.sessionId
        const s = useStore(sid)
        // v15-27������Ȩ�� cwd ���� SessionSummary.cwd���Ự�б����������ͬԴ�����滻�ֶ����²���
        const summaryCwd = props.useSessions(function (x) {
          return (sid && x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined
        })
        // v14-20 �� r3����ỰԤ����ӿ��»Ự���� dock ���ؼ����ѣ���
        // issue #12 BUG4 r3 �ռ��޸��������ʽ����
        //   �ؼ��Ķ���effect deps �� [props] ��Ϊ [props.sessionId]��
        //   ��ʵ�� [props] �������� ws.startSession ������������Ⱦ �� ��ǰ�Ự�� props ���ñ� �� ��ǰ�Ự effect ���� �� �������� pendingDraft��
        //   ��ʵ�� [props.sessionId] ֻ�� sid �仯ʱ�ܣ���ÿ���Ựֻ�ڳ��� mount ��һ�Σ���
        //     �� ��ǰ�Ự��sid ���ڲ��� �� effect ������ �� ����������
        //     �� �»Ự��sid �������� �� effect ��һ�� �� ���� pendingDraft
        //   consumedDraftRef ����������Ϊ belt-and-suspenders����ʹ��� remount��ͬ sid �ַ�������
        //     ref ���ܷ�ֹ effect ���롣
              // r4：consumedDraftRef 按 sid 存储 + pendingDraftTargetSid 锚定新会话，防止 boolean 常驻阻断后续注入
      const consumedDraftRef = React.useRef(null)
      // 注入器常驻：只要 inputActions 就位就挂到 s.injector（不依赖 pendingDraft）
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
          // 若有目标 sid 锚定，则仅目标会话消费；无锚定（handoff 兼容）则任意新会话可消费
          if (pendingDraftTargetSid && pendingDraftTargetSid !== props.sessionId) return
          consumedDraftRef.current = props.sessionId
          const text = pendingDraft
          pendingDraft = null
          pendingDraftTargetSid = null
          props.inputActions.setDraft(text)
        }
      }, [props.sessionId, props.inputActions])
        React.useEffect(function () {
          probeHandoffReady(s)  // ����1�����׶� rev�����ؼ�̽�� .scratch/handoff/������ʵ�ĵ����޾����Ұ��/��
        }, [])
        // v13���Ự����Ŀ¼̽�� ���� ���� sessionId �仯���ܣ��л��Ի��ش�������
        // v15-27������ SessionSummary.cwd������Ȩ��������ѡ props.session ֱȡ����� host wf.cwd ���ס�
        // cwd �仯�����������������飨�������/״̬������ʾ�ɲֿ����ݣ���
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
          if (sid && conn !== undefined && conn.rpc !== undefined) {
            rpcCall('cwd', { sessionId: sid }).then(function (res) {
              if (res && res.ok && res.cwd) apply(res.cwd)
            }).catch(function () { /* �������� cwd */ })
          }
        }, [sid, summaryCwd])
        // v1.5������ʱ�������ݣ���60s�����»Ự�̳еĿ��գ��������أ������仺��ȫ���ؽ�����
        React.useEffect(function () { loadChecks(s, false); if (!snapFresh(s)) loadSnapshot(s, false) }, [])
        // v18-30���ɽ�/ռ�� = �б� open issue �ھ���������б�һ�£�
        const fr = frontierCount(s)
        const bugN = bugCount(s)
        const triageN = triageCount(s)
        const n = readyCount(s)
        const timeStr = timeOf(s.snapshot) || (s.checksUpdatedAt ? s.checksUpdatedAt.slice(5, 16) : '') || '-- --:--'
        const setup = setupCheck(s)
        const amber = s.checksMode === 'real' && setup && setup.level !== 'ok'
        // v1.5 T11�����ļ����׼���⣨��� 9��
        const skillsCheck = (s.checks || []).find(function (c) { return c.id === 9 })
        const skillsBad = s.checksMode === 'real' && skillsCheck && skillsCheck.level !== 'ok'
        // v1.5 �������������û��İ� 2026-08-17����gh CLI �� gh ��¼ �� setup �� ���� ���� banner ��ʾ�������ϵ�һ��ȱʧ��
        const ghCliCheck = (s.checks || []).find(function (c) { return c.id === 4 })
        const ghAuthCheck = (s.checks || []).find(function (c) { return c.id === 5 })
        const ghCliBad = s.checksMode === 'real' && ghCliCheck && ghCliCheck.level !== 'ok'
        const ghAuthBad = s.checksMode === 'real' && ghAuthCheck && ghAuthCheck.level !== 'ok'
        const go = function (tab) { s.tab = tab; openPanel(s) }
        // v14-22���������̶���λ���ȿ������ 5ch �� '98/99'���ɽ�/ռ�� 2ch��
        const num = (txt, minW) => h('span', { className: 'dsws-num', style: minW ? { minWidth: minW } : null }, txt)
        const seg = (icon, label, color, onGo, title) => h('span', { className: 'dsws-seg', onClick: function (e) { e.stopPropagation(); onGo() }, title: title || '', style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: color } }, [
          Ic({ n: icon, size: 12 }),
          label,
        ])
        // #16 V2��2026-08-18 ���ֺ�����ƣ���dn/dw ��ֵ��ϵ��������dn �ź�Դ R5 ���Ϊ��������wrapper�����
        //   Ĭ�� 1280 �ӿ����������� 812px��dn=0 �������� �� ����Ĭ��ȱƷ���֡�
        //   ��Ϊ��������Ӧ������������ #15 tabs����applyFold ȫչ���� data-fold-priority ����
        //   ����۵����� span��.dsws-folded �� display:none����ֱ�� scrollWidth �� clientWidth��
        //   ���ȼ� = ��Ϣ��ֵ��Ʒ��(1) �� ����(2)/����(3)/ˢ����(4) �� �ɽ�(5)/BUG(6)/���(7)/����(8) �� ʱ��(9)��
        //   �۵��� React �ⲿ DOM class ������React ����Ⱦʱ className prop ���� �� classList �ֶ��仯�������
        const inputRef = React.useRef(null)
        const foldRef = React.useRef(null)
        const bugAnchorRef = React.useRef(null)
        const skillAnchorRef = React.useRef(null)
        const bugCloseRef = React.useRef(null)
        const skillCloseRef = React.useRef(null)
        const [iw, setIw] = React.useState(780)
        // issue #22������ wrapper ���ֲü�ְ�𣻸���λ����ê�� viewport rect ��ʾ��
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
          clearClose(skillCloseRef); clearClose(bugCloseRef)
          let changed = false
          if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
          if (!s.skillsOpen) { s.skillsOpen = true; changed = true }
          if (placeSkillPop()) changed = true
          if (changed) emit(s)
        }
        React.useEffect(function () {
          if (!s.bugMenuOpen && !s.skillsOpen) return undefined
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
            clearClose(bugCloseRef); clearClose(skillCloseRef)
          }
        }, [s.bugMenuOpen, s.skillsOpen])
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
            try { setIw(inputRef.current.getBoundingClientRect().width) } catch (e) { /* ���� */ }
          }
          applyInput()
          const roInput = new ResizeObserver(applyInput)
          if (inputRef.current) roInput.observe(inputRef.current)
          // �۵����㣺capsule ���=iw���仯 / ���� resize / ������غ󣨷����������У�
          const roFold = new ResizeObserver(function () { applyFold() })
          const applyAll = function () { applyInput(); applyFold() }
          applyFold()
          if (foldRef.current) roFold.observe(foldRef.current)
          window.addEventListener('resize', applyAll)
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyFold)
          // DSH shell ż�����ڶԻ��л�ʱ���¹��� textarea����ѯ�����ض�
          const poll = setInterval(applyAll, 2000)
          return function () {
            try { roInput.disconnect() } catch (e) { /* ���� */ }
            try { roFold.disconnect() } catch (e) { /* ���� */ }
            window.removeEventListener('resize', applyAll)
            clearInterval(poll)
          }
        }, [])
        const capsule = h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { openPanel(s) }, style: { position: 'relative', width: iw + 'px', maxWidth: iw + 'px' } }, [
          h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
            Icon({ scheme: s.ui.icon, size: 14 }),
            h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
          ]),
          seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; go('list') }, tr('nav.takeableTitle')),
          // issue #4��BUG ������ ���� ����Կ� bug �����б����ͣ�����������˵����»ỰԤ�� /wayfinder ���� BUG �� prompt��
          h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
            seg('alert', [h('span', { 'data-fold-priority': 6 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') }, tr('nav.bugTitle')),
            s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
              h('div', { onClick: function (e) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
                Ic({ n: 'bug', size: 12, color: '#f87171' }),
                h('span', null, tr('nav.bugNew')),
              ]),
            ]) : null,
          ]),
          seg('search', [h('span', { 'data-fold-priority': 7 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') }, tr('nav.triageTitle')),
          // #16 V2��note �Σ����� / Consolidate������ span �� data-fold-priority=2�������ֲ����Σ���Ϣ��ֵ�ͣ����գ�
          seg('note', h('span', { 'data-fold-priority': 2 }, tr('nav.word')), '#c084fc', function () { injectFixate(s) }, tr('nav.fixateTitle')),
          // ����1�����׶Σ�2026-08-18�������ӷָť ���� ����� + ϸ�ָ��ߣ���롸���ӡ�= ��һ�����ɡ�
          //   �Ұ롸���ӳ�ȥ��= ԭ�ڶ�����̽����������ĵ� �� Ԥ�� + ���»Ự�������Ե����/tooltip �����hover ���� seg ������
          //   �Ұ��/��˫̬��handoffReady �� ���� #58a6ff��tooltip nav.handoffReadyTitle����δ ready �� ��͸���ң�tooltip nav.handoffGreyTitle��
          // #16 V2��split-part ��롸���ӡ����� span �� data-fold-priority=3�������ֲ����Σ�
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
          // v19-36������������ĩβ��������ࣩ���û��ٵ�
          seg('dot', [h('span', { 'data-fold-priority': 8 }, tr('nav.env')), num(envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') }, tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) })),
          // v1.5 T10��ˢ�·��� = ͼ��תȦ�����ֺ㶨���� �� �ؼ������仯��
          // #16 V2��timebtn �������ָ��� priority��ˢ����=4 �����ֲ����� / ʱ��=9 ���ο�ʱ�������գ�
          h('span', { className: 'dsws-timebtn', onClick: function (e) { e.stopPropagation(); refreshAll(s) }, title: tr('nav.refreshTitle') }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 4 }, tr('nav.refresh')), h('span', { 'data-fold-priority': 9 }, ' ' + timeStr)]),
          // ����2��2026-08-18����״̬��ĩβ�����б��ť ���� ����չ���������б��������������� /<������> ����ǰ�Ự
          // issue #3��D2�������� BUG �������˵� ���� ��ͣ��չ�����Ƴ�����ť + �б���������򼴹رգ�
          //   ��ť���б�֮��� 4px ��϶����� paddingTop �Žӣ������� marginBottom������괩Խ����ء�
          h('span', {
            style: { position: 'relative', display: 'inline-flex' },
            ref: skillAnchorRef, onMouseEnter: showSkillPop,
            onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) }
          }, [
            h('span', { className: 'dsws-skillbtn' + (s.skillsOpen ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.skillsOpen) closeSkillPop(); else showSkillPop() }, title: tr('nav.skillsTitle'), style: { display: 'inline-flex', alignItems: 'center', padding: '1px 4px', borderRadius: 4, cursor: 'pointer', color: s.skillsOpen ? '#c084fc' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [Ic({ n: 'skills', size: 12 })]),
            s.skillsOpen ? PortalOverlay({ className: 'dsws-skillpop-bridge', onMouseEnter: function () { clearClose(skillCloseRef) }, onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) }, style: { position: 'fixed', right: s.skillPopPos ? s.skillPopPos.right : 0, bottom: s.skillPopPos ? s.skillPopPos.bottom : 0, paddingTop: 4, paddingBottom: 4, zIndex: 2147483000 }, onClick: function (e) { e.stopPropagation() } }, [
              h('div', { className: 'dsws-skillpop', style: { minWidth: 150, maxHeight: 'min(300px, calc(100vh - 24px))', overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)', padding: 4 } }, [
                // �������䣺����Ƶ������������ָ��㣨��������ԭ�� title �����ӳ٣�
                SKILLS.map(function (sk) {
                  return h('div', {
                    key: sk.name,
                    onClick: function (e) { e.stopPropagation(); inject(s, '/' + sk.name); closeSkillPop() },
                    onMouseEnter: function (e) {
                      const r = e.currentTarget.getBoundingClientRect()
                      // ����ʵ�� = maxWidth 220 + �����ڱ߾� 16 + �߿� 2 = 238����ת��ֵ��ʵ����룬�������ߣ�
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
                // �ײ�������ʾ��������Ƴ����б����λ�����ֶ�������������
                h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '5px 8px 2px', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 2, whiteSpace: 'nowrap' } }, tr('nav.skillHint')),
              ]),
            ]) : null,
          ]),
          // ����������ʾ��portal �� document.body��issue #3��D1����������״̬��������position:fixed ��
          //   �ӿ������� z-index ȫ����Ч�����ٱ����������������ü��ѹ��
          s.skillTip && s.skillHover ? portalTop(h('div', { style: { position: 'fixed', left: s.skillTip.x, top: s.skillTip.y, transform: 'translateY(-50%)', maxWidth: 220, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)' } }, tr('skilldesc.' + s.skillTip.name))) : null,
        ])
        // �û��İ� 2026-08-16 + 2026-08-17������Ƶ�״̬���Ϸ��������� gh �� ��¼ �� setup �� ���ܣ���ʾ��һ��ȱʧ��
        const firstBlock = ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
        // #16 v1.6.4 R4��wrapper �� overflow:hidden �ص� capsule ��� wrapper ���֣�dn=0..3 �м�״̬ʱ children ���к����ҿ������ wrapper��
        // #16 R6b��ȥ�� alignItems:'stretch'��֮ǰΪ������ capsule ���� wrapper �߶ȣ������ø���
//   composerHero 297px �ߴ��� wrapper ��capsule �������� wrapper ͬ�� ��9.5px�����ֱ��ص��
        // #16 R12�����Σ������� conversation.input.dock ��� = composerStack��column flex����wrapper �� flex item��
//   Ĭ�� flex-shrink:1 �� �������߶ȱ�ѹ��ʱ wrapper ��ѹ�⣨wrapper 11px �� capsule 8px �� overflow:hidden �����֣���
//   R6b ֻ���ˡ������ߡ���û������ѹ�������ʼ� flex:'none'��flex:0 0 auto��˫���ա�
// #22������·���� portal ����ü���� ReactDOM �����ã��˻��ڵ���벻�ٱ��� wrapper �����õ��
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
    // T17��issue ���� markdown ��������Ⱦ��mdToHtml��
    //   ֻ�ϰ������﷨������һ�ɴ��ı�������Ⱦԭʼ HTML���� XSS��
    //   �����׼ HTML ��ǩ �� opencode-palette �����Զ���ɫ��markdownHeading/Link/Code/Emph/Strong��
    //   ����ֵ��React Ԫ�����飨��ֱ����Ϊ h(...) children��
    // ============================================================
    const MD_LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/g
    const MD_TASK_RE = /^- \[([ xX])\]\s*(.*)$/
    const mdEsc = function (s) { return String(s == null ? '' : s) }
    const mdInline = function (text, keyBase) {
      const out = []
      let rest = mdEsc(text)
      let k = 0
      // ����ȡ���ӣ����ڲ� ** ������URL Э��������� javascript:/data: ��Σ��Э�飩
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
      // �ٴ���Ӵ� / б�� / ���ڴ��루�Ƚ�����������ռλ���������ӿ�Ƕ���ı�����λ�ã�
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
        // �б�������й��飩
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
        // ���� / ��ͨ����
        if (trim === '') { i++; continue }
        nodes.push(h('div', { key: 'p' + (k++), style: { margin: '1px 0' } }, mdInline(line, 'p' + k)))
        i++
      }
      if (o.single) return nodes[0] || null
      return nodes
    }
    // ============================================================
    // v1.5 T12��Ʊ������Ⱦ��״̬���� + ������������ open/close ԭ�� + ��������
      const tStatus = function (t) {
        if (t.state === 'CLOSED') return { key: 'done', color: '#3fb950', icon: 'check' }
        if (t.progress === null || t.progress === undefined || t.progress <= 0) return { key: 'todo', color: '#8b8b95', icon: 'dot' } // B4��0% = δ��������Լ�������� doing
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
        const label = (t.state === 'CLOSED') ? '100%' : (t.progress === null || t.progress === undefined ? '��' : t.progress + '%')
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

      // ---- 5.3 Ʊ���У���ͼ�����ڣ�����/������Դ ellipsis��v19������ǩ�� ���/�޸�/����/ִ�� ������Ԥ�������----
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
              // T2 #3�����ǰ��
              h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, flex: 'none' } }, '#' + t.number),
              TypeChip({ type: t.type }),
              h('span', { className: 'dsws-tt-wrap', style: { flex: 1 }, title: t.title }, t.title),
            ]),
            h('div', { className: 'dsws-tt-sub', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              t.claimedBy ? subItem('person', '#58a6ff', tr('map.subClaimed', { who: t.claimedBy })) : null,
              // #370�������� chip ֻ��ʾ�� OPEN �������ߣ��� compute/���б�/��ť���ƿھ�һ�£�
              blocked ? subItem('lock', '#f0883e', tr('map.subBlocked', { who: blockerNames(t, g.m) })) : null,
              t.state === 'CLOSED' ? subItem('check', '#3fb950', tr('map.subClosed')) : null,
              tStatusBadge(t),
            ]),
            (t.state === 'OPEN') ? tProgressBar(t) : null,
          ]),
          t.state === 'OPEN' ? h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: 'none' } }, [
            blocked ? null : mkRowAction(st, t, false, colorOf),
            // #361 ���������ͬ cwd + �Զ����� + Ԥ��ָ���#394��ȥ ghost/icon-only���� nav.handoff ����
            //   marginLeft:4 ����� mkRowAction �γ���ʽ���飨������ vs �����飩
            h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, t) }, title: tr('list.newSessionLabel'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: actionColorOf(t, colorOf), borderColor: 'transparent', color: isLightHex(actionColorOf(t, colorOf)) ? '#140a1e' : '#ffffff' } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))]),
            h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 6px' } }, Ic({ n: 'link', size: 12 })),
          ]) : h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' } }, tr('act.view')),
        ])
      }

      // ---- 5.4 ��ͼ���飨���� 3A ��ֱ���ȣ��ɽ�/������/���������ԣ��ѹر��۵�������������v19 ����ִ�� + ����״̬������----
      const MapDetail = ({ st, g }) => {
        const m = g.m
        const colorOf = buildColorOf(st)
        const tickets = m.tickets || []
        const levels = (m.stats && m.stats.levels) || []
        const totalLayers = levels.length
        // ��ǰ�� = ��һ���� open Ʊ�Ĳ㣨�� open ȫ done �� ���һ�㣩
        const curLevel = (function () {
          for (let i = 0; i < levels.length; i++) { if (levels[i].open > 0) return i }
          return Math.max(0, levels.length - 1)
        })()
        const passedLayers = levels.filter(function (l, i) { return i < curLevel }).length
        const byLevel = {}
        tickets.forEach(function (t) { const lv = (typeof t.level === 'number') ? t.level : 0; (byLevel[lv] = byLevel[lv] || []).push(t) })
        // �����fog Ʊ��Not yet specified��+ ���������������� open ��Ʊ���������D7 �Ӿ��ڱ�
        const isFog = function (t) {
          if (t.state !== 'OPEN') return false
          const blk = (t.blockedBy || []).map(function (b) { return tickets.find(function (x) { return x.number === b }) }).filter(Boolean)
          return blk.some(function (b) { return b.state === 'OPEN' })
        }
        const fogTitles = (m.fog || []).map(function (f) { return String(f).trim() })
        const isFogTitle = function (t) { return fogTitles.some(function (f) { return f && t.title && t.title.indexOf(f) >= 0 }) }
        // v1.4��ͬ�������� ���� ��ִ�У�open �ҷ���������� �� open ������ �� �ѹرտ��ң�һ�ۿ�����ǰ����ʲô��
        Object.keys(byLevel).forEach(function (lv) {
          byLevel[lv].sort(function (a, b) {
            const rank = function (t) {
              if (t.state === 'OPEN') return isFog(t) || isFogTitle(t) ? 1 : 0
              return 2
            }
            return rank(a) - rank(b) || a.number - b.number
          })
        })
        // ������ȥ��״̬��st �ϰ� map �棩
        st.reveal = st.reveal || {}
        const nodeCls = function (t) {
          let cls = 'dsws-node'
          if (t.state === 'CLOSED') cls += ' done'
          else if (t.level === curLevel) cls += ' now'
          const fog = isFog(t) || isFogTitle(t)
          if (fog) { cls += ' fog'; if (st.reveal[m.number] && st.reveal[m.number][t.number]) cls += ' revealed' }
          // R5����Ʊ���仯������issueFlash��
          if (st.issueFlash && st.issueFlash[t.number]) cls += st.issueFlash[t.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed'
          return cls
        }
        const toggleReveal = function (t) {
          st.reveal[m.number] = st.reveal[m.number] || {}
          st.reveal[m.number][t.number] = !(st.reveal[m.number][t.number])
          emit(st)
        }
        const gateState = function (layerIndex) {
          // բ�ţ��ò�ȫ closed �� open(��?)���㺬 open ������֮ǰ��ȫ closed �� open������ lock
          const lv = levels[layerIndex]
          if (!lv) return 'open'
          if (lv.closed === lv.total && lv.total > 0) return 'open'
          const prevAllClosed = levels.slice(0, layerIndex).every(function (p) { return p.closed === p.total })
          return prevAllClosed ? 'open' : 'lock'
        }
        const node = function (t) {
          const blocked = isFog(t)
          // T15��acts ����Ⱦ������CLOSED/fog ��ռλ���� ��Ƭ�߶Ⱥ㶨
          const acts = h('div', { className: 'acts' }, (t.state === 'OPEN' && !blocked) ? [
            mkRowAction(st, t, false, colorOf),
            h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' } }, Ic({ n: 'link', size: 11 })),
          ] : [])
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
                // v1.5 T12�������� + ״̬���£�open Ʊ��ʾ��ʵ���� �� �� 0/13��
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
          // T15�������� + ���Բ�ţ���ǰ���������������������Ӧ
          return [
            h('div', { className: 'dsws-layerbox' + (isCur ? ' cur' : '') }, [
              h('div', { className: 'dsws-layerTag' }, [
                h('span', { className: 'dsws-layerNo' }, String(layerIndex + 1)),
                h('span', { className: 'dsws-layerTitle' }, tr('map.layer', { n: layerIndex + 1 }) + ' �� ' + lv.open + ' open'),
                h('span', { className: 'sp' }),
              ]),
              h('div', { className: 'dsws-layer' }, layerTickets.map(function (t) { return node(t) })),
            ]),
            h('div', { className: 'dsws-gate' }, [
              h('span', { className: 'g ' + gate }, Ic({ n: gate === 'open' ? 'check' : 'lock', size: 12 })),
            ]),
          ]
        }
        // ���̬��ȫ closed �� ������ȫ�� + ����Ȧ
        const allClosed = m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total
        const ringPct = allClosed ? 1 : (totalLayers ? Math.min(1, (passedLayers + 1) / totalLayers) : 0)
        const C = 2 * Math.PI * 31
        const ringOff = C * (1 - ringPct)
        return h('div', null, [
          // ���������У����� + map chip + ִ��/���
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
                  // v1.4��map �ƽ�ʽִ�У�startText ��� wayfinder:map �� MAP_EXECUTE_PROMPT��
                  inject(st, startText(st, m))
                }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11 } }, [
                  Ic({ n: 'play', size: 10 }),
                  h('span', null, tr('act.execute')),
                ]),
            // v1.5 B2��O5��������ҳ�����»Ự�򿪡����� �� ִ��/��� ͬ���壬���»Ự�ƽ��� map
            h('button', { className: 'dsws-btn ghost', title: tr('map.newSessionTitle'), onClick: function () { openInNewSession(st, m) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, flex: 'none' } }, [
              Ic({ n: 'external-link', size: 10 }),
              h('span', null, tr('list.newSessionLabel')),
            ]),
          ]),
          // T14��map ��Ż��� ���� ����ǰ������ɫ�����б� map ��ͬ�dsws-idnum��
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 } }, [
            h('span', { className: 'dsws-idnum', style: { color: '#c084fc', borderColor: '#c084fc', flex: 'none' } }, '#' + m.number),
            h('div', { className: 'dsws-mtitle dsws-tt-wrap', style: { flex: 1, minWidth: 0 }, title: m.title }, m.title),
          ]),
          m.error ? h('div', { style: { color: '#f87171', fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, String((m.error && m.error.error) || tr('list.loadFail')).slice(0, 160))]) : null,
          // D2���ֶξ�̬������ = ��ͼ������ͼ���޶�����Ψһ����Դ��
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
          // T17 �޶���Destination �� markdown ��Ⱦ��**�Ӵ�** �Ȳ�����¶��ȥ ellip ������У�
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }, [Ic({ n: 'target', size: 12, style: { marginTop: 2, flex: 'none' } }), h('div', { style: { flex: 1, minWidth: 0 } }, m.destination ? mdToHtml(m.destination) : tr('list.noDest'))]),
          // T17 �޶����������飨Notes��Ĭ���۵� ���� <details> ���𣬵��չ��
          h('details', { style: { margin: '2px 0 4px' } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
              Ic({ n: 'note', size: 11 }),
              h('span', null, tr('map.notesCap')),
            ]),
            m.notes ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } }, mdToHtml(m.notes)) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 4, paddingLeft: 8 } }, tr('list.noNotes')),
          ]),
          // ©���ֲ�����
          h('div', { style: { marginTop: 2 } }, [
            h('div', { className: 'dsws-start' }, [
              h('span', { className: 'cap' }, tr('map.startCap')),
            ]),
            levels.map(function (l, i) { return layerBlock(i) }),
            // D3��Destination 72px ��ʽ�����������ģ������֣�
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
                // v1.4���ײ���ť�붥��ͬ���� ���� ���̬����ɡ���COMPLETE_PROMPT ͬ�б��/ δ��ɡ�ִ�С���execute ģ�壩
                (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
                  ? h('button', { className: 'dsws-btn primary', title: tr('map.doneTitle'), onClick: function () {
                      const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                      inject(st, text)
                    }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 700 } }, [
                      Ic({ n: 'check', size: 11 }),
                      h('span', null, tr('act.done')),
                    ])
                  : h('button', { className: 'dsws-btn primary', title: tr('map.executeTitle'), onClick: function () {
                      // v1.4��map �ƽ�ʽִ�У�startText ��� wayfinder:map �� MAP_EXECUTE_PROMPT��
                      inject(st, startText(st, m))
                    }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#4ade80', borderColor: 'transparent', color: '#04120a', fontWeight: 700 } }, [
                      Ic({ n: 'play', size: 11 }),
                      h('span', null, tr('act.execute')),
                    ]),
                h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + m.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))]),
              ]),
            ]),
          ]),
          // �۵��飺Decisions / Fog / Out of scope��������Ϣչʾ��
          h('details', { style: { marginTop: 10, marginBottom: 4 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.decisions', { n: m.decisions.length })),
            h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.decisions.map(function (d, i) {
              return h('div', { key: i, style: { margin: '2px 0' } }, [
                h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '�� '),
                (d.url ? h('a', { href: d.url, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, d.title) : h('span', null, d.title)),
                d.gist ? h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, ' �� ' + d.gist) : null,
              ])
            })),
          ]),
          h('details', { style: { marginBottom: 4 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.fog', { n: m.fog.length })),
            h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.fog.map(function (f, i) {
              return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('�� ' + f))
            })),
          ]),
          h('details', { style: { marginBottom: 4 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.outOfScope', { n: m.outOfScope.length })),
            h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.outOfScope.map(function (o, i) {
              return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('�� ' + o))
            })),
          ]),
        ])
      }

      // ---- 5.5 ���б��v14����ѡһ���� / map ��ͻ�� + ��ʼִ�� / �ѹر��۵��� / chips ��߿� / խ��˫����----
      // v1.3.3 UI����2 ��ǩ̰���۵� ���� ��Ⱦ��������ÿ�ȣ�����ű�ǩ���Ų��µ����ؽ� +N�����в����У�
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
      // v1.3.3 UI��+N ���� ���� fixed ��λ����׼ = ������� rect������ clamp ��Խ�磬�����Զ���ת���ã�
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
        ptitle.innerHTML = '<b>' + tr('list.popTitle') + '��</b>' + String(title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
      // ============ T2 #35 �� NoRepo �쿨 + �����ListTab ���������� �� ����= checkRepo:bad && !dismissed��============
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
          card.loading = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
          rpcCall('initPublish', { cwd: st.cwd, name: card.name, visibility: card.visibility }).then(function (res) {
            card.loading = false
            if (res && res.ok) {
              const repoStr2 = res.repo && res.repo.owner ? res.repo.owner + '/' + res.repo.name : (res.repo && res.repo.name ? res.repo.name : card.name)
              flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
              card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
              rpcCall('refresh', st.cwd ? { cwd: st.cwd } : {}).then(function(snap){ if(snap && snap.ok){ st.snapshot=snap; st.snapMode='real'; emit(st)} }).catch(function(){})
              rpcCall('status', Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, { force: true, lang: (typeof promptLang==='function'?promptLang():'zh') })).then(function(r){ if(r && r.checks){ st.checks=r.checks; st.checksMode='real'; emit(st)} }).catch(function(){})
            } else {
              const kind = (res && res.errorKind) || 'unknown'
              const raw = (res && res.error) || ''
              card.errorKind = kind
              card.errorRepoUrl = (res && res.repoUrl) || ''
              const key = 'panel.noRepoErr.' + kind
              const mapped = tr(key)
              const base = (mapped !== key) ? mapped : (raw ? String(raw).slice(0, 160) : tr('panel.noRepoErr.unknown'))
              card.error = base + (raw && base !== String(raw).slice(0, 160) && mapped !== raw ? ' �� ' + String(raw).slice(0, 120) : '')
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
                kind === 'no-git' ? h('a', { href: 'https://git-scm.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '����') : null,
                kind === 'no-gh' ? h('a', { href: 'https://cli.github.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '����') : null,
                kind === 'not-logged-in' ? h('a', { href: 'https://cli.github.com/manual/gh_auth_login', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, 'ȥ��¼') : null,
                kind === 'already-exists' ? h('a', { href: card.errorRepoUrl || ('https://github.com/search?q=' + encodeURIComponent(card.name)), target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, 'ȥ�鿴') : null,
                kind === 'network' ? h('button', { onClick: doSubmit, disabled: card.loading, style: { marginLeft: 8, background: 'transparent', color: col, border: '1px solid ' + col, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, '����') : null,
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
        // v1.3.3 UI��ÿ����Ⱦ��ִ��̰���۵���������/�п�仯�������Ⱦ��
        // v1.5 T10 ���٣�������ָ������ ���� ����������/tab/���˱仯�����ţ�refreshing ̬���޹���Ⱦ���������ֲ�����
        React.useLayoutEffect(function () {
          const fp = String((st.snapshot && st.snapshot.generatedMs) || '') + '|' + st.tab + '|' + st.stateFilter + '|' + (st.lblFilters || []).join(',')
          if (_tagsFpOf.get(st) === fp) return
          _tagsFpOf.set(st, fp)
          fitAllTags()
        })
        const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
        const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' })
        const closedIssues = issues.filter(function (x) { return x.state === 'CLOSED' })
        // #374����ά���� ���� map �к��ö���map ������ͨ����԰���ѡά������Ĭ�� ����ʱ���������״һ�£�
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
            return a.number - b.number  // ͬ�����ף���������ȶ���
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
        // ��ǩͳ�ƣ�open + closed ȫ��������ɫ
        const stat = {}
        const colorOf = {}
        issues.forEach(function (x) {
          (x.labels || []).forEach(function (l) {
            stat[l.name] = (stat[l.name] || 0) + 1
            if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color
          })
        })
        const tagNames = Object.keys(stat).sort(function (a, b) { return stat[b] - stat[a] })
        // #375��ȫ�� label������ labels �ֶ����ȣ��ɿ����޸��ֶν��� issue ͳ�ƣ�����ɫ���� label �б�ɫ
        const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : null
        if (snapLabels) snapLabels.forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
        const labelNames = snapLabels ? snapLabels.map(function (l) { return l.name }) : tagNames.slice()
        // �������˫�����򣺴������� �� ���������� �� ����Ƶ�ν��� �� ������
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
        // v15-26�����б���� map ��Ʊ������Ϣ��open �����߲����������������Կ��� maps.tickets.blockedBy�������������
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
        // #374��״̬���ˣ�ȫ��/Open/����/�ѹرգ��� label ���˵���
        // v1.3.3 T3��blocked ��������ʵ�� ���� open �Ҵ��� open �����ߣ�blockOf ���У�
        const showOpen = st.stateFilter !== 'closed'
        const showClosedList = st.stateFilter === 'closed'
        // v1.5����ѡ��ǩ���ˣ�OR ���壺������һѡ�б�ǩ����ʾ��
        const byLabel = function (x) {
          const ls = st.lblFilters || []
          if (!ls.length) return true
          return (x.labels || []).some(function (l) { return ls.indexOf(l.name) >= 0 })
        }
        const openRows = sortedMaps.concat(sortedOpen)
        const openFiltered = (st.lblFilters && st.lblFilters.length) ? openRows.filter(byLabel) : openRows
        // v1.3.3 #6������ = ��ռ�ÿھ���isOccupied���� assignee ����� open �����ߣ������� KPI��ռ�� N��һ��
        const filteredOpen = showOpen ? (st.stateFilter === 'blocked' ? openFiltered.filter(function (x) { return isOccupied(st, x) })
          : (st.stateFilter === 'frontier' ? openFiltered.filter(function (x) { return !isOccupied(st, x) }) : openFiltered)) : []
        const filteredClosed = showClosedList ? ((st.lblFilters && st.lblFilters.length) ? closedSorted.filter(byLabel) : closedSorted) : []
        const has = function (x, nm) { return (x.labels || []).some(function (l) { return l.name === nm }) }
        const findMap = function (num) { return (st.snapshot && st.snapshot.maps || []).find(function (m) { return m.number === num }) }
        const openBlocked = function (blk) { st.activeMap = blk.map; emit(st) }
        // v14-18��chips ������һ���߿򣨱߿�ɫ = label ɫ HSL ���� -16%��
        const chip = (nm, withCount, on, isAll) => {
          const c = colorOf[nm]
          const borderColor = isAll ? 'rgba(255,255,255,.35)' : (darken(c, 0.16) || 'rgba(188,140,255,.6)')
          const selColor = isAll ? 'rgba(255,255,255,.65)' : (c ? '#' + c : '#bc8cff')
          return h('span', {
            key: nm,
            className: 'dsws-chip',
            // v14-1����ȫ��������չ��˲�����ѡ�У�����ͨ��ǩ toggle �������
            // #375����ѡ���ǵ�����䣨���� + ������ʱ�䣬˫������
            onClick: function (e) {
              e.stopPropagation()
              // v1.5����ѡ toggle ���� ѡ��/ȡ��������ǩ����������
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
        // v14-4���м������� label ��ѡһ�����/�޸�/����/ִ�У���ȫ��Ԥ�������
        // v19������ mkRowAction���б��� map ����ͬ�߼�����ťɫ��̬ȡ label ����ɫ����v14-3 ��ť 80%��v14-19 խ���۵�Ϊ��ͼ��
        // v1.3.3 UI ���壨�û����ȷ�ϣ������нṹ �� ��Ƭ�磨C���� ���/map ���ţ�idcol����
        //   ��1 = ���(��)+map����(��) ���� + ����(ռ��,��2��) + ����Բ������(����)��
        //   ��2 = ��ǩ����̰���۵������խ��,����1��,�Ų��½� +N ������+ ��ť�飨ִ��/���/�»Ự����,����/���� hover��
        //   +N ������fixed ��λ,��׼=�������,clamp ���Ҳ�Խ��,���������ɼ����û����� A ������
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
          // v15-26���������ж���open �����ߣ��� ���ض�����ť + ��ɫ������������ǩ����������� map ���飩
          const blk = blockOf[x.number]
          const blocked = !!(blk && blk.by && blk.by.length)
          // v1.3.3 #8��map �����̬ ���� ��Ʊȫ�أ�total>0 �� closed===total���� ����ť�С���ɡ����̣���ע����βȷ�� prompt
          const mapDone = !!(isMap && mapObj && mapObj.stats && mapObj.stats.total > 0 && mapObj.stats.closed === mapObj.stats.total)
          // v1.5����Ż�����ɫ = �Ҳද����ťͬһ�߼���label ɫ��map ���̬�̣�
          const numColor = mapDone ? '#3fb950' : actionColorOf(x, colorOf)
          // v1.3.3 UI��ȫ����ǩ��Ⱦ����Ⱦ��̰���۵����Ų��µ����ؽ� +N��+N ������ʾȫ����
          const labels = x.labels || []
          const allNames = labels.map(function (l) { return l.name }).join('��')
          const openPop = function (e) {
            e.stopPropagation()
            const trig = e.currentTarget
            const host = trig.closest('.dsws-panel') || trig.closest('[data-dsws-host]')
            showPop(trig, host, labels, x.title)
          }
          return h('div', {
            key: x.number,
            // R5���仯���Ӿ���������꽥�� / ����������
            className: 'dsws-aggrow' + ((st.rowFlash && st.rowFlash[x.number]) ? (st.rowFlash[x.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed') : ''),
            onClick: function () { if (isMap && mapObj) { st.activeMap = x.number; emit(st) } },
            title: (isMap && mapObj) ? tr('list.mapTitle') : undefined,
            style: isMap ? { cursor: 'pointer', borderLeft: '3px solid #c084fc', background: 'rgba(188,140,255,.07)' } : undefined,
          }, [
            // ��1��idcol ���ţ������ map �����£�+ ���� + Բ������
            h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%' } }, [
              h('span', { className: 'dsws-idcol' }, [
                isMap ? h('span', { className: 'dsws-chip dsws-chip-m', style: { fontSize: 11, fontWeight: 600, lineHeight: 1.7, padding: '0 8px' } }, [Ic({ n: 'map', size: 11 }), h('span', null, tr('list.mapChip'))]) : null,
                h('span', { className: 'dsws-idnum', style: { color: numColor, borderColor: numColor } }, '#' + x.number),
              ]),
              h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontWeight: isMap ? 600 : undefined, color: isOpen ? undefined : 'var(--dsw-alias-label-secondary,#a1a1aa)' }, title: x.title }, x.title),
              (isMap && mapObj && mapObj.stats) ? ringOf(mapObj.stats) : null,
              !isOpen ? h('span', { className: 'dsws-chip', style: { fontSize: 10, marginRight: 0, flex: 'none', background: 'rgba(139,139,149,.12)', color: '#8b8b95', border: '1px solid rgba(139,139,149,.35)' } }, [Ic({ n: 'check', size: 9 }), h('span', null, tr('map.subClosed'))]) : null,
            ]),
            // ��2����ǩ̰���۵������в����У�+ ��ť�飨���ԣ�
            h('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, width: '100%' } }, [
              h('div', { className: 'dsws-tags', 'data-dsws-labels': JSON.stringify(labels.map(function (l) { return l.name })) }, [
                labels.map(function (l, i) {
                  return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA(l.color, 0.18) || 'rgba(188,140,255,.16)', color: l.color ? '#' + l.color : '#bc8cff', border: '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)') } }, l.name)
                }),
                labels.length > 0 ? h('span', { key: 'more', className: 'dsws-chip dsws-more', onClick: openPop, title: tr('list.tagsTitle', { names: allNames }) }, '+0') : null,
                blocked ? h('span', { key: 'blk', className: 'dsws-chip dsws-blocked', onClick: function (e) { e.stopPropagation(); openBlocked(blk) }, title: tr('list.blockedTitle', { by: blk.by.map(function (b) { return '#' + b }).join('��') }), style: { fontSize: 10, background: 'rgba(248,113,113,.16)', color: '#f87171', border: '1px solid rgba(248,113,113,.55)', cursor: 'pointer' } }, [Ic({ n: 'lock', size: 10 }), h('span', null, tr('list.blocked'))]) : null,
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
                  // v1.3.3������/����ͼ������ 11 �� 13
                  h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); copyUrl(x) }, title: tr('list.copyLinkTitle'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 })),
                  h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: x.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + x.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 })),
                ]) : null,
              ]),
            ]),
          ])
        }
        const kpi = (num, lab, icon, color) => h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [Ic({ n: icon, size: 11, color: color }), h('span', null, String(num) + ' ' + lab)])
        return h('div', null, [
          // v1.5����ѡ��ǩ������������ǩ �� ��ɫ = �ñ�ǩ����ɫ �� �� ? �رգ�
          (st.lblFilters && st.lblFilters.length) ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 } }, [
            h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none' } }, tr('list.filterActive')),
            (st.lblFilters || []).map(function (nm) {
              const c = colorOf[nm]
              const hex = c ? '#' + c : '#bc8cff'
              return h('span', { key: 'f-label-' + nm, className: 'dsws-chip', style: { fontSize: 10, background: hexA(c, 0.18) || 'rgba(188,140,255,.16)', color: hex, border: '1px solid ' + (darken(c, 0.16) || 'rgba(188,140,255,.6)') } }, [
                nm,
                h('span', { onClick: function (e) { e.stopPropagation(); st.lblFilters = (st.lblFilters || []).filter(function (x) { return x !== nm }); emit(st) }, style: { cursor: 'pointer', marginLeft: 4, fontWeight: 700 } }, '?'),
              ])
            }),
            h('span', { key: 'f-label-clear', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.lblFilters = []; emit(st) }, style: { fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid rgba(255,255,255,.15)' } }, tr('list.filterClear')),
          ]) : null,
          // T2 #35 �� ���������Ⱥ쿨��ListTab ���� �� KPI ֮�� �� Ψһբ�� checkRepo:bad && !dismissed��
          h(NoRepoCard, { st: st }),
          // KPI �� + ������ʾ��v18-30���ɽ�/ռ�� = �б� open issue �ھ���
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap', position: 'relative' } }, [
            kpi(frontierCount(st), tr('list.kpi.takeable'), 'target', '#4ade80'),
            kpi(occCount(st), tr('list.kpi.occupied'), 'lock', '#f0883e'),
            kpi(closedIssues.length, tr('list.kpi.closed'), 'check', '#52525b'),
            h('span', { style: { flex: 1 } }),
            // T2 #2��ˢ�°�ť�������� OverlayPanel tabs ��
          ]),
          (function () { const cr = cs.find(function (c) { return c.id === 1 }); if (cr && cr.level === 'bad' && !isNoRepoDismissed(st.cwd)) return null; return nBad > 0 ? h('div', { className: 'dsws-banner bad', onClick: function () { st.tab = 'checks'; emit(st) } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('list.envWarn', { n: nBad }))]) : null })(),
          // #374/#375��״̬���� + ���� + label ���� chips��ȫ��С�Ž��ͬ�ţ�խ�����в����ߣ�չ��̬��ѡ label ������
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
              const arrow = on ? (st.sortDir === 'asc' ? '��' : '��') : ''
              return h('span', { key: 'srt-' + k, className: 'dsws-chip', onClick: function (e) {
                e.stopPropagation()
                if (st.sortKey === k) { st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc' }
                else { st.sortKey = k; st.sortDir = (k === 'title') ? 'asc' : 'desc' }
                listPrefs.sortKey = st.sortKey; listPrefs.sortDir = st.sortDir; saveListPrefs(); emit(st)
              }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(88,166,255,.16)' : 'rgba(255,255,255,.06)', color: on ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(88,166,255,.55)' : 'rgba(255,255,255,.15)') } }, tr('list.sort.' + k) + arrow)
            }),
            h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
            chip(tr('list.all'), false, !st.lblFilters || !st.lblFilters.length, true),
            // #405��filter row Ĭ�Ͽɼ��� 9 �� 4���� per-row һ�£���+N �������� + ����ͬ��
            (st.expLabels ? sortedLabels : sortedLabels.slice(0, 4)).map(function (nm) { return chip(nm, true, (st.lblFilters || []).indexOf(nm) >= 0, false) }),
            (!st.expLabels && sortedLabels.length > 4) ? h('span', { key: 'lbl-more', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = true; emit(st) }, title: tr('list.tagsTitle', { names: sortedLabels.join('��') }), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px dashed rgba(188,140,255,.55)', cursor: 'pointer' } }, '+' + (sortedLabels.length - 4)) : null,
            st.expLabels ? h('span', { key: 'lbl-less', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = false; emit(st) }, title: tr('list.tagsCollapseTitle'), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-caption,#8b8b95)', border: '1px dashed rgba(255,255,255,.3)', cursor: 'pointer' } }, tr('list.collapse')) : null,
          ]),
          // T3 #5���������֣���������ı���ȫ������ + תȦ + ���㣩
          // v1.3.3 �޸����������ֽ��׿�������ʱ��ʾ���ֶ�ˢ�����߾�Ĭ·�������ٵ��ӣ�
          // #58 �������ȣ����п��գ��� store �� per-cwd ���棩ʱ����ʾȫ�� loading���뿪���б� + ��̨��Ĭˢ��
        (st.snapMode === 'loading' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { className: 'dsws-loading-shade', style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 5, pointerEvents: 'auto' } }, [
          h('div', { className: 'dsws-spinner' }),
          h('span', { style: { fontSize: 12, color: '#e6edf3' } }, tr('list.loading')),
        ]) : null,
          (st.snapMode === 'err' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { style: { color: '#f87171', fontSize: 12, padding: '14px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 12 }), h('span', null, tr('list.errFull', { err: st.snapError }))]) : null,
          st.snapMode === 'real' && st.snapshot && st.snapshot.fallback === 'rest' ? h('div', { style: { color: '#f59e0b', fontSize: 11, padding: '6px 12px', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, background: 'rgba(245,158,11,.08)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('list.restFallback'))]) : null,
          // #374��״̬������Ⱦ ���� open ���� / closed �б� / ��ȫ����̬�����ѹر��۵���
          showOpen ? (filteredOpen.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredOpen.map(function (x) { return issueRow(x, true, narrow) })) : null,
          showClosedList ? (filteredClosed.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredClosed.map(function (x) { return issueRow(x, false, narrow) })) : null,
          // v14-4�ݣ��б�ײ����ѹر� (N)���۵��У�����ȫ����״̬��ʾ��Ĭ������ֻռһ�У�չ���ɼ���
          (st.stateFilter === 'all' && closedIssues.length) ? h('details', { style: { marginTop: 8 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 2px', userSelect: 'none' } }, [
              Ic({ n: 'check', size: 11 }),
              h('span', null, tr('list.closedN', { n: closedIssues.length })),
            ]),
            h('div', null, closedSorted.map(function (x) { return issueRow(x, false, narrow) })),
          ]) : null,
        ])
      }

      // ---- 5.6 �����״���� 4A �Ƽ�+�б� �� 4B Բ�μ��ܻ���A/B �л���----
      const RingSkills = ({ st, rec, list }) => {
        const cx = 110, cy = 108, R2 = 88
        const center = rec[0] || 'ask-matt'
        const ring = list.filter(function (sk) { return sk.name !== center }).slice(0, 8)
        const nodes = ring.map(function (sk, i) {
          const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2
          const x = cx + R2 * Math.cos(a), y = cy + R2 * Math.sin(a)
          const filled = sk.level === 'ok'
          return h('div', { key: sk.name, title: tr('skilldesc.' + sk.name), onClick: function () { inject(st, '/' + sk.name) }, style: { position: 'absolute', left: x - 15, top: y - 15, width: 30, height: 30, borderRadius: '50%', border: filled ? '2px solid #4ade80' : '2px solid #52525b', background: filled ? 'rgba(74,222,128,.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, cursor: 'pointer', color: filled ? '#4ade80' : '#8b8b95', lineHeight: 1.2, textAlign: 'center' } }, sk.name.length > 4 ? sk.name.slice(0, 4) + '��' : sk.name)
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

      // ---- 5.7 ������飨���� 5A����� + ��/��/�̷��鿨��v12 ʧ�ܲ��������ݣ�----
      const ChecksTab = ({ st }) => {
        React.useEffect(function () { loadChecks(st, false) }, [])
        const cs = activeChecks(st)
        const bad = cs.filter(function (c) { return c.level === 'bad' })
        const warn = cs.filter(function (c) { return c.level === 'warn' })
        const ok = cs.filter(function (c) { return c.level === 'ok' })
        // #373��hint ֧��������̬ ���� URL���ɴ�/���ƣ��� /������� /xxx �������ť��������ݣ�
        const actBtn = (c) => {
          const hint = c.hint || ''
          // v1.5��prompt: Э�� ���� ����/ע��һ������ prompt �� AI ִ�У��缼�ܰ�װ������
          if (hint.indexOf('prompt:') === 0) {
            const ptext = hint.slice(7)
            // v1.6��prompt: ����Э�� ���� ���ȴ� PROMPTS ע���ȡ˫���ı����������ԣ���δ֪������ԭ��
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
        // �������ҳ����������û��İ� 2026-08-16�����ȼ����������棩
        //   ����δװȫ �� matte �����������װ�� setup δִ�� �� setup ������� ok �� ����ʾ
        const skillsCheck2 = activeChecks(st).find(function (c) { return c.id === 9 })
        const ghCli2 = activeChecks(st).find(function (c) { return c.id === 4 })
        const ghAuth2 = activeChecks(st).find(function (c) { return c.id === 5 })
        const setupCheck2 = activeChecks(st).find(function (c) { return c.id === 2 })
        const skillsOk = !skillsCheck2 || skillsCheck2.level === 'ok'
        const setupOk = !setupCheck2 || setupCheck2.level === 'ok'
        const ghCliOk2 = !ghCli2 || ghCli2.level === 'ok'
        const ghAuthOk2 = !ghAuth2 || ghAuth2.level === 'ok'
        // v1.5 �������������û��İ� 2026-08-17����gh CLI �� gh ��¼ �� setup �� ���ܣ���ʾ��һ��ȱʧ��
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
        // v1.5 ��������˳�������û��İ� 2026-08-17���������� 1-2-3-4������Զ���ѡ
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
          // T2 #35 �� ChecksTab �������쿨��ʾʱ checkRepo:bad ������Ϊ�������������� �� �л��� ListTab ��ɡ���dismiss ���ṩ�����ú��ԡ����
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); if (!showRed) return null; return h('div', { className: 'dsws-ccard', style: { opacity: 0.85, borderColor: 'rgba(139,139,149,.35)', background: 'rgba(139,139,149,.08)', marginBottom: 6 } }, [h('div', { className: 'nm', style: { color: '#8b8b95' } }, cr.name), h('div', { className: 'dt', style: { color: '#8b8b95' } }, tr('panel.noRepoCardDone')), h('div', { className: 'act' }, [h('button', { className: 'dsws-btn', onClick: function () { st.tab = 'list'; emit(st) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('panel.tabList'))])]) })(),
        (function () { const dismissed = isNoRepoDismissed(st.cwd); if (!dismissed) return null; const cr = cs.find(function (c) { return c.id === 1 }); if (!cr || cr.level !== 'bad') return null; return h('div', { className: 'dsws-ccard', style: { borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.06)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 } }, [h('span', { style: { fontSize: 11, color: '#f87171', flex: 1 } }, tr('panel.noRepoCardDismiss') + ' �� ' + (cr.detail || '')), h('button', { className: 'dsws-btn', onClick: function () { setNoRepoDismissed(st.cwd, false); emit(st) }, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, tr('panel.noRepoReset'))]) })(),
                st.checksMode === 'err' ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.failFull', { err: st.checksError }))]) : null,
          st.checksMode === 'loading' ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, marginBottom: 6 } }, tr('env.detecting')) : null,
          (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; const cnt = displayBad.length; return cnt ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.missingBanner', { n: cnt }))]) : null })(),
          (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; return grp(tr('env.missing'), '#f87171', displayBad) })(),
          grp(tr('env.partial'), '#f59e0b', warn),
          grp(tr('env.ready'), '#4ade80', ok),
        ])
      }

      // ---- 5.8b �Ҳ�ͣ����details ��λ �� ����ͼ�������ݣ�����/��ק/��ȼ����ɿǹ����----
      // ��Լ��details �� = ���Ҳ�����У�AppFrame grid����scope session���ر� = ctx.layout.closeDetails()
      //   ��ռλ�� props ��ע�� closeDetails������� 300-520px ����ק���ر�ʱ������ж�أ�״̬�������
      // issue #15��tabs �����ݷŲ���ʱ�۵�Ϊ��ͼ�꣨��������Ӧ + �ͻط�����
      const TABS_FOLD_HYST = 4
      const TABS_LEVELS = 3
      const tabsLevelDecide = function (level, avail, nats) {
        if (!Array.isArray(nats) || !nats.length) return 0
        let cur = level < 0 ? 0 : level
        while (cur < nats.length - 1 && nats[cur] > avail + 1) cur++
        while (cur > 0 && avail >= nats[cur - 1] + TABS_FOLD_HYST) cur--
        return cur
      }
      // issue#15 �޸���scrollWidth �ᱻ�������ǯ�ƣ�������������ʱ scrollWidth===clientWidth����
      // �����۵���չ���ж� avail>=nats[cur-1]+4 �������������������Ĳ����� children ����ʵ�����
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
        // #45 �ع飨2026-08-20 �������л滭/������������崮̨
        // ����ԭ DetailsDock ���ڹ���ʱ��һ�θ����ã�deps []������ֱ��ȡ props.sessionId��details ��λ�������ﳣΪ�� �� �˻� shared ��������
        //   ���£��� �л滭��sessionId �仯��������ˮ��/���أ��ɻ滭�� polluted snapshot ��פ���� �� current �������� snapshot �� shared �㲥��details ���� shared.cwd���׹����������ա�
        // �޸����� �� props.useSessions Ȩ���źŸ��浱ǰ�Ự��hookCurrent���뾫ȷ cwd��summaryCwd����props.sessionId / scope.sessionId ���ȣ��� ������ deps ��Ϊ [sid]/[sid,summaryCwd]���л滭������ cwd ͬ�� + ˮ�ϣ��� �� deps ������
        const hookCurrent = (props && typeof props.useSessions === 'function') ? props.useSessions(function (x) { return x.current }) : undefined
        const propSid = props && (props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id))
        const sid = propSid || hookCurrent
        const summaryCwd = (props && typeof props.useSessions === 'function' && sid) ? props.useSessions(function (x) { return (x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined }) : undefined
        const s = useStore(sid)
        const layoutSvc = ctx.get('layout')
        const dockRef = React.useRef(null)
        const [dw, setDw] = React.useState(460)
        // �п��֪��details �� 300-520px��խ�� 380 ʱ������ť�۵�Ϊ��ͼ�꣨���������ͬ��ֵ��
        React.useEffect(function () {
          if (!dockRef.current) return
          const el = dockRef.current
          const ro = new ResizeObserver(function (entries) {
            try { setDw(entries[0].contentRect.width) } catch (e) { /* ���� */ }
          })
          ro.observe(el)
          return function () { try { ro.disconnect() } catch (e) { /* ���� */ } }
        }, [])
        // ��Ӧʽ������ͬ�������� StatusBar������ host Ȩ���� summaryCwd / session �仯�������� s.cwd �е���ȷ��������ˮ�� per-cwd ����
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
            }).catch(function () { /* �������� cwd */ })
          }
        }, [sid, summaryCwd])
        // ��ʼ���ݣ��� sid �仯���ܣ��޸��� deps �����л滭��ˢ�£��� per-cwd ˮ���뿪 + ��Ⱦ����������
        React.useEffect(function () {
          if (!s.cwd) {
            const sync = getCwdSync(sid)
            if (sync) { s.cwd = sync; hydrateFromCache(s) }
          } else { hydrateFromCache(s) }
          // ��Ⱦ���������ǰ store �� snapshot ����֮ǰ��������̨�����repoRoot �� cwd ǰ׺��ƥ�䣬�� repo ���� cwd β�β�һ�£���ǿ�ƺ�̨ˢ��
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
            // �����׶���ʱ���� transition��max-width ��������Ⱦ scrollWidth ���� �� 0/6 ������
            t.classList.add('dsws-no-anim')
            // 1) ȫչ�� + ǿ�� reflow���õ�"������ʵ�ŵ���"�Ļ�׼��
            for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
            if (ver) ver.classList.remove('collapsed')
            void t.offsetWidth
            // 2) �����Ҫ��priority ������۵���ֱ���ŵ��£�scrollWidth ����ж���
            const items = Array.from(btns)
              .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
              .sort(function (a, b) { return b.p - a.p })
            for (const it of items) {
              if (t.scrollWidth <= t.clientWidth + 1) break
              it.el.classList.add('collapsed')
              void t.offsetWidth
            }
            // 3) �汾�Ÿ��桸ˢ�¡�(priority=3) �۵�����¼�۵����� tooltip �ſ�
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
        // ͷ������Ӧ���ռ����ʱ��������ѹʱ������ MATT skills ���֣�����ͼ�꣩�������� repo��#28��
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
            // ��׼������ɼ� + �����ֿ������̿����Ȼ���
            titleEl.style.display = ''
            if (full) txt.textContent = full
            chip.style.flex = 'none'
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            // �׶�1�����ر��⣬���ȱ��ֿ���
            titleEl.style.display = 'none'
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            // �׶�2����խʱ���� repo
            if (full && short) txt.textContent = short
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            // �ԷŲ��£����� chip ���� ellipsis ����
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
          // ͷ�������� + �رգ������߲��������У����Ƶ���ǩ���·���Ի�/�켣����
          // #28 ����Ӧ��flex ���� minWidth 0 + оƬ flex ����Ӧ�������������أ���խ���� repo
          h('div', { ref: headRef, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px', flex: 'none', minWidth: 0 } }, [
            Icon({ scheme: 'compass', size: 15 }),
            h('span', { 'data-head-title': 1, style: { fontWeight: 600, fontSize: 13, flex: 'none', whiteSpace: 'nowrap' } }, tr('panel.title')),
            // v1.5 T7���ֿ������� ���� ��ǰ��⵽�� git �ֿ⣨owner/name��������� GitHub
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
          // ��ǩ������ = ��Ի�/�켣һ�µĺ��ߣ��Ҳࣺˢ�°�ť + �汾�ţ�v1.3.3��
          h('div', { className: 'dsws-tabs', ref: tabsRef, style: { padding: '0 12px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', flex: 'none', display: 'flex', alignItems: 'center', gap: 4 } }, [
            tabBtn('list', 'list', tr('panel.tabList'), 4),
            tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
            tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
            h('span', { style: { flex: 1 } }),
            // v1.5 T6 �޶���V2 ����� �� ˢ����ࣩ������ wayfinder ���� ע�� /wayfinder + �ֿ���Ϣ + ��������
            // issue #4������ BUG �� ���� ͬ����ť���»ỰԤ�� /wayfinder ���� BUG �� prompt��
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
          // v1.5 T10 R7��ˢ�������ѷϳ����ֶ�ˢ���߾�Ĭ·�����ޡ�ˢ���С���
          s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
            Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
            h('span', null, s.notice.text),
          ]) : null,
        ])
      }

      // ---- 5.8 ����壨���϶� �� 8 ������ �� ����ͼ �� v14 ���浱ǰ�Ự + ˢ�����֣�----
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
            // �����׶���ʱ���� transition��max-width ��������Ⱦ scrollWidth ���� �� 0/6 ������
            t.classList.add('dsws-no-anim')
            // 1) ȫչ�� + ǿ�� reflow���õ�"������ʵ�ŵ���"�Ļ�׼��
            for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
            if (ver) ver.classList.remove('collapsed')
            void t.offsetWidth
            // 2) �����Ҫ��priority ������۵���ֱ���ŵ��£�scrollWidth ����ж���
            const items = Array.from(btns)
              .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
              .sort(function (a, b) { return b.p - a.p })
            for (const it of items) {
              if (t.scrollWidth <= t.clientWidth + 1) break
              it.el.classList.add('collapsed')
              void t.offsetWidth
            }
            // 3) �汾�Ÿ��桸ˢ�¡�(priority=3) �۵�����¼�۵����� tooltip �ſ�
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
        // ͷ������Ӧ��Overlay����ͬ Dock �߼����ռ������������ѹ�Ȳر������֣������� repo��#28��
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
        // #376�������� openPanel ͳһ���ɣ�δ����/���� force������ֱ��չʾ�����˴������ظ�����
        if (!s.open) return null
        const groups = compute(s)
        const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
        // v14-19��խ����ֵ������ <380px ʱ������ť�۵�Ϊ��ͼ�꣩
        const narrow = s.size.w < 380
        const tabsTip = function (e, text, priority) {
          const t = tabsRef && tabsRef.current
          setTabTip(null)
          if (!t || !text || typeof e === 'undefined') return
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
          // #28 ����Ӧͷ����minWidth 0 �����������Ȳر������֣���ͼ�꣩�������� repo
          h('div', { ref: headRef, className: 'dsws-head', onMouseDown: startDrag, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
            Icon({ scheme: s.ui.icon, size: 17 }),
            h('span', { 'data-head-title': 1, style: { fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' } }, tr('panel.title')),
            // v19-35���������ݡ��� ��ʾ repo ������δ���û��������壻�쳣ʱ��ɫ��ʾ��
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
          // v1.5 T6 �޶���V2 ����� �� ˢ����ࣩ������ wayfinder
          // issue #4������ BUG �� ���� ͬ����ť���»ỰԤ�� /wayfinder ���� BUG �� prompt��
          h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
            Ic({ n: 'map', size: 11 }),
            h('span', null, tr('panel.newWayfinder')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
            Ic({ n: 'bug', size: 11 }),
            h('span', null, tr('panel.newBug')),
          ]),
          // T2 #2��ˢ�°�ť������ tabs ĩβ��������������ұ� �� �û�����
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
          // v1.5 T10 R7��ˢ�������ѷϳ����ֶ�ˢ���߾�Ĭ·�����ޡ�ˢ���С���
          s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
            Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
            h('span', null, s.notice.text),
          ]) : null,
        ])
      }

      // ---- 5.9 ����ҳ��v25 �� settings.plugins.tab��Waystation������������ + ����ģ��༭����----
      // ��ʼģ�壨ǰ׺���� + execute ģ�壩/ ����ģ��༭�������� 6 ������
      // T3��ģ����/��������Ⱦʱ tr('tpl.name.*')/tr('tpl.desc.*')���˴��������ľ�̬���Ĭ���İ��ο���
      const TPL_NAMES = {
        diagnose: '���', fix: '�޸�', discuss: '����', handoff1: '���ӵ�һ��', handoff2: '���ӵڶ���', fixate: '����',
      }
      const TPL_DESC = {
        diagnose: 'needs-triage Ʊ���м�����',
        fix: 'bug Ʊ���м�����',
        discuss: 'wayfinder:grilling Ʊ���м�����',
        handoff1: '���ɽ����ĵ�����ʱ����������ļ���һ�£�',
        handoff2: '��ȡ�����ĵ�',
        fixate: '�㶪ʧ���� prompt',
      }
      const TPL_EDIT_IDS = ['diagnose', 'fix', 'discuss', 'handoff1', 'handoff2', 'fixate']  // execute �ڡ���ʼģ�塹��
      const PREVIEW_VALUES = { url: 'https://github.com/FeatherHunter/SKILLS/issues/365', number: '365', title: tr('cfg.previewTitle'), ts: '20260814-172113', file: '20260814-172113.md' }
      const SettingsPage = (props) => {
        // T5 �޶������� store������ҳ��������� dock�����Լ����� shared ������Ⱦ flash toast��
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
        // v1.4.1����λ�ü�ʱ��Ч ���� seg �����д�� cfg + localStorage + �㲥����������ײ��㱣��ȫ����
        const pickOpenIn = function (v) {
          setOpenIn(v)
          cfg.openIn = v
          saveCfg()
          broadcastCfg()
          setOpenInNote(true)
          if (timer !== undefined) timer.timeout(function () { setOpenInNote(false) }, 2600)
        }
        // v1.3.3 T1��ģ�� textarea ����Ӧ�߶ȣ�����ȫչ�� �� ���ڲ���� �� ����㻬����
        const autoGrowTa = function (el) {
          if (!el) return
          el.style.height = 'auto'
          el.style.height = (el.scrollHeight + 2) + 'px'
        }
        // У��ȫ�� 7 ��ģ�壨��Ч�ı� = �Զ��� || Ĭ�ϣ�
        const validateAll = function (executeText) {
          const errList = []
          const check = function (id, text) {
            const v = validateTemplate(id, text || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''))
            if (!v.ok) {
              const bits = []
              if (v.missing.length) bits.push(tr('tpl.missing', { list: v.missing.map(function (n) { return '{' + n + '}' }).join('��') }))
              if (v.unknown.length) bits.push(tr('tpl.unknown', { list: v.unknown.map(function (n) { return '{' + n + '}' }).join('��') }))
              errList.push('��' + tr('tpl.name.' + id) + '��' + bits.join('��'))
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
          later(function () { setSaved(false) }, 2000)
        }
        const setTpl = function (id, val) { setTpls(function (p) { const o = Object.assign({}, p); o[id] = val; return o }) }
        const resetExecute = function () { setTpl('execute', ''); setErrs([]) }
        const resetTpl = function (id) { setTpl(id, ''); setErrs([]) }
        // ҳ�漶�ָ�ȫ��Ĭ�ϣ�T1 ��� ��5����� = ע��ʱ������Ĭ���ı���
        const resetAll = function () {
          const o = {}
          o.execute = ''
          TPL_EDIT_IDS.forEach(function (id) { o[id] = '' })
          setTpls(o)
          setWf(true)
          setErrs([])
        }
        // ���ռλ�� chip �ڹ�괦����
        const insertPh = function (id, name) {
          const ta = taRefs.current[id]
          const cur = tpls[id] || ''
          if (!ta) { setTpl(id, cur + '{' + name + '}'); return }
          const start = (ta.selectionStart != null) ? ta.selectionStart : cur.length
          const end = (ta.selectionEnd != null) ? ta.selectionEnd : cur.length
          const next = cur.slice(0, start) + '{' + name + '}' + cur.slice(end)
          setTpl(id, next)
          const pos = start + name.length + 2
          setTimeout(function () { try { ta.focus(); ta.setSelectionRange(pos, pos) } catch (e) { /* ���� */ } }, 0)
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
        // T5 �޶�������ҳ�� toast����������� dock �� notice ��Ⱦ��
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
          // v1.5 T4��Matt ���ܽ��ܿ����������� + ͨ������ skills �� GitHub ���� + ��װ prompt ����/ע�룩
          h('div', { className: 'dsws-cfg-group' }, [
            h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'star', size: 13 }), h('span', null, tr('matte.title'))]),
            h('div', { className: 'dsws-cfg-gdesc' }, tr('matte.desc')),
            h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6 } }, [
              h('a', { href: MATT_REPO, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('matte.openRepo'))]),
              h('button', { className: 'dsws-btn', onClick: function () { copyText(sharedSt, promptText('installSkills'), tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('matte.copyPrompt'))]),
            ]),
          ]),
          // v1.4����λ�ã�details �� / better-sidebar������ better-sidebar δװʱ����ʾ dock ѡ��
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
          // 1.5 ��������ã�#398 ��Ʊ A �� �� #397 Э�� �� �� layoutSvc.resetDetails API��ȱʧʱ�Ѻ���ʾ���� UI ������
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
          // 2. ��ʼģ�壨execute Ψһ�༭�㣻id ������ģ��༭��ê����ת��
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
          // 3. ����ģ��༭�������� 6 ���� �� T1��Ĭ��չ�����ֶ��۵���
          h('details', { open: true, className: 'dsws-cfg-group dsws-cfg-details' }, [
            h('summary', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 650, marginBottom: 4, cursor: 'pointer', listStyle: 'none' } }, [Ic({ n: 'note', size: 13 }), h('span', null, tr('cfg.tplEditor'))]),
            h('div', { className: 'dsws-cfg-gdesc' }, [
              h('span', null, tr('cfg.tplEditorDesc')),
              h('a', { href: 'javascript:void(0)', onClick: function () { const el = document.getElementById('dsws-cfg-exec-group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, style: { color: '#bc8cff', cursor: 'pointer', flex: 'none', textDecoration: 'none' } }, tr('cfg.execHint')),
            ]),
            TPL_EDIT_IDS.map(tplCard),
          ]),
          // У�������ʾ
          errs.length ? h('div', { className: 'dsws-cfg-err' }, [
            h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.saveRejected'))]),
            errs.map(function (e, i) { return h('div', { key: i }, '�� ' + e) }),
          ]) : null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-end' } }, [
            h('button', { className: 'dsws-cfg-btn', onClick: resetAll }, tr('cfg.resetAll')),
            h('button', { className: 'dsws-cfg-save', onClick: save }, [Ic({ n: 'check', size: 13 }), h('span', null, tr('cfg.saveAll'))]),
          ]),
        ])
      }

      // ---- 5.10 Run ��������壨v25��״̬չʾ + ��ݴ�����ҳ������л���Ǩ������ҳ��----
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
            // v25���������Ϊ shell �������״̬���޹����� API���Ѳ�֤���� ��ť����·����ƫ���¼�� T2a resolution��
            h('button', { className: 'dsws-btn', onClick: function () { flash(s, tr('run.cfgGuide'), 'info') } }, tr('run.openCfg')),
          ]),
        ])
      }

      // ============================================================
      // 6. ���ע�ᣨ�ռ� disposer����ж��ʱͳһ�������̬����� Run ������ע�� tool.view.cordis��
      // ============================================================
      const disposeSlots = [
        slots.inject('shell.overlay', function () {
          return slots.register({ name: 'shell.overlay', id: 'dsws-overlay-v5', order: 10 }, OverlayPanel)
        }),
        slots.inject('conversation.input.dock', function () {
          return slots.register({ name: 'conversation.input.dock', id: 'dsh-mattpocock-skills-deck', order: 40 }, StatusBar)
        }),
        // v25-50������ҳ������ �� ��� �� Waystation���� opencode ����ͬģʽ��
        slots.inject('settings.plugins.tab', function () {
          return slots.register({ name: 'settings.plugins.tab', id: 'dsws-settings', order: 40, label: function () { return tr('panel.title') } }, SettingsPage)
        }),
        // v1.5 T2���������ֱ�� ���� settings.section ������Ŀ������ҳ tab ˫��ڣ�����ͬһ SettingsPage��
        //   order 18 = ��� ���ҳ15 ֮���û��İ� 2026-08-16��15 < 18 < AgentPresets20 < better-sidebar100��
        slots.inject('settings.section', function () {
          return slots.register({ name: 'settings.section', id: 'dsws-settings-section', order: 18, label: function () { return tr('panel.title') } }, SettingsPage)
        }),
        // ԭ�ͣ��Ҳ�ͣ����details ��λ �� �滻���ù���������壩
        // priority: -1 ���������������Ĭ�� 0 �� �޳�ͻ�ҡ�����ʤ�����滻�������
        slots.inject('details', function () {
          return slots.register({ name: 'details', id: 'dsws-details', order: 10, priority: -1 }, DetailsDock)
        }),
        // v1.4.1��better-sidebar tab ע������Ϊ ensureSidebarTab���ݵ� + ��ʱ���� + openTab ǰ���ף���
        //   �� openInSidebar ���崦��disposer / ���Զ�ʱ��������·����� ctx.effect��
        //   ��ʵ��ע�ᵽ betterSidebar.tab ��λ�������� ���� better-sidebar �Ӳ����Ѹò�λ��
        //   ���� npm �� tab ����ע�ᣨopenTab ��Ĭ no-op�������в����û��Ӧ������֮һ��
      ]
      ctx.effect(function () {
        return function () {
          disposeSlots.forEach(function (d) { try { if (d) d() } catch (e) { /* ���������ڴ��� */ } })
        }
      }, 'dsh-mattpocock-skills-deck: slots')

      // v1.4.1��apply ʱ����ע�ᡸWaystation��tab��better-sidebar ����δ�������������ڱ�ģ�飩�� ��ʱ���ԣ���� 10 �Σ�
      //   ж�أ�HMR / ������ã�ʱ���� disposer + ���Զ�ʱ��
      if (!ensureSidebarTab()) {
        let tries = 0
        sidebarTabRetry = setInterval(function () {
          tries++
          if (ensureSidebarTab() || tries >= 10) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
        }, 1000)
      }
      ctx.effect(function () {
        return function () {
          try { if (sidebarTabDisposer) sidebarTabDisposer() } catch (e) { /* ���� */ }
          sidebarTabDisposer = null
          if (sidebarTabRetry) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
        }
      }, 'dsh-mattpocock-skills-deck: better-sidebar tab')

      // ���������ݿ��գ�repo ���� + ǰ�ü�ⶵ�ף���ʧ�ܾ�Ĭ
      loadSnapshot(shared, false)
    }

    return module.exports
  },
})
