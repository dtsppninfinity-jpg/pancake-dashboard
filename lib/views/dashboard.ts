/* ============================================================
   dashboard — หน้า Dashboard (ภาพรวมแชทวันนี้)
   ข้อมูลจริงจาก apiDashboard({channel}) — channel กรองฝั่ง server
   (port จาก JsDashboard.html — โครง HTML/class/ข้อความ/esc คงเดิมทุกตัวอักษร)
   ============================================================ */

import {
  serverCall, esc, fmtNum, pctFmt, platformIcon, avatarHtml,
  showError, toast, tagColor,
} from '@/lib/ui/helpers';
import { svgWeekBars, svgDonut, hbarRows, bindChartTips, hideChartTip } from '@/lib/ui/charts';
import { dashboardSkel, dashboardBodySkel } from '@/lib/ui/skeletons';

/* ---------------- data types (apiDashboard) ---------------- */

interface Kpis {
  convsToday?: number;
  custMsgs?: number;
  newCustomers?: number;
  pageReplies?: number;
  phones?: number;
  waiting?: number;
  replyRate?: number;
}

interface DonutData {
  replied?: number;
  waiting?: number;
  ai?: number;
}

interface WeekItem {
  date?: string;
  label: string;
  total: number;
  replied: number;
}

interface ByTypeItem {
  label: string;
  count: number;
}

interface ByPageItem {
  name?: string;
  platform?: string;
  count?: number;
}

interface TagItem {
  name?: string;
  count?: number;
}

interface AttentionItem {
  id?: string | number;
  pageId?: string | number;
  pageName?: string;
  platform?: string;
  customer?: string;
  snippet?: string;
  updatedAt?: string;
  waitMins?: number;
}

interface DashData {
  kpis?: Kpis;
  week?: WeekItem[];
  donut?: DonutData;
  byType?: ByTypeItem[];
  byPage?: ByPageItem[];
  commentByPage?: ByPageItem[];
  tags?: TagItem[];
  attention?: AttentionItem[];
}

/* ---------------- closure state ---------------- */

let lastData: DashData | null = null;   // cache ข้อมูลล่าสุด (ต่อ channel ปัจจุบัน)
let channel = '';                       // '' | 'facebook' | 'line' (server-side param)
let reqSeq = 0;                         // กันผลลัพธ์เก่ามาทับผลลัพธ์ใหม่

const CHANNELS: { key: string; label: string }[] = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'facebook', label: '📘 Facebook' },
  { key: 'line', label: '🟢 LINE OA' },
  { key: 'comment', label: '💭 คอมเมนต์' }, // มุมมองเฉพาะคอมเมนต์ (ทุก platform)
];

/* ---------------- ชิ้นส่วน HTML ---------------- */

function chipRowHtml(): string {
  const pills = CHANNELS.map((c) => {
    return '<button class="filter-btn' + (channel === c.key ? ' active' : '') +
      '" data-ch="' + esc(c.key) + '">' + esc(c.label) + '</button>';
  }).join('');
  return '<div class="conv-filters" id="dash-channels">' + pills + '</div>';
}

function statCard(icon: string, iconCls: string, label: string, valueHtml: string, hintHtml: string): string {
  return '<div class="stat-card">' +
    '<div class="stat-icon ' + iconCls + '">' + icon + '</div>' +
    '<div style="min-width:0">' +
    '<div class="stat-label">' + label + '</div>' +
    '<div class="stat-value">' + valueHtml + '</div>' +
    '<div class="stat-hint">' + hintHtml + '</div>' +
    '</div></div>';
}

function statGridHtml(k: Kpis, donut?: DonutData): string {
  const waiting = Number(k.waiting) || 0;
  const d: DonutData = donut || {};
  const ai = Number(d.ai) || 0;
  const convBase = (Number(d.replied) || 0) + ai + (Number(d.waiting) || 0);
  const aiPct = convBase ? Math.round((ai / convBase) * 100) : 0;
  const commentMode = channel === 'comment';
  const cards: string[] = [];
  if (commentMode) {
    // มุมคอมเมนต์: ตัวเลขแรกคือ "จำนวนคอมเมนต์" ไม่ใช่บทสนทนา — ป้ายต้องตรงความหมาย
    cards.push(statCard('💭', 'purple', 'คอมเมนต์จากลูกค้าวันนี้', fmtNum(k.custMsgs),
      'เพจตอบคอมเมนต์ ' + fmtNum(k.pageReplies) + ' ครั้ง'));
  } else {
    cards.push(statCard('💬', 'purple', 'บทสนทนาใหม่วันนี้', fmtNum(k.convsToday),
      'ข้อความลูกค้า ' + fmtNum(k.custMsgs) + ' • 📞 เบอร์ใหม่ ' + fmtNum(k.phones)));
  }
  // ⚠️ pageReplies = จำนวน "ข้อความ" ที่เพจส่งวันนี้ (รวมบอต/ข้อความอัตโนมัติ/บรอดแคสต์)
  //    ไม่ใช่จำนวนบทสนทนาที่ตอบ — และคนละชุดข้อมูล/คนละช่วงเวลากับ replyRate (24 ชม. จาก conversations)
  //    เดิมเอามาแปะคู่กันในการ์ดเดียว ทำให้ดูเหมือน "ตอบ 94% จาก 47,375 ครั้ง" ซึ่งไม่จริง
  //    replyRate ยังอยู่ในการ์ดโดนัทที่เขียน "(24 ชม.)" กำกับไว้ชัดเจนแล้ว
  cards.push(statCard('📤', 'green', 'ข้อความที่เพจส่งวันนี้', fmtNum(k.pageReplies),
    'รวมบอต/ข้อความอัตโนมัติ • ลูกค้าส่ง ' + fmtNum(k.custMsgs) + ' ข้อความ'));
  cards.push(statCard('🤖', 'purple', 'ตอบอัตโนมัติ (24 ชม.)', fmtNum(ai),
    convBase ? '<b class="up">' + aiPct + '%</b> ของบทสนทนา 24 ชม.' : 'ยังไม่มีข้อมูล'));
  cards.push(statCard('👤', 'amber', 'รอแอดมินตอบ', fmtNum(k.waiting),
    waiting > 0 ? '<b class="warn">ต้องการความสนใจ</b>' : 'ไม่มีงานค้าง'));
  cards.push(statCard('🆕', 'blue', 'ลูกค้าใหม่วันนี้', fmtNum(k.newCustomers),
    commentMode ? 'ทุกช่องทางรวมกัน (แยกเฉพาะคอมเมนต์ไม่ได้)' : 'จากทุกเพจที่ sync'));
  return '<div class="stat-grid">' + cards.join('') + '</div>';
}

function weekCardHtml(week?: WeekItem[]): string {
  const body = (week && week.length)
    ? svgWeekBars(week)
    : '<div class="empty-note">ยังไม่มีข้อมูล</div>';
  // ป้ายต้องบอกว่าเป็น "จำนวนข้อความ" ไม่ใช่บทสนทนา — เพจส่งสคริปต์ขายทีละหลายบับเบิล
  // แท่งม่วงจึงสูงกว่าแท่งฟ้าหลายเท่าเป็นปกติ (ไม่ใช่ข้อมูลผิด)
  return '<div class="card">' +
    '<h3>ปริมาณข้อความ 7 วันล่าสุด</h3>' +
    '<div class="card-sub">' +
    '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#3b82f6;vertical-align:middle;margin-right:5px"></span>ลูกค้าส่ง' +
    '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#6c5ce7;vertical-align:middle;margin:0 5px 0 14px"></span>เพจส่ง (รวมบอต/บรอดแคสต์)' +
    '</div>' +
    body + '</div>';
}

function legendRow(color: string, label: string, value: number | undefined): string {
  return '<div class="row"><span class="dot" style="background:' + color + '"></span>' +
    esc(label) + '<b>' + fmtNum(value) + '</b></div>';
}

function donutCardHtml(k: Kpis, donut?: DonutData): string {
  const rate = Number(k.replyRate) || 0;
  const d: DonutData = donut || {};
  return '<div class="card">' +
    '<h3>สัดส่วนการตอบ (24 ชม.)</h3>' +
    '<div class="card-sub">แอดมินตอบ vs ตอบอัตโนมัติ vs รอตอบ</div>' +
    '<div class="donut-wrap">' +
    svgDonut(rate, esc(pctFmt(k.replyRate)), 'ตอบแล้ว') +
    '<div class="donut-legend">' +
    legendRow('#2dd4a0', 'แอดมินตอบ', d.replied) +
    legendRow('#6c5ce7', 'ตอบอัตโนมัติ', d.ai) +
    legendRow('#ff5d7a', 'รอตอบ', d.waiting) +
    '</div></div></div>';
}

function typeLabel(t: string | undefined): string {
  const u = String(t || '').toUpperCase();
  if (u === 'INBOX') return '💬 ข้อความ';
  if (u === 'COMMENT') return '💭 คอมเมนต์';
  return String(t || '-');
}

function byTypeCardHtml(byType?: ByTypeItem[]): string {
  const items = (byType || []).slice().sort((a, b) => {
    return (Number(b.count) || 0) - (Number(a.count) || 0);
  }).map((t) => {
    return { label: typeLabel(t.label), value: Number(t.count) || 0 };
  });
  return '<div class="card">' +
    '<h3>ประเภทบทสนทนา (24 ชม.)</h3>' +
    '<div class="card-sub">แยกตามช่องทางที่ลูกค้าทักเข้ามา</div>' +
    hbarRows(items, { empty: 'ยังไม่มีข้อมูล' }) + '</div>';
}

function tagsCardHtml(tags?: TagItem[]): string {
  let body: string;
  if (tags && tags.length) {
    body = '<div class="tag-cloud">' + tags.map((t) => {
      return '<span class="chip"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;' +
        'background:' + tagColor(t.name) + ';margin-right:5px;vertical-align:middle"></span>' + esc(t.name) +
        ' <b style="opacity:.65">×' + fmtNum(t.count) + '</b></span>';
    }).join('') + '</div>';
  } else {
    body = '<div class="empty-note">ยังไม่มีแท็ก</div>';
  }
  return '<div class="card">' +
    '<h3>แท็กที่ใช้บ่อย</h3>' +
    '<div class="card-sub">นับจากบทสนทนาใน 24 ชม.ล่าสุด</div>' +
    body + '</div>';
}

function byPageCardHtml(byPage?: ByPageItem[]): string {
  const items = (byPage || []).map((p) => {
    return {
      label: platformIcon(p.platform) + ' ' + String(p.name || '-'),
      value: Number(p.count) || 0,
      cls: 'blue',
    };
  });
  return '<div class="card">' +
    '<h3>แชทแยกตามเพจ (24 ชม.)</h3>' +
    '<div class="card-sub">เพจที่ลูกค้าทักเยอะที่สุด (top 8)</div>' +
    hbarRows(items, { cls: 'blue', empty: 'ยังไม่มีข้อมูล' }) + '</div>';
}

function commentByPageCardHtml(commentByPage?: ByPageItem[]): string {
  const items = (commentByPage || []).map((p) => {
    return {
      label: platformIcon(p.platform) + ' ' + String(p.name || '-'),
      value: Number(p.count) || 0,
    };
  });
  return '<div class="card">' +
    '<h3>💭 คอมเมนต์แยกตามเพจ (วันนี้)</h3>' +
    '<div class="card-sub">เพจที่ลูกค้าคอมเมนต์เยอะที่สุด (top 8) — จากสถิติรายชั่วโมงจริง</div>' +
    hbarRows(items, { empty: 'วันนี้ยังไม่มีคอมเมนต์' }) + '</div>';
}

function waitLabel(mins: number | undefined): string {
  const m2 = Math.max(0, Math.round(Number(mins) || 0));
  if (m2 >= 60) {
    const h = Math.floor(m2 / 60);
    const m = m2 % 60;
    return 'รอ ' + fmtNum(h) + ' ชม.' + (m > 0 ? ' ' + m + ' นาที' : '');
  }
  return 'รอ ' + fmtNum(m2) + ' นาที';
}

function attentionCardHtml(attention?: AttentionItem[]): string {
  let body: string;
  if (attention && attention.length) {
    body = attention.slice(0, 30).map((a) => {
      const mins = Number(a.waitMins) || 0;
      const urgent = mins >= 60; // รอเกิน 1 ชม. = ด่วน
      // เปิดแชทนี้ใน Pancake web (แท็บใหม่) — id บทสนทนา = "{pageId}_{เลขแชท}"
      const pancakeUrl = 'https://pancake.vn/' + encodeURIComponent(String(a.pageId || '')) +
        '?c_id=' + encodeURIComponent(String(a.id || ''));
      return '<div class="attn-item' + (urgent ? ' urgent' : '') + '">' +
        avatarHtml(a.id, a.customer) +
        '<div class="attn-body">' +
        '<div class="attn-name">' + esc(a.customer || '-') +
        ' <span>' + platformIcon(a.platform) + '</span>' +
        (urgent ? ' <span class="badge urgent">🔥 ด่วน</span>' : '') +
        ' <span class="badge admin">' + esc(waitLabel(a.waitMins)) + '</span></div>' +
        '<div class="attn-snippet">' + esc(a.snippet || '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
        '<a class="btn-mini" href="' + esc(pancakeUrl) + '" target="_blank" rel="noopener" ' +
          'title="เปิดแชทนี้ใน Pancake (แท็บใหม่)">↗ เปิดใน Pancake</a>' +
        '<div style="font-size:10.5px;color:var(--text-3);margin-top:4px">' + esc(a.pageName || '') + '</div>' +
        '</div></div>';
    }).join('');
  } else {
    body = '<div class="empty-note">🎉 ไม่มีแชทค้างรอแอดมิน</div>';
  }
  return '<div class="card">' +
    '<h3>🔔 แชทที่รอแอดมินตอบ</h3>' +
    '<div class="card-sub">เรียงจากรอนานที่สุด — คลิก ↗ เพื่อเปิดตอบใน Pancake</div>' +
    body + '</div>';
}

function bodyHtml(data: DashData): string {
  const k = (data && data.kpis) || {};
  return statGridHtml(k, data.donut) +
    '<div class="dash-row">' +
      weekCardHtml(data.week) +
      donutCardHtml(k, data.donut) +
    '</div>' +
    '<div class="dash-row">' +
      byTypeCardHtml(data.byType) +
      tagsCardHtml(data.tags) +
    '</div>' +
    '<div class="dash-row">' +
      byPageCardHtml(data.byPage) +
      commentByPageCardHtml(data.commentByPage) +
    '</div>' +
    '<div class="dash-row single">' +
      attentionCardHtml(data.attention) +
    '</div>';
}

/* ---------------- render + events ---------------- */

function bindChips(container: HTMLElement): void {
  const wrap = container.querySelector('#dash-channels');
  if (!wrap) return;
  wrap.querySelectorAll('[data-ch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ch = btn.getAttribute('data-ch') || '';
      if (ch === channel) return;
      channel = ch;
      lastData = null; // ข้อมูลเดิมเป็นของ channel เก่า — ต้องดึงใหม่จาก server
      wrap.querySelectorAll('[data-ch]').forEach((b) => {
        b.classList.toggle('active', (b.getAttribute('data-ch') || '') === channel);
      });
      hideChartTip(); // กราฟกำลังถูกแทนด้วย skeleton — ซ่อนทูลทิปที่อาจค้าง
      const body = container.querySelector<HTMLElement>('#dash-body');
      if (body) body.innerHTML = dashboardBodySkel();
      fetchAndRender(container);
    });
  });
}

function render(container: HTMLElement, data?: DashData | null): void {
  container.innerHTML = chipRowHtml() + '<div id="dash-body">' + bodyHtml(data || {}) + '</div>';
  bindChips(container);
  bindChartTips(container); // ทูลทิป hover ของกราฟแท่ง 7 วัน
}

function fetchAndRender(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<DashData>('apiDashboard', { channel: channel }).then((data) => {
    if (seq !== reqSeq) return; // มี request ใหม่กว่าแล้ว
    lastData = data;
    render(container, data);
  }).catch((err) => {
    if (seq !== reqSeq) return;
    if (lastData) {
      // มีข้อมูลเดิมแสดงอยู่ — แจ้งเตือนเฉยๆ ไม่ทำลายหน้า
      toast('⚠️ โหลดข้อมูลใหม่ไม่สำเร็จ: ' + ((err && err.message) || 'ไม่ทราบสาเหตุ'));
    } else {
      hideChartTip(); // หน้าเปลี่ยนเป็นกล่อง error — ซ่อนทูลทิปที่อาจค้าง
      showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', () => {
        dashboard.load(container, true);
      });
    }
  });
}

/* ---------------- ลงทะเบียน view ---------------- */

export const dashboard = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);      // แสดงจาก cache ทันที
      fetchAndRender(container);        // แล้วดึงข้อมูลใหม่เบื้องหลัง
    } else {
      container.innerHTML = dashboardSkel();
      fetchAndRender(container);
    }
  },
};
