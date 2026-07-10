/* ============================================================
   sales — ภาพรวมยอดขาย (POS-style Sales Dashboard)
   port จาก JsSales.html → ลงทะเบียนเป็น export const sales
   ดึงข้อมูลจริงผ่าน apiSales
   ทุก param (preset/from/to/channel/compare) เป็น server-side
   → เปลี่ยน filter เมื่อไหร่ ต้องเรียก server ใหม่เสมอ
   ============================================================ */

import {
  serverCall,
  esc,
  THB,
  fmtNum,
  pctFmt,
  rangeControlsHtml,
  bindRangeControls,
  showLoading,
  showError,
  toast,
  downloadCSV,
} from '@/lib/ui/helpers';
import { svgHourlyLine, miniBars } from '@/lib/ui/charts';

declare global {
  // app-core (JsCommon) แนบ App / VIEW_META ไว้บน global — view อ้างถึงตรงๆ (ห้าม import กัน cycle)
  // eslint-disable-next-line no-var
  var App: { switchView: (view: string) => void };
  // eslint-disable-next-line no-var
  var VIEW_META: Record<string, { title: string; sub: string }>;
}

interface SalesState {
  preset: string;
  from: string;
  to: string;
  channel: string;
  compare: string;
}

interface SalesData {
  rangeLabel?: string;
  kpis?: any;
  trends?: any;
  channels?: any;
  hourly?: number[];
  hourlyPrev?: number[] | null;
  today?: any;
  sources?: any[];
  statusBreakdown?: any[];
  alerts?: any[];
}

let lastData: SalesData | null = null;
const state: SalesState = { preset: 'today', from: '', to: '', channel: '', compare: 'prev' };

const CH_LABELS: Record<string, string> = { '': '🌐 ทั้งหมด', 'facebook': '📘 Facebook', 'line': '🟢 LINE OA' };

/* ---------------- data helpers ---------------- */

function buildParams() {
  return {
    preset: state.preset,
    from: state.from,
    to: state.to,
    channel: state.channel,
    compare: state.compare,
  };
}

/** บังคับให้เป็น array ตัวเลข 24 ช่องเสมอ (กันข้อมูลขาด) */
function arr24(a: any): number[] {
  const out: number[] = [];
  a = a || [];
  for (let i = 0; i < 24; i++) out.push(Number(a[i]) || 0);
  return out;
}

/* ---------------- small view helpers ---------------- */

/** chip เทรนด์: ▲ +x% เขียว / ▼ x% แดง / — เทา (null = ไม่เปรียบเทียบ) */
function trendChip(v: any): string {
  if (v === null || v === undefined || isNaN(v)) return '<span class="sr-trend flat">—</span>';
  const r = Math.round(Number(v) * 10) / 10;
  if (r > 0) return '<span class="sr-trend up">▲ +' + r + '%</span>';
  if (r < 0) return '<span class="sr-trend down">▼ ' + Math.abs(r) + '%</span>';
  return '<span class="sr-trend flat">—</span>';
}

function chBoxHtml(key: string, ch: any): string {
  ch = ch || {};
  return '<button type="button" class="sr-chbox' + (state.channel === key ? ' active' : '') +
    '" data-ch="' + key + '">' +
    '<div class="t">' + CH_LABELS[key] + '</div>' +
    '<div class="v">' + THB(ch.revenue || 0) + '</div>' +
    '<div class="s">' + fmtNum(ch.orders || 0) + ' ออเดอร์ • ' +
      fmtNum(ch.customers || 0) + ' ลูกค้า' + trendChip(ch.trend) + '</div>' +
    '</button>';
}

function tileHtml(label: string, value: string): string {
  return '<div class="tile">' + label + '<b>' + value + '</b></div>';
}

/* ---------------- render ---------------- */

function render(container: HTMLElement, dArg?: SalesData | null): void {
  const d: SalesData = dArg || {};
  const k = d.kpis || {};
  const t = d.trends || {};
  const ch = d.channels || {};
  const fb = ch.facebook || {};
  const ln = ch.line || {};
  const today = d.today || {};
  const sources = d.sources || [];
  const alerts = d.alerts || [];
  const hourly = arr24(d.hourly);
  const hourlyPrev = d.hourlyPrev ? arr24(d.hourlyPrev) : null;
  const todayHourly = arr24(today.hourly);
  const rangeLabel = d.rangeLabel || '';

  /* --- 1. head --- */
  let html = '' +
    '<div class="sr-head">' +
      '<div>' +
        '<div class="sr-title">ภาพรวมยอดขาย</div>' +
        '<div class="sr-title-sub">' + esc(rangeLabel) + ' — ข้อมูลจริงจาก Pancake POS</div>' +
      '</div>' +
      '<div class="pg-controls" style="margin-bottom:0">' +
        rangeControlsHtml(state, 'sr') +
        '<select class="input" id="sr-compare">' +
          '<option value="prev"' + (state.compare === 'prev' ? ' selected' : '') + '>เปรียบเทียบช่วงก่อนหน้า</option>' +
          '<option value="none"' + (state.compare === 'none' ? ' selected' : '') + '>ไม่เปรียบเทียบ</option>' +
        '</select>' +
        '<button class="btn" id="sr-csv">📄 CSV</button>' +
      '</div>' +
    '</div>';

  /* --- 2. KPI cards (3 ใบ) --- */
  const closeRateBig = (k.closeRate === null || k.closeRate === undefined || isNaN(k.closeRate))
    ? '-'
    : (Math.round(Number(k.closeRate) * 10) / 10) +
      '%<span style="font-size:14px;font-weight:600;color:var(--text-2)"> ปิดการขาย</span>';

  html += '<div class="sr-cards">' +
    '<div class="sr-card">' +
      '<div class="label">💰 รายได้รวม</div>' +
      '<div class="big">' + THB(k.revenue || 0) + '</div>' +
      '<div class="foot">' + fmtNum(k.orders || 0) + ' ออเดอร์' + trendChip(t.revenue) + '</div>' +
    '</div>' +
    '<div class="sr-card">' +
      '<div class="label">🛒 คำสั่งซื้อ</div>' +
      '<div class="big">' + fmtNum(k.orders || 0) + '</div>' +
      '<div class="foot">📘 ' + THB(fb.revenue || 0) + ' • 🟢 ' + THB(ln.revenue || 0) +
        (Number(k.needCheck) > 0
          ? ' <span class="sr-red">⚠ ต้องตรวจ ' + fmtNum(k.needCheck) + '</span>'
          : ' ✓ ไม่มีค้างตรวจ') +
        trendChip(t.orders) +
      '</div>' +
    '</div>' +
    '<div class="sr-card" title="ปิดการขาย = ออเดอร์ ÷ บทสนทนาใหม่ (บทสนทนาใหม่ ' + esc(fmtNum(k.newConvs || 0)) + ')">' +
      '<div class="label">🎯 ประสิทธิภาพการขาย</div>' +
      '<div class="big">' + closeRateBig + '</div>' +
      '<div class="foot">ยอดขายจากแอด ' + THB(k.adRevenue || 0) +
        ' • เฉลี่ย ' + THB(k.avgOrder || 0) + '/ออเดอร์</div>' +
    '</div>' +
  '</div>';

  /* --- 3. channel boxes (คลิกเพื่อกรอง — server-side) --- */
  html += '<div class="sr-channels">' +
    chBoxHtml('', ch.all) +
    chBoxHtml('facebook', fb) +
    chBoxHtml('line', ln) +
  '</div>';

  /* --- 4. KPI strip 6 ช่อง --- */
  html += '<div class="sr-strip">' +
    tileHtml('💰 รายได้', THB(k.revenue || 0)) +
    tileHtml('🛒 ออเดอร์', fmtNum(k.orders || 0)) +
    tileHtml('👥 ลูกค้า', fmtNum(k.customers || 0)) +
    tileHtml('💵 เฉลี่ย/ออเดอร์', THB(k.avgOrder || 0)) +
    tileHtml('🎯 % ปิดการขาย', pctFmt(k.closeRate)) +
    tileHtml('💬 บทสนทนาใหม่', fmtNum(k.newConvs || 0)) +
  '</div>';

  /* --- 5. main: กราฟรายชั่วโมง + ข้อมูลธุรกิจวันนี้ --- */
  const legend = '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--text-3);margin-top:8px">' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#6c5ce7;margin-right:6px;vertical-align:middle"></span>ช่วงที่เลือก</span>' +
    (hourlyPrev
      ? '<span><span style="display:inline-block;width:18px;height:0;border-top:2px dashed #5b6478;margin-right:6px;vertical-align:middle"></span>ช่วงเปรียบเทียบ</span>'
      : '') +
    '<span>ชี้ที่จุดบนเส้นเพื่อดูยอดแต่ละชั่วโมง</span>' +
  '</div>';

  html += '<div class="sr-main">' +
    '<div class="card">' +
      '<h3>📈 ยอดขายรายชั่วโมง</h3>' +
      '<div class="card-sub">' + esc(rangeLabel) +
        (hourlyPrev ? ' — เส้นประ = ช่วงก่อนหน้า' : '') + '</div>' +
      svgHourlyLine(hourly, hourlyPrev) +
      legend +
    '</div>' +
    '<div class="card">' +
      '<h3>🏪 ข้อมูลธุรกิจวันนี้</h3>' +
      '<div class="card-sub">ยอดจริงของวันนี้ — ไม่เปลี่ยนตามตัวกรองด้านบน</div>' +
      '<div class="sr-green" style="font-size:26px;font-weight:800;letter-spacing:-0.5px">' + THB(today.revenue || 0) + '</div>' +
      '<div style="font-size:12px;color:var(--text-3)">' + fmtNum(today.orders || 0) + ' ออเดอร์วันนี้</div>' +
      miniBars(todayHourly) +
      '<div class="sr-today-row"><span>📘 Facebook</span><b>' + THB(today.fb || 0) + '</b></div>' +
      '<div class="sr-today-row"><span>🟢 LINE OA</span><b>' + THB(today.line || 0) + '</b></div>' +
      '<div class="sr-today-row"><span>🆕 ลูกค้าใหม่</span><b>' + fmtNum(today.newCust || 0) + ' คน</b></div>' +
      '<div class="sr-today-row"><span>⚠ ออเดอร์ที่ต้องตรวจ</span><b' +
        (Number(today.needCheck) > 0 ? ' class="sr-red"' : '') + '>' +
        fmtNum(today.needCheck || 0) + '</b></div>' +
    '</div>' +
  '</div>';

  /* --- 6. bottom: แหล่งที่มา + แจ้งเตือน --- */
  const srcRows = sources.map(function (s: any) {
    const st = s.status || {};
    return '<tr>' +
      '<td>' + esc(s.label) + '</td>' +
      '<td>' + THB(s.revenue || 0) + '</td>' +
      '<td>' + fmtNum(s.orders || 0) + '</td>' +
      '<td>' + fmtNum(s.customers || 0) + '</td>' +
      '<td>' + pctFmt(s.closeRate) + '</td>' +
      '<td><span class="badge ' + esc(st.cls || 'neutral') + '">' + esc(st.label || '—') + '</span></td>' +
    '</tr>';
  }).join('');

  const statusPills = (d.statusBreakdown || []).map(function (b: any) {
    const nm = String(b.name || '');
    const cls = (nm.indexOf('ยกเลิก') >= 0 || nm.indexOf('ตีกลับ') >= 0) ? 'urgent' : 'neutral';
    return '<span class="badge ' + cls + '">' + esc(nm) + ' ' + fmtNum(b.count || 0) + '</span>';
  }).join('');

  let alertsHtml;
  if (!alerts.length) {
    alertsHtml = '<div class="empty-note">✓ วันนี้ไม่มีอะไรต้องตรวจเป็นพิเศษ</div>';
  } else {
    alertsHtml = '<div class="alert-list">' + alerts.map(function (a: any) {
      const lv = (a.level === 'red' || a.level === 'orange' || a.level === 'yellow' || a.level === 'green')
        ? a.level : 'yellow';
      return '<div class="alert-row lv-' + lv + '">' +
        '<div class="alert-icon">' + esc(a.icon || '🔔') + '</div>' +
        '<div class="alert-body">' +
          '<div class="alert-title">' + esc(a.title) + '</div>' +
          '<div class="alert-reason">' + esc(a.reason) + '</div>' +
          (a.view && VIEW_META[a.view]
            ? '<div style="margin-top:6px"><button class="btn-mini" data-goview="' + esc(a.view) + '">ดูรายละเอียด →</button></div>'
            : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  html += '<div class="sr-bottom">' +
    '<div class="card">' +
      '<h3>🧭 แหล่งที่มาของคำสั่งซื้อ</h3>' +
      '<div class="card-sub">รายได้ • ออเดอร์ • สถานะของแต่ละช่องทาง</div>' +
      (sources.length
        ? '<div class="table-scroll"><table class="tbl"><thead><tr>' +
            '<th>แหล่งที่มา</th><th>รายได้</th><th>ออเดอร์</th><th>ลูกค้า</th><th>% ปิด</th><th>สถานะ</th>' +
          '</tr></thead><tbody>' + srcRows + '</tbody></table></div>'
        : '<div class="empty-note">ยังไม่มีคำสั่งซื้อในช่วงเวลานี้</div>') +
      (statusPills
        ? '<div class="pill-grid" style="margin:12px 0 0">' + statusPills + '</div>'
        : '') +
    '</div>' +
    '<div class="card">' +
      '<h3>🔔 สิ่งที่ควรตรวจวันนี้</h3>' +
      '<div class="card-sub">แจ้งเตือนจากตัวเลขจริง (สูงสุด 3 รายการ)</div>' +
      alertsHtml +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  bindEvents(container);
}

/* ---------------- events ---------------- */

function bindEvents(container: HTMLElement): void {
  bindRangeControls(container, state, 'sr', function () {
    refetch(container);
  });

  const cmp = container.querySelector('#sr-compare') as HTMLSelectElement | null;
  if (cmp) cmp.addEventListener('change', function () {
    state.compare = cmp.value;
    refetch(container);
  });

  const csvBtn = container.querySelector('#sr-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportCsv);

  container.querySelectorAll('[data-ch]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const key = btn.getAttribute('data-ch') || '';
      if (state.channel === key) return;
      state.channel = key;
      toast('🔎 กรองช่องทาง: ' + CH_LABELS[key]);
      refetch(container);
    });
  });

  container.querySelectorAll('[data-goview]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      App.switchView(btn.getAttribute('data-goview')!);
    });
  });
}

/* ---------------- fetch ---------------- */

/** filter เปลี่ยน (ทุก param เป็น server-side ตาม contract) → โหลดจาก server ใหม่ */
function refetch(container: HTMLElement): void {
  showLoading(container);
  fetchAndRender(container, true);
}

let reqSeq = 0; // กัน response เก่ามาทับ response ใหม่เมื่อกดเปลี่ยน filter รัวๆ

function fetchAndRender(container: HTMLElement, blocking: boolean): void {
  const seq = ++reqSeq;
  serverCall('apiSales', buildParams()).then(function (data: SalesData) {
    if (seq !== reqSeq) return; // มี request ใหม่กว่าออกไปแล้ว — ทิ้งผลลัพธ์นี้
    lastData = data || {};
    render(container, lastData);
  }).catch(function (err: any) {
    if (seq !== reqSeq) return;
    const msg = (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ';
    if (blocking) {
      showError(container, msg, function () { refetch(container); });
    } else {
      toast('⚠ รีเฟรชข้อมูลไม่สำเร็จ — แสดงข้อมูลเดิมไว้ก่อน');
    }
  });
}

/* ---------------- CSV export ---------------- */

function exportCsv(): void {
  if (!lastData) {
    toast('ยังไม่มีข้อมูลสำหรับ export');
    return;
  }
  const d = lastData;
  const k = d.kpis || {};
  const t = d.trends || {};
  const ch = d.channels || {};
  const rows: unknown[][] = [];

  rows.push(['Sales Report — ภาพรวมยอดขาย']);
  rows.push(['ช่วงเวลา', d.rangeLabel || '']);
  rows.push(['ช่องทางที่กรอง', CH_LABELS[state.channel] || 'ทั้งหมด']);
  rows.push(['สร้างเมื่อ', new Date().toLocaleString('th-TH')]);
  rows.push([]);

  rows.push(['— สรุปยอดขาย —']);
  rows.push(['รายได้รวม', Math.round(Number(k.revenue) || 0)]);
  rows.push(['คำสั่งซื้อ', Number(k.orders) || 0]);
  rows.push(['ลูกค้า', Number(k.customers) || 0]);
  rows.push(['เฉลี่ย/ออเดอร์', Math.round(Number(k.avgOrder) || 0)]);
  rows.push(['% ปิดการขาย', (k.closeRate === null || k.closeRate === undefined) ? '-' : k.closeRate]);
  rows.push(['ยอดขายจากแอด', Math.round(Number(k.adRevenue) || 0)]);
  rows.push(['บทสนทนาใหม่', Number(k.newConvs) || 0]);
  rows.push(['ออเดอร์ที่ต้องตรวจ', Number(k.needCheck) || 0]);
  rows.push(['เทียบช่วงก่อนหน้า — รายได้ (%)', (t.revenue === null || t.revenue === undefined) ? '-' : t.revenue]);
  rows.push(['เทียบช่วงก่อนหน้า — ออเดอร์ (%)', (t.orders === null || t.orders === undefined) ? '-' : t.orders]);
  rows.push([]);

  rows.push(['— ช่องทาง —']);
  rows.push(['ช่องทาง', 'รายได้', 'ออเดอร์', 'ลูกค้า', 'เปลี่ยนแปลง (%)']);
  [['ทั้งหมด', 'all'], ['Facebook', 'facebook'], ['LINE OA', 'line']].forEach(function (p) {
    const c = ch[p[1]] || {};
    rows.push([
      p[0],
      Math.round(Number(c.revenue) || 0),
      Number(c.orders) || 0,
      Number(c.customers) || 0,
      (c.trend === null || c.trend === undefined) ? '-' : c.trend,
    ]);
  });
  rows.push([]);

  rows.push(['— แหล่งที่มาของคำสั่งซื้อ —']);
  rows.push(['แหล่งที่มา', 'รายได้', 'ออเดอร์', 'ลูกค้า', '% ปิด', 'สถานะ']);
  (d.sources || []).forEach(function (s: any) {
    rows.push([
      s.label || '',
      Math.round(Number(s.revenue) || 0),
      Number(s.orders) || 0,
      Number(s.customers) || 0,
      (s.closeRate === null || s.closeRate === undefined) ? '-' : s.closeRate,
      (s.status && s.status.label) || '',
    ]);
  });

  downloadCSV(rows, 'sales-report-' + state.preset);
}

/* ---------------- register view ---------------- */

export const sales = {
  load: async (container: HTMLElement, force: boolean): Promise<void> => {
    if (lastData && !force) {
      // มี cache → แสดงทันที แล้วดึงข้อมูลใหม่เบื้องหลัง
      render(container, lastData);
      fetchAndRender(container, false);
    } else {
      showLoading(container);
      fetchAndRender(container, true);
    }
  },
};
