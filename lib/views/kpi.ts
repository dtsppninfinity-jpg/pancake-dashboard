// lib/views/kpi.ts — หน้า "KPI ทีมขาย" (รื้อ UI 2026-08-01 ตามบรีฟ: นำเสนอแบบเว็บตัวอย่างของทีม
// — การ์ดสรุป + สูตรน้ำหนักตามระดับ + ตารางประเมินตามสายบังคับบัญชา (หัวหน้า→รอง→ลูกทีม)
// + เกรด A-D + แนวโน้มเทียบเดือนก่อน + สัดส่วนเกรด + แจ้งเตือน — แต่หน้าตาเป็นธีมของเรา)
// คะแนนจากชีท KPI กลางของทีม (สูตรอยู่ในชีท — หน้านี้คือกระจก + จัดอันดับ)

import { serverCall, esc, fmtNum, THB, pctFmt, avatarHtml, showError, downloadCSV, toast } from '@/lib/ui/helpers';

interface AdminRow {
  id: string; name: string; nick: string; unit: string; unitFull: string;
  sales: number; close: number; err: number; perBill: number; ret: number; score: number;
}
interface Person { id: string; name: string; nick: string; units: string[]; sales: number; score: number }
interface SubRow {
  id: string; name: string; nick: string; unit: string;
  target: number; teamSales: number; teamCount: number; hitTarget: number;
  close: number; perBill: number; adCost: number; err: number; score: number; kpiAvg: number;
}
interface HeadRow {
  id: string; name: string; nick: string;
  kpiSub: number; target: number; sales: number; adCost: number; score: number;
  units: Array<{ unit: string; score: number; sales: number; target: number }>;
}
interface YearRow {
  id: string; name: string; nick: string;
  kpiYear: number; sales: number; close: number; err: number; perBill: number; ret: number; kpiAvg: number;
}
interface KpiData {
  setupNeeded?: boolean;
  year: number; months: number[]; month: number; prevMonth: number; updatedAt: string;
  admin: AdminRow[]; persons: Person[]; sub: SubRow[]; head: HeadRow[]; adminYear: YearRow[];
  prevPersons: Record<string, number>; prevSub: Record<string, number>; prevHead: Record<string, number>;
  headHistory: Array<{ month: number; score: number | null }>;
  noComAlerts: Array<{ admin: string; months: string[] }>;
  unitAlerts: Array<{ u: string; days: number; level: string }>;
  topSales: Person[]; topKpi: Person[]; topSalesYear: YearRow[];
}

let lastData: KpiData | null = null;
let reqSeq = 0;
const state = { month: 0 };

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MEDALS = ['🥇', '🥈', '🥉'];

/* ---------- คะแนน / เกรด / แนวโน้ม ---------- */

/** คะแนนชีทเป็นสัดส่วน (0.7947) → แต้มเต็ม 100 (79.5) — เกิน 100 ได้เมื่อทะลุเป้า */
const pts = (v: number | null | undefined): number | null =>
  (v === null || v === undefined || isNaN(Number(v))) ? null : Math.round(Number(v) * 1000) / 10;

function scorePct(v: number | null | undefined): string {
  const p = pts(v);
  return p === null ? '-' : p + '%';
}

/** เกรดตามเกณฑ์ทีม: A ≥80 • B 70-79.9 • C 60-69.9 • D <60 */
function gradeOf(p: number | null): 'A' | 'B' | 'C' | 'D' | '-' {
  if (p === null) return '-';
  return p >= 80 ? 'A' : p >= 70 ? 'B' : p >= 60 ? 'C' : 'D';
}
const GRADE_CLS: Record<string, string> = { A: 'g-a', B: 'g-b', C: 'g-c', D: 'g-d' };

function gradeChip(p: number | null): string {
  const g = gradeOf(p);
  return g === '-' ? '—' : '<span class="grade ' + GRADE_CLS[g] + '">' + g + '</span>';
}

/** แนวโน้ม = แต้มเดือนนี้ − เดือนก่อน (จุด) — '—' เมื่อไม่มีเดือนก่อนเทียบ */
function trendHtml(cur: number | null | undefined, prev: number | null | undefined): string {
  const c = pts(cur), p = pts(prev);
  if (c === null || p === null) return '<span style="opacity:.4">—</span>';
  const d = Math.round((c - p) * 10) / 10;
  if (d > 0) return '<span class="txt-good">▲ +' + d + '</span>';
  if (d < 0) return '<span class="txt-bad">▼ ' + d + '</span>';
  return '<span style="opacity:.6">• 0</span>';
}

/** สถานะ: เฝ้าระวัง = คะแนนต่ำกว่า 60 หรือร่วงแรง (≥3 จุด) / นอกนั้น = มาตรฐาน */
function statusBadge(cur: number | null | undefined, prev: number | null | undefined): string {
  const c = pts(cur), p = pts(prev);
  if (c === null) return '—';
  const drop = (p !== null && c - p <= -3);
  if (c < 60 || drop) return '<span class="badge urgent">เฝ้าระวัง</span>';
  return '<span class="badge ai">มาตรฐาน</span>';
}

/** วงแหวนคะแนน (0-100+) — สีตามเกรด */
function ring(p: number | null): string {
  if (p === null) return '';
  const g = gradeOf(p);
  const color = g === 'A' ? 'var(--green)' : g === 'B' ? 'var(--blue)' : g === 'C' ? 'var(--amber)' : 'var(--red)';
  return '<div class="kpi-ring" style="--p:' + Math.max(0, Math.min(100, p)) + ';--rc:' + color + '">' +
    '<span>' + Math.round(p) + '%</span></div>';
}

/* ---------- การ์ดสรุปบนสุด ---------- */

function summaryCards_(d: KpiData): string {
  const h = d.head[0];
  const hp = h ? pts(h.score) : null;
  const subIds = new Set(d.sub.map((r) => r.id || r.name));
  const passN = d.persons.filter((p) => (pts(p.score) || 0) >= 70).length;
  const passPct = d.persons.length ? Math.round((passN / d.persons.length) * 100) : 0;
  return '<div class="kpi-cards">' +
    '<div class="card kpi-card">' +
      ring(hp) +
      '<div><div class="kpi-big">' + (hp === null ? '—' : hp) + '<span class="kpi-max">/100</span> ' + gradeChip(hp) + '</div>' +
      '<div class="card-sub" style="margin:0">คะแนนหัวหน้า' + (h ? ' — ' + esc(h.nick || h.name) : '') + '</div></div>' +
    '</div>' +
    '<div class="card kpi-card"><div class="kpi-ico">🧭</div><div>' +
      '<div class="kpi-big">' + fmtNum(subIds.size) + '</div>' +
      '<div class="card-sub" style="margin:0">รองหัวหน้า</div></div></div>' +
    '<div class="card kpi-card"><div class="kpi-ico">👥</div><div>' +
      '<div class="kpi-big">' + fmtNum(d.persons.length) + '</div>' +
      '<div class="card-sub" style="margin:0">แอดมิน (มีคะแนนเดือนนี้)</div></div></div>' +
    '<div class="card kpi-card"><div class="kpi-ico">✅</div><div>' +
      '<div class="kpi-big ' + (passPct >= 70 ? 'txt-good' : passPct < 50 ? 'txt-bad' : '') + '">' + passPct + '%</div>' +
      '<div class="card-sub" style="margin:0">ผ่าน KPI (เกรด B ขึ้นไป ' + fmtNum(passN) + '/' + fmtNum(d.persons.length) + ' คน)</div></div></div>' +
  '</div>';
}

/* ---------- สูตรน้ำหนักคะแนนตามระดับ (จากแท็บ ตัวชี้วัด ของชีททีม) ---------- */

const WEIGHTS: Array<{ role: string; items: Array<[string, number]> }> = [
  { role: 'หัวหน้าฝ่าย', items: [['KPI รองที่ดูแล', 40], ['ยอดขายรวม', 40], ['ค่าแอด ≤33%', 20]] },
  { role: 'รองหัวหน้า', items: [['ยอดยูนิต', 30], ['ลูกทีมถึงเป้า', 20], ['%ปิดเฉลี่ย', 20], ['ค่าแอด ≤33%', 20], ['เปอร์บิล', 10]] },
  { role: 'แอดมิน', items: [['ยอดขาย', 35], ['%ปิด', 35], ['เปอร์บิล', 20], ['%Error', 5], ['%ตีกลับ', 5]] },
];
const WT_COLORS = ['var(--green)', 'var(--blue)', 'var(--amber)', 'var(--primary)', '#f472b6'];

function weightStrip_(): string {
  const cols = WEIGHTS.map(function (w) {
    const items = w.items.map(function (it, i) {
      return '<div class="wt-item"><div class="wt-num">' + it[1] + '</div>' +
        '<div class="wt-name">' + esc(it[0]) + '</div>' +
        '<div class="wt-bar" style="background:' + WT_COLORS[i % WT_COLORS.length] + '"></div></div>';
    }).join('');
    return '<div class="wt-group"><div class="wt-role">' + esc(w.role) + '</div><div class="wt-row">' + items + '</div></div>';
  }).join('');
  return '<div class="card" style="margin-top:14px">' +
    '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">' +
      '<h3 style="margin:0">🧮 สูตรคะแนนตามระดับ</h3>' +
      '<span class="card-sub" style="margin:0">น้ำหนักจากแท็บ "ตัวชี้วัด" ของชีท KPI — สูตรคิดในชีท เว็บอ่านผลอย่างเดียว</span></div>' +
    '<div class="wt-strip">' + cols + '</div></div>';
}

/* ---------- ตารางประเมินตามสายบังคับบัญชา (หัวหน้า → รอง → ลูกทีม) ---------- */

function hierarchyHtml_(d: KpiData): string {
  const persons = d.persons;
  const passOf = (list: Person[]) => list.filter((p) => (pts(p.score) || 0) >= 70).length;

  // จัดกลุ่มรองรายคน (คนเดียวดูหลายยูนิต = หลายแถวในชีท)
  const subBy: Record<string, { id: string; nick: string; name: string; units: string[]; target: number; teamSales: number; close: number; _cw: number; adCost: number; _aw: number; score: number; n: number; prevSum: number; prevN: number }> = {};
  d.sub.forEach(function (r) {
    const k = r.id || r.name;
    const a = (subBy[k] = subBy[k] || { id: r.id, nick: r.nick || r.name, name: r.name, units: [], target: 0, teamSales: 0, close: 0, _cw: 0, adCost: 0, _aw: 0, score: 0, n: 0, prevSum: 0, prevN: 0 });
    a.units.push(r.unit);
    a.target += r.target; a.teamSales += r.teamSales;
    const w = r.teamSales > 0 ? r.teamSales : 1;
    a.close += r.close * w; a._cw += w;
    a.adCost += r.adCost * w; a._aw += w;
    a.score += r.score; a.n++;
    const pv = d.prevSub[`${r.id}|${r.unit}`];
    if (pv !== undefined) { a.prevSum += pv; a.prevN++; }
  });
  const subs = Object.values(subBy).sort((a, b) => (b.score / b.n) - (a.score / a.n));

  // แอดมินใต้รองแต่ละคน = คนที่ประจำยูนิตที่รองดูแล
  const personsInUnits = (units: string[]) => {
    const set = new Set(units);
    return persons.filter((p) => p.units.some((u) => set.has(u)));
  };

  const rows: string[] = [];

  // แถวหัวหน้า
  const h = d.head[0];
  if (h) {
    const hp = h.score, hprev = d.prevHead[h.id || h.name];
    const attain = h.target > 0 ? Math.round((h.sales / h.target) * 1000) / 10 : null;
    rows.push('<tr class="kpi-head-row">' +
      '<td><b>👑 ' + esc(h.nick || h.name) + '</b> <span class="rank-fullname">หัวหน้าฝ่าย</span></td>' +
      '<td><span class="chip">ทุกยูนิต</span></td>' +
      '<td class="num"><b>' + (attain === null ? '—' : pctFmt(attain)) + '</b>' +
        '<div class="kpi-subnum">' + THB(h.sales) + ' / ' + THB(h.target) + '</div></td>' +
      '<td class="num">' + (h.adCost > 33 ? '<span class="txt-bad">' + pctFmt(h.adCost) + '</span>' : pctFmt(h.adCost)) + '</td>' +
      '<td class="num">' + fmtNum(passOf(persons)) + '/' + fmtNum(persons.length) + '</td>' +
      '<td class="num"><b>' + esc(scorePct(hp)) + '</b></td>' +
      '<td>' + gradeChip(pts(hp)) + '</td>' +
      '<td class="num">' + trendHtml(hp, hprev) + '</td>' +
      '<td>' + statusBadge(hp, hprev) + '</td><td></td></tr>');
  }

  // แถวรอง + ลูกทีมพับได้
  subs.forEach(function (s, si) {
    const score = s.score / s.n;
    const prev = s.prevN ? s.prevSum / s.prevN : null;
    const team = personsInUnits(s.units);
    const attain = s.target > 0 ? Math.round((s.teamSales / s.target) * 1000) / 10 : null;
    const close = s._cw ? s.close / s._cw : null;
    const adCost = s._aw ? s.adCost / s._aw : null;
    rows.push('<tr class="kpi-sub-row">' +
      '<td><span class="kpi-rank">' + (si + 1) + '</span> <b>' + esc(s.nick) + '</b> <span class="rank-fullname">รองหัวหน้า</span></td>' +
      '<td>' + s.units.map((u) => '<span class="chip">' + esc(u) + '</span>').join(' ') + '</td>' +
      '<td class="num"><b>' + (attain === null ? '—' : pctFmt(attain)) + '</b>' +
        '<div class="kpi-subnum">' + THB(s.teamSales) + ' / ' + THB(s.target) + '</div></td>' +
      '<td class="num">' + (adCost === null ? '—' : (adCost > 33 ? '<span class="txt-bad">' + pctFmt(adCost) + '</span>' : pctFmt(adCost))) + '</td>' +
      '<td class="num">' + fmtNum(passOf(team)) + '/' + fmtNum(team.length) + '</td>' +
      '<td class="num"><b>' + esc(scorePct(score)) + '</b>' +
        (close === null ? '' : '<div class="kpi-subnum">%ปิด ' + pctFmt(close) + '</div>') + '</td>' +
      '<td>' + gradeChip(pts(score)) + '</td>' +
      '<td class="num">' + trendHtml(score, prev) + '</td>' +
      '<td>' + statusBadge(score, prev) + '</td>' +
      '<td><button class="btn-mini" data-subtoggle="' + si + '">ดูทีม ▾</button></td></tr>');
    team
      .slice().sort((a, b) => b.score - a.score)
      .forEach(function (p) {
        rows.push('<tr class="kpi-child kpi-team-' + si + '" style="display:none">' +
          '<td style="padding-left:34px">' + esc(p.nick || p.name) + ' <span class="rank-fullname">' + esc(p.name) + '</span></td>' +
          '<td>' + p.units.map((u) => '<span class="chip">' + esc(u) + '</span>').join(' ') + '</td>' +
          '<td class="num">' + THB(p.sales) + '</td>' +
          '<td class="num">—</td><td class="num">—</td>' +
          '<td class="num">' + esc(scorePct(p.score)) + '</td>' +
          '<td>' + gradeChip(pts(p.score)) + '</td>' +
          '<td class="num">' + trendHtml(p.score, d.prevPersons[p.id]) + '</td>' +
          '<td>' + statusBadge(p.score, d.prevPersons[p.id]) + '</td><td></td></tr>');
      });
  });

  return '<div class="card">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<h3 style="margin:0">🪜 ประเมินตามสายบังคับบัญชา — ' + esc(TH_MONTHS[d.month - 1] + ' ' + d.year) + '</h3>' +
      '<div class="spacer" style="flex:1"></div><button class="btn-mini" id="kpi-csv">📄 CSV</button></div>' +
    '<div class="card-sub">เกรด: <span class="grade g-a">A</span> ≥80 • <span class="grade g-b">B</span> 70-79.9 • ' +
      '<span class="grade g-c">C</span> 60-69.9 • <span class="grade g-d">D</span> &lt;60 • ' +
      'ผ่าน KPI = เกรด B ขึ้นไป • แนวโน้มเทียบ' + (d.prevMonth ? esc(TH_MONTHS[d.prevMonth - 1]) : 'เดือนก่อน') +
      ' • กด "ดูทีม" เพื่อกางลูกทีมของรองคนนั้น</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>บุคลากร</th><th>ยูนิต</th><th class="num">ยอด vs เป้า</th><th class="num">ค่าแอด/ยอด</th>' +
      '<th class="num">ลูกทีมผ่าน KPI</th><th class="num">คะแนน</th><th>เกรด</th>' +
      '<th class="num">แนวโน้ม</th><th>สถานะ</th><th></th>' +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div></div>';
}

/* ---------- แผงขวา: สัดส่วนเกรด + แจ้งเตือน + ประวัติคะแนนหัวหน้า ---------- */

function gradeDonut_(d: KpiData): string {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  d.persons.forEach((p) => { const g = gradeOf(pts(p.score)); if (g !== '-') counts[g]++; });
  const total = d.persons.length;
  if (!total) return '';
  const colors: Record<string, string> = { A: 'var(--green)', B: 'var(--blue)', C: 'var(--amber)', D: 'var(--red)' };
  let acc = 0;
  const segs: string[] = [];
  (['A', 'B', 'C', 'D'] as const).forEach(function (g) {
    const share = (counts[g] / total) * 100;
    if (share <= 0) return;
    segs.push(colors[g] + ' ' + acc + '% ' + (acc + share) + '%');
    acc += share;
  });
  const legend = (['A', 'B', 'C', 'D'] as const).map(function (g) {
    return '<div class="kpi-lg"><span class="kpi-dot" style="background:' + colors[g] + '"></span>' +
      '<span class="grade ' + GRADE_CLS[g] + '">' + g + '</span> ' + fmtNum(counts[g]) + ' คน (' +
      (total ? Math.round((counts[g] / total) * 100) : 0) + '%)</div>';
  }).join('');
  return '<div class="card"><h3>🍩 สัดส่วนเกรดแอดมิน</h3>' +
    '<div style="display:flex;gap:14px;align-items:center">' +
      '<div class="kpi-donut" style="background:conic-gradient(' + segs.join(',') + ')"><span>' + fmtNum(total) + '<small>คน</small></span></div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' + legend + '</div></div></div>';
}

function alertsCard_(d: KpiData): string {
  const items: string[] = [];
  if (d.noComAlerts.length) {
    items.push('<div class="kpi-alert"><b>🔔 ' + fmtNum(d.noComAlerts.length) + ' คน</b> ไม่ได้ค่าคอม 2 เดือนปิดยอดติดกัน' +
      '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">' +
      d.noComAlerts.slice(0, 10).map((a) => '<span class="chip">' + esc(a.admin) + '</span>').join('') +
      (d.noComAlerts.length > 10 ? ' <span class="chip">+' + (d.noComAlerts.length - 10) + '</span>' : '') + '</div>' +
      '<div class="kpi-subnum">รายละเอียดอยู่ส่วนค่าคอม หน้า Admin Performance</div></div>');
  }
  const urgent = d.unitAlerts.filter((a) => a.level === 'urgent');
  if (urgent.length) {
    items.push('<div class="kpi-alert"><b>🚨 ' + fmtNum(urgent.length) + ' ยูนิต</b> ขาดทุน ≥2 วันติด' +
      '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">' +
      urgent.slice(0, 10).map((a) => '<span class="chip">' + esc(a.u) + ' ' + fmtNum(a.days) + ' วัน</span>').join('') + '</div>' +
      '<div class="kpi-subnum">รายละเอียด + ผู้รับผิดชอบ อยู่บนสุดหน้า Sales</div></div>');
  }
  if (!items.length) items.push('<div class="empty-note">✅ ไม่มีเรื่องเร่งด่วน</div>');
  return '<div class="card"><h3>⚠️ แจ้งเตือนหัวหน้า</h3>' + items.join('') + '</div>';
}

function historyCard_(d: KpiData): string {
  const ptsArr = d.headHistory.filter((x) => x.score !== null);
  if (ptsArr.length < 2) return '';
  const W = 260, H = 64, PAD = 6;
  const vals = ptsArr.map((x) => (pts(x.score) as number));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const xy = ptsArr.map(function (x, i) {
    const px = PAD + (i / (ptsArr.length - 1)) * (W - PAD * 2);
    const py = PAD + (1 - (((pts(x.score) as number)) - min) / span) * (H - PAD * 2);
    return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
  });
  const line = xy.map((p) => p.join(',')).join(' ');
  const last = xy[xy.length - 1];
  const h = d.head[0];
  return '<div class="card"><h3>📈 ประวัติคะแนนหัวหน้า' + (h ? ' — ' + esc(h.nick || h.name) : '') + '</h3>' +
    '<div class="card-sub">' + esc(TH_MONTHS[ptsArr[0].month - 1] + ' – ' + TH_MONTHS[ptsArr[ptsArr.length - 1].month - 1] + ' ' + d.year) +
      ' • ล่าสุด <b>' + vals[vals.length - 1] + '</b></div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" preserveAspectRatio="none">' +
      '<polyline points="' + line + '" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5" fill="var(--primary)"/></svg>' +
    '<div style="display:flex;justify-content:space-between" class="kpi-subnum">' +
      ptsArr.map((x) => '<span>' + esc(TH_MONTHS[x.month - 1]) + '</span>').join('') + '</div></div>';
}

/* ---------- ส่วนเดิมที่คงไว้ (ท็อป / ตารางแอดมินละเอียด / สรุปปี) ---------- */

function topCard_(title: string, sub: string, rows: Array<{ nick: string; name: string; id: string; big: string; small: string }>): string {
  const items = rows.map(function (r, i) {
    return '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
      '<div style="font-size:20px">' + MEDALS[i] + '</div>' +
      avatarHtml(r.id, r.nick || r.name, undefined, 'sm') +
      '<div style="flex:1;min-width:0"><b>' + esc(r.nick || r.name) + '</b>' +
        '<div class="card-sub" style="margin:0">' + esc(r.small) + '</div></div>' +
      '<b>' + r.big + '</b>' +
    '</div>';
  }).join('');
  return '<div class="card" style="flex:1;min-width:240px">' +
    '<h3>' + title + '</h3><div class="card-sub">' + esc(sub) + '</div>' +
    (items || '<div class="empty-note">ยังไม่มีข้อมูล</div>') + '</div>';
}

function scoreCls(v: number): string {
  const p = pts(v);
  if (p === null) return '';
  if (p >= 80) return 'txt-good';
  if (p < 60) return 'txt-bad';
  return '';
}

function adminTableHtml_(d: KpiData): string {
  const body = d.admin.map(function (r, i) {
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><b>' + esc(r.nick || r.name) + '</b> <span class="rank-fullname">' + esc(r.name) + '</span></td>' +
      '<td><span class="badge neutral" title="' + esc(r.unitFull) + '">' + esc(r.unit) + '</span></td>' +
      '<td class="num">' + THB(r.sales) + '</td>' +
      '<td class="num">' + pctFmt(r.close) + '</td>' +
      '<td class="num"' + (Math.abs(r.err) > 5 ? ' style="color:var(--bad,#e74c3c)"' : '') + '>' + pctFmt(r.err) + '</td>' +
      '<td class="num">' + fmtNum(Math.round(r.perBill)) + '</td>' +
      '<td class="num"' + (r.ret > 5 ? ' style="color:var(--bad,#e74c3c)"' : '') + '>' + pctFmt(r.ret) + '</td>' +
      '<td class="num ' + scoreCls(r.score) + '"><b>' + esc(scorePct(r.score)) + '</b></td>' +
      '<td>' + gradeChip(pts(r.score)) + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="card" style="margin-top:14px">' +
    '<h3>👥 KPI แอดมินรายคน (ละเอียดตามชีท) — ' + esc(TH_MONTHS[d.month - 1] + ' ' + d.year) + '</h3>' +
    '<div class="card-sub">คนเดียวหลายยูนิต = หลายแถวตามชีท • ตัวเลขทุกช่องมาจากชีท KPI ตรงๆ</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>#</th><th>แอดมิน</th><th>ยูนิต</th><th class="num">ยอดขาย</th><th class="num">%ปิด</th>' +
      '<th class="num">%Error</th><th class="num">เปอร์บิล</th><th class="num">%ตีกลับ</th><th class="num">คะแนน KPI</th><th>เกรด</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

function yearTableHtml_(d: KpiData): string {
  if (!d.adminYear.length) return '';
  const body = d.adminYear.map(function (r, i) {
    return '<tr>' +
      '<td>' + (i + 1) + (i < 3 ? ' ' + MEDALS[i] : '') + '</td>' +
      '<td><b>' + esc(r.nick || r.name) + '</b> <span class="rank-fullname">' + esc(r.name) + '</span></td>' +
      '<td class="num">' + THB(r.sales) + '</td>' +
      '<td class="num">' + pctFmt(r.close) + '</td>' +
      '<td class="num">' + fmtNum(Math.round(r.perBill)) + '</td>' +
      '<td class="num">' + pctFmt(r.ret) + '</td>' +
      '<td class="num ' + scoreCls(r.kpiAvg) + '"><b>' + esc(scorePct(r.kpiAvg)) + '</b></td>' +
      '<td>' + gradeChip(pts(r.kpiAvg)) + '</td>' +
    '</tr>';
  }).join('');
  const topSale = d.topSalesYear[0];
  return '<div class="card" style="margin-top:14px">' +
    '<h3>📅 สรุปทั้งปี ' + esc(String(d.year)) + ' — ท็อปเซลประจำปี: <b>' +
      esc(topSale ? (topSale.nick || topSale.name) : '—') + '</b>' +
      (topSale ? ' (' + THB(topSale.sales) + ')' : '') + '</h3>' +
    '<div class="card-sub">เรียงตาม KPI เฉลี่ยรวม (เฉพาะเดือนที่มีข้อมูล) • ตัดคนไม่มียอดทั้งปีออก</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>#</th><th>แอดมิน</th><th class="num">ยอดขายรวมปี</th><th class="num">%ปิด</th>' +
      '<th class="num">เปอร์บิล</th><th class="num">%ตีกลับ</th><th class="num">KPI เฉลี่ยปี</th><th>เกรด</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

/* ---------- render ---------- */

function render(container: HTMLElement, d: KpiData | null): void {
  if (!d) return;
  if ((d as any).setupNeeded) {
    container.innerHTML = '<div class="empty-note">⏳ ยังไม่มีข้อมูล KPI — รอ sync รายวัน หรือรัน <code>npm run import:kpi</code></div>';
    return;
  }
  const monthBtns = d.months.map(function (m) {
    return '<button class="filter-btn' + (m === d.month ? ' active' : '') + '" data-kpimonth="' + m + '">' +
      esc(TH_MONTHS[m - 1]) + '</button>';
  }).join('');

  const tops =
    '<div class="perf-row" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:14px">' +
      topCard_('🏆 ท็อป KPI ประจำเดือน', 'คะแนนรวมถ่วงตามยอดขายทุกยูนิตที่ประจำ',
        d.topKpi.map(function (p) {
          return { nick: p.nick, name: p.name, id: p.id, big: scorePct(p.score), small: p.units.join(' • ') + ' — ' + THB(p.sales) };
        })) +
      topCard_('💰 ท็อปเซลประจำเดือน', 'ยอดขายรวมทุกยูนิต (จากชีท KPI)',
        d.topSales.map(function (p) {
          return { nick: p.nick, name: p.name, id: p.id, big: THB(p.sales), small: p.units.join(' • ') + ' — KPI ' + scorePct(p.score) };
        })) +
    '</div>';

  container.innerHTML =
    '<div class="pg-controls">' + monthBtns +
      '<div class="spacer"></div>' +
      '<span class="chip" title="ดึงจากชีท KPI กลางของทีมวันละครั้ง">🕐 อัปเดต ' + esc(String(d.updatedAt).slice(0, 10)) + '</span>' +
    '</div>' +
    summaryCards_(d) +
    weightStrip_() +
    '<div class="kpi-grid">' +
      '<div>' + hierarchyHtml_(d) + '</div>' +
      '<div class="kpi-side">' + gradeDonut_(d) + alertsCard_(d) + historyCard_(d) + '</div>' +
    '</div>' +
    tops +
    adminTableHtml_(d) +
    yearTableHtml_(d);

  bindEvents(container);
}

function bindEvents(container: HTMLElement): void {
  container.querySelectorAll('[data-kpimonth]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.month = Number(btn.getAttribute('data-kpimonth'));
      fetchData(container);
    });
  });
  // กาง/พับลูกทีมของรองแต่ละคน
  container.querySelectorAll('[data-subtoggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const i = btn.getAttribute('data-subtoggle');
      const rows = container.querySelectorAll('.kpi-team-' + i);
      const opening = rows.length && (rows[0] as HTMLElement).style.display === 'none';
      rows.forEach(function (r) { (r as HTMLElement).style.display = opening ? '' : 'none'; });
      btn.textContent = opening ? 'ซ่อนทีม ▴' : 'ดูทีม ▾';
    });
  });
  const csv = container.querySelector('#kpi-csv');
  if (csv) csv.addEventListener('click', function () {
    const d = lastData;
    if (!d || !d.admin.length) { toast('ยังไม่มีข้อมูลให้ Export'); return; }
    const out: (string | number)[][] = [
      ['KPI แอดมิน ' + TH_MONTHS[d.month - 1] + ' ' + d.year],
      ['ชื่อเล่น', 'ชื่อจริง', 'ยูนิต', 'ยอดขาย', '%ปิด', '%Error', 'เปอร์บิล', '%ตีกลับ', 'คะแนน KPI (%)', 'เกรด'],
    ];
    d.admin.forEach(function (r) {
      out.push([r.nick, r.name, r.unit, r.sales, Math.round(r.close * 10) / 10,
        Math.round(r.err * 100) / 100, Math.round(r.perBill), Math.round(r.ret * 100) / 100,
        Math.round(r.score * 1000) / 10, gradeOf(pts(r.score))]);
    });
    downloadCSV(out, 'kpi-admin-' + d.year + '-' + String(d.month).padStart(2, '0'));
  });
}

function fetchData(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<KpiData>('apiKpi', { month: state.month }).then(function (d) {
    if (seq !== reqSeq) return;
    lastData = d;
    if (d && d.month) state.month = d.month;
    render(container, d);
  }).catch(function (err) {
    if (seq !== reqSeq) return;
    showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
      container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
      fetchData(container);
    });
  });
}

export const kpi = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);
      return;
    }
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล KPI...</div>';
    fetchData(container);
  },
};
