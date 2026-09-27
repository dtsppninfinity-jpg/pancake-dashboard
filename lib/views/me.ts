/* ============================================================
   me — "ผลงานของฉัน" สำหรับผู้ใช้ระดับแอดมิน
   เห็นเฉพาะตัวเลขของตัวเอง + อันดับ + ค่าเฉลี่ยทีม (ไม่เห็นยอดของเพื่อนร่วมงาน)
   ข้อมูลมาจาก apiMe ซึ่ง scope ด้วย session ฝั่ง server แล้ว

   ตรวจ UI รอบ 3 (26 ก.ย. 69)
   - C4/F1: ช่วงเวลาอยู่ในแถวเครื่องมือมาตรฐาน (บนมือถือยุบเป็นปุ่มเดียวจากตัวช่วยกลาง)
   - E2: %ปิด ทศนิยม 2 ตำแหน่ง · ROAS "x" 2 ตำแหน่ง · %เทียบเป้า 1 ตำแหน่ง (ตัวจัดรูปแบบกลาง)
   - E3: สีแถบเทียบเป้าใช้เกณฑ์กลาง (100 / 80) เดิมหน้านี้ใช้ 70 คนละเกณฑ์กับหน้าอื่น
   ============================================================ */

import {
  serverCall, esc, fmtNum, THB, pct1, pct2, roasFmt, dash, showError, toast, stateHtml,
  rangeControlsHtml, bindRangeControls, type RangeState,
} from '@/lib/ui/helpers';
import { attainKind, kindClass, legendHtml, LEGEND } from '@/lib/ui/color-rules';
import { meSkel } from '@/lib/ui/skeletons';

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

/** การ์ดตัวเลขใหญ่ 1 ตัว — ป้ายคำ + ตัวเลข + บรรทัดเทียบ (กล่องตัวเลขมาตรฐาน C3 ผ่าน .me-card) */
function bigCard(label: string, value: string, sub: string): string {
  return '<div class="card me-card">' +
    '<div class="me-card-top">' + esc(label) + '</div>' +
    '<div class="me-card-val">' + value + '</div>' +
    (sub ? '<div class="card-sub">' + sub + '</div>' : '') +
    '</div>';
}

/**
 * แถบความคืบหน้าเทียบเป้า — ไม่มีเป้าก็ไม่แสดง (ไม่เดาเป้าเอง)
 * pct เกิน 100 ให้เต็มแถบแต่โชว์ตัวเลขจริง (คนทำเกินเป้าต้องเห็นว่าเกินเท่าไร)
 * สีตามเกณฑ์กลาง attainKind: ถึงเป้า = เขียว · 80–99% = ส้ม · ต่ำกว่า = แดง
 */
function progressRow(label: string, value: number, target: number, fmt: (n: number) => string): string {
  if (!target) return '';
  const pct = (value / target) * 100;
  const kind = attainKind(value, target);
  const tone = kind === 'good' ? 'ok' : kind === 'warn' ? 'warn' : kind === 'bad' ? 'bad' : '';
  return '<div class="me-prog">' +
    '<div class="me-prog-head"><span>' + esc(label) + '</span>' +
      '<b>' + fmt(value) + ' <span class="me-prog-target">/ ' + fmt(target) + '</span></b></div>' +
    '<div class="me-bar"><i class="me-bar-fill ' + tone + '" style="width:' + Math.min(100, Math.max(0, pct)).toFixed(1) + '%"></i></div>' +
    '<div class="me-prog-pct ' + kindClass(kind) + '">' + pct1(pct) + ' ของเป้า</div>' +
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
  // C4 แถวเครื่องมือมาตรฐาน — หน้านี้มีแค่ช่วงเวลา (ไม่มีตัวกรอง/ไฟล์ดาวน์โหลด)
  const controls = '<div class="toolbar me-tb"><div class="tb-range">' + rangeControlsHtml(state, 'me') + '</div></div>';

  if (d.linked === false) {
    return controls + '<div class="card">' + stateHtml('notready', {
      title: 'บัญชีนี้ยังไม่ได้ผูกกับแอดมิน',
      // ข้อความจากเซิร์ฟเวอร์พูดเรื่องเดียวกับหัวข้อ — ใช้ประโยคบอกทางแก้แทน ไม่ให้อ่านซ้ำ 2 รอบ
      body: 'ติดต่อผู้ดูแลระบบให้ผูกบัญชีนี้กับชื่อแอดมินของคุณ แล้วเปิดหน้านี้ใหม่',
    }) + '</div>';
  }
  if (d.empty || !d.me) {
    return controls + '<div class="card">' + stateHtml('nodata', {
      title: 'ยังไม่มีข้อมูลของคุณในช่วง' + (d.rangeLabel ? ' ' + d.rangeLabel : 'นี้'),
      body: 'ลองเลือกช่วงเวลาอื่นด้านบน',
    }) + '</div>';
  }

  const m = d.me;
  const avg = d.teamAvg || { revenue: 0, orders: 0, chats: 0, closeRate: null };
  const rev = Number(m.revenue) || 0;
  const tg = d.targets || {};

  // ชื่อที่แสดง: ใช้ชื่อเล่นถ้ามี (ตั้งจากหน้าจัดการแอดมิน)
  const shown = esc(m.nickname || m.name || '');

  const head = '<div class="card me-hero">' +
    '<div class="me-hero-name">สวัสดี ' + shown + '</div>' +
    '<div class="me-hero-sub">ผลงานของคุณ • ' + esc(d.rangeLabel || '') +
      (state.preset === 'today' ? ' • ' + esc(timeLeftToday()) : '') + '</div>' +
    '<div class="me-rank">อันดับ <b>' + fmtNum(d.rank || 0) + '</b> จาก ' + fmtNum(d.teamSize || 0) + ' คน</div>' +
    '</div>';

  // เป้า: ถ้าผู้ดูแลตั้งไว้จะโชว์แถบ ถ้าไม่ตั้งก็ข้ามไป (ไม่เดาเป้าเอง)
  const progs = [
    progressRow('ยอดขาย', rev, Number(tg.revenue) || 0, (n) => THB(n)),
    progressRow('ออเดอร์', Number(m.orders) || 0, Number(tg.orders) || 0, (n) => fmtNum(n)),
    progressRow('คนทัก', Number(m.chats) || 0, Number(tg.chats) || 0, (n) => fmtNum(n)),
  ].filter(Boolean).join('');
  const progCard = progs
    ? '<div class="card"><h3>เทียบเป้าหมาย</h3>' + legendHtml(LEGEND.attain) + progs + '</div>'
    : '';

  // ตัวเลขที่ไม่ได้ตัดสินอะไร = สีปกติ (E3) — เทียบค่าเฉลี่ยทีมอยู่บรรทัดล่างแทนการทาสี
  const hasRoas = !(m.roas === null || m.roas === undefined);
  const cards = '<div class="me-grid">' +
    bigCard('ยอดขาย', THB(rev), 'เฉลี่ยทีม ' + THB(avg.revenue)) +
    bigCard('ออเดอร์', fmtNum(m.orders || 0), 'เฉลี่ยทีม ' + fmtNum(avg.orders)) +
    bigCard('คนทัก', fmtNum(m.chats || 0), 'เฉลี่ยทีม ' + fmtNum(avg.chats)) +
    bigCard('%ปิด', pct2(m.closeRate),
      avg.closeRate === null ? '' : 'เฉลี่ยทีม ' + pct2(avg.closeRate)) +
    bigCard('เปอร์บิล', THB(m.avgOrder || 0), 'ยอดขายเฉลี่ยต่อบิล') +
    bigCard('ROAS', hasRoas ? roasFmt(Number(m.roas)) : dash(),
      hasRoas ? 'ยอดขาย ÷ ค่าแอดที่จัดสรร' : 'ยอดขายไม่ได้มาจากแอด') +
    bigCard('ตอบเฉลี่ย',
      (m.avgRespMins === null || m.avgRespMins === undefined) ? dash() : fmtNum(m.avgRespMins) + ' น.', 'ยิ่งน้อยยิ่งดี') +
    bigCard('ข้อความที่ตอบ', fmtNum(m.replies || 0), 'เบอร์ใหม่ ' + fmtNum(m.phones || 0)) +
    '</div>';

  // งานค้างตอนนี้ — ค่า "ตอนนี้" ไม่ขึ้นกับช่วงที่เลือก บอกให้ชัดกันเข้าใจผิด
  // ส้ม = เรื่องที่ต้องจับตา (ไม่ใช่แดง — งบสีแดง B3)
  const now = '<div class="card">' +
    '<h3>งานค้างตอนนี้</h3>' +
    '<div class="card-sub">24 ชม. ล่าสุด — ไม่ขึ้นกับช่วงเวลาที่เลือกด้านบน</div>' +
    '<div class="pg-summary me-now">' +
      '<div class="pgs-item"><b>' + fmtNum(m.activeNow || 0) + '</b><span>แชทที่ดูแล</span></div>' +
      '<div class="pgs-item' + ((m.waitingNow || 0) > 0 ? ' warn' : '') + '"><b>' + fmtNum(m.waitingNow || 0) + '</b><span>รอตอบ</span></div>' +
      '<div class="pgs-item' + ((m.overSla || 0) > 0 ? ' warn' : '') + '"><b>' + fmtNum(m.overSla || 0) + '</b><span>เกิน SLA</span></div>' +
    '</div></div>';

  // แถว "หัวข้อ : ค่า" มาตรฐาน (.kv — C3)
  const kvRow = (k: string, v: string) =>
    '<div class="kv-row"><span class="kv-k">' + esc(k) + '</span><span class="kv-v">' + (v ? esc(v) : dash()) + '</span></div>';
  const detail = '<div class="card">' +
    '<h3>รายละเอียด</h3>' +
    '<div class="kv">' +
      kvRow('สินค้าขายดีของคุณ', m.topProduct || '') +
      kvRow('เพจที่ทำยอดดีสุด', m.topPage || '') +
      kvRow('ออเดอร์ล่าสุด', m.lastOrderAt || '') +
    '</div></div>';

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
        toast('โหลดข้อมูลใหม่ไม่สำเร็จ', 'error', { action: { label: 'ลองใหม่', fn: () => me.load(container, true) } });
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
      container.innerHTML = meSkel();
      fetchAndRender(container);
    }
  },
};
