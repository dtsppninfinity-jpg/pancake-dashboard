// lib/ui/skeletons.ts — skeleton loading ต่อหน้า (layout ตรงกับหน้าจริง ใช้ class เดียวกัน)
// pure string builder รันฝั่ง client — ไม่ผูก event ใดๆ (โดน render ทับเมื่อข้อมูลมา)

/* ---------------- primitives ---------------- */

/** บล็อก skeleton (มี shimmer จาก .skel ใน globals.css) */
function b(style: string): string {
  return '<div class="skel" style="' + style + '"></div>';
}
/** แถบข้อความ */
function line(w: string, h = '11px', mt = '0'): string {
  return b('width:' + w + ';height:' + h + ';border-radius:6px;margin-top:' + mt);
}
function circle(size: string, extra = ''): string {
  return b('width:' + size + ';height:' + size + ';border-radius:50%;flex-shrink:0;' + extra);
}
function pill(w: string, h = '32px'): string {
  return b('width:' + w + ';height:' + h + ';border-radius:99px');
}
/** หัวการ์ด: title + sub */
function head(): string {
  return line('42%', '15px') + line('62%', '11px', '7px');
}

/* ---------------- chart-ish ---------------- */

/** แท่งแนวตั้ง (กราฟ) — heights เป็น % */
function vbars(heights: number[], boxH = '200px', gap = '10px', mt = '14px'): string {
  const bars = heights.map((h) =>
    b('flex:1;height:' + h + '%;border-radius:5px 5px 0 0')).join('');
  return '<div style="display:flex;align-items:flex-end;gap:' + gap + ';height:' + boxH + ';margin-top:' + mt + '">' + bars + '</div>';
}
function hourlyBars(): string {
  const hs: number[] = [];
  for (let i = 0; i < 24; i++) hs.push(12 + ((i * 7 + 13) % 70));
  return vbars(hs, '210px', '3px');
}
function miniBars(): string {
  const hs: number[] = [];
  for (let i = 0; i < 24; i++) hs.push(15 + ((i * 5 + 9) % 70));
  return vbars(hs, '48px', '2px', '10px');
}
/** โดนัท (วงกลม) + legend */
function donut(): string {
  return '<div class="donut-wrap" style="margin-top:10px">' +
    circle('150px') +
    '<div style="flex:1">' + line('80%', '12px', '4px') + line('70%', '12px', '13px') + line('75%', '12px', '13px') + '</div>' +
    '</div>';
}
/** แถวบาร์แนวนอน (hbar-row = grid 130px 1fr 48px) */
function hbars(n: number): string {
  let h = '<div style="margin-top:16px">';
  for (let i = 0; i < n; i++) {
    h += '<div class="hbar-row">' +
      line('85%', '11px') +
      b('height:9px;border-radius:99px') +
      line('60%', '11px') +
      '</div>';
  }
  return h + '</div>';
}

/* ---------------- ชิ้นการ์ด ---------------- */

function statCard(): string {
  return '<div class="stat-card">' +
    b('width:44px;height:44px;border-radius:12px;flex-shrink:0') +
    '<div style="flex:1;min-width:0">' +
      line('55%', '11px') + line('72%', '24px', '9px') + line('88%', '10px', '10px') +
    '</div></div>';
}

function chips(widths: number[], h = '33px'): string {
  return '<div class="conv-filters">' + widths.map((w) => pill(w + 'px', h)).join('') + '</div>';
}

function controlsBar(inputs: string): string {
  return '<div class="pg-controls">' + inputs + '</div>';
}
function inputSk(w: string): string {
  return b('width:' + w + ';height:34px;border-radius:10px');
}

/* ================================================================
 * 1) DASHBOARD
 * ================================================================ */

export function dashboardBodySkel(): string {
  return '<div class="stat-grid">' + statCard() + statCard() + statCard() + statCard() + '</div>' +
    '<div class="dash-row">' +
      '<div class="card">' + head() + vbars([55, 72, 58, 82, 66, 76, 45]) + '</div>' +
      '<div class="card">' + head() + donut() + '</div>' +
    '</div>' +
    '<div class="dash-row">' +
      '<div class="card">' + head() + hbars(4) + '</div>' +
      '<div class="card">' + head() + tagCloud() + '</div>' +
    '</div>' +
    '<div class="dash-row single"><div class="card">' + head() + hbars(6) + '</div></div>' +
    '<div class="dash-row single"><div class="card">' + head() + attnRows(4) + '</div></div>';
}

function tagCloud(): string {
  const ws = [70, 54, 84, 60, 48, 76, 66, 52, 90, 58, 72, 46, 80, 62];
  return '<div class="tag-cloud" style="margin-top:16px">' +
    ws.map((w) => pill(w + 'px', 28 + 'px')).join('') + '</div>';
}

function attnRows(n: number): string {
  let h = '<div style="margin-top:12px">';
  for (let i = 0; i < n; i++) {
    h += '<div class="attn-item">' +
      circle('44px') +
      '<div class="attn-body">' + line('38%', '12px') + line('72%', '10px', '8px') + '</div>' +
      pill('82px', '22px') +
      '</div>';
  }
  return h + '</div>';
}

export function dashboardSkel(): string {
  return chips([70, 112, 100]) + '<div id="dash-body">' + dashboardBodySkel() + '</div>';
}

/* ================================================================
 * 2) SALES
 * ================================================================ */

function srCard(): string {
  return '<div class="sr-card">' + line('42%', '12px') + line('66%', '28px', '9px') + line('56%', '11px', '10px') + '</div>';
}
function chBox(): string {
  return '<div class="sr-chbox">' + line('52%', '12px') + line('70%', '20px', '7px') + line('62%', '11px', '8px') + '</div>';
}
function tile(): string {
  return '<div class="tile">' + line('62%', '10px') + line('50%', '16px', '7px') + '</div>';
}
function todayRows(n: number): string {
  let h = '';
  for (let i = 0; i < n; i++) {
    h += '<div class="sr-today-row">' + line('40%', '11px') + line('22%', '11px') + '</div>';
  }
  return h;
}
function tableRows(n: number): string {
  let h = '<div class="table-scroll" style="margin-top:14px">';
  h += '<div style="display:flex;gap:12px;padding:8px 10px;border-bottom:1px solid var(--border)">' +
    line('20%', '10px') + line('16%', '10px') + line('14%', '10px') + line('14%', '10px') + line('12%', '10px') + line('16%', '10px') + '</div>';
  for (let i = 0; i < n; i++) {
    h += '<div style="display:flex;gap:12px;padding:11px 10px;border-bottom:1px solid rgba(128,128,128,.12)">' +
      line('20%', '11px') + line('16%', '11px') + line('14%', '11px') + line('14%', '11px') + line('12%', '11px') + line('16%', '11px') + '</div>';
  }
  return h + '</div>';
}
function alertRows(n: number): string {
  let h = '<div class="alert-list" style="margin-top:6px">';
  for (let i = 0; i < n; i++) {
    h += '<div class="alert-row" style="border-left-color:var(--border)">' +
      circle('20px') +
      '<div class="alert-body">' + line('50%', '12px') + line('80%', '10px', '7px') + '</div>' +
      '</div>';
  }
  return h + '</div>';
}

export function salesSkel(): string {
  let h = '<div class="sr-head">' +
    '<div>' + line('180px', '16px') + line('240px', '11px', '8px') + '</div>' +
    '<div class="pg-controls" style="margin-bottom:0">' +
      chips([60, 96, 108, 84, 96], '30px') + inputSk('150px') + inputSk('80px') +
    '</div>' +
  '</div>';
  h += '<div class="sr-cards">' + srCard() + srCard() + srCard() + '</div>';
  h += '<div class="sr-channels">' + chBox() + chBox() + chBox() + '</div>';
  h += '<div class="sr-strip">' + tile() + tile() + tile() + tile() + tile() + tile() + '</div>';
  h += '<div class="sr-main">' +
    '<div class="card">' + head() + hourlyBars() + '</div>' +
    '<div class="card">' + head() + line('48%', '26px', '12px') + line('30%', '11px', '8px') + miniBars() + todayRows(4) + '</div>' +
  '</div>';
  h += '<div class="sr-bottom">' +
    '<div class="card">' + head() + tableRows(5) + '</div>' +
    '<div class="card">' + head() + alertRows(3) + '</div>' +
  '</div>';
  return h;
}

/* ================================================================
 * 3) ADMIN MANAGEMENT
 * ================================================================ */

function pgsItem(): string {
  return '<div class="pgs-item">' +
    b('width:44px;height:22px;border-radius:6px;margin:0 auto') +
    b('width:70%;height:9px;border-radius:6px;margin:7px auto 0') +
    '</div>';
}
function statCell(): string {
  return '<div class="cell">' +
    b('width:52%;height:14px;border-radius:5px;margin:0 auto') +
    b('width:74%;height:9px;border-radius:5px;margin:6px auto 0') +
    '</div>';
}
function adminCard(): string {
  const cells = statCell() + statCell() + statCell() + statCell() + statCell() + statCell();
  return '<div class="admin-card">' +
    '<div class="admin-head">' +
      circle('44px') +
      '<div style="flex:1;min-width:0">' + line('60%', '13px') + line('80%', '10px', '8px') + '</div>' +
      pill('72px', '22px') +
    '</div>' +
    '<div class="page-stats">' + cells + '</div>' +
    '<div class="page-status-row">' + pill('150px', '26px') + '<span style="flex:1"></span>' + b('width:90px;height:26px;border-radius:8px') + '</div>' +
  '</div>';
}

export function adminsSkel(): string {
  let h = '<div class="pg-summary">';
  for (let i = 0; i < 7; i++) h += pgsItem();
  h += '</div>';
  h += controlsBar(inputSk('220px') + inputSk('130px') + inputSk('130px') + '<div class="spacer"></div>' + inputSk('120px'));
  let cards = '';
  for (let i = 0; i < 8; i++) cards += adminCard();
  h += '<div class="admin-grid">' + cards + '</div>';
  return h;
}

/* ================================================================
 * 4) ADMIN PERFORMANCE
 * ================================================================ */

function podiumCard(tall: boolean): string {
  const av = tall ? '54px' : '46px';
  return '<div class="top3-card' + (tall ? ' first' : '') + '" style="border-color:var(--border)">' +
    b('width:34px;height:34px;border-radius:50%;margin:0 auto') +
    circle(av, 'margin:10px auto') +
    b('width:60%;height:12px;border-radius:6px;margin:0 auto') +
    b('width:45%;height:18px;border-radius:6px;margin:8px auto 0') +
    b('width:52%;height:20px;border-radius:99px;margin:8px auto 0') +
    b('width:80%;height:9px;border-radius:6px;margin:8px auto 0') +
    '</div>';
}
function rankCard(): string {
  return '<div class="rank-card">' +
    circle('34px') +
    circle('34px') +
    '<div class="rank-mid">' + line('45%', '13px') + line('75%', '10px', '8px') + line('60%', '10px', '6px') + '</div>' +
    '<div class="rank-right" style="min-width:90px">' + b('width:70px;height:16px;border-radius:6px;margin-left:auto') + b('width:110px;height:10px;border-radius:6px;margin:6px 0 0 auto') + '</div>' +
  '</div>';
}

export function adminperfSkel(): string {
  let h = controlsBar(chips([60, 96, 108, 84, 96], '30px') + inputSk('130px') + '<div class="spacer"></div>' + inputSk('80px'));
  h += controlsBar(pill('110px', '28px') + pill('150px', '28px') + pill('140px', '28px') + pill('110px', '28px') + '<div class="spacer"></div>' + inputSk('160px'));
  h += '<div class="top3-grid">' + podiumCard(false) + podiumCard(true) + podiumCard(false) + '</div>';
  let rows = '';
  for (let i = 0; i < 6; i++) rows += rankCard();
  h += '<div class="rank-list">' + rows + '</div>';
  return h;
}

/* ================================================================
 * 6) U MAP (จับคู่แอดมิน ↔ U)
 * ================================================================ */

function uCardSkel(): string {
  return '<div class="u-card">' +
    line('38%', '20px') + line('68%', '11px', '7px') +
    '<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">' +
      pill('76px', '22px') + pill('60px', '22px') +
    '</div></div>';
}

export function umapSkel(): string {
  let h = controlsBar(inputSk('220px') + inputSk('100px') + inputSk('140px') + '<div class="spacer"></div>' + inputSk('160px'));
  h += '<div class="umap-stats">' +
    '<div class="tile">' + line('60%', '10px') + line('40%', '16px', '7px') + '</div>' +
    '<div class="tile">' + line('66%', '10px') + line('44%', '16px', '7px') + '</div>' +
    '<div class="tile">' + line('62%', '10px') + line('36%', '16px', '7px') + '</div>' +
    '</div>';
  let chips2 = '';
  for (let i = 0; i < 10; i++) chips2 += pill((84 + ((i * 23) % 60)) + 'px', '30px');
  let cards = '';
  for (let i = 0; i < 9; i++) cards += uCardSkel();
  h += '<div class="umap-layout">' +
    '<div class="card">' + head() +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' + chips2 + '</div></div>' +
    '<div class="u-grid">' + cards + '</div>' +
    '</div>';
  return h;
}

/* ================================================================
 * 7) CONTENT & ADS
 * ================================================================ */

function caCard(): string {
  let nums = '<div class="ca-nums">';
  for (let i = 0; i < 8; i++) {
    nums += '<div class="ca-num">' + b('width:56px;height:14px;border-radius:5px;margin-left:auto') + b('width:40px;height:9px;border-radius:5px;margin:5px 0 0 auto') + '</div>';
  }
  nums += '</div>';
  return '<div class="ca-card">' +
    b('width:24px;height:24px;border-radius:6px;flex-shrink:0') +
    '<div class="ca-main">' + line('55%', '13px') + line('40%', '10px', '8px') + line('50%', '10px', '6px') + '</div>' +
    nums +
    b('width:90px;height:28px;border-radius:8px;flex-shrink:0') +
  '</div>';
}

export function contentadsSkel(): string {
  let h = controlsBar(inputSk('300px') + inputSk('130px') + inputSk('150px') + '<span class="spacer"></span>' + inputSk('80px'));
  // alerts card
  h += '<div class="card" style="margin-bottom:14px">' +
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">' + line('160px', '15px') + pill('70px', '22px') + pill('80px', '22px') + pill('90px', '22px') + '</div>' +
    alertRows(3) +
  '</div>';
  // rank controls
  h += controlsBar([120, 130, 150, 110, 120, 140].map((w) => pill(w + 'px', '28px')).join(''));
  // ad cards
  let cards = '';
  for (let i = 0; i < 5; i++) cards += caCard();
  h += '<div class="ca-list">' + cards + '</div>';
  return h;
}
