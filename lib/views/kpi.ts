// lib/views/kpi.ts — หน้า "KPI ทีมขาย" (รื้อ UI 2026-08-01 ตามบรีฟ: นำเสนอแบบเว็บตัวอย่างของทีม
// — การ์ดสรุป + สูตรน้ำหนักตามระดับ + ตารางประเมินตามสายบังคับบัญชา (หัวหน้า→รอง→ลูกทีม)
// + เกรด A-D + แนวโน้มเทียบเดือนก่อน + สัดส่วนเกรด + แจ้งเตือน — แต่หน้าตาเป็นธีมของเรา)
// คะแนนจากชีท KPI กลางของทีม (สูตรอยู่ในชีท — หน้านี้คือกระจก + จัดอันดับ)

import { serverCall, esc, fmtNum, THB, kFmt, pctFmt, avatarHtml, showError, downloadCSV, toast } from '@/lib/ui/helpers';

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
  personHistory: Record<string, Array<{ m: number; s: number }>>;
  noComAlerts: Array<{ admin: string; months: string[] }>;
  unitAlerts: Array<{ u: string; days: number; level: string }>;
  topSales: Person[]; topKpi: Person[]; topSalesYear: YearRow[];
}

let lastData: KpiData | null = null;
let reqSeq = 0;
// tab: matrix = ตารางประเมิน HR (ค่าเริ่มต้น) / structure = โครงสร้างทีม / coaching = เจาะทีม & Coaching
// sel: คนที่เลือกในแท็บ Coaching — 'head' | 'sub:<id>' | '<adminId>'
const state = {
  month: 0,
  tab: 'matrix' as 'matrix' | 'structure' | 'coaching',
  sel: '' as string,
  search: '',
  sort: 'score-desc' as 'score-desc' | 'score-asc' | 'trend-desc',
};

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
  if (d < 0) return '<span class="txt-bad">▼ ' + Math.abs(d) + '</span>'; // ลูกศรบอกทิศแล้ว ไม่ต้องติดลบซ้ำ
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

/** วงแหวนคะแนน (0-100+) — สีตามเกรด ตรงกลางโชว์ตัวเกรด (เลขเต็มอยู่ข้างๆ แล้ว ไม่โชว์ซ้ำ) */
function ring(p: number | null): string {
  if (p === null) return '<div class="kpi-ico">👑</div>';
  const g = gradeOf(p);
  const color = g === 'A' ? 'var(--green)' : g === 'B' ? 'var(--blue)' : g === 'C' ? 'var(--amber)' : 'var(--red)';
  return '<div class="kpi-ring" style="--p:' + Math.max(0, Math.min(100, p)) + ';--rc:' + color + '">' +
    '<span style="color:' + color + '">' + g + '</span></div>';
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
      '<div class="card-sub" style="margin:0">ผ่าน KPI ' + fmtNum(passN) + '/' + fmtNum(d.persons.length) + ' คน (เกรด B ขึ้นไป)</div></div></div>' +
  '</div>';
}

/* ---------- สูตรน้ำหนักคะแนนตามระดับ (จากแท็บ ตัวชี้วัด ของชีททีม) ---------- */

const WEIGHTS: Array<{ role: string; items: Array<[string, number]> }> = [
  { role: 'หัวหน้าฝ่าย', items: [['KPI รองที่ดูแล', 40], ['ยอดขายรวม', 40], ['ค่าแอด ≤33%', 20]] },
  { role: 'รองหัวหน้า', items: [['ยอดยูนิต', 30], ['ลูกทีมถึงเป้า', 20], ['%ปิดเฉลี่ย', 20], ['ค่าแอด ≤33%', 20], ['เปอร์บิล', 10]] },
  { role: 'แอดมิน', items: [['ยอดขาย', 35], ['%ปิด', 35], ['เปอร์บิล', 20], ['%Error', 5], ['%ตีกลับ', 5]] },
];
// สีตามตัวชี้วัด (ไม่ใช่ตามตำแหน่งลำดับ) — ตัวเดียวกันสีเดียวกันทุกระดับ
const WT_COLOR_BY_NAME: Record<string, string> = {
  'ยอดขายรวม': 'var(--green)', 'ยอดยูนิต': 'var(--green)', 'ยอดขาย': 'var(--green)',
  '%ปิดเฉลี่ย': 'var(--blue)', '%ปิด': 'var(--blue)',
  'ค่าแอด ≤33%': 'var(--red)',
  'ลูกทีมถึงเป้า': 'var(--primary)', 'KPI รองที่ดูแล': 'var(--primary)',
  'เปอร์บิล': 'var(--amber)', '%Error': 'var(--amber)', '%ตีกลับ': 'var(--red)',
};

function weightStrip_(): string {
  const cols = WEIGHTS.map(function (w) {
    const items = w.items.map(function (it) {
      return '<div class="wt-item"><div class="wt-num">' + it[1] + '</div>' +
        '<div class="wt-name">' + esc(it[0]) + '</div>' +
        '<div class="wt-bar" style="background:' + (WT_COLOR_BY_NAME[it[0]] || 'var(--primary)') + '"></div></div>';
    }).join('');
    return '<div class="wt-group"><div class="wt-role">' + esc(w.role) + '</div><div class="wt-row">' + items + '</div></div>';
  }).join('');
  return '<div class="card" style="margin-top:14px">' +
    '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">' +
      '<h3 style="margin:0">🧮 สูตรคะแนนตามระดับ</h3>' +
      '<span class="card-sub" style="margin:0">น้ำหนักจากแท็บ "ตัวชี้วัด" ของชีท KPI — สูตรคิดในชีท เว็บอ่านผลอย่างเดียว</span></div>' +
    '<div class="wt-strip">' + cols + '</div></div>';
}

/* ---------- โครงสร้างทีม (helpers ใช้ร่วม 3 แท็บ) ---------- */

interface SubAgg {
  id: string; nick: string; name: string; units: string[]; target: number; teamSales: number;
  close: number; _cw: number; adCost: number; _aw: number; perBill: number; _pw: number;
  score: number; n: number; prevSum: number; prevN: number;
}

/** จัดกลุ่มแถวรองในชีท (คน,ยูนิต) → รายคน เรียงคะแนนมาก→น้อย */
function computeSubs_(d: KpiData): SubAgg[] {
  const subBy: Record<string, SubAgg> = {};
  d.sub.forEach(function (r) {
    const k = r.id || r.name;
    const a = (subBy[k] = subBy[k] || { id: r.id || r.name, nick: r.nick || r.name, name: r.name, units: [], target: 0, teamSales: 0, close: 0, _cw: 0, adCost: 0, _aw: 0, perBill: 0, _pw: 0, score: 0, n: 0, prevSum: 0, prevN: 0 });
    a.units.push(r.unit);
    a.target += r.target; a.teamSales += r.teamSales;
    const w = r.teamSales > 0 ? r.teamSales : 1;
    a.close += r.close * w; a._cw += w;
    a.adCost += r.adCost * w; a._aw += w;
    if (r.perBill > 0) { a.perBill += r.perBill * w; a._pw += w; }
    a.score += r.score; a.n++;
    const pv = d.prevSub[`${r.id}|${r.unit}`];
    if (pv !== undefined) { a.prevSum += pv; a.prevN++; }
  });
  return Object.values(subBy).sort((a, b) => (b.score / b.n) - (a.score / a.n));
}

/** แอดมินที่ประจำยูนิตในลิสต์ (= ลูกทีมของรองที่ดูแลยูนิตพวกนั้น) */
function personsInUnits_(d: KpiData, units: string[]): Person[] {
  const set = new Set(units);
  return d.persons.filter((p) => p.units.some((u) => set.has(u)));
}

interface PersonDetail { close: number | null; err: number | null; perBill: number | null; ret: number | null; units: string[] }

/** รวมค่าจริงรายคนจากแถว (คน,ยูนิต) — ถ่วงด้วยยอดขาย เพื่อโชว์ในแผง Coaching */
function personDetail_(d: KpiData): Record<string, PersonDetail> {
  const by: Record<string, any> = {};
  d.admin.forEach(function (r) {
    const a = (by[r.id] = by[r.id] || { close: 0, err: 0, perBill: 0, ret: 0, _w: 0, units: [] });
    const w = r.sales > 0 ? r.sales : 1;
    a.close += r.close * w; a.err += r.err * w; a.perBill += r.perBill * w; a.ret += r.ret * w;
    a._w += w; a.units.push(r.unit);
  });
  const out: Record<string, PersonDetail> = {};
  Object.keys(by).forEach(function (id) {
    const a = by[id];
    out[id] = a._w
      ? { close: a.close / a._w, err: a.err / a._w, perBill: a.perBill / a._w, ret: a.ret / a._w, units: a.units }
      : { close: null, err: null, perBill: null, ret: null, units: a.units };
  });
  return out;
}

const passOf_ = (list: Person[]) => list.filter((p) => (pts(p.score) || 0) >= 70).length;

/** กราฟเส้นเล็ก ใช้ซ้ำทุกที่ — คืน svg + แถวป้ายเดือน (ต้น/กลาง/ท้าย) */
function sparkSvg_(hist: Array<{ m: number; s: number }>): string {
  if (hist.length < 2) return '<div class="empty-note">มีข้อมูลเดือนเดียว — กราฟขึ้นเมื่อมี 2 เดือนขึ้นไป</div>';
  const W = 260, H = 64, PAD = 6;
  const vals = hist.map((x) => pts(x.s) as number);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const xy = hist.map(function (x, i) {
    const px = PAD + (i / (hist.length - 1)) * (W - PAD * 2);
    const py = PAD + (1 - ((pts(x.s) as number) - min) / span) * (H - PAD * 2);
    return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
  });
  const last = xy[xy.length - 1];
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" preserveAspectRatio="none">' +
      '<polyline points="' + xy.map((p) => p.join(',')).join(' ') + '" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5" fill="var(--primary)"/></svg>' +
    '<div style="display:flex;justify-content:space-between" class="kpi-subnum">' +
      hist.map(function (x, i) {
        const show = i === 0 || i === hist.length - 1 || i === Math.floor((hist.length - 1) / 2);
        return '<span>' + (show ? esc(TH_MONTHS[x.m - 1]) : '') + '</span>';
      }).join('') + '</div>';
}

/* ---------- ตารางประเมินตามสายบังคับบัญชา (หัวหน้า → รอง → ลูกทีม) ---------- */

function hierarchyHtml_(d: KpiData): string {
  const persons = d.persons;
  const passOf = passOf_;
  const subs = computeSubs_(d);
  const personsInUnits = (units: string[]) => personsInUnits_(d, units);

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
        '<div class="kpi-subnum" title="' + esc(THB(h.sales) + ' / เป้า ' + THB(h.target)) + '">' + kFmt(h.sales) + ' / ' + kFmt(h.target) + '</div></td>' +
      '<td class="num">' + (h.adCost > 33 ? '<span class="txt-bad">' + pctFmt(h.adCost) + '</span>' : pctFmt(h.adCost)) + '</td>' +
      '<td class="num">' + fmtNum(passOf(persons)) + '/' + fmtNum(persons.length) + '</td>' +
      '<td class="num"><b>' + esc(scorePct(hp)) + '</b></td>' +
      '<td>' + gradeChip(pts(hp)) + '</td>' +
      '<td class="num">' + trendHtml(hp, hprev) + '</td>' +
      '<td>' + statusBadge(hp, hprev) + '</td>' +
      '<td><button class="btn-mini" data-coach="head">ดูผล</button></td></tr>');
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
        '<div class="kpi-subnum" title="' + esc(THB(s.teamSales) + ' / เป้า ' + THB(s.target)) + '">' + kFmt(s.teamSales) + ' / ' + kFmt(s.target) + '</div></td>' +
      '<td class="num">' + (adCost === null ? '—' : (adCost > 33 ? '<span class="txt-bad">' + pctFmt(adCost) + '</span>' : pctFmt(adCost))) + '</td>' +
      '<td class="num">' + fmtNum(passOf(team)) + '/' + fmtNum(team.length) + '</td>' +
      '<td class="num"><b>' + esc(scorePct(score)) + '</b>' +
        (close === null ? '' : '<div class="kpi-subnum">%ปิด ' + pctFmt(close) + '</div>') + '</td>' +
      '<td>' + gradeChip(pts(score)) + '</td>' +
      '<td class="num">' + trendHtml(score, prev) + '</td>' +
      '<td>' + statusBadge(score, prev) + '</td>' +
      '<td style="white-space:nowrap">' +
        (team.length ? '<button class="btn-mini" data-subtoggle="' + si + '">ดูทีม ▾</button> ' : '') +
        '<button class="btn-mini" data-coach="sub:' + esc(s.id) + '" title="เจาะทีม & Coaching">🎯</button></td></tr>');
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
          '<td>' + statusBadge(p.score, d.prevPersons[p.id]) + '</td>' +
          '<td><button class="btn-mini" data-coach="' + esc(p.id) + '">ดูผล</button></td></tr>');
      });
  });

  return '<div class="card">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<h3 style="margin:0">🪜 ประเมินตามสายบังคับบัญชา — ' + esc(TH_MONTHS[d.month - 1] + ' ' + d.year) + '</h3>' +
      '<div class="spacer" style="flex:1"></div><button class="btn-mini" id="kpi-csv">📄 CSV</button></div>' +
    '<div class="card-sub">เกรด: <span class="grade g-a">A</span> ≥80 • <span class="grade g-b">B</span> 70-79.9 • ' +
      '<span class="grade g-c">C</span> 60-69.9 • <span class="grade g-d">D</span> &lt;60 • ' +
      'ผ่าน KPI = เกรด B ขึ้นไป • แนวโน้มเทียบ ' + (d.prevMonth ? esc(TH_MONTHS[d.prevMonth - 1]) : 'เดือนก่อน') +
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
    '<div style="display:flex;gap:14px;align-items:center;margin-top:12px">' +
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
  return '<div class="card"><h3>⚠️ แจ้งเตือนหัวหน้า</h3><div style="margin-top:8px">' + items.join('') + '</div></div>';
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
    // ป้ายเดือนโชว์แค่ ต้น/กลาง/ท้าย — ครบทุกเดือนแล้วล้นการ์ดแคบ 300px
    '<div style="display:flex;justify-content:space-between" class="kpi-subnum">' +
      ptsArr.map(function (x, i) {
        const show = i === 0 || i === ptsArr.length - 1 || i === Math.floor((ptsArr.length - 1) / 2);
        return '<span>' + (show ? esc(TH_MONTHS[x.month - 1]) : '') + '</span>';
      }).join('') + '</div></div>';
}

/* ---------- แถบสลับมุมมอง 3 แท็บ + ปุ่มค่าคอม ---------- */

function tabBar_(): string {
  const tabs: Array<[string, string]> = [
    ['structure', '🏢 โครงสร้างทีม'],
    ['matrix', '📋 ตารางประเมิน HR'],
    ['coaching', '🎯 เจาะทีม & Coaching'],
  ];
  return '<div class="kpi-tabbar">' +
    tabs.map(([k, t]) =>
      '<button class="kpi-tab' + (state.tab === k ? ' active' : '') + '" data-kpitab="' + k + '">' + t + '</button>').join('') +
    '<div class="spacer" style="flex:1"></div>' +
    '<button class="btn-mini" id="kpi-goto-com" title="ตารางค่าคอมอยู่หน้า Admin Performance">💰 ค่าคอมมิชชัน →</button>' +
  '</div>';
}

/* ---------- แท็บ "โครงสร้างทีม" ---------- */

function structureTab_(d: KpiData): string {
  const h = d.head[0];
  const subs = computeSubs_(d);
  const hp = h ? pts(h.score) : null;

  const headCard = h
    ? '<div class="card" style="margin-top:14px"><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        ring(hp) +
        '<div style="flex:1;min-width:200px"><div class="card-sub" style="margin:0">คะแนนหัวหน้าฝ่าย</div>' +
          '<div class="kpi-big">' + esc(h.nick || h.name) + ' — ' + (hp === null ? '—' : hp) + '<span class="kpi-max">/100</span> ' +
          gradeChip(hp) + ' ' + trendHtml(h.score, d.prevHead[h.id || h.name]) + '</div>' +
          '<div class="card-sub" style="margin:4px 0 0">KPI รองเฉลี่ย ' + esc(scorePct(h.kpiSub)) + ' • ยอด ' + kFmt(h.sales) +
            ' / เป้า ' + kFmt(h.target) + ' • ค่าแอด/ยอด ' + pctFmt(h.adCost) + '</div></div>' +
        '<div style="width:280px;max-width:100%">' + sparkSvg_(d.headHistory.filter((x) => x.score !== null).map((x) => ({ m: x.month, s: x.score as number }))) + '</div>' +
      '</div></div>'
    : '';

  const depCards = subs.map(function (s) {
    const score = s.score / s.n;
    const p = pts(score);
    const team = personsInUnits_(d, s.units);
    const passN = passOf_(team);
    const passPct = team.length ? Math.round((passN / team.length) * 100) : 0;
    const tone = p === null ? '' : p >= 80 ? 'ok' : p >= 70 ? 'watch' : 'risk';
    return '<div class="card dep-card ' + tone + '">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        avatarHtml(s.id, s.nick, undefined, 'sm') +
        '<div style="flex:1;min-width:0"><b>' + esc(s.nick) + '</b><div class="card-sub" style="margin:0">รองหัวหน้า • ' +
          s.units.map((u) => esc(u)).join(' ') + '</div></div>' +
        '<div style="text-align:right"><b style="font-size:18px">' + (p === null ? '—' : p) + '</b> ' + gradeChip(p) + '</div>' +
      '</div>' +
      '<div class="card-sub" style="margin:8px 0 4px">ลูกทีม ' + fmtNum(team.length) + ' คน • ผ่าน KPI ' +
        fmtNum(passN) + '/' + fmtNum(team.length) + ' (' + passPct + '%)</div>' +
      '<div class="dep-bar"><div style="width:' + Math.min(100, passPct) + '%;background:' +
        (passPct >= 70 ? 'var(--green)' : passPct >= 50 ? 'var(--amber)' : 'var(--red)') + '"></div></div>' +
      '<div style="margin-top:10px;display:flex;gap:6px">' +
        '<button class="btn-mini" data-coach="sub:' + esc(s.id) + '">🎯 ดูทีม & Coaching</button>' +
        '<span class="chip">' + trendHtml(score, s.prevN ? s.prevSum / s.prevN : null) + '</span>' +
      '</div></div>';
  }).join('');

  const low = d.persons.slice().sort((a, b) => a.score - b.score).slice(0, 4);
  const lowRows = low.map(function (p) {
    return '<div class="low-row" data-coach="' + esc(p.id) + '" title="คลิกดูแผน Coaching">' +
      avatarHtml(p.id, p.nick || p.name, undefined, 'sm') +
      '<div style="flex:1;min-width:0"><b>' + esc(p.nick || p.name) + '</b>' +
        '<div class="card-sub" style="margin:0">' + p.units.map((u) => esc(u)).join(' • ') + '</div></div>' +
      '<b>' + esc(scorePct(p.score)) + '</b> ' + gradeChip(pts(p.score)) +
      '<span>' + trendHtml(p.score, d.prevPersons[p.id]) + '</span><span style="opacity:.5">›</span></div>';
  }).join('');

  return headCard +
    '<div class="dep-grid">' + depCards + '</div>' +
    '<div class="card" style="margin-top:14px">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<h3 style="margin:0">🚩 คนที่ต้องเห็นก่อนในการประเมินรอบนี้</h3>' +
        '<div class="spacer" style="flex:1"></div>' +
        '<button class="btn-mini" data-kpitab="matrix">ดูพนักงานทั้งหมด →</button></div>' +
      '<div class="card-sub">4 คนคะแนนต่ำสุดของเดือน — คลิกเพื่อเปิดแผน Coaching</div>' +
      lowRows + '</div>';
}

/* ---------- แท็บ "เจาะทีม & Coaching" ---------- */

/** คำแนะนำโค้ชจากค่าจริงที่หลุดเกณฑ์ทีม (%ปิด≥40, เปอร์บิล≥500, ตีกลับ<5, Error ±5) */
function coachTips_(d: KpiData, p: Person, det: PersonDetail | undefined): Array<{ sev: 'risk' | 'watch'; txt: string }> {
  const tips: Array<{ sev: 'risk' | 'watch'; txt: string }> = [];
  const noCom = d.noComAlerts.some((a) => a.admin === p.nick || a.admin === p.name);
  if (noCom) tips.push({ sev: 'risk', txt: 'ไม่ได้ค่าคอม 2 เดือนปิดยอดติดกัน — เปิดแผนกู้ยอดกับรองหัวหน้า + นัดติดตามภายใน 7 วัน' });
  if (det && det.close !== null) {
    if (det.close < 33) tips.push({ sev: 'risk', txt: '%ปิด ' + pctFmt(det.close) + ' ต่ำกว่า 33% — สุ่มตรวจแชตที่ไม่ปิดอย่างน้อย 10 เคส + โค้ชสคริปต์แก้ข้อโต้แย้งจากเคสจริง' });
    else if (det.close < 40) tips.push({ sev: 'watch', txt: '%ปิด ' + pctFmt(det.close) + ' ยังไม่ถึงเป้า 40% — วัดเวลาตอบครั้งแรก + ตามลูกค้าค้างแชตให้จบในวัน' });
  }
  if (det && det.perBill !== null && det.perBill > 0) {
    if (det.perBill < 450) tips.push({ sev: 'risk', txt: 'เปอร์บิล ฿' + fmtNum(Math.round(det.perBill)) + ' ต่ำ — ทำชุดขาย 2-3 ชิ้น + Upsell ตามขั้นยอด ดันให้ถึง ฿500' });
    else if (det.perBill < 500) tips.push({ sev: 'watch', txt: 'เปอร์บิล ฿' + fmtNum(Math.round(det.perBill)) + ' — ใส่ชุดแนะนำในสคริปต์ก่อนเสนอขายชิ้นเดียว' });
  }
  if (det && det.ret !== null && det.ret > 5) tips.push({ sev: 'risk', txt: '%ตีกลับ ' + pctFmt(det.ret) + ' เกินเกณฑ์ 5% — ยืนยันที่อยู่/เบอร์/นัดรับก่อนส่งทุกออเดอร์' });
  if (det && det.err !== null && Math.abs(det.err) > 5) tips.push({ sev: 'watch', txt: '%Error ' + pctFmt(det.err) + ' เกิน ±5% — ตรวจการคีย์ออเดอร์/ราคาก่อนยืนยัน' });
  const p100 = pts(p.score);
  if (p100 !== null && p100 < 60) tips.push({ sev: 'risk', txt: 'คะแนนรวมต่ำกว่าเกรด C — นัดทำแผนกู้ยอดกับหัวหน้าภายใน 3 วันทำการ' });
  if (!tips.length) tips.push({ sev: 'watch', txt: '✅ ผ่านเกณฑ์หลักครบ — รักษามาตรฐาน และให้ช่วยแชร์วิธีทำงานกับเพื่อนร่วมทีม' });
  return tips;
}

/** แถวตัวชี้วัด: ค่า vs เป้า + แถบสี */
function metricRow_(label: string, valueTxt: string, targetTxt: string, ratioPct: number | null, good: boolean | null): string {
  const color = good === null ? 'var(--track)' : good ? 'var(--green)' : 'var(--red)';
  const w = ratioPct === null ? 0 : Math.max(4, Math.min(100, ratioPct));
  return '<div class="metric-row"><div class="metric-head"><span>' + esc(label) + '</span>' +
    '<span><b>' + valueTxt + '</b> <small class="kpi-subnum">' + esc(targetTxt) + '</small></span></div>' +
    '<div class="metric-bar"><div style="width:' + w + '%;background:' + color + '"></div></div></div>';
}

function coachingTab_(d: KpiData): string {
  const subs = computeSubs_(d);
  const details = personDetail_(d);
  const h = d.head[0];
  // sel ค้างจากเดือนก่อนแล้วคนนั้นไม่มีคะแนนเดือนนี้ → กลับไปทีมแรก (กันแผงกลางว่างเปล่า)
  const validSel = state.sel === 'head' ||
    subs.some((s) => 'sub:' + s.id === state.sel) ||
    d.persons.some((p) => p.id === state.sel);
  if (!state.sel || !validSel) state.sel = subs.length ? 'sub:' + subs[0].id : 'head';

  const selSub = state.sel.startsWith('sub:') ? subs.find((s) => 'sub:' + s.id === state.sel) : undefined;
  const selPerson = (!selSub && state.sel !== 'head') ? d.persons.find((p) => p.id === state.sel) : undefined;
  // sub ที่ต้อง expand ใน tree = sub ที่เลือก หรือ sub ที่ลูกทีมที่เลือกสังกัด
  const expandSub = selSub || (selPerson ? subs.find((s) => personsInUnits_(d, s.units).some((p) => p.id === selPerson.id)) : undefined);

  /* ---- ซ้าย: ต้นไม้ทีม ---- */
  let tree = '<button class="tree-btn' + (state.sel === 'head' ? ' active' : '') + '" data-coach="head">👑 ' +
    esc(h ? (h.nick || h.name) : 'หัวหน้า') + '<span>' + (h ? esc(scorePct(h.score)) : '—') + '</span></button>';
  subs.forEach(function (s) {
    const key = 'sub:' + s.id;
    const team = personsInUnits_(d, s.units);
    tree += '<button class="tree-btn sub' + (state.sel === key ? ' active' : '') + '" data-coach="' + esc(key) + '">' +
      esc(s.nick) + ' <small>' + fmtNum(team.length) + ' คน • ' + s.units.map((u) => esc(u)).join(' ') + '</small>' +
      '<span>' + Math.round(pts(s.score / s.n) || 0) + '</span></button>';
    if (expandSub && expandSub.id === s.id) {
      team.slice().sort((a, b) => b.score - a.score).forEach(function (p) {
        tree += '<button class="tree-btn staff' + (state.sel === p.id ? ' active' : '') + '" data-coach="' + esc(p.id) + '">' +
          esc(p.nick || p.name) + '<span>' + Math.round(pts(p.score) || 0) + '</span></button>';
      });
    }
  });

  /* ---- กลาง: แผงคะแนนคนที่เลือก ---- */
  let title = '', role = '', unitTxt = '', score: number | null = null, prev: number | null | undefined;
  let rows = '', tipsHtml = '', hist: Array<{ m: number; s: number }> = [];
  if (state.sel === 'head' && h) {
    title = h.nick || h.name; role = 'หัวหน้าฝ่าย'; unitTxt = 'ทุกยูนิต';
    score = h.score; prev = d.prevHead[h.id || h.name];
    hist = d.headHistory.filter((x) => x.score !== null).map((x) => ({ m: x.month, s: x.score as number }));
    const attain = h.target > 0 ? (h.sales / h.target) * 100 : null;
    rows = metricRow_('KPI รองที่ดูแล (น้ำหนัก 40)', esc(scorePct(h.kpiSub)), 'เฉลี่ยรองทุกคน', pts(h.kpiSub), (pts(h.kpiSub) || 0) >= 70) +
      metricRow_('ยอดขายรวม (น้ำหนัก 40)', kFmt(h.sales), '/ เป้า ' + kFmt(h.target), attain, attain !== null ? attain >= 100 : null) +
      metricRow_('ค่าแอดต่อยอด (น้ำหนัก 20)', pctFmt(h.adCost), 'เป้า ≤33%', h.adCost > 0 ? Math.min(100, (33 / h.adCost) * 100) : null, h.adCost <= 33);
    tipsHtml = '<div class="kpi-alert">ดูภาพรวมลูกทีมในแท็บ โครงสร้างทีม — โค้ชผ่านรองหัวหน้ารายทีม</div>';
  } else if (selSub) {
    const s = selSub;
    title = s.nick; role = 'รองหัวหน้า'; unitTxt = s.units.join(' • ');
    score = s.score / s.n; prev = s.prevN ? s.prevSum / s.prevN : undefined;
    hist = d.personHistory['sub:' + s.id] || [];
    const attain = s.target > 0 ? (s.teamSales / s.target) * 100 : null;
    const close = s._cw ? s.close / s._cw : null;
    const adCost = s._aw ? s.adCost / s._aw : null;
    const team = personsInUnits_(d, s.units);
    const passN = passOf_(team);
    rows = metricRow_('ยอดทีม (น้ำหนัก 30)', kFmt(s.teamSales), '/ เป้า ' + kFmt(s.target), attain, attain !== null ? attain >= 100 : null) +
      metricRow_('ลูกทีมผ่าน KPI (น้ำหนัก 20)', fmtNum(passN) + '/' + fmtNum(team.length), 'เกรด B ขึ้นไป', team.length ? (passN / team.length) * 100 : null, team.length ? passN / team.length >= 0.7 : null) +
      metricRow_('%ปิดเฉลี่ย (น้ำหนัก 20)', pctFmt(close), 'เป้า ≥40%', close !== null ? (close / 40) * 100 : null, close !== null ? close >= 40 : null) +
      metricRow_('ค่าแอดต่อยอด (น้ำหนัก 20)', pctFmt(adCost), 'เป้า ≤33%', adCost !== null && adCost > 0 ? Math.min(100, (33 / adCost) * 100) : null, adCost !== null ? adCost <= 33 : null) +
      (s._pw > 0
        ? metricRow_('เปอร์บิล (น้ำหนัก 10)', '฿' + fmtNum(Math.round(s.perBill / s._pw)), 'เป้า ≥฿500', (s.perBill / s._pw / 500) * 100, s.perBill / s._pw >= 500)
        : '');
    const weak = team.slice().sort((a, b) => a.score - b.score).slice(0, 3);
    tipsHtml = weak.map(function (p) {
      const t = coachTips_(d, p, details[p.id])[0];
      return '<div class="kpi-alert ' + t.sev + '"><b>' + esc(p.nick || p.name) + '</b> (' + esc(scorePct(p.score)) + ') — ' + esc(t.txt) + '</div>';
    }).join('') || '<div class="empty-note">ทีมนี้ผ่านเกณฑ์ครบ</div>';
  } else if (selPerson) {
    const p = selPerson;
    const det = details[p.id];
    title = p.nick || p.name; role = 'แอดมิน'; unitTxt = p.units.join(' • ');
    score = p.score; prev = d.prevPersons[p.id];
    hist = d.personHistory[p.id] || [];
    rows = metricRow_('ยอดขาย (น้ำหนัก 35)', THB(p.sales), 'รวมทุกยูนิตเดือนนี้', null, null) +
      metricRow_('%ปิด (น้ำหนัก 35)', pctFmt(det ? det.close : null), 'เป้า ≥40%', det && det.close !== null ? (det.close / 40) * 100 : null, det && det.close !== null ? det.close >= 40 : null) +
      metricRow_('เปอร์บิล (น้ำหนัก 20)', det && det.perBill !== null ? '฿' + fmtNum(Math.round(det.perBill)) : '—', 'เป้า ≥฿500', det && det.perBill !== null ? (det.perBill / 500) * 100 : null, det && det.perBill !== null ? det.perBill >= 500 : null) +
      metricRow_('%Error (น้ำหนัก 5)', pctFmt(det ? det.err : null), 'เป้า ±5%', det && det.err !== null ? Math.max(0, 100 - Math.abs(det.err) * 10) : null, det && det.err !== null ? Math.abs(det.err) <= 5 : null) +
      metricRow_('%ตีกลับ (น้ำหนัก 5)', pctFmt(det ? det.ret : null), 'เป้า <5%', det && det.ret !== null ? Math.max(0, 100 - det.ret * 10) : null, det && det.ret !== null ? det.ret < 5 : null);
    tipsHtml = coachTips_(d, p, det).map(function (t) {
      return '<div class="kpi-alert ' + t.sev + '">' + esc(t.txt) + '</div>';
    }).join('');
  }
  const sp = pts(score);
  const centerPanel = '<div class="card">' +
    '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      ring(sp) +
      '<div style="flex:1;min-width:160px"><div class="card-sub" style="margin:0">' + esc(role) + ' • ' + esc(unitTxt) + '</div>' +
        '<div class="kpi-big">' + esc(title) + '</div>' +
        '<div>' + gradeChip(sp) + ' ' + statusBadge(score, prev) + ' ' + trendHtml(score, prev) + '</div></div>' +
      '<button class="btn-mini" id="kpi-person-csv">📄 ดาวน์โหลดผล</button>' +
    '</div>' +
    '<div style="margin-top:12px">' + rows + '</div>' +
    (hist.length > 1 ? '<div style="margin-top:12px"><div class="card-sub">ประวัติคะแนน</div>' + sparkSvg_(hist) + '</div>' : '') +
  '</div>';

  /* ---- ขวา: ต้องโค้ชก่อน + สิ่งที่ต้องจัดการ ---- */
  const low3 = d.persons.slice().sort((a, b) => a.score - b.score).slice(0, 3);
  const coachFirst = '<div class="card"><h3>🎯 ต้องโค้ชก่อน</h3><div style="margin-top:8px">' +
    low3.map(function (p, i) {
      return '<div class="low-row" data-coach="' + esc(p.id) + '"><span class="kpi-rank">' + (i + 1) + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(p.nick || p.name) + '</b>' +
        '<div class="card-sub" style="margin:0">' + p.units.map((u) => esc(u)).join(' • ') + '</div></div>' +
        '<b>' + Math.round(pts(p.score) || 0) + '</b></div>';
    }).join('') + '</div></div>';
  const todo: string[] = [];
  d.noComAlerts.slice(0, 3).forEach(function (a) {
    const p = d.persons.find((x) => x.nick === a.admin || x.name === a.admin);
    todo.push('<div class="kpi-alert risk"' + (p ? ' data-coach="' + esc(p.id) + '" style="cursor:pointer"' : '') + '>' +
      '<b>' + esc(a.admin) + '</b> ไม่ได้ค่าคอม 2 เดือนติด — เปิดแผนกู้ยอด</div>');
  });
  d.persons.filter((p) => (pts(p.score) || 100) < 60).slice(0, 3).forEach(function (p) {
    todo.push('<div class="kpi-alert watch" data-coach="' + esc(p.id) + '" style="cursor:pointer"><b>' +
      esc(p.nick || p.name) + '</b> คะแนน ' + Math.round(pts(p.score) || 0) + ' ต่ำกว่าเกรด C — ต้องติดตาม</div>');
  });
  const todoCard = '<div class="card"><h3>📌 สิ่งที่ต้องจัดการ</h3><div style="margin-top:8px">' +
    (todo.join('') || '<div class="empty-note">✅ ไม่มีเรื่องค้าง</div>') + '</div></div>';

  /* ---- ตารางล่าง: พนักงานในสายงาน ---- */
  const teamList = (expandSub ? personsInUnits_(d, expandSub.units) : d.persons)
    .slice().sort((a, b) => a.score - b.score);
  const teamRows = teamList.map(function (p) {
    const det = details[p.id];
    return '<tr' + (p.id === state.sel ? ' style="outline:1px solid var(--primary)"' : '') + '>' +
      '<td><b>' + esc(p.nick || p.name) + '</b> <span class="rank-fullname">' + esc(p.name) + '</span></td>' +
      '<td>' + p.units.map((u) => '<span class="chip">' + esc(u) + '</span>').join(' ') + '</td>' +
      '<td class="num">' + THB(p.sales) + '</td>' +
      '<td class="num">' + pctFmt(det ? det.close : null) + '</td>' +
      '<td class="num">' + (det && det.perBill !== null ? fmtNum(Math.round(det.perBill)) : '—') + '</td>' +
      '<td class="num">' + pctFmt(det ? det.ret : null) + '</td>' +
      '<td class="num ' + scoreCls(p.score) + '"><b>' + esc(scorePct(p.score)) + '</b></td>' +
      '<td>' + gradeChip(pts(p.score)) + '</td>' +
      '<td>' + statusBadge(p.score, d.prevPersons[p.id]) + '</td>' +
      '<td><button class="btn-mini" data-coach="' + esc(p.id) + '">ดูผล</button></td></tr>';
  }).join('');
  const teamTable = '<div class="card" style="margin-top:14px">' +
    '<h3>👥 พนักงานในสายงาน — ' + esc(expandSub ? expandSub.nick : 'ทุกทีม') + '</h3>' +
    '<div class="card-sub">เรียงคนคะแนนต่ำขึ้นก่อน เพื่อแก้ได้ทันที</div>' +
    '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>ชื่อ</th><th>ยูนิต</th><th class="num">ยอด</th><th class="num">%ปิด</th><th class="num">เปอร์บิล</th>' +
      '<th class="num">%ตีกลับ</th><th class="num">คะแนน</th><th>เกรด</th><th>สถานะ</th><th></th>' +
    '</tr></thead><tbody>' + teamRows + '</tbody></table></div></div>';

  return '<div class="coach-grid">' +
    '<div class="card coach-tree"><h3>โครงสร้างทีม</h3><div class="card-sub">คลิกชื่อเพื่อดูคะแนน + แผนแก้รายคน</div>' + tree + '</div>' +
    '<div>' + centerPanel + '</div>' +
    '<div class="kpi-side">' + todoCard + coachFirst + '</div>' +
  '</div>' + teamTable;
}

/* ---------- ส่วนเดิมที่คงไว้ (ท็อป / ตารางแอดมินละเอียด / สรุปปี) ---------- */

function topCard_(title: string, sub: string, rows: Array<{ nick: string; name: string; id: string; big: string; small: string }>): string {
  const items = rows.map(function (r, i) {
    return '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
      '<div style="font-size:20px">' + (MEDALS[i] || '<span class="kpi-rank">' + (i + 1) + '</span>') + '</div>' +
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

/** CSV ผลประเมินรายคน (ปุ่ม ดาวน์โหลดผล ในแท็บ Coaching) */
function personCsv_(): void {
  const d = lastData;
  if (!d) { toast('ยังไม่มีข้อมูล'); return; }
  const subs = computeSubs_(d);
  const details = personDetail_(d);
  const monthTxt = TH_MONTHS[d.month - 1] + ' ' + d.year;
  let name = '', role = '', unit = '', score: number | null = null;
  const metric: (string | number)[][] = [];
  if (state.sel === 'head' && d.head[0]) {
    const h = d.head[0];
    name = h.nick || h.name; role = 'หัวหน้าฝ่าย'; unit = 'ทุกยูนิต'; score = pts(h.score);
    metric.push(['KPI รองที่ดูแล', 40, Math.round((pts(h.kpiSub) || 0) * 10) / 10],
      ['ยอดขายรวม', 40, h.sales], ['เป้ายอด', '', h.target], ['ค่าแอดต่อยอด (%)', 20, h.adCost]);
  } else if (state.sel.startsWith('sub:')) {
    const s = subs.find((x) => 'sub:' + x.id === state.sel);
    if (!s) { toast('ไม่พบข้อมูล'); return; }
    name = s.nick; role = 'รองหัวหน้า'; unit = s.units.join(' '); score = pts(s.score / s.n);
    metric.push(['ยอดทีม', 30, Math.round(s.teamSales)], ['เป้ายอด', '', Math.round(s.target)],
      ['%ปิดเฉลี่ย', 20, s._cw ? Math.round((s.close / s._cw) * 10) / 10 : ''],
      ['ค่าแอดต่อยอด (%)', 20, s._aw ? Math.round((s.adCost / s._aw) * 10) / 10 : '']);
  } else {
    const p = d.persons.find((x) => x.id === state.sel);
    if (!p) { toast('ไม่พบข้อมูล'); return; }
    const det = details[p.id];
    name = p.nick || p.name; role = 'แอดมิน'; unit = p.units.join(' '); score = pts(p.score);
    metric.push(['ยอดขาย', 35, p.sales],
      ['%ปิด', 35, det && det.close !== null ? Math.round(det.close * 10) / 10 : ''],
      ['เปอร์บิล', 20, det && det.perBill !== null ? Math.round(det.perBill) : ''],
      ['%Error', 5, det && det.err !== null ? Math.round(det.err * 100) / 100 : ''],
      ['%ตีกลับ', 5, det && det.ret !== null ? Math.round(det.ret * 100) / 100 : '']);
  }
  const out: (string | number)[][] = [
    ['ผลประเมิน KPI', name],
    ['ช่วงเวลา', monthTxt],
    ['ตำแหน่ง', role],
    ['ยูนิต/ทีม', unit],
    ['คะแนนรวม', score === null ? '-' : score],
    ['เกรด', gradeOf(score)],
    [],
    ['ตัวชี้วัด', 'น้ำหนัก', 'ค่าที่ทำได้'],
    ...metric,
  ];
  downloadCSV(out, 'kpi-' + name + '-' + d.year + '-' + String(d.month).padStart(2, '0'));
  toast('ดาวน์โหลดผลประเมิน ' + name + ' แล้ว');
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

  let body = '';
  if (state.tab === 'structure') {
    body = structureTab_(d) + weightStrip_();
  } else if (state.tab === 'coaching') {
    body = coachingTab_(d);
  } else {
    // ท็อป KPI/ท็อปเซล อยู่ใต้ตารางในคอลัมน์ซ้าย — เติมช่องว่างที่เกิดเวลาแผงขวายาวกว่าตาราง
    body = weightStrip_() +
      '<div class="kpi-grid">' +
        '<div>' + hierarchyHtml_(d) + tops + '</div>' +
        '<div class="kpi-side">' + gradeDonut_(d) + alertsCard_(d) + historyCard_(d) + '</div>' +
      '</div>' +
      adminTableHtml_(d) +
      yearTableHtml_(d);
  }

  container.innerHTML =
    '<div class="pg-controls">' + monthBtns +
      '<div class="spacer"></div>' +
      '<span class="chip" title="ดึงจากชีท KPI กลางของทีมวันละครั้ง">🕐 อัปเดต ' +
        esc(String(d.updatedAt).slice(8, 10) + ' ' + (TH_MONTHS[Number(String(d.updatedAt).slice(5, 7)) - 1] || '')) + '</span>' +
    '</div>' +
    tabBar_() +
    summaryCards_(d) +
    body;

  bindEvents(container);
}

function bindEvents(container: HTMLElement): void {
  container.querySelectorAll('[data-kpimonth]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.month = Number(btn.getAttribute('data-kpimonth'));
      fetchData(container);
    });
  });
  // สลับแท็บย่อย (โครงสร้างทีม / ประเมิน HR / Coaching) — ข้อมูลอยู่ครบใน lastData ไม่ยิง API ซ้ำ
  container.querySelectorAll('[data-kpitab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.tab = (btn.getAttribute('data-kpitab') as typeof state.tab) || 'matrix';
      if (lastData) render(container, lastData);
    });
  });
  // เลือกคนในแท็บ Coaching (จากทุกที่: ตาราง/ต้นไม้/การ์ด) — เด้งไปแท็บ Coaching เสมอ
  container.querySelectorAll('[data-coach]').forEach(function (el) {
    el.addEventListener('click', function () {
      state.sel = el.getAttribute('data-coach') || '';
      state.tab = 'coaching';
      if (lastData) render(container, lastData);
      const c = container.closest('.view') || container;
      (c as HTMLElement).scrollTop = 0;
      window.scrollTo({ top: 0 });
    });
  });
  const gotoCom = container.querySelector('#kpi-goto-com');
  if (gotoCom) gotoCom.addEventListener('click', function () {
    const app = (globalThis as any).App;
    if (app && app.switchView) app.switchView('adminperf');
    toast('ตารางค่าคอมอยู่ล่างสุดของหน้า Admin Performance');
  });
  // ดาวน์โหลดผลรายคน (แท็บ Coaching)
  const pcsv = container.querySelector('#kpi-person-csv');
  if (pcsv) pcsv.addEventListener('click', function () { personCsv_(); });
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
