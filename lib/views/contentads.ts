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
const filter = { q: '', status: '', account: '', page: '', product: '', rank: 'revenue' };
let alertShowAll = false;
/** มีข้อมูลครีเอทีฟให้โชว์ไหม — ยังไม่ได้รัน migration ad_creative ก็ไม่ต้องขึ้นกล่องรูปเปล่าทุกใบ */
let hasCreatives = false;
/** ช่วงย้อนหลังที่ดึงจาก server (วัน) — เดิมหน้านี้ไม่มีตัวกรองเวลาเลย เป็นยอดสะสมตั้งแต่ต้น */
let rangeDays = 7;

// นับเป็น "วันปฏิทินไทยเต็มวัน" เหมือนหน้า Sales และเหมือน Pancake
// (1 วัน = ตั้งแต่เที่ยงคืนวันนี้ | 7 วัน = วันนี้ + 6 วันก่อน)
// ค่าแอดกับยอดขายใช้หน้าต่างเดียวกันเป๊ะ — ไม่งั้น ROAS เพี้ยน
const RANGE_OPTIONS = [
  { d: 1, label: 'วันนี้' },
  { d: 7, label: '7 วัน' },
  { d: 30, label: '30 วัน' },
  { d: 90, label: '90 วัน' },
];

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
        String(it.marketer || '') + ' ' + String(it.pageName || '') + ' ' +
        (it.products || []).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
    }
    if (filter.status && (!it.status || it.status.key !== filter.status)) continue;
    if (filter.account && String(it.account || '') !== filter.account) continue;
    if (filter.page && String(it.pageName || it.pageId || '') !== filter.page) continue;
    if (filter.product && (it.products || []).indexOf(filter.product) < 0) continue;
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

function uniquePages(items: any[]): string[] {
  const seen: Record<string, boolean> = {}, out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = String(items[i].pageName || items[i].pageId || '');
    if (p && !seen[p]) { seen[p] = true; out.push(p); }
  }
  out.sort();
  return out;
}

/** รายชื่อสินค้าจากทุกแอด เรียงตามจำนวนแอดที่ขายสินค้านั้น (cap 30 ตัวเลือก) */
function uniqueProducts(items: any[]): string[] {
  const cnt: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) {
    (items[i].products || []).forEach(function (nm: string) {
      cnt[nm] = (cnt[nm] || 0) + 1;
    });
  }
  return Object.keys(cnt)
    .sort(function (a, b) { return cnt[b] - cnt[a] || a.localeCompare(b); })
    .slice(0, 30);
}

/* ---------------- สื่อ/ครีเอทีฟของแอด (รูป / คลิป / ลิงก์โพสต์จริง) ---------------- */

/**
 * กล่องรูปครีเอทีฟ — URL รูปจาก Meta มีวันหมดอายุ (ทั้ง scontent และ /ads/image)
 * จึงใส่ตัวสำรองไว้ใน data-ca-fallback แล้วให้ bindImgFallback_() สลับให้เมื่อโหลดพลาด
 * ถ้าพังทั้งคู่ → กล่องว่างมีไอคอน ไม่ปล่อยเป็นรูปแตก
 */
function mediaBoxHtml_(it: any, cls: string): string {
  const m = it && it.media;
  const isVid = !!(m && m.video);
  const icon = isVid ? '🎬' : (it && it.organicPost ? '📝' : '🖼');
  const img = safeUrl_(m && m.img);
  const alt = safeUrl_(m && m.imgAlt);
  // ไม่มีรูปเลย → เรนเดอร์กล่องว่างตั้งแต่แรก (ไม่ต้องรอ error)
  if (!img) {
    return '<div class="' + cls + ' broken"><span class="ca-ph">' + icon + '</span></div>';
  }
  return '<div class="' + cls + '">' +
    '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async"' +
    (alt && alt !== img ? ' data-ca-fallback="' + esc(alt) + '"' : ' data-ca-fallback=""') + '>' +
    '<span class="ca-ph">' + icon + '</span>' +
    (isVid ? '<span class="ca-play">▶</span>' : '') +
    '</div>';
}

/** ผูก fallback ของรูปทุกใบใน root (การ์ด + modal ใช้ตัวเดียวกัน) */
function bindImgFallback_(root: HTMLElement | Document): void {
  root.querySelectorAll('img[data-ca-fallback]').forEach(function (el) {
    const img = el as HTMLImageElement;
    img.addEventListener('error', function () {
      const next = img.getAttribute('data-ca-fallback') || '';
      if (next && next !== img.getAttribute('src')) {
        img.setAttribute('data-ca-fallback', '');  // ให้ลองได้ครั้งเดียว กันวนไม่รู้จบ
        img.setAttribute('src', next);
        return;
      }
      const box = img.parentElement;
      if (box) box.classList.add('broken');
    });
  });
}

/** อนุญาตเฉพาะ http(s) — ค่ามาจาก Meta ก็จริง แต่ href ที่หลุด javascript: เข้ามาคือ XSS */
function safeUrl_(u: any): string {
  const s = String(u || '');
  return /^https?:\/\//i.test(s) ? s : '';
}

/** ลิงก์เปิดโพสต์จริง — dark post ใช้ effective_object_story_id จึงเปิดได้เหมือนกัน */
function mediaLinksHtml_(it: any): string {
  const m = it && it.media;
  if (!m) return '';
  const btn = function (href: any, label: string): string {
    const u = safeUrl_(href);
    if (!u) return '';
    return '<a class="btn-mini" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' +
      label + '</a>';
  };
  let h = '';
  // Ads Manager = ที่เดียวที่ดูครีเอทีฟของแอด (รวม dark post + วิดีโอ) ได้ครบจริง
  // ต้องล็อกอิน Facebook ที่มีสิทธิ์บัญชีโฆษณานั้นก่อน — ทีมแอดมีอยู่แล้ว
  const acc = String((it && it.accountId) || '').replace(/^act_/, '');
  const adId = String((it && it.adId) || '');
  if (acc && adId) {
    h += btn('https://adsmanager.facebook.com/adsmanager/manage/ads?act=' + encodeURIComponent(acc) +
      '&selected_ad_ids=' + encodeURIComponent(adId), '📊 เปิดใน Ads Manager ↗');
  }
  h += btn(m.permalink, 'เปิดโพสต์จริงบน Facebook ↗');
  h += btn(m.ig, '📸 โพสต์ Instagram ↗');
  h += btn(m.link, '🌐 ลิงก์ปลายทาง ↗');
  return h;
}

/** บล็อกสื่อในหน้าวิเคราะห์ (รูปใหญ่ + ปุ่มเล่นวิดีโอ + ลิงก์โพสต์) */
function mediaPanelHtml_(it: any): string {
  const m = it && it.media;
  const links = mediaLinksHtml_(it);
  if (!m || (!m.img && !links)) return '';
  let h = '<div class="ca-media">';
  h += '<div class="ca-media-frame" id="ca-media-frame">' + mediaBoxHtml_(it, 'ca-media-img') + '</div>';
  h += '<div class="ca-media-side">';
  if (m.title) h += '<div class="ca-media-title">' + esc(String(m.title)) + '</div>';
  const tags: string[] = [];
  if (m.type) tags.push(String(m.type));
  if (m.cta) tags.push(String(m.cta));
  if (tags.length) {
    h += '<div class="pill-grid" style="margin:0 0 6px">' + tags.map(function (t) {
      return '<span class="badge neutral">' + esc(t) + '</span>';
    }).join('') + '</div>';
  }
  h += '<div class="ca-media-actions">' + links + '</div>';
  // เคยมีปุ่ม "เล่นวิดีโอตรงนี้" (facebook video plugin) แต่ใช้ไม่ได้จริง:
  // คลิปของแอดเป็น dark post ไม่ได้เผยแพร่สาธารณะ plugin จึงขึ้น "วิดีโอไม่พร้อมใช้งาน" เสมอ
  // และดึงไฟล์ตรงจาก Graph API ก็ไม่ได้ (error 10 — app ไม่มีสิทธิ์) จึงส่งไป Ads Manager แทน
  h += '<div class="ca-media-note">' +
    (m.video ? '🎬 คลิปของแอดดูได้ที่ <b>Ads Manager</b> (ต้องล็อกอิน Facebook ที่มีสิทธิ์บัญชีโฆษณา) — ' : '') +
    'รูปดึงจาก Meta โดยตรง ลิงก์มีวันหมดอายุ ถ้าไม่ขึ้นให้กด "เปิดโพสต์จริง"</div>';
  h += '</div></div>';
  return h;
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

  // สื่อของแอด (รูป/คลิป/ลิงก์โพสต์) — วางบนสุดเพราะทีมแอดต้อง "เห็นครีเอทีฟ" ก่อนอ่านตัวเลข
  html += mediaPanelHtml_(item);

  // ---- รายละเอียดการขายจริง (จากออเดอร์ POS ที่ผูก ad_id นี้) — แบบเดียวกับหน้า PAGE POS เดิม ----
  const closers = Array.isArray(item.closers) ? item.closers : [];
  const dRow = function (label: string, val: string): string {
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;' +
      'border-bottom:1px dashed rgba(38,51,82,.6);font-size:12.5px">' +
      '<span style="color:var(--text-3)">' + label + '</span>' +
      '<span style="font-weight:600;text-align:right;min-width:0">' + val + '</span></div>';
  };
  html += '<div style="font-weight:700;font-size:13px;margin:16px 0 4px">🧾 รายละเอียดการขาย (POS จริง)</div>';
  html += '<div>';
  html += dRow('บริษัท / เพจ', esc(item.pageName || '—'));
  html += dRow('Ad ID', '<span style="font-family:monospace;font-size:11px">' + esc(String(item.adId)) + '</span>');
  html += dRow('ยอดขาย POS', THB(num(item.revenuePos)) + ' • ' + fmtNum(num(item.ordersPos)) + ' ออเดอร์');
  if (num(item.spend) > 0) {
    html += dRow('ค่าแอด / ROAS(POS)', THB(num(item.spend)) +
      (num(item.spend) > 0 ? ' • ' + (num(item.revenuePos) / num(item.spend)).toFixed(2) + 'x' : ''));
  }
  html += dRow('อัปเดตล่าสุด', item.updatedAt ? esc(relTime(item.updatedAt)) : '—');
  html += '</div>';
  html += '<div style="font-weight:700;font-size:13px;margin:14px 0 4px">🧑‍💼 ปิดยอดขาย (ใครปิดได้เท่าไร)</div>';
  if (!closers.length) {
    html += '<div class="empty-note" style="padding:10px">ยังไม่มีออเดอร์ POS ที่ผูกแอดนี้ในช่วงที่เลือก</div>';
  } else {
    html += '<div>' + closers.map(function (c: any) {
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;' +
        'border-bottom:1px dashed rgba(38,51,82,.5);font-size:12.5px">' +
        '<span>👤 ' + esc(String(c.name)) + ' <span class="badge neutral">' + fmtNum(num(c.orders)) + '</span></span>' +
        '<span style="font-weight:600">' + THB(num(c.revenue)) + '</span></div>';
    }).join('') + '</div>';
  }

  html += '<div style="font-weight:700;font-size:13px;margin:16px 0 4px">⚠️ ปัญหาที่พบ</div>';
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
  // ผูกเฉพาะใน modal — ถ้าผูกทั้ง document รูปบนการ์ดจะโดน handler ซ้ำแล้วขึ้น .broken ทั้งที่กำลังลองตัวสำรอง
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) bindImgFallback_(modalRoot);

  // รูปครีเอทีฟกดได้ = เปิดโพสต์จริง (ทางลัดแทนการไล่หาปุ่มด้านขวา)
  const frame = document.getElementById('ca-media-frame');
  const post = item.media && item.media.permalink;
  if (frame && post && /^https?:\/\//i.test(String(post))) {
    frame.classList.add('clickable');
    frame.setAttribute('title', 'กดเพื่อเปิดโพสต์จริงบน Facebook');
    frame.addEventListener('click', function () {
      window.open(String(post), '_blank', 'noopener,noreferrer');
    });
  }
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
    '#', 'ชื่อแอด', 'Ad ID', 'แคมเปญ', 'Ad Set', 'บัญชีแอด', 'เพจ', 'สินค้าหลัก', 'มาร์เก็ตติ้ง', 'สถานะ',
    'อายุ (วัน)', 'แอดมินปิดขายมากสุด',
    'Spend', 'Impressions', 'Reach', 'คลิก', 'CTR', 'แชท', 'Cost/แชท',
    'ออเดอร์สร้าง', 'ออเดอร์ส่งแล้ว', 'ซื้อ(Meta)', 'ออเดอร์POSจริง', 'ยอดขาย(Meta)', 'ยอดขายPOSจริง', 'ROAS', 'Cost/ซื้อ',
    '% ปิด(ซื้อ/ทัก)', 'อัปเดตล่าสุด',
  ]];
  list.forEach(function (it, i) {
    // แถว Organic ไม่มี tracking ฝั่งแอด (spend/คลิก/แชท/impressions) — ใส่ "-" เหมือนบนการ์ด ไม่ใช่ 0 ปลอม
    const org = !!it.organicPost;
    rows.push([
      i + 1,
      csvVal(it.name), csvVal(it.adId), csvVal(it.campaign), csvVal(it.adsetId), csvVal(it.account),
      csvVal(it.pageName || it.pageId), (it.products || []).join(', '),
      csvVal(it.marketer), (it.status && it.status.label) || '',
      csvVal(nullable(it.ageDays)), csvVal(it.topSeller),
      org ? '-' : num(it.spend), org ? '-' : num(it.impressions),
      org ? '-' : num(it.reach), org ? '-' : num(it.clicks),
      org ? '-' : csvVal(nullable(it.ctr)), org ? '-' : num(it.msgs),
      org ? '-' : csvVal(nullable(it.costPerMsg)),
      org ? '-' : num(it.orderCreated), org ? '-' : num(it.orderShipped),
      num(it.orders), num(it.ordersPos), num(it.revenue), num(it.revenuePos),
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
  let h = '<div class="conv-filters" id="ca-range" style="margin-bottom:10px">' +
    RANGE_OPTIONS.map(function (o) {
      return '<button class="filter-btn' + (rangeDays === o.d ? ' active' : '') +
        '" data-cadays="' + o.d + '">🗓 ' + o.label + '</button>';
    }).join('') + '</div>';
  h += '<div class="pg-controls">';
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
  const pages = uniquePages(items);
  h += '<select class="input" id="ca-page"><option value="">ทุกเพจ</option>' +
    pages.map(function (p) {
      return '<option value="' + esc(p) + '"' + (filter.page === p ? ' selected' : '') + '>' +
        esc(p) + '</option>';
    }).join('') + '</select>';
  const products = uniqueProducts(items);
  h += '<select class="input" id="ca-product" title="สินค้าจากออเดอร์ที่ผูกแอด (Top 30)">' +
    '<option value="">ทุกสินค้า</option>' +
    products.map(function (p) {
      return '<option value="' + esc(p) + '"' + (filter.product === p ? ' selected' : '') + '>' +
        esc(p) + '</option>';
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
  // รูปครีเอทีฟย่อ — ทีมแอดจำแอดจาก "ภาพ" ไม่ใช่ชื่อแอดที่ตั้งว่า VP4/A1
  if (hasCreatives) h += mediaBoxHtml_(it, 'ca-thumb');
  h += '<div class="ca-main">';
  h += '<div class="ca-id">' + esc(it.name || ('Ad ' + it.adId)) +
    ' <span class="badge ' + esc(st.cls || 'neutral') + '">' + esc(st.label || '-') + '</span>' +
    (it.campaign
      ? ' <span class="chip" style="padding:2px 10px;font-size:10.5px">' + esc(it.campaign) + '</span>'
      : '') +
    '</div>';
  const isOrganic = !!it.organicPost;
  h += '<div class="ca-sub">' + esc(isOrganic ? 'ยอดขายจากโพสต์ (ไม่ผ่านแอด)' : line1) +
    (it.pageName ? ' • 📄 ' + esc(it.pageName) : '') +
    (it.topSeller ? ' • 🧑‍💼 ปิดขายมากสุด: ' + esc(it.topSeller) : '') + '</div>';
  h += '<div class="ca-sub">' + (isOrganic ? 'Post ' : 'Ad ') + esc(it.adId) +
    (nullable(it.ageDays) !== null ? ' • อายุ ' + fmtNum(num(it.ageDays)) + ' วัน' : '') +
    ((it.products || []).length ? ' • 📦 ' + esc((it.products || []).slice(0, 2).join(', ')) : '') +
    ' • อัปเดต ' + esc(relTime(it.updatedAt)) + '</div>';
  h += '</div>';

  // ยอดขาย POS จริง (เทียบกับที่ Meta ตี) — โชว์เป็นบรรทัดเล็กใต้ตัวเลข Meta
  const posRev = num(it.revenuePos);
  const posSub = (!isOrganic && posRev > 0 && posRev !== num(it.revenue))
    ? '<span style="font-size:10px;color:var(--text-3)">จริง ' + THB(posRev) + '</span>' : '';
  h += '<div class="ca-nums">';
  h += caNum('<b class="txt-good" title="' +
    (isOrganic ? 'ยอดขายจากออเดอร์ที่ผูกโพสต์นี้'
      : 'ยอดขายที่ Meta ตี (ตรงหน้า Meta dashboard) • ยอด POS จริงในระบบ = ' + THB(posRev)) + '">' +
    THB(num(it.revenue)) + '</b>' + posSub, isOrganic ? 'ยอดขาย' : 'ยอดขาย (Meta)');
  h += caNum('<b title="ค่าโฆษณาที่ใช้ไป">' + (num(it.spend) > 0 ? THB(it.spend) : '-') + '</b>', 'Spend');
  h += caNum('<b' + (roasCls ? ' class="' + roasCls + '"' : '') +
    ' title="ROAS = ยอดขาย Meta ÷ ค่าโฆษณา (เหมือน Meta dashboard)">' + roasStr(roas) + '</b>', 'ROAS');
  h += caNum('<b' + (cpoCls ? ' class="' + cpoCls + '"' : '') +
    ' title="ค่าโฆษณาต่อ 1 การซื้อ (แบบ Meta)">' + (cpo === null ? '-' : THB(cpo)) + '</b>', 'Cost/ซื้อ');
  h += caNum('<b title="จำนวน &quot;ซื้อ&quot; ที่ Meta ตี' +
    (isOrganic ? '' : ' • ออเดอร์ POS จริง ' + fmtNum(num(it.ordersPos))) + '">' +
    fmtNum(num(it.orders)) + '</b>', isOrganic ? 'ออเดอร์' : 'ซื้อ (Meta)');
  // โพสต์ organic ไม่มี tracking แชท/คลิก — โชว์ "-" (ไม่ใช่ 0 เพราะไม่ได้วัด)
  h += caNum('<b>' + (isOrganic ? '-' : fmtNum(num(it.msgs))) + '</b>', 'ทัก');
  // ต้นทุน/ทัก = ค่าโฆษณา ÷ จำนวนคนทัก (ตรงคอลัมน์ "ต้นทุน/นัก" ของทีมแอด)
  h += caNum('<b title="ต้นทุนต่อ 1 คนทัก = ค่าโฆษณา ÷ จำนวนคนทัก">' +
    ((isOrganic || num(it.msgs) === 0) ? '-' : THB(num(it.costPerMsg))) + '</b>', 'ต้นทุน/ทัก');
  h += caNum('<b>' + (isOrganic ? '-' : kFmt(num(it.clicks))) + '</b>', 'คลิก');
  // เกิน 100% = Meta ส่งยอดซื้อมาก่อนคนทัก (พบบ่อยระหว่างวัน / แอดที่ปิดการขายจากคลิกเมื่อวาน)
  // โชว์ตัวเลขพันเปอร์เซ็นต์ทำให้ตารางอ่านไม่ได้ — ใส่หมายเหตุแทน เกณฑ์เดียวกับการ์ดหน้า Sales
  h += caNum(Number(it.closeRate) > 100
    ? '<b title="ซื้อ ' + fmtNum(it.orders || 0) + ' มากกว่าคนทัก ' + fmtNum(it.msgs || 0) +
      ' — Meta ส่งยอดซื้อมาก่อนตัวเลขคนทัก (หรือปิดจากคลิกวันก่อน) รอสิ้นวันจะนิ่ง">⏳</b>'
    : '<b title="ซื้อ ÷ ทัก (แบบ Meta)">' + pctFmt(it.closeRate) + '</b>', '% ปิด');
  h += '</div>';

  if (!isOrganic) {
    h += '<div style="flex-shrink:0"><button class="btn-mini primary" data-ca-view="' +
      esc(it.adId) + '" title="วิเคราะห์จากตัวเลขจริง + คำแนะนำ">🧠 วิเคราะห์</button></div>';
  }
  h += '</div>';
  return h;
}

function listHtml(allItems: any[], list: any[], needSetup?: boolean): string {
  if (!allItems.length) {
    // แยก 2 กรณีให้ชัด: ยังไม่ได้สร้างตาราง vs สร้างแล้วแต่ยังไม่มีข้อมูลในช่วงนี้
    return needSetup
      ? '<div class="card"><div class="empty-note">🧩 ยังไม่ได้เปิดใช้ข้อมูลค่าแอด — ' +
        'ต้องรัน <b>db/migrations/2026-07-23-ad-daily.sql</b> ใน Supabase ก่อน ' +
        'แล้วรอ sync รอบถัดไป (ทุก 15 นาที)</div></div>'
      : '<div class="card"><div class="empty-note">📡 ยังไม่มีข้อมูลแอดในช่วงนี้ — ' +
        'ลองเลือกช่วงที่ยาวขึ้น หรือรอ sync รอบถัดไป</div></div>';
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

/* ---------------- 🖼 สื่อรายเพจทั้งปี (บรีฟ 2026-07-31) ----------------
 * เลือกเพจ → รวมแอดเป็นราย "สื่อ" (โพสต์เดียวกัน = สื่อเดียวกัน) เทียบค่าแอดรายเดือนทั้งปี
 * fetch แยกจากข้อมูลหลักของหน้า (ช่วงวันด้านบนไม่เกี่ยว — อันนี้ดูทั้งปีเสมอ)
 */

let mediaPages: Array<{ id: string; name: string; spend60d: number }> | null = null;
let mediaData: any = null;
let mediaPageId = '';
let mediaReq = 0;

const TH_MONTHS_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function mediaKFmt_(v: number): string {
  const a = Math.abs(v);
  return a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(Math.round(v));
}

function mediaSectionHtml(): string {
  const headRow = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<h3 style="margin:0">🖼 สื่อรายเพจ — เทียบทั้งปี</h3>' +
    (mediaPages
      ? '<select class="input" id="ca-media-page"><option value="">— เลือกเพจ (' + mediaPages.length + ' เพจที่มีค่าแอด 60 วัน) —</option>' +
        mediaPages.map(function (pg) {
          return '<option value="' + esc(pg.id) + '"' + (pg.id === mediaPageId ? ' selected' : '') + '>' +
            esc(pg.name) + ' (' + mediaKFmt_(pg.spend60d) + ')</option>';
        }).join('') + '</select>'
      : '<span class="chip">กำลังโหลดรายชื่อเพจ...</span>') +
    '<div class="spacer" style="flex:1"></div></div>';

  let bodyHtml = '<div class="card-sub">เลือกเพจเพื่อดูว่าเพจนั้นยิงสื่อ (โพสต์) ตัวไหนบ้างทั้งปี — ' +
    'ค่าแอดรายเดือนต่อสื่อ • สื่อเดียวกันหลายแอดรวมเป็นแถวเดียว • ▶ = วิดีโอ</div>';
  if (mediaPageId && !mediaData) {
    bodyHtml += '<div class="loading"><div class="spinner"></div>กำลังรวมสื่อทั้งปีของเพจ...</div>';
  } else if (mediaData && mediaData.items) {
    const months: number[] = [];
    for (let i = 0; i < 12; i++) {
      if (mediaData.items.some(function (x: any) { return x.byMonth[i] > 0; })) months.push(i);
    }
    const rows = mediaData.items.map(function (x: any, idx: number) {
      const img = x.thumb
        ? '<img src="' + esc(x.thumb) + '" style="width:44px;height:44px;object-fit:cover;border-radius:6px" loading="lazy">'
        : '<div style="width:44px;height:44px;border-radius:6px;background:var(--bg-2,#333);display:flex;align-items:center;justify-content:center">🖼</div>';
      const title = (x.permalink
        ? '<a href="' + esc(x.permalink) + '" target="_blank" rel="noopener" style="text-decoration:none">'
        : '') + (x.isVideo ? '▶ ' : '') + esc(String(x.title).slice(0, 60)) + (x.permalink ? '</a>' : '');
      return '<tr>' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><div style="display:flex;gap:8px;align-items:center">' + img +
          '<div style="min-width:0"><div>' + title + '</div>' +
          '<div class="rank-fullname">' + fmtNum(x.ads) + ' แอด • ล่าสุด ' + esc(x.lastDate) +
          (x.running ? ' • <b class="txt-good">ยิงอยู่</b>' : '') + '</div></div></div></td>' +
        months.map(function (i) {
          const v = x.byMonth[i];
          return '<td class="num">' + (v ? mediaKFmt_(v) : '<span style="opacity:.3">—</span>') + '</td>';
        }).join('') +
        '<td class="num"><b>' + THB(x.spend) + '</b></td>' +
        '<td class="num">' + (x.costPerMsg === null ? '-' : '฿' + x.costPerMsg) + '</td>' +
        '<td class="num">' + (x.roasMeta === null ? '-' : x.roasMeta.toFixed(2) + 'x') + '</td>' +
      '</tr>';
    }).join('');
    bodyHtml +=
      (mediaData.truncated ? '<div class="hint-box">แสดง ' + fmtNum(mediaData.items.length) + ' สื่อแรกตามค่าแอด — ตัดท้ายอีก ' + fmtNum(mediaData.truncated) + ' สื่อ (ค่าแอดน้อย)</div>' : '') +
      '<div class="table-scroll"><table class="tbl"><thead><tr>' +
        '<th>#</th><th>สื่อ (โพสต์)</th>' +
        months.map(function (i) { return '<th class="num">' + TH_MONTHS_M[i] + '</th>'; }).join('') +
        '<th class="num">ค่าแอดรวมปี</th><th class="num">ค่าทัก</th><th class="num">ROAS (Meta)</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  return headRow + bodyHtml;
}

function fetchMediaPages(container: HTMLElement): void {
  serverCall<any>('apiPageMedia', {}).then(function (res) {
    mediaPages = (res && res.pages) || [];
    const box = container.querySelector('#ca-media');
    if (box) { box.innerHTML = mediaSectionHtml(); bindMedia(container); }
  }).catch(function () { /* เงียบ — section รอง */ });
}

function fetchMedia(container: HTMLElement): void {
  const seq = ++mediaReq;
  serverCall<any>('apiPageMedia', { pageId: mediaPageId }).then(function (res) {
    if (seq !== mediaReq) return;
    mediaData = res;
    const box = container.querySelector('#ca-media');
    if (box) { box.innerHTML = mediaSectionHtml(); bindMedia(container); }
  }).catch(function () {
    if (seq !== mediaReq) return;
    toast('⚠️ โหลดสื่อของเพจไม่สำเร็จ');
  });
}

function bindMedia(container: HTMLElement): void {
  const sel = container.querySelector('#ca-media-page') as HTMLSelectElement | null;
  if (sel) sel.addEventListener('change', function () {
    mediaPageId = sel.value;
    mediaData = null;
    const box = container.querySelector('#ca-media');
    if (box) { box.innerHTML = mediaSectionHtml(); bindMedia(container); }
    if (mediaPageId) fetchMedia(container);
  });
}

/* ---------------- render + bind ---------------- */

function render(container: HTMLElement, data: any): void {
  const items = (data && data.items) || [];
  // reset filter ที่ค่าหายไปจากตัวเลือกชุดใหม่ "ก่อน" กรอง — กัน ghost filter ที่ UI มองไม่เห็น
  // (เช่น สินค้าเลือกไว้หลุดจาก Top-30 หลัง refetch → select โชว์ "ทุกสินค้า" แต่ยังกรองอยู่)
  if (filter.account && uniqueAccounts(items).indexOf(filter.account) < 0) filter.account = '';
  if (filter.page && uniquePages(items).indexOf(filter.page) < 0) filter.page = '';
  if (filter.product && uniqueProducts(items).indexOf(filter.product) < 0) filter.product = '';
  hasCreatives = num(data && data.creativeCount) > 0;
  const list = filteredItems(data);
  let html = '';
  // ค่าแอดไม่ครบช่วง = ROAS สูงเกินจริง — ต้องเตือนก่อนตัวเลข ไม่ใช่ปล่อยให้อ่านผิด
  if (data && data.adDaysWarning) {
    html += '<div class="hint-box" style="border-color:var(--red,#e17055);color:var(--red,#e17055)">⚠️ ' +
      esc(data.adDaysWarning) + '</div>';
  }
  // มีแอดแต่ไม่มีสื่อสักตัว = ยังไม่ได้เปิดใช้ตาราง ad_creative (บอกให้ชัด ไม่ใช่ปล่อยกล่องรูปว่าง)
  if (data && !data.needAdSetup && items.length && !num(data.creativeCount)) {
    html += '<div class="hint-box">🖼 ยังไม่มีรูปครีเอทีฟ — รัน <b>db/migrations/2026-07-27-ad-creative.sql</b> ' +
      'ใน Supabase แล้วสั่ง <b>npm run backfill:ad-creatives</b> (หลังจากนั้นเติมเองอัตโนมัติวันละครั้ง)</div>';
  }
  if (data && data.note) html += '<div class="hint-box">' + esc(data.note) + '</div>';
  html += controlsHtml(items);
  html += alertsCardHtml(data);
  html += rankControlsHtml();
  html += listHtml(items, list, !!(data && data.needAdSetup));
  // สื่อรายเพจทั้งปี — ใช้แคชโมดูล (ไม่ refetch ตอน re-render จาก filter ฝั่ง client)
  html += '<div class="card" id="ca-media" style="margin-top:14px">' + mediaSectionHtml() + '</div>';
  container.innerHTML = html;
  bind(container, data);
  bindMedia(container);
  if (!mediaPages) fetchMediaPages(container);
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
  const pg = container.querySelector('#ca-page') as HTMLSelectElement | null;
  if (pg) pg.addEventListener('change', function () { filter.page = pg.value; rerender(); });
  const pd = container.querySelector('#ca-product') as HTMLSelectElement | null;
  if (pd) pd.addEventListener('change', function () { filter.product = pd.value; rerender(); });

  container.querySelectorAll('[data-cadays]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const d = Number(btn.getAttribute('data-cadays')) || 7;
      if (d === rangeDays) return;
      rangeDays = d;
      container.innerHTML = contentadsSkel(); // ต้องดึงใหม่จาก server — กรองฝั่ง client ไม่ได้
      fetchFresh(container, false);
    });
  });

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

  bindImgFallback_(container);
}

/* ---------------- fetch + register ---------------- */

function fetchFresh(container: HTMLElement, background: boolean): void {
  serverCall('apiContentAds', { days: rangeDays }).then(function (data) {
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
