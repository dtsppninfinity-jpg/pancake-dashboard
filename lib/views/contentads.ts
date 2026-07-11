/* ============================================================
   contentads — Content & Ads Performance
   ข้อมูลจริงจาก apiContentAds() — กรอง/เรียงทั้งหมดฝั่ง client
   (port จาก JsContentAds.html — HTML/class/ข้อความ/esc คงเดิมทุกตัวอักษร)
   ============================================================ */

import {
  serverCall, esc, fmtNum, THB, kFmt, pctFmt, relTime,
  toast, openModal, closeModal, showError, downloadCSV, downloadXLS,
} from '@/lib/ui/helpers';
import { contentadsSkel } from '@/lib/ui/skeletons';

let lastData: any = null;
const filter = { q: '', status: '', account: '', rank: 'revenue' };
let alertShowAll = false;

const STATUS_OPTIONS = [
  { key: '', label: 'ทุกสถานะ' },
  { key: 'winning', label: '🏆 Winning' },
  { key: 'needs_fix', label: '🛠 Needs Fix' },
  { key: 'losing', label: '📉 Losing' },
  { key: 'watch', label: '👀 Watch' },
  { key: 'active', label: '▶ Active' },
  { key: 'organic', label: '🌱 Organic (ไม่ใช้งบ)' }, // แถวที่ไม่มี spend — เดิมกรองหาไม่ได้เลย (บั๊ก)
  { key: 'paused', label: '⏸ Paused' },
];

const RANK_MODES = [
  { key: 'revenue', label: '💰 ทำยอดขายสูงสุด' },
  { key: 'roas', label: '📈 ROAS ดีที่สุด' },
  { key: 'cpo', label: '💸 Cost/Order ต่ำสุด' },
  { key: 'worry', label: '⚠️ น่าเป็นห่วง' },
  { key: 'spend', label: '🔥 Spend สูงสุด' },
  { key: 'lowclose', label: '💬 แชทเยอะปิดต่ำ' },
];

const VERDICT_ACTIONS: Record<string, string[]> = {
  scale: [
    'เพิ่มงบ 20-30% ทุก 2 วัน — อย่าเพิ่มครั้งเดียวเยอะ',
    'เตรียมครีเอทีฟสำรอง 2-3 ตัวไว้ก่อนตัวนี้จะล้า',
  ],
  stop: [
    'หยุดแอดตัวนี้ แล้วย้ายงบไปตัวที่ ROAS ≥ 2',
    'เก็บบทเรียน: Hook / กลุ่มเป้าหมายแบบไหนที่ไม่เวิร์ก',
  ],
  adjust: [
    'ลดงบลง 30% ระหว่างแก้ครีเอทีฟ',
    'เปลี่ยน Hook แล้ววัดผล 3 วัน',
    'อัปเดตสคริปต์แอดมินให้ตอบคำถามยอดฮิตได้ตั้งแต่ข้อความแรก',
  ],
};

/* ---------------- data helpers ---------------- */

function num(v: any): number {
  return (v === null || v === undefined || isNaN(v)) ? 0 : Number(v);
}

function nullable(v: any): number | null {
  return (v === null || v === undefined || isNaN(v)) ? null : Number(v);
}

function roasStr(r: any): string {
  const v = nullable(r);
  if (v === null) return '-';
  return String(Math.round(v * 100) / 100);
}

function rankScore(it: any, mode: string): number {
  const roas = nullable(it.roas);
  const cpo = nullable(it.costPerOrder);
  if (mode === 'roas') return roas === null ? -9e15 : roas;                 // desc, null ท้าย
  if (mode === 'cpo') return cpo === null ? -9e15 : -cpo;                   // asc, null ท้าย
  if (mode === 'worry') return roas === null ? -9e15 : -roas;              // roas asc, null ท้าย
  if (mode === 'spend') return num(it.spend);                               // desc
  if (mode === 'lowclose') return num(it.msgs) - num(it.orders) * 5;        // desc
  return num(it.revenue);                                                   // revenue desc (default)
}

function filteredItems(data: any): any[] {
  const items = (data && data.items) || [];
  const q = String(filter.q || '').toLowerCase();
  const out: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (q) {
      const hay = (String(it.name || '') + ' ' + String(it.campaign || '') + ' ' +
        String(it.account || '') + ' ' + String(it.adId || '') + ' ' +
        String(it.marketer || '')).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
    }
    if (filter.status && (!it.status || it.status.key !== filter.status)) continue;
    if (filter.account && String(it.account || '') !== filter.account) continue;
    out.push(it);
  }
  out.sort(function (a, b) { return rankScore(b, filter.rank) - rankScore(a, filter.rank); });
  return out;
}

function uniqueAccounts(items: any[]): string[] {
  const seen: Record<string, boolean> = {}, out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const a = String(items[i].account || '');
    if (a && !seen[a]) { seen[a] = true; out.push(a); }
  }
  out.sort();
  return out;
}

/* ---------------- rule-based analysis (deterministic, ไม่เรียก server) ---------------- */

function computeProblems(it: any): any[] {
  const probs: any[] = [];
  const spend = num(it.spend), orders = num(it.orders), msgs = num(it.msgs), clicks = num(it.clicks);
  const roas = nullable(it.roas);
  const cpo = nullable(it.costPerOrder);
  const close = nullable(it.closeRate);
  const age = nullable(it.ageDays);
  if (age !== null && age > 30 && it.status && it.status.key !== 'paused' && spend > 0) {
    probs.push({ icon: '🥱', label: 'คอนเทนต์ล้า (ยิงมานาน)',
      why: 'แอดนี้รันมาแล้ว ' + fmtNum(age) + ' วัน — ครีเอทีฟเดิมมักล้าหลัง 30 วัน ควรเตรียมตัวใหม่',
      sev: 'medium' });
  }
  if (cpo !== null && cpo > 400) {
    probs.push({ icon: '💸', label: 'Cost ต่อออเดอร์สูงเกินกำหนด',
      why: 'Cost/Order ' + THB(cpo) + ' เกินเพดาน ฿400', sev: 'high' });
  }
  if (roas !== null && roas < 1.5) {
    probs.push({ icon: '📉', label: 'ROAS ต่ำ',
      why: 'ROAS ' + roasStr(roas) + ' ต่ำกว่าเกณฑ์ 1.5 (ใช้งบ ' + THB(spend) + ')',
      sev: roas < 1 ? 'high' : 'medium' });
  }
  if (spend > 800 && orders === 0) {
    probs.push({ icon: '🕳', label: 'จ่ายแล้วไม่มีออเดอร์',
      why: 'ใช้งบไปแล้ว ' + THB(spend) + ' แต่ยังไม่มีออเดอร์เลย', sev: 'high' });
  }
  if (msgs > 30 && close !== null && close < 10) {
    probs.push({ icon: '💬', label: 'แชทเยอะ แต่ปิดไม่ได้',
      why: 'มีแชท ' + fmtNum(msgs) + ' แต่ปิดการขายได้แค่ ' + pctFmt(close), sev: 'medium' });
  }
  if (clicks > 800 && msgs < 15) {
    probs.push({ icon: '🪝', label: 'Hook ไม่ดึงเข้าแชท',
      why: 'คลิก ' + kFmt(clicks) + ' แต่ทักแชทแค่ ' + fmtNum(msgs), sev: 'medium' });
  }
  return probs;
}

function computeVerdict(it: any): string {
  const roas = nullable(it.roas);
  const spend = num(it.spend);
  if (roas !== null && roas >= 3) return 'scale';
  if (roas !== null && roas < 1 && spend > 800) return 'stop';
  return 'adjust';
}

function openAnalysis(data: any, adId: any): void {
  const items = (data && data.items) || [];
  let item: any = null;
  for (let i = 0; i < items.length; i++) {
    if (String(items[i].adId) === String(adId)) { item = items[i]; break; }
  }
  if (!item) { toast('ไม่พบข้อมูลแอดนี้'); return; }

  const probs = computeProblems(item);
  let hasHigh = false, hasMed = false;
  probs.forEach(function (p) {
    if (p.sev === 'high') hasHigh = true;
    else if (p.sev === 'medium') hasMed = true;
  });
  const urgBadge = hasHigh
    ? '<span class="badge urgent">ความเร่งด่วน: ด่วนมาก 🔴</span>'
    : (hasMed
      ? '<span class="badge admin">ควรปรับใน 48 ชม. 🟠</span>'
      : '<span class="badge ai">ติดตามต่อ 🟢</span>');
  const st = item.status || { label: '-', cls: 'neutral' };

  let html = '<div class="modal-head"><h3>🧠 วิเคราะห์: ' +
    esc(item.name || ('Ad ' + item.adId)) +
    '</h3><button class="modal-close">✕</button></div>';

  html += '<div class="pill-grid">' +
    '<span class="badge ' + esc(st.cls || 'neutral') + '">' + esc(st.label || '-') + '</span>' +
    urgBadge +
    '<span class="badge neutral">' + THB(num(item.spend)) + ' → ' + THB(num(item.revenue)) +
    ' (ROAS ' + roasStr(item.roas) + ')</span>' +
    (nullable(item.ageDays) !== null
      ? '<span class="badge neutral">🗓 อายุ ' + fmtNum(num(item.ageDays)) + ' วัน</span>' : '') +
    (item.topSeller
      ? '<span class="badge ai">🧑‍💼 ปิดขายมากสุด: ' + esc(item.topSeller) + '</span>' : '') +
    '</div>';

  html += '<div style="font-weight:700;font-size:13px;margin:12px 0 4px">⚠️ ปัญหาที่พบ</div>';
  if (!probs.length) {
    html += '<div class="empty-note" style="padding:14px 10px">ไม่พบปัญหา — แอดทำงานได้ดี 🎉</div>';
  } else {
    html += probs.map(function (p) {
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;' +
        'border-bottom:1px dashed rgba(38,51,82,.6);font-size:12.5px">' +
        '<span style="font-size:16px">' + p.icon + '</span>' +
        '<span style="flex:1;min-width:0"><b>' + esc(p.label) + '</b><br>' +
        '<span style="color:var(--text-3);font-size:11.5px">' + esc(p.why) + '</span></span>' +
        '<span class="badge ' + (p.sev === 'high' ? 'urgent' : 'admin') + '">' +
        (p.sev === 'high' ? 'สูง' : 'กลาง') + '</span></div>';
    }).join('');
  }

  const actions = VERDICT_ACTIONS[computeVerdict(item)] || VERDICT_ACTIONS.adjust;
  html += '<div style="font-weight:700;font-size:13px;margin:16px 0 4px">✅ Action ที่แนะนำ</div>';
  html += actions.map(function (a, idx) {
    return '<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;font-size:12.5px">' +
      '<span class="badge neutral">' + (idx + 1) + '</span>' +
      '<span style="padding-top:3px">' + esc(a) + '</span></div>';
  }).join('');

  html += '<div class="hint-box">🤖 วิเคราะห์จากกฎอัตโนมัติบนตัวเลขจริง — ยังไม่ใช่ AI</div>';
  html += '<div class="modal-actions"><button class="btn" id="ca-modal-ok">ปิด</button></div>';

  openModal(html);
  const ok = document.getElementById('ca-modal-ok');
  if (ok) ok.addEventListener('click', closeModal);
}

/* ---------------- CSV ---------------- */

function csvVal(v: any): any {
  return (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) ? '' : v;
}

function exportCSV(data: any): void {
  const rows = buildExportRows(data);
  if (rows) downloadCSV(rows, 'content-ads');
}

function exportXLS(data: any): void {
  const rows = buildExportRows(data);
  if (rows) downloadXLS(rows, 'content-ads', 'Content & Ads');
}

/** แถวรายงานชุดเดียว ใช้ทั้ง CSV และ Excel */
function buildExportRows(data: any): any[][] | null {
  const list = filteredItems(data);
  if (!list.length) { toast('ไม่มีข้อมูลให้ export'); return null; }
  const rows: any[][] = [[
    '#', 'ชื่อแอด', 'Ad ID', 'แคมเปญ', 'Ad Set', 'บัญชีแอด', 'มาร์เก็ตติ้ง', 'สถานะ',
    'อายุ (วัน)', 'แอดมินปิดขายมากสุด',
    'Spend', 'Impressions', 'Reach', 'คลิก', 'CTR', 'แชท', 'Cost/แชท',
    'ออเดอร์สร้าง', 'ออเดอร์ส่งแล้ว', 'ออเดอร์', 'ยอดขาย', 'ROAS', 'Cost/Order',
    '% ปิด', 'อัปเดตล่าสุด',
  ]];
  list.forEach(function (it, i) {
    rows.push([
      i + 1,
      csvVal(it.name), csvVal(it.adId), csvVal(it.campaign), csvVal(it.adsetId), csvVal(it.account),
      csvVal(it.marketer), (it.status && it.status.label) || '',
      csvVal(nullable(it.ageDays)), csvVal(it.topSeller),
      num(it.spend), num(it.impressions), num(it.reach), num(it.clicks),
      csvVal(nullable(it.ctr)), num(it.msgs), csvVal(nullable(it.costPerMsg)),
      num(it.orderCreated), num(it.orderShipped), num(it.orders), num(it.revenue),
      csvVal(nullable(it.roas)), csvVal(nullable(it.costPerOrder)),
      csvVal(nullable(it.closeRate)),
      String(it.updatedAt || '').replace('T', ' '),
    ]);
  });
  return rows;
}

/* ---------------- render: controls ---------------- */

function controlsHtml(items: any[]): string {
  const accounts = uniqueAccounts(items);
  let h = '<div class="pg-controls">';
  h += '<input class="input" id="ca-q" style="flex:1;min-width:220px;max-width:360px" ' +
    'placeholder="🔍 ค้นหาชื่อแอด / แคมเปญ / บัญชีแอด..." value="' + esc(filter.q) + '">';
  h += '<select class="input" id="ca-status">' + STATUS_OPTIONS.map(function (o) {
    return '<option value="' + o.key + '"' + (filter.status === o.key ? ' selected' : '') + '>' +
      o.label + '</option>';
  }).join('') + '</select>';
  h += '<select class="input" id="ca-account"><option value="">ทุกบัญชีแอด</option>' +
    accounts.map(function (a) {
      return '<option value="' + esc(a) + '"' + (filter.account === a ? ' selected' : '') + '>' +
        esc(a) + '</option>';
    }).join('') + '</select>';
  h += '<span class="spacer"></span>';
  h += '<button class="btn" id="ca-csv" title="Export รายการที่กรอง/เรียงแล้วทั้งหมด">📄 CSV</button>';
  h += '<button class="btn" id="ca-xls" title="ไฟล์ Excel เปิดแล้วภาษาไทยไม่เพี้ยน">📊 Excel</button>';
  h += '</div>';
  return h;
}

function rankControlsHtml(): string {
  return '<div class="pg-controls" style="margin-top:2px">' + RANK_MODES.map(function (m) {
    return '<button class="btn-mini' + (filter.rank === m.key ? ' primary' : '') +
      '" data-carank="' + m.key + '">' + m.label + '</button>';
  }).join('') + '</div>';
}

/* ---------------- render: alerts ---------------- */

function alertLevelBadge(level: string): string {
  if (level === 'red') return '<span class="badge urgent">ด่วนมาก</span>';
  if (level === 'orange') return '<span class="badge admin">ควรปรับ</span>';
  if (level === 'green') return '<span class="badge ai">โอกาส</span>';
  return '<span class="badge info">เฝ้าดู</span>';
}

function alertRowHtml(a: any): string {
  const lv = String(a.level || 'yellow');
  const reason = String(a.reason || '') + (a.nums ? ' • ' + String(a.nums) : '');
  return '<div class="alert-row lv-' + esc(lv) + '">' +
    '<div class="alert-icon">' + esc(a.icon || '🔔') + '</div>' +
    '<div class="alert-body">' +
    '<div class="alert-title">' + esc(a.title || '') + ' ' + alertLevelBadge(lv) + '</div>' +
    '<div class="alert-reason">' + esc(reason) + '</div>' +
    (a.recommend ? '<div class="alert-recommend">แนะนำ: ' + esc(a.recommend) + '</div>' : '') +
    '</div>' +
    '<div style="flex-shrink:0">' +
    '<button class="btn-mini" data-ca-view="' + esc(a.adId) + '">🔎 ดูรายละเอียด</button>' +
    '</div></div>';
}

function alertsCardHtml(data: any): string {
  const s = (data && data.summary) || {};
  const alerts = (data && data.alerts) || [];
  let h = '<div class="card" style="margin-bottom:14px">';
  h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<h3 style="margin:0">🔔 Content Alerts</h3>' +
    '<span class="badge urgent">' + fmtNum(num(s.urgent)) + ' ด่วน</span>' +
    '<span class="badge admin">' + fmtNum(num(s.adjust)) + ' ควรปรับ</span>' +
    '<span class="badge ai">' + fmtNum(num(s.scale)) + ' ควร Scale</span></div>';
  if (!alerts.length) {
    h += '<div class="empty-note">ไม่มี Alert ตอนนี้ 🎉</div>';
  } else {
    const shown = alertShowAll ? alerts : alerts.slice(0, 5);
    h += '<div class="alert-list">' + shown.map(alertRowHtml).join('') + '</div>';
    if (alerts.length > 5) {
      h += '<div style="margin-top:10px;text-align:center">' +
        '<button class="btn-mini" id="ca-alert-toggle">' +
        (alertShowAll ? 'ย่อ' : 'ดู Alert ทั้งหมด (' + fmtNum(alerts.length) + ')') +
        '</button></div>';
    }
  }
  h += '</div>';
  return h;
}

/* ---------------- render: ad cards ---------------- */

function caNum(valHtml: string, label: string): string {
  return '<div class="ca-num">' + valHtml + '<span>' + label + '</span></div>';
}

function cardHtml(it: any, rank: number): string {
  const st = it.status || { label: '-', cls: 'neutral' };
  const roas = nullable(it.roas);
  const cpo = nullable(it.costPerOrder);
  const roasCls = roas === null ? '' : (roas < 1.5 ? 'txt-bad' : (roas >= 3 ? 'txt-good' : ''));
  const cpoCls = (cpo !== null && cpo > 400) ? 'txt-bad' : '';
  const line1 = String(it.account || '-') +
    (it.marketer ? ' • มาร์เก็ตติ้ง: ' + String(it.marketer) : '');

  let h = '<div class="ca-card">';
  h += '<div class="ca-rank">' + rank + '</div>';
  h += '<div class="ca-main">';
  h += '<div class="ca-id">' + esc(it.name || ('Ad ' + it.adId)) +
    ' <span class="badge ' + esc(st.cls || 'neutral') + '">' + esc(st.label || '-') + '</span>' +
    (it.campaign
      ? ' <span class="chip" style="padding:2px 10px;font-size:10.5px">' + esc(it.campaign) + '</span>'
      : '') +
    '</div>';
  h += '<div class="ca-sub">' + esc(line1) +
    (it.topSeller ? ' • 🧑‍💼 ปิดขายมากสุด: ' + esc(it.topSeller) : '') + '</div>';
  h += '<div class="ca-sub">Ad ' + esc(it.adId) +
    (nullable(it.ageDays) !== null ? ' • อายุ ' + fmtNum(num(it.ageDays)) + ' วัน' : '') +
    ' • อัปเดต ' + esc(relTime(it.updatedAt)) + '</div>';
  h += '</div>';

  h += '<div class="ca-nums">';
  h += caNum('<b class="txt-good" title="ยอดขายจากออเดอร์ที่ผูก ad นี้">' +
    THB(num(it.revenue)) + '</b>', 'ยอดขาย');
  h += caNum('<b title="ค่าโฆษณาที่ใช้ไป">' + (num(it.spend) > 0 ? THB(it.spend) : '-') + '</b>', 'Spend');
  h += caNum('<b' + (roasCls ? ' class="' + roasCls + '"' : '') +
    ' title="ROAS = ยอดขาย ÷ ค่าโฆษณา">' + roasStr(roas) + '</b>', 'ROAS');
  h += caNum('<b' + (cpoCls ? ' class="' + cpoCls + '"' : '') +
    ' title="ค่าโฆษณาต่อ 1 ออเดอร์">' + (cpo === null ? '-' : THB(cpo)) + '</b>', 'Cost/Order');
  h += caNum('<b>' + fmtNum(num(it.orders)) + '</b>', 'ออเดอร์');
  h += caNum('<b>' + fmtNum(num(it.msgs)) + '</b>', 'แชท');
  h += caNum('<b>' + kFmt(num(it.clicks)) + '</b>', 'คลิก');
  h += caNum('<b>' + pctFmt(it.closeRate) + '</b>', '% ปิด');
  h += '</div>';

  h += '<div style="flex-shrink:0"><button class="btn-mini primary" data-ca-view="' +
    esc(it.adId) + '" title="วิเคราะห์จากตัวเลขจริง + คำแนะนำ">🧠 วิเคราะห์</button></div>';
  h += '</div>';
  return h;
}

function listHtml(allItems: any[], list: any[]): string {
  if (!allItems.length) {
    return '<div class="card"><div class="empty-note">📡 ยังไม่มีข้อมูลแอด — ' +
      'ระบบซิงค์ข้อมูลแอดอัตโนมัติทุกชั่วโมง รอสักครู่แล้วรีเฟรช</div></div>';
  }
  if (!list.length) {
    return '<div class="card"><div class="empty-note">🎯 ไม่พบแอดตามตัวกรอง</div></div>';
  }
  const top = list.slice(0, 30);
  let h = '<div class="ca-list">' + top.map(function (it, i) {
    return cardHtml(it, i + 1);
  }).join('') + '</div>';
  if (list.length > 30) {
    h += '<div class="empty-note" style="padding:14px 10px">แสดง 30 อันดับแรกจากทั้งหมด ' +
      fmtNum(list.length) + ' รายการ — กด 📄 CSV เพื่อดูทั้งหมด</div>';
  }
  return h;
}

/* ---------------- render + bind ---------------- */

function render(container: HTMLElement, data: any): void {
  const items = (data && data.items) || [];
  const list = filteredItems(data);
  let html = '';
  if (data && data.note) html += '<div class="hint-box">' + esc(data.note) + '</div>';
  html += controlsHtml(items);
  html += alertsCardHtml(data);
  html += rankControlsHtml();
  html += listHtml(items, list);
  container.innerHTML = html;
  bind(container, data);
}

function bind(container: HTMLElement, data: any): void {
  function current() { return lastData || data; }
  function rerender() { render(container, current()); }

  const q = container.querySelector('#ca-q') as HTMLInputElement | null;
  if (q) {
    q.addEventListener('change', function () {
      if (q.value.trim() !== filter.q) { filter.q = q.value.trim(); rerender(); }
    });
    q.addEventListener('keydown', function (e: KeyboardEvent) {
      if (e.keyCode === 13) { filter.q = q.value.trim(); rerender(); }
    });
  }
  const st = container.querySelector('#ca-status') as HTMLSelectElement | null;
  if (st) st.addEventListener('change', function () { filter.status = st.value; rerender(); });
  const ac = container.querySelector('#ca-account') as HTMLSelectElement | null;
  if (ac) ac.addEventListener('change', function () { filter.account = ac.value; rerender(); });

  container.querySelectorAll('[data-carank]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      filter.rank = btn.getAttribute('data-carank')!;
      rerender();
    });
  });

  const tog = container.querySelector('#ca-alert-toggle');
  if (tog) tog.addEventListener('click', function () {
    alertShowAll = !alertShowAll;
    rerender();
  });

  const csv = container.querySelector('#ca-csv');
  if (csv) csv.addEventListener('click', function () { exportCSV(current()); });

  const xls = container.querySelector('#ca-xls');
  if (xls) xls.addEventListener('click', function () { exportXLS(current()); });

  container.querySelectorAll('[data-ca-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openAnalysis(current(), btn.getAttribute('data-ca-view'));
    });
  });
}

/* ---------------- fetch + register ---------------- */

function fetchFresh(container: HTMLElement, background: boolean): void {
  serverCall('apiContentAds').then(function (data) {
    lastData = data || {};
    render(container, lastData);
  }).catch(function (err: any) {
    if (background) {
      toast('⚠️ โหลดข้อมูลแอดใหม่ไม่สำเร็จ — แสดงข้อมูลเดิมไปก่อน');
    } else {
      showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
        container.innerHTML = contentadsSkel();
        fetchFresh(container, false);
      });
    }
  });
}

export const contentads = {
  load: async (container: HTMLElement, force?: boolean) => {
    if (lastData && !force) {
      render(container, lastData);
      fetchFresh(container, true);
    } else {
      container.innerHTML = contentadsSkel();
      fetchFresh(container, false);
    }
  },
};
