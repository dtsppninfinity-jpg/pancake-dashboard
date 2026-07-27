/* ============================================================
   me — "ผลงานของฉัน" สำหรับผู้ใช้ระดับแอดมิน
   เห็นเฉพาะตัวเลขของตัวเอง + อันดับ + ค่าเฉลี่ยทีม (ไม่เห็นยอดของเพื่อนร่วมงาน)
   ข้อมูลมาจาก apiMe ซึ่ง scope ด้วย session ฝั่ง server แล้ว
   ============================================================ */

import {
  serverCall, esc, fmtNum, THB, pctFmt, showError, toast,
  rangeControlsHtml, bindRangeControls, type RangeState,
} from '@/lib/ui/helpers';

interface MeRow {
  id?: string;
  name?: string;
  nickname?: string;
  revenue?: number;
  orders?: number;
  chats?: number;
  replies?: number;
  phones?: number;
  closeRate?: number | null;
  avgRespMins?: number | null;
  avgOrder?: number | null;
  roas?: number | null;
  topProduct?: string;
  topPage?: string;
  lastOrderAt?: string;
  waitingNow?: number;
  overSla?: number;
  activeNow?: number;
}

interface MeData {
  linked?: boolean;
  empty?: boolean;
  message?: string;
  rangeLabel?: string;
  me?: MeRow;
  rank?: number;
  teamSize?: number;
  teamAvg?: { revenue: number; orders: number; chats: number; closeRate: number | null };
  topRevenue?: number;
  targets?: Record<string, number> | null;
}

let lastData: MeData | null = null;
let reqSeq = 0;
const state: RangeState = { preset: 'today', from: '', to: '' };

/* ---------------- ชิ้นส่วน HTML ---------------- */

/** การ์ดตัวเลขใหญ่ 1 ตัว */
function bigCard(icon: string, label: string, value: string, sub: string, tone = ''): string {
  return '<div class="card me-card' + (tone ? ' ' + tone : '') + '">' +
    '<div class="me-card-top">' + icon + ' ' + esc(label) + '</div>' +
    '<div class="me-card-val">' + value + '</div>' +
    (sub ? '<div class="card-sub">' + sub + '</div>' : '') +
    '</div>';
}

/**
 * แถบความคืบหน้าเทียบเป้า — ไม่มีเป้าก็ยังใช้เทียบค่าเฉลี่ยทีมได้
 * pct เกิน 100 ให้เต็มแถบแต่โชว์ตัวเลขจริง (คนทำเกินเป้าต้องเห็นว่าเกินเท่าไร)
 */
function progressRow(label: string, value: number, target: number, fmt: (n: number) => string): string {
  if (!target) return '';
  const pct = Math.round((value / target) * 100);
  const tone = pct >= 100 ? 'ok' : pct >= 70 ? 'warn' : 'bad';
  return '<div class="me-prog">' +
    '<div class="me-prog-head"><span>' + esc(label) + '</span>' +
      '<b>' + fmt(value) + ' <span class="me-prog-target">/ ' + fmt(target) + '</span></b></div>' +
    '<div class="me-bar"><i class="me-bar-fill ' + tone + '" style="width:' + Math.min(100, Math.max(0, pct)) + '%"></i></div>' +
    '<div class="me-prog-pct ' + tone + '">' + pct + '% ของเป้า</div>' +
    '</div>';
}

/** เวลาที่เหลือของวันไทย — ใช้บอกว่ายังมีเวลาไล่เป้าอีกเท่าไร */
function timeLeftToday(): string {
  const now = new Date();
  const bkkNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const mins = (24 * 60) - (bkkNow.getHours() * 60 + bkkNow.getMinutes());
  if (mins <= 0) return 'หมดวันแล้ว';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? 'เหลือ ' + h + ' ชม. ' + m + ' น.' : 'เหลือ ' + m + ' น.';
}

function bodyHtml(d: MeData): string {
  const controls = '<div class="pg-controls">' + rangeControlsHtml(state, 'me') + '</div>';

  if (d.linked === false) {
    return controls + '<div class="card"><div class="empty">🔗 ' + esc(d.message || 'บัญชียังไม่ได้ผูกกับแอดมิน') + '</div></div>';
  }
  if (d.empty || !d.me) {
    return controls + '<div class="card"><div class="empty">ยังไม่มีข้อมูลของคุณในช่วง ' + esc(d.rangeLabel || '') + '</div></div>';
  }

  const m = d.me;
  const avg = d.teamAvg || { revenue: 0, orders: 0, chats: 0, closeRate: null };
  const rev = Number(m.revenue) || 0;
  const tg = d.targets || {};

  // ชื่อที่แสดง: ใช้ชื่อเล่นถ้ามี (ตั้งจากหน้า Admin Management)
  const shown = esc(m.nickname || m.name || '');

  const head = '<div class="card me-hero">' +
    '<div class="me-hero-name">👋 สวัสดี ' + shown + '</div>' +
    '<div class="me-hero-sub">ผลงานของคุณ • ' + esc(d.rangeLabel || '') +
      (state.preset === 'today' ? ' • ⏱ ' + timeLeftToday() : '') + '</div>' +
    '<div class="me-rank">อันดับ <b>' + fmtNum(d.rank || 0) + '</b> จาก ' + fmtNum(d.teamSize || 0) + ' คน</div>' +
    '</div>';

  // เป้า: ถ้าผู้ดูแลตั้งไว้จะโชว์แถบ ถ้าไม่ตั้งก็ข้ามไป (ไม่เดาเป้าเอง)
  const progs = [
    progressRow('ยอดขาย', rev, Number(tg.revenue) || 0, (n) => THB(n)),
    progressRow('ออเดอร์', Number(m.orders) || 0, Number(tg.orders) || 0, (n) => fmtNum(n)),
    progressRow('คนทัก', Number(m.chats) || 0, Number(tg.chats) || 0, (n) => fmtNum(n)),
  ].filter(Boolean).join('');
  const progCard = progs
    ? '<div class="card"><h3>🎯 เทียบเป้าหมาย</h3>' + progs + '</div>'
    : '';

  const cards = '<div class="me-grid">' +
    bigCard('💰', 'ยอดขาย', THB(rev), 'เฉลี่ยทีม ' + THB(avg.revenue)) +
    bigCard('🛒', 'ออเดอร์', fmtNum(m.orders || 0), 'เฉลี่ยทีม ' + fmtNum(avg.orders)) +
    bigCard('💬', 'คนทัก', fmtNum(m.chats || 0), 'เฉลี่ยทีม ' + fmtNum(avg.chats)) +
    bigCard('🎯', '% ปิดการขาย', pctFmt(m.closeRate),
      avg.closeRate === null ? '' : 'เฉลี่ยทีม ' + pctFmt(avg.closeRate)) +
    bigCard('🧾', 'เปอร์บิล', THB(m.avgOrder || 0), 'ยอดขายเฉลี่ยต่อบิล') +
    bigCard('📈', 'ROAS',
      (m.roas === null || m.roas === undefined) ? '—' : (Math.round(Number(m.roas) * 100) / 100) + 'x',
      (m.roas === null || m.roas === undefined) ? 'ยอดขายไม่ได้มาจากแอด' : 'ยอดขาย ÷ ค่าแอดที่จัดสรร') +
    bigCard('⚡', 'ตอบเฉลี่ย',
      (m.avgRespMins === null || m.avgRespMins === undefined) ? '—' : m.avgRespMins + ' น.', 'ยิ่งน้อยยิ่งดี') +
    bigCard('↩', 'ข้อความที่ตอบ', fmtNum(m.replies || 0), '📞 เบอร์ใหม่ ' + fmtNum(m.phones || 0)) +
    '</div>';

  // งานค้างตอนนี้ — ค่า "ตอนนี้" ไม่ขึ้นกับช่วงที่เลือก บอกให้ชัดกันเข้าใจผิด
  const now = '<div class="card">' +
    '<h3>⏰ งานค้างตอนนี้</h3>' +
    '<div class="card-sub">24 ชม. ล่าสุด — ไม่ขึ้นกับช่วงเวลาที่เลือกด้านบน</div>' +
    '<div class="pg-summary">' +
      '<div class="pgs-item"><b>' + fmtNum(m.activeNow || 0) + '</b><span>แชทที่ดูแล</span></div>' +
      '<div class="pgs-item' + ((m.waitingNow || 0) > 0 ? ' warn' : '') + '"><b>' + fmtNum(m.waitingNow || 0) + '</b><span>รอตอบ</span></div>' +
      '<div class="pgs-item' + ((m.overSla || 0) > 0 ? ' warn' : '') + '"><b>' + fmtNum(m.overSla || 0) + '</b><span>เกิน SLA</span></div>' +
    '</div></div>';

  const detail = '<div class="card">' +
    '<h3>📦 รายละเอียด</h3>' +
    '<div class="me-kv"><span>สินค้าขายดีของคุณ</span><b>' + esc(m.topProduct || '-') + '</b></div>' +
    '<div class="me-kv"><span>เพจที่ทำยอดดีสุด</span><b>' + esc(m.topPage || '-') + '</b></div>' +
    '<div class="me-kv"><span>ออเดอร์ล่าสุด</span><b>' + esc(m.lastOrderAt || '-') + '</b></div>' +
    '</div>';

  return controls + head + progCard + cards + now + detail;
}

/* ---------------- render / fetch ---------------- */

function render(container: HTMLElement): void {
  container.innerHTML = bodyHtml(lastData || {});
  bindRangeControls(container, state, 'me', () => {
    lastData = null;
    me.load(container, true);
  });
}

function fetchAndRender(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<MeData>('apiMe', { preset: state.preset, from: state.from, to: state.to })
    .then((data) => {
      if (seq !== reqSeq) return;
      lastData = data;
      const ae = document.activeElement;
      if (ae && container.contains(ae) &&
          (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
      render(container);
    })
    .catch((err) => {
      if (seq !== reqSeq) return;
      if (lastData) {
        toast('⚠️ โหลดข้อมูลใหม่ไม่สำเร็จ: ' + ((err && err.message) || 'ไม่ทราบสาเหตุ'));
      } else {
        showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', () => me.load(container, true));
      }
    });
}

export const me = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container);
      fetchAndRender(container);
    } else {
      container.innerHTML = '<div class="card"><div class="skel-line"></div><div class="skel-line"></div></div>';
      fetchAndRender(container);
    }
  },
};
