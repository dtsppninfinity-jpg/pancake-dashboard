/* ============================================================
   contentads — หน้าโฆษณา & คอนเทนต์
   ข้อมูลจริงจาก apiContentAds() — กรอง/เรียงทั้งหมดฝั่ง client
   (port จาก JsContentAds.html — กติกาข้อมูล/ตัวเลขคงเดิม หน้าตาปรับตามตรวจ UI รอบ 3)

   โครงหน้า (ตรวจ UI ข้อ B5): แท็บย่อย 3 แท็บ แบบเดียวกับหน้า KPI
     แจ้งเตือน   = รายการเรื่องที่ควรทำ (เรียงจากด่วนที่สุด)
     อันดับแอด   = ตารางแอดหัวคอลัมน์ชุดเดียว กดหัวคอลัมน์เรียงได้ (เดิมเป็นการ์ด 30 ใบ ตัวเลข 9 ตัวต่อใบ
                   แต่ละใบมีป้ายกำกับของตัวเอง อ่านเทียบข้ามแอดยาก)
     สื่อรายเพจ  = ค่าแอดรายเดือนต่อสื่อทั้งปีของเพจที่เลือก (โหลดแยก เฉพาะตอนเปิดแท็บนี้)
   ============================================================ */

import {
  serverCall, esc, fmtNum, THB, THBk, kFmt, pct2, roasFmt, dash, relTime, dateTh, monthTh,
  toast, openModal, closeModal, showError, downloadCSV, downloadXLS, downloadMenuHtml, bindDownloadMenu,
  infoTip, stateHtml, modalCloseBtn,
} from '@/lib/ui/helpers';
import { kindClass, legendHtml, type ColorKind } from '@/lib/ui/color-rules';
import { sortTh, makeSortable } from '@/lib/ui/table-sort';
import { contentadsSkel } from '@/lib/ui/skeletons';
import { icon, brandIcon, statusPill, statusDot, ICON_FOR, type StatusKind } from '@/lib/ui/icons';

let lastData: any = null;
const filter = { q: '', status: '', account: '', page: '', product: '', rank: 'revenue' };
let alertShowAll = false;
/** มีข้อมูลครีเอทีฟให้โชว์ไหม — ยังไม่ได้รัน migration ad_creative ก็ไม่ต้องขึ้นกล่องรูปเปล่าทุกแถว */
let hasCreatives = false;
/** ช่วงย้อนหลังที่ดึงจาก server (วัน) — เดิมหน้านี้ไม่มีตัวกรองเวลาเลย เป็นยอดสะสมตั้งแต่ต้น */
let rangeDays = 7;
/** ลำดับคำขอ apiContentAds ล่าสุด + ช่วงวันของคำขอที่กำลังวิ่ง (0 = ไม่มี) — ดู fetchFresh */
let fetchSeq = 0;
let fetchDays = 0;

/* ---- สื่อของแอด: ขอเฉพาะแอดที่จอกำลังโชว์ (apiPageMedia {adIds}) ----
 * เดิม server ส่งสื่อของทุกแอดมาในก้อนเดียว (~11k แอด / 7 วัน = 16MB และ 46% ของเวลาโหลด) ทั้งที่จอใช้ ~30 รูป
 * ตอนนี้ server เติมให้แค่ชุดแรก (แจ้งเตือน + 30 แอดยอดขายสูงสุด) ที่เหลือขอตอนจะโชว์ แล้วจำไว้ที่นี่ข้ามรอบรีเฟรช/ช่วงวัน
 * m = null → แอดนี้ไม่มีรูปจริง (จำไว้ 30 นาที — sync ครีเอทีฟรายชั่วโมงเติมรูปให้แอดใหม่ได้)
 * URL รูปในฐานไม่ถูกเปลี่ยนหลังเขียนครั้งแรก (sync ดึงเฉพาะแอดที่ยังไม่มีแถว) จึงจำตัวที่มีรูปไว้ได้ทั้ง session */
const mediaCache: Record<string, { m: any; at: number }> = {};
const MEDIA_NONE_TTL = 30 * 60000;
const mediaWant = new Set<string>();
const mediaInflight = new Set<string>();
let mediaTimer = 0;
/** กล่องของหน้านี้ที่วาดล่าสุด — ผลสื่อมาถึงทีหลังให้แปะลงของที่อยู่บนจอจริงตอนนั้น (ไม่ถือ element เก่าไว้) */
let caContainer: HTMLElement | null = null;

type CaTab = 'alerts' | 'ads' | 'media';
const TAB_KEY = 'pn-ca-tab';
/** แท็บที่เปิดอยู่ — จำไว้ในเครื่องนี้ (localStorage) คนที่ดูแต่ "อันดับแอด" ไม่ต้องกดเปลี่ยนแท็บทุกครั้งที่เปิดเว็บ
 *  ใช้ไม่ได้ (โหมดส่วนตัว/ปิดที่เก็บข้อมูล) → จำแค่ในหน่วยความจำ เปิดใหม่เริ่มที่แท็บแจ้งเตือน */
let caTab: CaTab = (function (): CaTab {
  try {
    const v = window.localStorage.getItem(TAB_KEY);
    if (v === 'alerts' || v === 'ads' || v === 'media') return v;
  } catch { /* ใช้ค่าเริ่มต้น */ }
  return 'alerts';
})();
function setTab_(t: CaTab): void {
  caTab = t;
  try { window.localStorage.setItem(TAB_KEY, t); } catch { /* จำแค่ในหน่วยความจำ */ }
}

/** จำนวนแอดสูงสุดในตาราง — ที่เหลือดูในไฟล์ดาวน์โหลด (กันหน้าบวม รูปครีเอทีฟโหลดทีละหลายร้อยรูป) */
const TOP_N = 30;

// นับเป็น "วันปฏิทินไทยเต็มวัน" เหมือนหน้า Sales และเหมือน Pancake
// (1 วัน = ตั้งแต่เที่ยงคืนวันนี้ | 7 วัน = วันนี้ + 6 วันก่อน)
// ค่าแอดกับยอดขายใช้หน้าต่างเดียวกันเป๊ะ — ไม่งั้น ROAS เพี้ยน
const RANGE_OPTIONS = [
  { d: 1, label: 'วันนี้' },
  { d: 7, label: '7 วัน' },
  { d: 30, label: '30 วัน' },
  { d: 90, label: '90 วัน' },
];

/** ชื่อสถานะแอดภาษาไทย (ตรวจ UI ข้อ D2) — ตัวจัดสถานะอยู่ที่เซิร์ฟเวอร์ (lib/api/contentads.ts) ตามกติกาเดิม
 *  ไฟล์ดาวน์โหลดยังใช้ชื่อเดิมจากเซิร์ฟเวอร์ (statusLabel_) — ชีทที่ทีมเอาไฟล์ไปต่อจะได้ไม่พัง */
const STATUS_TH: Record<string, string> = {
  winning: 'แอดติด', active: 'กำลังยิง', watch: 'เฝ้าดู', needs_fix: 'ต้องแก้',
  losing: 'ไม่คุ้ม', paused: 'หยุดแล้ว', organic: 'ออร์แกนิก',
};

// ตัวเลือกใน <select> ใส่ไอคอนไม่ได้ — คำล้วน
const STATUS_OPTIONS = [
  { key: '', label: 'ทุกสถานะ' },
  { key: 'winning', label: STATUS_TH.winning },
  { key: 'needs_fix', label: STATUS_TH.needs_fix },
  { key: 'losing', label: STATUS_TH.losing },
  { key: 'watch', label: STATUS_TH.watch },
  { key: 'active', label: STATUS_TH.active },
  { key: 'organic', label: 'ออร์แกนิก (ไม่ใช้งบ)' }, // แถวที่ไม่มี spend — เดิมกรองหาไม่ได้เลย (บั๊ก)
  { key: 'paused', label: STATUS_TH.paused },
];

// "30 อันดับแรกตาม…" — ตัดสินว่าแอด 30 ตัวไหนขึ้นตาราง (ครอบทุกแอด ไม่ใช่แค่ที่เห็นอยู่)
// ส่วนการกดหัวคอลัมน์ = เรียงใหม่เฉพาะ 30 แถวที่เห็น
const RANK_MODES = [
  { key: 'revenue', label: 'ทำยอดขายสูงสุด' },
  { key: 'roas', label: 'ROAS ดีที่สุด' },
  { key: 'cpo', label: 'ต้นทุนต่อออเดอร์ต่ำสุด' },
  { key: 'worry', label: 'น่าเป็นห่วง (ROAS ต่ำสุด)' },
  { key: 'spend', label: 'ค่าแอดสูงสุด' },
  { key: 'lowclose', label: 'แชทเยอะปิดต่ำ' },
];

/**
 * ป้ายสถานะแอดจาก server (lib/api/contentads.ts) ยังมีอีโมจินำหน้า เช่น '🏆 Winning' '⏸ Paused'
 * ตัดสัญลักษณ์หน้าคำทิ้ง — ใช้กับไฟล์ดาวน์โหลดเท่านั้น (บนจอใช้ STATUS_TH)
 */
function statusLabel_(st: any): string {
  const s = String((st && st.label) || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return s || '-';
}

/** ป้ายสถานะแอด = จุดสี + คำ แบบเดียวกับทั้งเว็บ
 *  Winning = เขียว + ถ้วย (แอดดีที่สุดต้องเด่นกว่าแอดทั่วไป), Active = สีหลัก, organic มีไอคอนต้นกล้า */
const AD_STATUS_KIND: Record<string, StatusKind> = {
  winning: 'good', active: 'brand', watch: 'info', needs_fix: 'warn', losing: 'bad', paused: 'muted', organic: 'muted',
};
function statusBadge_(st: any): string {
  const key = String((st && st.key) || '');
  const ic = key === 'organic' ? icon(ICON_FOR.organic, { size: 12 }) + ' '
    : key === 'winning' ? icon('trophy', { size: 12 }) + ' ' : '';
  return statusPill(AD_STATUS_KIND[key] || 'muted', ic + esc(STATUS_TH[key] || statusLabel_(st)));
}

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

/** จำนวนตัวกรองที่ใช้อยู่ (4 ช่องเลือก — ไม่นับช่องค้นหา ซึ่งเห็นอยู่บนจอตลอด) */
function activeFilterCount_(): number {
  return (filter.status ? 1 : 0) + (filter.account ? 1 : 0) + (filter.page ? 1 : 0) + (filter.product ? 1 : 0);
}

/** คนที่เปิดหน้าอยู่เป็นผู้ดูแลระบบไหม — คำสั่ง/ชื่อไฟล์เทคนิคโชว์เฉพาะคนนี้ (page.tsx ใส่ data-role ไว้ที่ #app) */
function isSuperadmin_(): boolean {
  const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
  return !!app && app.dataset.role === 'superadmin';
}

/* ---------------- สื่อ/ครีเอทีฟของแอด (รูป / คลิป / ลิงก์โพสต์จริง) ---------------- */

/** สื่อของแถว: ของที่มากับข้อมูลหลัก (organic / ชุดแรกที่ server เติม) ก่อน แล้วค่อยดูที่ขอเพิ่มไว้ · null = ไม่มี/ยังไม่รู้ */
function mediaOf_(it: any): any {
  if (it && it.media) return it.media;
  const e = it && it.adId !== undefined ? mediaCache[String(it.adId)] : undefined;
  return e ? e.m : null;
}

/** แอดจริงที่ยังไม่รู้ว่ามีรูปไหม (กำลังขอ / จะขอ) — organic มีสื่อจาก server เสมอ */
function mediaLoading_(it: any): boolean {
  if (!it || it.organicPost || it.media) return false;
  return !mediaCache[String(it.adId)];
}

/** จดสื่อที่มากับผลหลัก — ชุดที่ server เช็คแล้ว (mediaSeeded) ไม่ต้องขอซ้ำ แม้ไม่มีรูป */
function seedMedia_(data: any): void {
  const now = Date.now();
  const byId: Record<string, any> = {};
  ((data && data.items) || []).forEach(function (it: any) { if (!it.organicPost) byId[String(it.adId)] = it; });
  ((data && data.mediaSeeded) || []).forEach(function (raw: any) {
    const id = String(raw);
    const it = byId[id];
    mediaCache[id] = { m: (it && it.media) || null, at: now };
  });
}

/** ขอสื่อของแอดชุดนี้ — รวบคำขอที่เกิดติดกันใน 150ms เป็นครั้งเดียว (เปลี่ยนตัวกรองรัวๆ / ตาราง+หน้าวิเคราะห์ ไม่ยิงรัว) */
function ensureMedia_(ids: string[]): void {
  const now = Date.now();
  ids.forEach(function (raw) {
    const id = String(raw || '');
    if (!/^\d+$/.test(id) || mediaInflight.has(id)) return;
    const e = mediaCache[id];
    if (e && (e.m || now - e.at < MEDIA_NONE_TTL)) return;
    mediaWant.add(id);
  });
  if (!mediaWant.size || mediaTimer) return;
  mediaTimer = window.setTimeout(flushMedia_, 150);
}

function flushMedia_(): void {
  mediaTimer = 0;
  const ids = Array.from(mediaWant);
  mediaWant.clear();
  for (let i = 0; i < ids.length; i += 60) {            // เพดานของ server ต่อคำขอ
    const chunk = ids.slice(i, i + 60);
    chunk.forEach(function (id) { mediaInflight.add(id); });
    serverCall<any>('apiPageMedia', { adIds: chunk }).then(function (res) {
      const media = (res && res.media) || {};
      const now = Date.now();
      chunk.forEach(function (id) {
        mediaInflight.delete(id);
        // id ที่ไม่อยู่ในผล = ยังไม่รู้ (ห้ามจดว่า "ไม่มีรูป" ไม่งั้นรูปหายถาวร) — ขอใหม่รอบวาดถัดไป
        if (Object.prototype.hasOwnProperty.call(media, id)) mediaCache[id] = { m: media[id] || null, at: now };
      });
      patchMedia_(chunk);
    }).catch(function () {
      // พลาด = ไม่จดอะไร เลิกวิบวับกลับเป็นไอคอน · รอบวาดถัดไป (รีเฟรช/เปลี่ยนตัวกรอง) ลองขอใหม่เอง
      chunk.forEach(function (id) { mediaInflight.delete(id); });
      patchMedia_(chunk);
    });
  }
}

/** แปะรูปที่เพิ่งมาถึงลงตาราง + หน้าวิเคราะห์ที่เปิดค้าง — แก้เฉพาะกล่องรูป ห้ามวาดทั้งหน้าใหม่ (ช่องค้นหาเสียโฟกัส/ข้อความที่พิมพ์ค้าง) */
function patchMedia_(ids: string[]): void {
  const root = caContainer;
  if (root && root.isConnected) {
    let added = false;
    ids.forEach(function (id) {
      const box = root.querySelector<HTMLElement>('[data-ca-thumb="' + id + '"]');
      if (!box) return;
      const e = mediaCache[id];
      if (e && e.m) { box.outerHTML = mediaBoxHtml_({ media: e.m }, 'ca-thumb', id); added = true; }
      else box.classList.remove('ca-loading');
    });
    if (added) bindImgFallback_(root);
  }
  const panel = document.querySelector<HTMLElement>('#modal-root [data-ca-media-for]');
  const pid = panel ? panel.getAttribute('data-ca-media-for') || '' : '';
  if (panel && ids.indexOf(pid) >= 0) {
    const item = findItem_(lastData, pid);
    if (!item) return;
    if (mediaLoading_(item)) {           // พลาด — เลิกวิบวับ ปุ่ม Ads Manager ยังอยู่
      panel.querySelectorAll('.ca-loading').forEach(function (el) { el.classList.remove('ca-loading'); });
      return;
    }
    panel.outerHTML = mediaPanelHtml_(item);
    const mr = document.getElementById('modal-root');
    if (mr) bindImgFallback_(mr);
    bindMediaFrame_(item);
  }
}

function findItem_(data: any, adId: any): any {
  const items = (data && data.items) || [];
  for (let i = 0; i < items.length; i++) {
    if (String(items[i].adId) === String(adId)) return items[i];
  }
  return null;
}

/**
 * กล่องรูปครีเอทีฟ — URL รูปจาก Meta มีวันหมดอายุ (ทั้ง scontent และ /ads/image)
 * จึงใส่ตัวสำรองไว้ใน data-ca-fallback แล้วให้ bindImgFallback_() สลับให้เมื่อโหลดพลาด
 * ถ้าพังทั้งคู่ → กล่องว่างมีไอคอน ไม่ปล่อยเป็นรูปแตก
 */
function mediaBoxHtml_(it: any, cls: string, thumbId?: string): string {
  const m = mediaOf_(it);
  // thumbId = รหัสแอดของกล่องรูปย่อในตาราง — patchMedia_ หากล่องนี้เจอเพื่อแปะรูปที่มาถึงทีหลัง
  const attr = thumbId ? ' data-ca-thumb="' + esc(thumbId) + '"' : '';
  const isVid = !!(m && m.video);
  // ไอคอนในกล่องว่าง: คลิป / โพสต์ (organic) / รูป — ขนาดใหญ่ในหน้าวิเคราะห์ปรับด้วย CSS .ca-media-img .ca-ph .ic
  const ph = icon(isVid ? 'video' : (it && it.organicPost ? 'file-text' : 'image'), { size: 20 });
  const img = safeUrl_(m && m.img);
  const alt = safeUrl_(m && m.imgAlt);
  // ไม่มีรูปเลย → เรนเดอร์กล่องว่างตั้งแต่แรก (ไม่ต้องรอ error)
  if (!img) {
    // ยังรอรูป = กล่องวิบวับ (ไม่ใช่ไอคอนรูปแตก — ไม่งั้นดูเหมือนแอดไม่มีรูป)
    const wait = thumbId && mediaLoading_(it) ? ' ca-loading' : '';
    return '<div class="' + cls + ' broken' + wait + '"' + attr + '><span class="ca-ph">' + ph + '</span></div>';
  }
  return '<div class="' + cls + '"' + attr + '>' +
    '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async"' +
    (alt && alt !== img ? ' data-ca-fallback="' + esc(alt) + '"' : ' data-ca-fallback=""') + '>' +
    '<span class="ca-ph">' + ph + '</span>' +
    (isVid ? '<span class="ca-play" title="วิดีโอ">' + icon(ICON_FOR.play, { size: 12, label: 'วิดีโอ' }) + '</span>' : '') +
    '</div>';
}

/** ผูก fallback ของรูปทุกใบใน root (ตาราง + modal ใช้ตัวเดียวกัน) */
function bindImgFallback_(root: HTMLElement | Document): void {
  // :not([data-ca-b]) = ผูกรูปละครั้งเดียว — แท็บสื่อรายเพจถูกผูกทั้งจาก bind() และ bindMedia()
  // ถ้าผูกซ้ำ ตัวที่ 2 จะเห็นว่าตัวสำรองถูกใช้ไปแล้วแล้วติด .broken ทั้งที่รูปสำรองกำลังโหลด
  root.querySelectorAll('img[data-ca-fallback]:not([data-ca-b])').forEach(function (el) {
    const img = el as HTMLImageElement;
    img.setAttribute('data-ca-b', '1');
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
  // แอดที่ไม่มีสื่อ (หรือรูปยังมาไม่ถึง) ก็ต้องมีปุ่ม Ads Manager — เดิมจบฟังก์ชันตั้งแต่ไม่มีสื่อ ปุ่มหายไปด้วย
  const m = mediaOf_(it) || {};
  // labelHtml = ไอคอน + คำ (ประกอบจากค่าคงที่ในไฟล์นี้เท่านั้น ไม่มีข้อมูลผู้ใช้ปน)
  const btn = function (href: any, labelHtml: string): string {
    const u = safeUrl_(href);
    if (!u) return '';
    return '<a class="btn-mini" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' +
      labelHtml + '</a>';
  };
  let h = '';
  // Ads Manager = ที่เดียวที่ดูครีเอทีฟของแอด (รวม dark post + วิดีโอ) ได้ครบจริง
  // ต้องล็อกอิน Facebook ที่มีสิทธิ์บัญชีโฆษณานั้นก่อน — ทีมแอดมีอยู่แล้ว
  const acc = String((it && it.accountId) || '').replace(/^act_/, '');
  const adId = String((it && it.adId) || '');
  if (acc && adId) {
    h += btn('https://adsmanager.facebook.com/adsmanager/manage/ads?act=' + encodeURIComponent(acc) +
      '&selected_ad_ids=' + encodeURIComponent(adId), icon(ICON_FOR.open, { size: 14 }) + 'เปิดใน Ads Manager');
  }
  h += btn(m.permalink, brandIcon('facebook') + 'เปิดโพสต์จริงบน Facebook');
  h += btn(m.ig, brandIcon('instagram') + 'โพสต์ Instagram');
  h += btn(m.link, icon(ICON_FOR.link, { size: 14 }) + 'ลิงก์ปลายทาง');
  return h;
}

/** คำไทยของชนิดสื่อ + ปุ่มชวนกด (call-to-action) ของ Meta ที่พบบ่อย */
const MEDIA_WORD: Record<string, string> = {
  VIDEO: 'วิดีโอ', PHOTO: 'รูปภาพ', IMAGE: 'รูปภาพ', CAROUSEL: 'ภาพสไลด์', SHARE: 'แชร์โพสต์', STATUS: 'โพสต์ข้อความ',
  MESSAGE_PAGE: 'ปุ่ม: ส่งข้อความ', WHATSAPP_MESSAGE: 'ปุ่ม: ส่งข้อความ WhatsApp', SHOP_NOW: 'ปุ่ม: ซื้อเลย',
  LEARN_MORE: 'ปุ่ม: ดูเพิ่มเติม', ORDER_NOW: 'ปุ่ม: สั่งซื้อเลย', BUY_NOW: 'ปุ่ม: ซื้อเลย', SIGN_UP: 'ปุ่ม: ลงทะเบียน',
  CONTACT_US: 'ปุ่ม: ติดต่อเรา', GET_OFFER: 'ปุ่ม: รับข้อเสนอ', SEND_MESSAGE: 'ปุ่ม: ส่งข้อความ', NO_BUTTON: 'ไม่มีปุ่ม',
  LIKE_PAGE: 'ปุ่ม: ถูกใจเพจ', WATCH_MORE: 'ปุ่ม: ดูเพิ่มเติม', CALL_NOW: 'ปุ่ม: โทรเลย',
};

/** บล็อกสื่อในหน้าวิเคราะห์ (รูปใหญ่ + ปุ่มเล่นวิดีโอ + ลิงก์โพสต์) */
function mediaPanelHtml_(it: any): string {
  const m = mediaOf_(it) || {};
  const links = mediaLinksHtml_(it);
  const wait = mediaLoading_(it);
  if (!m.img && !links && !wait) return '';
  // data-ca-media-for = ยังรอรูป — patchMedia_ แทนทั้งบล็อกเมื่อรูปมาถึง (เฉพาะหน้าวิเคราะห์ของแอดตัวนี้)
  let h = '<div class="ca-media"' + (wait ? ' data-ca-media-for="' + esc(String(it.adId)) + '"' : '') + '>';
  // แอดที่รู้แล้วว่าไม่มีรูป: ไม่วาดกรอบสี่เหลี่ยมใหญ่ว่างๆ — เหลือแค่ปุ่มเปิด Ads Manager
  const frame = !!m.img || wait || !!it.organicPost;
  if (frame) {
    h += '<div class="ca-media-frame" id="ca-media-frame">' + mediaBoxHtml_(it, 'ca-media-img' + (wait ? ' ca-loading' : '')) + '</div>';
  }
  h += '<div class="ca-media-side">';
  if (m.title) h += '<div class="ca-media-title">' + esc(String(m.title)) + '</div>';
  // ชนิดสื่อ / ปุ่มของแอด มาจาก Meta เป็นรหัสอังกฤษ (VIDEO, MESSAGE_PAGE) — แปลเป็นคำไทยสั้นตัวที่เจอบ่อย (D2)
  // ตัวที่ไม่รู้จักแสดงรหัสเดิม ไม่ทิ้งข้อมูล
  const tags: string[] = [];
  if (m.type) tags.push(MEDIA_WORD[String(m.type).toUpperCase()] || String(m.type));
  if (m.cta) tags.push(MEDIA_WORD[String(m.cta).toUpperCase()] || String(m.cta));
  if (tags.length) {
    h += '<div class="pill-grid ca-media-tags">' + tags.map(function (t) {
      return '<span class="badge neutral">' + esc(t) + '</span>';
    }).join('') + '</div>';
  }
  h += '<div class="ca-media-actions">' + links + '</div>';
  // เคยมีปุ่ม "เล่นวิดีโอตรงนี้" (facebook video plugin) แต่ใช้ไม่ได้จริง:
  // คลิปของแอดเป็น dark post ไม่ได้เผยแพร่สาธารณะ plugin จึงขึ้น "วิดีโอไม่พร้อมใช้งาน" เสมอ
  // และดึงไฟล์ตรงจาก Graph API ก็ไม่ได้ (error 10 — app ไม่มีสิทธิ์) จึงส่งไป Ads Manager แทน
  h += '<div class="ca-media-note">' +
    (!frame ? 'แอดนี้ยังไม่มีรูปครีเอทีฟในระบบ — ดูครีเอทีฟได้ที่ <b>Ads Manager</b> (ต้องล็อกอิน Facebook ที่มีสิทธิ์บัญชีโฆษณา)'
      : (m.video ? 'คลิปของแอดดูได้ที่ <b>Ads Manager</b> (ต้องล็อกอิน Facebook ที่มีสิทธิ์บัญชีโฆษณา) — ' : '') +
        'รูปดึงจาก Meta โดยตรง ลิงก์มีวันหมดอายุ ถ้าไม่ขึ้นให้กด "เปิดโพสต์จริง"') + '</div>';
  h += '</div></div>';
  return h;
}

/* ---------------- rule-based analysis (deterministic, ไม่เรียก server) ---------------- */

/**
 * ปัญหาของแอดจากกฎตายตัว — ic = ชื่อไอคอนลายเส้น
 * ไอคอนย้อมสีตามความรุนแรงตอนวาด (สูง = แดง, กลาง = ส้ม) ดู openAnalysis()
 */
function computeProblems(it: any): any[] {
  const probs: any[] = [];
  const spend = num(it.spend), orders = num(it.orders), msgs = num(it.msgs), clicks = num(it.clicks);
  const roas = nullable(it.roas);
  const cpo = nullable(it.costPerOrder);
  const close = nullable(it.closeRate);
  const age = nullable(it.ageDays);
  if (age !== null && age > 30 && it.status && it.status.key !== 'paused' && spend > 0) {
    probs.push({ ic: 'history', label: 'คอนเทนต์ล้า (ยิงมานาน)',
      why: 'แอดนี้รันมาแล้ว ' + fmtNum(age) + ' วัน — ครีเอทีฟเดิมมักล้าหลัง 30 วัน ควรเตรียมตัวใหม่',
      sev: 'medium' });
  }
  if (cpo !== null && cpo > 400) {
    probs.push({ ic: 'coins', label: 'ต้นทุนต่อออเดอร์สูงเกินกำหนด',
      why: 'ต้นทุนต่อออเดอร์ ' + THB(cpo) + ' เกินเพดาน ฿400', sev: 'high' });
  }
  if (roas !== null && roas < 1.5) {
    probs.push({ ic: ICON_FOR.trendDown, label: 'ROAS ต่ำ',
      why: 'ROAS ' + roasFmt(roas) + ' ต่ำกว่าเกณฑ์ 1.5 (ใช้งบ ' + THB(spend) + ')',
      sev: roas < 1 ? 'high' : 'medium' });
  }
  if (spend > 800 && orders === 0) {
    probs.push({ ic: 'package-x', label: 'จ่ายแล้วไม่มีออเดอร์',
      why: 'ใช้งบไปแล้ว ' + THB(spend) + ' แต่ยังไม่มีออเดอร์เลย', sev: 'high' });
  }
  if (msgs > 30 && close !== null && close < 10) {
    probs.push({ ic: ICON_FOR.chats, label: 'แชทเยอะ แต่ปิดไม่ได้',
      why: 'มีแชท ' + fmtNum(msgs) + ' แต่ปิดการขายได้แค่ ' + pct2(close), sev: 'medium' });
  }
  if (clicks > 800 && msgs < 15) {
    probs.push({ ic: 'mouse-pointer-click', label: 'Hook ไม่ดึงเข้าแชท',
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

/** แถวรายละเอียด "หัวข้อ : ค่า" แบบกลาง (.kv — ตรวจ UI ข้อ C3) · valHtml ต้อง escape มาแล้ว */
function kvRow_(label: string, valHtml: string): string {
  return '<div class="kv-row"><span class="kv-k">' + esc(label) + '</span><span class="kv-v">' + valHtml + '</span></div>';
}

/**
 * หน้าต่างวิเคราะห์แอด — รายละเอียดที่ย้ายออกจากตาราง (B5) มาอยู่ที่นี่:
 * รหัสแอด / รหัสเพจ / อายุแอด / เวลาอัปเดต + บัญชีแอด / แคมเปญ / มาร์เก็ตติ้ง / สินค้า (เดิมอยู่ใต้ชื่อบนการ์ด)
 * โพสต์ออร์แกนิกไม่มีค่าแอด → ไม่มีส่วน "ปัญหาที่พบ / สิ่งที่ควรทำ" (กฎพวกนั้นคิดจากค่าแอดทั้งหมด)
 */
function openAnalysis(data: any, adId: any): void {
  const item = findItem_(data, adId);
  if (!item) { toast('ไม่พบข้อมูลแอดนี้', 'warn'); return; }
  const isOrganic = !!item.organicPost;

  const probs = isOrganic ? [] : computeProblems(item);
  let hasHigh = false, hasMed = false;
  probs.forEach(function (p) {
    if (p.sev === 'high') hasHigh = true;
    else if (p.sev === 'medium') hasMed = true;
  });
  const urgBadge = isOrganic ? ''
    : hasHigh ? statusPill('bad', 'ความเร่งด่วน: ด่วนมาก')
      : hasMed ? statusPill('warn', 'ควรปรับใน 48 ชม.')
        : statusPill('good', 'ติดตามต่อ');
  const st = item.status || { label: '-', cls: 'neutral' };

  let html = '<div class="modal-head"><h3>' + (isOrganic ? 'รายละเอียด: ' : 'วิเคราะห์: ') +
    esc(item.name || ('แอด ' + item.adId)) + '</h3>' + modalCloseBtn() + '</div>';

  html += '<div class="pill-grid">' +
    statusBadge_(st) +
    urgBadge +
    (isOrganic ? ''
      : '<span class="badge neutral">' + esc(THB(num(item.spend))) + ' → ' + esc(THB(num(item.revenue))) +
        ' (ROAS ' + esc(roasFmt(nullable(item.roas))) + ')</span>') +
    (item.topSeller
      ? '<span class="badge neutral">' + icon('trophy', { size: 14 }) + 'ปิดขายมากสุด: ' + esc(item.topSeller) + '</span>' : '') +
    '</div>';

  // สื่อของแอด (รูป/คลิป/ลิงก์โพสต์) — วางบนสุดเพราะทีมแอดต้อง "เห็นครีเอทีฟ" ก่อนอ่านตัวเลข
  html += mediaPanelHtml_(item);

  // ---- รายละเอียดการขายจริง (จากออเดอร์ในระบบที่ผูกแอดนี้) ----
  const closers = Array.isArray(item.closers) ? item.closers : [];
  html += '<h4 class="ca-sec">ยอดขายจริงในระบบ</h4><div class="kv">';
  html += kvRow_('บริษัท / เพจ', esc(item.pageName || '—'));
  html += kvRow_('ยอดขายจริง', esc(THB(num(item.revenuePos))) + ' • ' + fmtNum(num(item.ordersPos)) + ' ออเดอร์');
  if (num(item.spend) > 0) {
    html += kvRow_('ค่าแอด / ROAS (ยอดจริง)', esc(THB(num(item.spend))) + ' • ' +
      esc(roasFmt(num(item.revenuePos) / num(item.spend))));
  }
  html += '</div>';

  html += '<h4 class="ca-sec">ปิดยอดขาย (ใครปิดได้เท่าไร)</h4>';
  if (!closers.length) {
    html += '<div class="ca-empty">ยังไม่มีออเดอร์ในระบบที่ผูกแอดนี้ในช่วงที่เลือก</div>';
  } else {
    html += '<div class="kv">' + closers.map(function (c: any) {
      return '<div class="kv-row"><span class="kv-k ca-closer">' + esc(String(c.name)) +
        ' <span class="badge neutral">' + fmtNum(num(c.orders)) + '</span></span>' +
        '<span class="kv-v">' + esc(THB(num(c.revenue))) + '</span></div>';
    }).join('') + '</div>';
  }

  // ---- ข้อมูลแอด (ย้ายมาจากใต้ชื่อบนการ์ดเดิม — ตรวจ UI ข้อ B5) ----
  const age = nullable(item.ageDays);
  const pid = String(item.pageId || '');
  html += '<h4 class="ca-sec">ข้อมูล' + (isOrganic ? 'โพสต์' : 'แอด') + '</h4><div class="kv">';
  if (item.account) html += kvRow_('บัญชีแอด', esc(item.account));
  if (item.campaign) html += kvRow_('แคมเปญ', esc(item.campaign));
  if (item.marketer) html += kvRow_('มาร์เก็ตติ้ง', esc(item.marketer));
  if ((item.products || []).length) html += kvRow_('สินค้าหลัก', esc((item.products || []).join(', ')));
  html += kvRow_(isOrganic ? 'รหัสโพสต์' : 'รหัสแอด',
    '<span class="ca-id">' + esc(isOrganic ? String(item.adId).replace(/^post:/, '') : String(item.adId)) + '</span>');
  if (pid) html += kvRow_('รหัสเพจ', '<span class="ca-id">' + esc(pid) + '</span>');
  if (age !== null) html += kvRow_('อายุแอด', fmtNum(age) + ' วัน');
  html += kvRow_('อัปเดตล่าสุด', item.updatedAt ? esc(relTime(item.updatedAt)) + ' (' + esc(dateTh(item.updatedAt)) + ')' : '—');
  html += '</div>';

  if (!isOrganic) {
    html += '<h4 class="ca-sec">ปัญหาที่พบ</h4>';
    if (!probs.length) {
      html += '<div class="ca-empty">' + statusDot('good') + ' ไม่พบปัญหา — แอดทำงานได้ดี</div>';
    } else {
      html += probs.map(function (p) {
        const high = p.sev === 'high';
        return '<div class="ca-prob">' +
          '<span class="ca-prob-ic ' + (high ? 'tx-bad' : 'tx-warn') + '">' + icon(p.ic, { size: 16 }) + '</span>' +
          '<span class="ca-prob-txt"><b>' + esc(p.label) + '</b><span class="ca-prob-why">' + esc(p.why) + '</span></span>' +
          statusPill(high ? 'bad' : 'warn', high ? 'สูง' : 'กลาง') +
        '</div>';
      }).join('');
    }

    const actions = VERDICT_ACTIONS[computeVerdict(item)] || VERDICT_ACTIONS.adjust;
    html += '<h4 class="ca-sec">สิ่งที่ควรทำ</h4><ol class="ca-acts">' +
      actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ol>';

    // คำล้วน ไม่ใส่ไอคอนประกาย — ประโยคนี้บอกว่า "ยังไม่ใช่ AI" ไอคอนสื่อ AI จะขัดกับคำ
    html += '<div class="hint-box">วิเคราะห์จากกฎอัตโนมัติบนตัวเลขจริง — ยังไม่ใช่ AI</div>';
  }
  html += '<div class="modal-actions"><button type="button" class="btn" id="ca-modal-ok">ปิด</button></div>';

  openModal(html, { cls: 'modal-ca' });
  const ok = document.getElementById('ca-modal-ok');
  if (ok) ok.addEventListener('click', closeModal);
  // ผูกเฉพาะใน modal — ถ้าผูกทั้ง document รูปในตารางจะโดน handler ซ้ำแล้วขึ้น .broken ทั้งที่กำลังลองตัวสำรอง
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) bindImgFallback_(modalRoot);

  bindMediaFrame_(item);
  // แอดนอกชุดแรก (เช่นเปิดจากแจ้งเตือน/อันดับแบบอื่น) — ขอรูปตอนนี้ แล้ว patchMedia_ แปะลงหน้าต่างที่เปิดอยู่
  if (!isOrganic && mediaLoading_(item)) ensureMedia_([String(item.adId)]);
}

/** รูปครีเอทีฟกดได้ = เปิดโพสต์จริง (ทางลัดแทนการไล่หาปุ่มด้านขวา) — ผูกใหม่ทุกครั้งที่วาดบล็อกสื่อ */
function bindMediaFrame_(item: any): void {
  const frame = document.getElementById('ca-media-frame');
  const m = mediaOf_(item);
  const post = m && m.permalink;
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

/** แถวรายงานชุดเดียว ใช้ทั้ง CSV และ Excel (หัวคอลัมน์/ค่าเหมือนเดิมทุกตัว — ไฟล์ที่ทีมเอาไปต่อจะได้ไม่พัง) */
function buildExportRows(data: any): any[][] | null {
  const list = filteredItems(data);
  if (!list.length) { toast('ไม่มีข้อมูลให้ดาวน์โหลด', 'warn'); return null; }
  const rows: any[][] = [[
    '#', 'ชื่อแอด', 'Ad ID', 'แคมเปญ', 'Ad Set', 'บัญชีแอด', 'เพจ', 'สินค้าหลัก', 'มาร์เก็ตติ้ง', 'สถานะ',
    'อายุ (วัน)', 'แอดมินปิดขายมากสุด',
    'Spend', 'Impressions', 'Reach', 'คลิก', 'CTR', 'แชท', 'Cost/แชท',
    'ออเดอร์สร้าง', 'ออเดอร์ส่งแล้ว', 'ซื้อ(Meta)', 'ออเดอร์POSจริง', 'ยอดขาย(Meta)', 'ยอดขายPOSจริง', 'ROAS', 'Cost/ซื้อ',
    '% ปิด(ซื้อ/ทัก)', 'อัปเดตล่าสุด',
  ]];
  list.forEach(function (it, i) {
    // แถว Organic ไม่มี tracking ฝั่งแอด (spend/คลิก/แชท/impressions) — ใส่ "-" เหมือนบนจอ ไม่ใช่ 0 ปลอม
    const org = !!it.organicPost;
    rows.push([
      i + 1,
      csvVal(it.name), csvVal(it.adId), csvVal(it.campaign), csvVal(it.adsetId), csvVal(it.account),
      csvVal(it.pageName || it.pageId), (it.products || []).join(', '),
      // ป้ายสถานะแบบตัดอีโมจิแล้ว (แถวไม่มีสถานะ = ช่องว่างเหมือนเดิม)
      csvVal(it.marketer), it.status && it.status.label ? statusLabel_(it.status) : '',
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

/* ---------------- render: ส่วนบนของหน้า ---------------- */

/** แถบแจ้งสั้นๆ เหนือแท็บ (ค่าแอดไม่ครบช่วง / ยังไม่มีรูปครีเอทีฟ) — คำสั่งเทคนิคเห็นเฉพาะผู้ดูแลระบบ (D3) */
function noticeHtml_(kind: 'warn' | 'info', text: string, adminDetail?: string): string {
  return '<div class="ca-notice' + (kind === 'warn' ? ' sig-warn' : '') + '" role="status">' +
    '<span class="ca-notice-ic">' + icon(kind === 'warn' ? ICON_FOR.alert : ICON_FOR.info, { size: 16 }) + '</span>' +
    '<div class="ca-notice-body"><div>' + esc(text) + '</div>' +
      (adminDetail && isSuperadmin_()
        ? '<details class="state-admin"><summary>รายละเอียดสำหรับผู้ดูแล</summary><pre>' + esc(adminDetail) + '</pre></details>'
        : '') +
    '</div></div>';
}

function tabsHtml(data: any): string {
  const s = (data && data.summary) || {};
  const alertTotal = num(s.urgent) + num(s.adjust) + num(s.scale);
  const adCount = filteredItems(data).length;
  // ช่องที่ 5 = ตัวเลขนี้ซ่อนบนมือถือได้ไหม (จำนวนแอดซ้ำกับหัวการ์ด — มือถือเก็บที่ไว้ให้แท็บครบ 3 แท็บในจอเดียว)
  const tabs: Array<[CaTab, string, string, string, boolean]> = [
    ['alerts', 'bell', 'แจ้งเตือน', alertTotal ? fmtNum(alertTotal) : '', false],
    ['ads', 'list-ordered', 'อันดับแอด', adCount ? fmtNum(adCount) : '', true],
    ['media', 'image', 'สื่อรายเพจ', '', false],
  ];
  return '<div class="tabs ca-tabs" role="tablist" aria-label="มุมมองของหน้าโฆษณา & คอนเทนต์">' +
    tabs.map(function (t) {
      const on = caTab === t[0];
      return '<button type="button" class="tab" role="tab" id="ca-tab-' + t[0] + '" data-catab="' + t[0] + '"' +
        ' aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="ca-panel" tabindex="' + (on ? '0' : '-1') + '">' +
        icon(t[1], { size: 16 }) + esc(t[2]) +
        (t[3] ? '<span class="ca-tab-n' + (t[4] ? ' ca-n-opt' : '') + '">' + t[3] + '</span>' : '') + '</button>';
    }).join('') +
  '</div>';
}

/** ชิปช่วงเวลา (วันนี้ / 7 / 30 / 90 วัน) — ใช้กับแท็บแจ้งเตือนและอันดับแอด (สื่อรายเพจดูทั้งปีเสมอ) */
function rangeChipsHtml(): string {
  return '<div class="tb-range" role="group" aria-label="ช่วงเวลา">' +
    RANGE_OPTIONS.map(function (o) {
      return '<button type="button" class="filter-btn' + (rangeDays === o.d ? ' active' : '') +
        '" data-cadays="' + o.d + '">' + o.label + '</button>';
    }).join('') + '</div>';
}

/** บรรทัด "ตัวเลขของช่วงไหน" ใต้แถวเครื่องมือ (C4) + คำอธิบายที่มาของตัวเลขในปุ่ม ⓘ (เดิมเป็นกล่องข้อความยาว 2 บรรทัด) */
function asofHtml(): string {
  return '<div class="data-asof">' +
    (rangeDays === 1 ? 'ตัวเลขของวันนี้' : 'ตัวเลขของ ' + rangeDays + ' วันล่าสุด') +
    ' · นับเต็มวันตามปฏิทินไทย เหมือนหน้ายอดขาย' +
    infoTip('ยอดขาย / ซื้อ / ROAS / %ปิด (ซื้อ ÷ ทัก) = ตัวเลขจาก Meta Ads โดยตรง ตรงกับหน้า Meta • ' +
      'ยอดขายจริง = ออเดอร์ในระบบที่ผูกกับแอดนั้น ไว้เทียบ • ' +
      'แถวออร์แกนิก = ยอดจากโพสต์ที่ไม่ได้ยิงแอด (แสดง 50 โพสต์ยอดสูงสุด)', 'ที่มาของตัวเลข') +
  '</div>';
}

function selectHtml_(id: string, aria: string, allLabel: string, values: string[], cur: string, attr?: string): string {
  return '<select class="input" id="' + id + '" aria-label="' + esc(aria) + '"' + (attr || '') + '>' +
    '<option value="">' + esc(allLabel) + '</option>' +
    values.map(function (v) {
      return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('') + '</select>';
}

function statusSelectHtml_(id: string): string {
  return '<select class="input" id="' + id + '" aria-label="สถานะแอด">' + STATUS_OPTIONS.map(function (o) {
    return '<option value="' + o.key + '"' + (filter.status === o.key ? ' selected' : '') + '>' + esc(o.label) + '</option>';
  }).join('') + '</select>';
}

/**
 * แถวเครื่องมือของแท็บอันดับแอด: ช่วงเวลา → ค้นหา + ตัวกรอง 4 ช่อง → ดาวน์โหลด (C4)
 * มือถือ (<600): ตัวกรอง 4 ช่องยุบเป็นปุ่มเดียว "ตัวกรอง (N)" เปิดแผ่นเลือกจากด้านล่าง (F1)
 * — เดิม 4 ช่องเลือก + ช่องค้นหา + 2 ปุ่มส่งออก กินครึ่งจอแรกของมือถือ
 */
function adsToolbarHtml(items: any[]): string {
  const n = activeFilterCount_();
  let h = '<div class="toolbar ca-toolbar">' + rangeChipsHtml();
  h += '<div class="tb-filters ca-filters">';
  // ช่องค้นหา: แว่นขยายวาดใน .search-box (placeholder ใส่รูปไม่ได้)
  h += '<div class="search-box ca-search">' + icon(ICON_FOR.search) +
    '<input class="input" id="ca-q" type="search" aria-label="ค้นหาแอด" ' +
    'placeholder="ค้นหาชื่อแอด / แคมเปญ / บัญชีแอด..." value="' + esc(filter.q) + '"></div>';
  h += '<button type="button" class="btn ca-filter-open' + (n ? ' has-filter' : '') + '" id="ca-filter-open" aria-haspopup="dialog">' +
    icon(ICON_FOR.filter, { size: 16 }) + 'ตัวกรอง' + (n ? ' (' + n + ')' : '') + '</button>';
  h += '<div class="ca-sel-inline">' +
    statusSelectHtml_('ca-status') +
    selectHtml_('ca-account', 'บัญชีแอด', 'ทุกบัญชีแอด', uniqueAccounts(items), filter.account) +
    selectHtml_('ca-page', 'เพจ', 'ทุกเพจ', uniquePages(items), filter.page) +
    selectHtml_('ca-product', 'สินค้า (จากออเดอร์ที่ผูกแอด 30 อันดับแรก)', 'ทุกสินค้า', uniqueProducts(items), filter.product,
      ' title="สินค้าจากออเดอร์ที่ผูกแอด (30 อันดับแรก)"') +
  '</div>';
  h += '</div>';
  h += '<div class="tb-actions">' + downloadMenuHtml('ca-dl', { excel: true }) + '</div>';
  h += '</div>';
  return h;
}

/* ---------------- render: แท็บแจ้งเตือน ---------------- */

const LEVEL_WORD: Record<string, string> = { red: 'ด่วนมาก', orange: 'ควรปรับ', yellow: 'เฝ้าดู', green: 'ควรเพิ่มงบ' };
const LEVEL_KIND: Record<string, StatusKind> = { red: 'bad', orange: 'warn', yellow: 'warn', green: 'good' };

/**
 * ไอคอนของ alert — server (lib/api/contentads.ts) ยังส่งอีโมจิมาใน a.icon จึงไม่ใช้ค่านั้นแล้ว
 * เลือกจากชนิดท้าย id แทน ('AL-<adId>-roas' | -cpo | -zero | -close | -scale | -stop) ชนิดที่ไม่รู้จัก = กระดิ่ง
 */
const ALERT_ICONS: Record<string, string> = {
  roas: ICON_FOR.trendDown, cpo: 'coins', zero: 'package-x', close: ICON_FOR.chats,
  scale: ICON_FOR.trendUp, stop: 'octagon-alert',
};

/** แถวแจ้งเตือน — ระดับบอกด้วยแถบสีซ้าย + ไอคอน + จุดสีหน้าคำ (B3: เลิกป้ายพื้นแดง "ด่วนมาก" ซ้ำ 30 แถว) */
function alertRowHtml(a: any): string {
  const lv = String(a.level || 'yellow');
  const reason = String(a.reason || '') + (a.nums ? ' • ' + String(a.nums) : '');
  const kind = String(a.id || '').split('-').pop() || '';
  return '<div class="alert-row lv-' + esc(lv) + '">' +
    '<div class="alert-icon">' + icon(ALERT_ICONS[kind] || 'bell', { size: 20 }) + '</div>' +
    '<div class="alert-body">' +
    '<div class="alert-title">' + esc(a.title || '') +
      '<span class="ca-lv">' + statusDot(LEVEL_KIND[lv] || 'muted') + esc(LEVEL_WORD[lv] || 'เฝ้าดู') + '</span></div>' +
    '<div class="alert-reason">' + esc(reason) + '</div>' +
    (a.recommend ? '<div class="alert-recommend">แนะนำ: ' + esc(a.recommend) + '</div>' : '') +
    '</div>' +
    '<div class="ca-alert-act">' +
    '<button type="button" class="btn-text" data-ca-view="' + esc(a.adId) + '">ดูรายละเอียด' + icon(ICON_FOR.next, { size: 14 }) + '</button>' +
    '</div></div>';
}

function alertsPanelHtml(data: any): string {
  const s = (data && data.summary) || {};
  const alerts = (data && data.alerts) || [];
  const total = num(s.urgent) + num(s.adjust) + num(s.scale);
  // หัวข้อสรุปสีปกติเสมอ (B3): ระดับที่มีมากกว่าครึ่งไม่ใช่ "เรื่องด่วนไม่กี่เรื่อง" — ทาแดงทั้งหัวข้อตาชินจนไม่เห็นอะไร
  // จุดสีเล็กหน้าตัวเลขพอบอกว่าเป็นระดับไหน
  let h = '<div class="card ca-alerts">';
  h += '<div class="card-head"><h3 class="card-title">แจ้งเตือน ' + fmtNum(total) + ' เรื่อง</h3>' +
    '<div class="ca-sum">' +
      '<span>' + statusDot('bad') + 'ด่วนมาก <b>' + fmtNum(num(s.urgent)) + '</b></span>' +
      '<span>' + statusDot('warn') + 'ควรปรับ <b>' + fmtNum(num(s.adjust)) + '</b></span>' +
      '<span>' + statusDot('good') + 'ควรเพิ่มงบ <b>' + fmtNum(num(s.scale)) + '</b></span>' +
    '</div></div>';
  if (!alerts.length) {
    h += stateHtml('nodata', { title: 'ไม่มีเรื่องต้องแจ้งเตือนตอนนี้', body: '' });
  } else {
    const shown = alertShowAll ? alerts : alerts.slice(0, 5);
    // เซิร์ฟเวอร์ส่งมาแค่ 30 เรื่องแรก (ด่วนสุดก่อน) จากทั้งหมด N เรื่อง — บอกตรงๆ ว่าที่เหลือไปดูที่ไหน
    // (เดิม "แสดง 5 จาก 30 เรื่องแรก" ใต้หัวข้อ "1,114 เรื่อง" อ่านแล้วงงว่าอีกพันเรื่องหายไปไหน)
    h += '<div class="card-sub">เรียงจากด่วนที่สุด • แสดง ' + fmtNum(shown.length) + ' เรื่องแรก' +
      (total > alerts.length
        ? ' — หน้านี้เปิดดูได้ ' + fmtNum(alerts.length) + ' เรื่อง ที่เหลือดูได้ในแท็บ "อันดับแอด" (เลือก "น่าเป็นห่วง")'
        : '') + '</div>';
    h += '<div class="alert-list">' + shown.map(alertRowHtml).join('') + '</div>';
    if (alerts.length > 5) {
      h += '<div class="ca-more"><button type="button" class="btn-text" id="ca-alert-toggle" aria-expanded="' +
        (alertShowAll ? 'true' : 'false') + '">' +
        (alertShowAll ? icon(ICON_FOR.collapse, { size: 16 }) + 'ย่อเหลือ 5 เรื่อง'
          : icon(ICON_FOR.expand, { size: 16 }) + 'ดูเพิ่ม (อีก ' + fmtNum(alerts.length - 5) + ' เรื่อง)') +
        '</button></div>';
    }
  }
  h += '</div>';
  return h;
}

/* ---------------- render: แท็บอันดับแอด (ตาราง) ---------------- */

/** สี ROAS ของแอด: ต่ำกว่า 1.5 = แดง · 3 ขึ้นไป = เขียว (เกณฑ์เดียวกับสถานะแอดของเซิร์ฟเวอร์) · ช่วงกลาง = ไม่มีสี */
function adRoasKind_(roas: number | null): ColorKind {
  return roas === null ? 'none' : roas < 1.5 ? 'bad' : roas >= 3 ? 'good' : 'none';
}

/** ช่องตัวเลข: data-sort = ค่าดิบ (ว่าง = ไม่มีข้อมูล เรียงไว้ท้ายเสมอ) · data-label = ป้ายบนมือถือ (แถวเป็นการ์ด) */
function numTd_(label: string, sortVal: number | null, html: string, cls?: string): string {
  return '<td class="num' + (cls ? ' ' + cls : '') + '" data-label="' + esc(label) + '" data-sort="' +
    (sortVal === null ? '' : String(sortVal)) + '">' + html + '</td>';
}

function adRowHtml(it: any, rank: number): string {
  const st = it.status || { label: '-', cls: 'neutral' };
  const isOrganic = !!it.organicPost;
  const roas = nullable(it.roas);
  const cpo = nullable(it.costPerOrder);
  const name = String(it.name || ('แอด ' + it.adId));
  // ยอดขายจริงจากออเดอร์ในระบบ (เทียบกับที่ Meta ตี) — บรรทัดเล็กใต้ตัวเลข Meta เหมือนการ์ดเดิม
  const posRev = num(it.revenuePos);
  const posSub = (!isOrganic && posRev > 0 && posRev !== num(it.revenue))
    ? '<span class="ca-sub2">จริง ' + esc(THB(posRev)) + '</span>' : '';
  const orgDash = dash();

  let h = '<tr>';
  h += '<td class="ca-c-rk"><span class="sort-rank">' + rank + '</span></td>';
  h += '<td class="ca-c-ad" data-sort="' + esc(name) + '"><div class="ca-ad">';
  // รูปครีเอทีฟย่อ — ทีมแอดจำแอดจาก "ภาพ" ไม่ใช่ชื่อแอดที่ตั้งว่า VP4/A1
  if (hasCreatives) h += mediaBoxHtml_(it, 'ca-thumb', isOrganic ? '' : String(it.adId));
  h += '<div class="ca-ad-txt">' +
    '<div class="ca-ad-name"><span class="sort-rank ca-rk-m">' + rank + '</span>' + esc(name) + '</div>' +
    '<div class="ca-ad-meta">' + statusBadge_(st) +
      (it.pageName ? '<span class="ca-ad-page" title="' + esc(it.pageName) + '">' + esc(it.pageName) + '</span>' : '') +
    '</div></div></div></td>';

  h += numTd_('ยอดขาย' + (isOrganic ? '' : ' (Meta)'), num(it.revenue),
    '<span class="v-plain" title="' + esc(isOrganic ? 'ยอดขายจากออเดอร์ที่ผูกโพสต์นี้'
      : 'ยอดขายที่ Meta ตี (ตรงหน้า Meta) • ยอดจริงในระบบ = ' + THB(posRev)) + '">' +
    esc(THB(num(it.revenue))) + '</span>' + posSub);
  h += numTd_('ค่าแอด', num(it.spend) > 0 ? num(it.spend) : null,
    num(it.spend) > 0 ? esc(THB(it.spend)) : orgDash);
  h += numTd_('ROAS', roas, roas === null ? orgDash
    : '<span class="' + (kindClass(adRoasKind_(roas)) || '') + '">' + esc(roasFmt(roas)) + '</span>');
  h += numTd_('ต้นทุน/ซื้อ', cpo, cpo === null ? orgDash
    : '<span class="' + (cpo > 400 ? kindClass('bad') : '') + '">' + esc(THB(cpo)) + '</span>');
  h += numTd_(isOrganic ? 'ออเดอร์' : 'ซื้อ (Meta)', num(it.orders),
    '<span title="' + esc('จำนวนซื้อที่ Meta ตี' + (isOrganic ? '' : ' • ออเดอร์จริงในระบบ ' + fmtNum(num(it.ordersPos)))) + '">' +
    fmtNum(num(it.orders)) + '</span>');
  // โพสต์ organic ไม่มี tracking แชท/คลิก — โชว์ "—" (ไม่ใช่ 0 เพราะไม่ได้วัด)
  h += numTd_('ทัก', isOrganic ? null : num(it.msgs), isOrganic ? orgDash : fmtNum(num(it.msgs)));
  // ค่าทัก = ค่าโฆษณา ÷ จำนวนคนทัก (ตรงคอลัมน์ "ต้นทุน/ทัก" ของทีมแอด)
  const noMsg = isOrganic || num(it.msgs) === 0;
  h += numTd_('ค่าทัก', noMsg ? null : num(it.costPerMsg), noMsg ? orgDash : esc(THB(num(it.costPerMsg))));
  h += numTd_('คลิก', isOrganic ? null : num(it.clicks), isOrganic ? orgDash : esc(kFmt(num(it.clicks))));
  // เกิน 100% = Meta ส่งยอดซื้อมาก่อนคนทัก (พบบ่อยระหว่างวัน / แอดที่ปิดการขายจากคลิกเมื่อวาน)
  // โชว์ตัวเลขพันเปอร์เซ็นต์ทำให้ตารางอ่านไม่ได้ — ใส่ "รอข้อมูล" แทน เกณฑ์เดียวกับการ์ดหน้า Sales
  const close = nullable(it.closeRate);
  h += numTd_('%ปิด', close !== null && close <= 100 ? close : null,
    close !== null && close > 100
      ? '<span class="tx-muted ca-wait" title="' + esc('ซื้อ ' + fmtNum(it.orders || 0) + ' มากกว่าคนทัก ' + fmtNum(it.msgs || 0) +
        ' — Meta ส่งยอดซื้อมาก่อนตัวเลขคนทัก (หรือปิดจากคลิกวันก่อน) รอสิ้นวันจะนิ่ง') + '">รอข้อมูล</span>'
      : esc(pct2(close)));

  // ปุ่มเรียบ (C2) — ปุ่มที่ซ้ำทุกแถวไม่ต้องเป็นปุ่มม่วงทึบ 30 ปุ่มแข่งกันเด่น
  h += '<td class="ca-c-act"><button type="button" class="btn-text" data-ca-view="' + esc(it.adId) + '"' +
    ' aria-label="' + esc((isOrganic ? 'ดูรายละเอียด ' : 'วิเคราะห์แอด ') + name) + '">' +
    icon(isOrganic ? ICON_FOR.info : ICON_FOR.analyze, { size: 14 }) + (isOrganic ? 'รายละเอียด' : 'วิเคราะห์') + '</button></td>';
  h += '</tr>';
  return h;
}

function adsPanelHtml(allItems: any[], list: any[], needSetup: boolean): string {
  let body: string;
  if (!allItems.length) {
    // แยก 2 กรณีให้ชัด: ยังไม่ได้เปิดใช้ข้อมูลค่าแอด vs เปิดแล้วแต่ยังไม่มีข้อมูลในช่วงนี้
    body = needSetup
      ? stateHtml('notready', {
          title: 'ยังไม่ได้เปิดใช้ข้อมูลค่าแอด',
          adminDetail: 'รัน db/migrations/2026-07-23-ad-daily.sql ใน Supabase แล้วรอรอบดึงข้อมูลถัดไป (ทุก 15 นาที)',
        })
      : stateHtml('nodata', {
          body: 'ลองเลือกช่วงที่ยาวขึ้น หรือรอข้อมูลรอบถัดไป',
          actionsHtml: rangeDays < 30 ? '<button type="button" class="btn" data-cadays="30">ดู 30 วัน</button>' : '',
        });
    return '<div class="card">' + body + '</div>';
  }
  if (!list.length) {
    return '<div class="card">' + stateHtml('nodata', {
      title: 'ไม่พบแอดตามตัวกรอง', body: 'ลองล้างตัวกรองหรือค้นหาด้วยคำอื่น',
      actionsHtml: '<button type="button" class="btn" id="ca-clear-empty">ล้างตัวกรอง</button>',
    }) + '</div>';
  }
  const top = list.slice(0, TOP_N);
  const rankSel = '<label class="ca-rank-pick"><span class="t-label">' + TOP_N + ' อันดับแรกตาม</span>' +
    '<select class="input" id="ca-rank" aria-label="เลือก ' + TOP_N + ' อันดับแรกตาม">' +
    RANK_MODES.map(function (m) {
      return '<option value="' + m.key + '"' + (filter.rank === m.key ? ' selected' : '') + '>' + esc(m.label) + '</option>';
    }).join('') + '</select></label>';

  let h = '<div class="card ca-ads">';
  h += '<div class="card-head"><h3 class="card-title">อันดับแอด' +
    '<span class="ca-count">' + fmtNum(top.length) + (list.length > top.length ? ' จาก ' + fmtNum(list.length) : '') + ' แอด</span></h3>' +
    '<div class="card-actions">' + rankSel + '</div></div>';
  h += legendHtml('สี: ROAS เขียว = 3 ขึ้นไป • ROAS แดง = ต่ำกว่า 1.5 • ต้นทุน/ซื้อ แดง = เกิน ฿400 • กดหัวคอลัมน์เพื่อเรียงใหม่');
  // data-cards="off" = บอก app-core ว่าไม่ต้องแปลงตารางนี้ (มือถือ/แท็บเล็ต จัดเป็นการ์ดเองใน pw-dashca.css)
  h += '<div class="table-scroll ca-tbl-wrap"><table class="tbl ca-tbl" data-cards="off"><thead><tr>' +
    '<th class="ca-c-rk">#</th>' +
    sortTh('แอด', 'name', { cls: 'ca-c-ad' }) +
    sortTh('ยอดขาย', 'rev', { num: true, tip: 'ยอดขายที่ Meta ตี (ตรงหน้า Meta) — บรรทัดเล็ก "จริง" = ยอดจากออเดอร์ในระบบ' }) +
    sortTh('ค่าแอด', 'spend', { num: true }) +
    sortTh('ROAS', 'roas', { num: true, tip: 'ยอดขาย Meta ÷ ค่าแอด (เหมือนหน้า Meta)' }) +
    sortTh('ต้นทุน/ซื้อ', 'cpo', { num: true, dir: 'asc', tip: 'ค่าแอด ÷ จำนวนซื้อ (แบบ Meta)' }) +
    sortTh('ซื้อ', 'orders', { num: true, tip: 'จำนวน "ซื้อ" ที่ Meta ตี' }) +
    sortTh('ทัก', 'msgs', { num: true }) +
    sortTh('ค่าทัก', 'cpm', { num: true, dir: 'asc', tip: 'ค่าแอด ÷ จำนวนคนทัก' }) +
    sortTh('คลิก', 'clicks', { num: true }) +
    sortTh('%ปิด', 'close', { num: true, tip: 'ซื้อ ÷ ทัก (แบบ Meta)' }) +
    '<th class="ca-c-act"><span class="ca-vh">คำสั่ง</span></th>' +
  '</tr></thead><tbody>' +
    top.map(function (it, i) { return adRowHtml(it, i + 1); }).join('') +
  '</tbody></table></div>';
  if (list.length > TOP_N) {
    h += '<div class="ca-foot">แสดง ' + TOP_N + ' อันดับแรกจากทั้งหมด ' + fmtNum(list.length) +
      ' แอด — กด "ดาวน์โหลด" เพื่อดูทั้งหมด</div>';
  }
  h += '</div>';
  return h;
}

/* ---------------- สื่อรายเพจทั้งปี (บรีฟ 2026-07-31) ----------------
 * เลือกเพจ → รวมแอดเป็นราย "สื่อ" (โพสต์เดียวกัน = สื่อเดียวกัน) เทียบค่าแอดรายเดือนทั้งปี
 * fetch แยกจากข้อมูลหลักของหน้า (ช่วงวันด้านบนไม่เกี่ยว — อันนี้ดูทั้งปีเสมอ)
 * โหลดเฉพาะตอนเปิดแท็บนี้ครั้งแรก — เดิมดึงรายชื่อเพจทุกครั้งที่เปิดหน้า แม้ไม่มีใครเลื่อนลงไปดู
 */

let mediaPages: Array<{ id: string; name: string; spend60d: number }> | null = null;
let mediaData: any = null;
let mediaPageId = '';
let mediaReq = 0;
let mediaPagesLoading = false;

function mediaSectionHtml(): string {
  const pick = mediaPages
    ? '<select class="input ca-media-pick" id="ca-media-page" aria-label="เลือกเพจ">' +
        '<option value="">เลือกเพจ (' + mediaPages.length + ' เพจที่มีค่าแอดใน 60 วัน)</option>' +
        mediaPages.map(function (pg) {
          return '<option value="' + esc(pg.id) + '"' + (pg.id === mediaPageId ? ' selected' : '') + '>' +
            esc(pg.name) + ' (' + esc(THBk(pg.spend60d)) + ')</option>';
        }).join('') + '</select>'
    : '<span class="chip">กำลังโหลดรายชื่อเพจ...</span>';
  let h = '<div class="card-head"><h3 class="card-title">สื่อรายเพจ — เทียบทั้งปี' +
      infoTip('ไม่ขึ้นกับช่วงวันที่ของแท็บอื่น — ดูทั้งปีเสมอ • สื่อเดียวกันหลายแอดรวมเป็นแถวเดียว • ' +
        'ไอคอนกล้อง = วิดีโอ • เงินย่อ K = พัน M = ล้าน', 'สื่อรายเพจ') +
    '</h3><div class="card-actions">' + pick + '</div></div>';
  h += '<div class="card-sub">เลือกเพจเพื่อดูว่ายิงสื่อ (โพสต์) ตัวไหนบ้างทั้งปี และค่าแอดรายเดือนของแต่ละสื่อ</div>';
  if (mediaPageId && !mediaData) {
    h += '<div class="loading"><div class="spinner"></div>กำลังรวมสื่อทั้งปีของเพจ...</div>';
  } else if (mediaData && mediaData.items) {
    const year = String(mediaData.year || new Date().getFullYear());
    const months: number[] = [];
    for (let i = 0; i < 12; i++) {
      if (mediaData.items.some(function (x: any) { return x.byMonth[i] > 0; })) months.push(i);
    }
    if (!mediaData.items.length) {
      return h + stateHtml('nodata', { title: 'เพจนี้ยังไม่มีค่าแอดในปีนี้', body: 'ลองเลือกเพจอื่น' });
    }
    const rows = mediaData.items.map(function (x: any, idx: number) {
      // รูปย่อใช้กล่องเดียวกับตารางแอด — URL รูปจาก Meta หมดอายุบ่อย กล่องนี้มีไอคอนแทนรูปแตก
      // (เดิมเป็น <img> เปล่า รูปหมดอายุแล้วขึ้นไอคอนรูปแตกของเบราว์เซอร์ทุกแถว)
      const img = mediaBoxHtml_({ media: { img: x.thumb, video: false } }, 'ca-thumb ca-mthumb');
      const link = safeUrl_(x.permalink);
      const fullTitle = String(x.title || '');
      // ชื่อยาวตัดที่ 3 บรรทัดด้วย CSS — ชื่อเต็มอยู่ใน title (ชี้เมาส์ดู) และเปิดโพสต์จริงได้จากลิงก์
      const title = (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener" title="' + esc(fullTitle) + '">' : '') +
        (x.isVideo ? icon('video', { size: 14, label: 'วิดีโอ' }) + ' ' : '') + esc(fullTitle.slice(0, 60)) +
        (link ? '</a>' : '');
      // ช่องแรก = ลำดับ + รูป + ชื่อสื่อ รวมเป็นช่องเดียว — ช่องที่ตรึงไว้ตอนเลื่อนแนวนอนบนมือถือจึงเป็นตัวสื่อเอง
      // (เดิมแยกช่อง "#" ไว้หน้า ช่องชื่อที่ตรึงเป็นช่องที่ 2 ถูกบีบเหลือรูปกับชื่อ 2-3 ตัวอักษร)
      return '<tr>' +
        '<td class="ca-mcell" data-sort="' + esc(String(x.title)) + '"><div class="ca-mblock">' +
          '<span class="sort-rank ca-mrank">' + (idx + 1) + '</span>' + img +
          '<div class="ca-mtxt"><div class="ca-mtitle">' + title + '</div>' +
          '<div class="ca-mmeta">' + fmtNum(x.ads) + ' แอด • ล่าสุด ' + esc(dateTh(x.lastDate)) +
            (x.running ? ' • ' + statusPill('good', 'ยิงอยู่') : '') + '</div></div></div></td>' +
        months.map(function (i) {
          const v = x.byMonth[i];
          return '<td class="num" data-sort="' + (v || '') + '">' + (v ? esc(THBk(v)) : dash()) + '</td>';
        }).join('') +
        '<td class="num" data-sort="' + x.spend + '"><b class="v-plain">' + esc(THB(x.spend)) + '</b></td>' +
        '<td class="num" data-sort="' + (x.costPerMsg === null ? '' : x.costPerMsg) + '">' +
          (x.costPerMsg === null ? dash() : esc(THB(x.costPerMsg))) + '</td>' +
        '<td class="num" data-sort="' + (x.roasMeta === null ? '' : x.roasMeta) + '">' +
          (x.roasMeta === null ? dash() : esc(roasFmt(x.roasMeta))) + '</td>' +
      '</tr>';
    }).join('');
    h +=
      (mediaData.truncated ? '<div class="hint-box">แสดง ' + fmtNum(mediaData.items.length) + ' สื่อแรกตามค่าแอด — ตัดท้ายอีก ' +
        fmtNum(mediaData.truncated) + ' สื่อ (ค่าแอดน้อย)</div>' : '') +
      // data-pin2="off": ช่องแรกเป็นก้อนสื่อ (รูป + ชื่อ + บรรทัดรอง) ห้ามให้ตัวช่วยกลางไปตรึงช่องที่ 2 (เดือนแรก) เพิ่ม
      '<div class="table-scroll"><table class="tbl ca-media-tbl" data-pin2="off"><thead><tr>' +
        sortTh('สื่อ (โพสต์)', 'title') +
        months.map(function (i) {
          return sortTh(esc(monthTh(year + '-' + String(i + 1).padStart(2, '0'))), 'm' + i, { num: true });
        }).join('') +
        sortTh('ค่าแอดรวมปี', 'spend', { num: true }) +
        sortTh('ค่าทัก', 'cpm', { num: true, dir: 'asc' }) +
        sortTh('ROAS (Meta)', 'roas', { num: true }) +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  } else {
    h += stateHtml('nodata', { title: 'ยังไม่ได้เลือกเพจ', body: 'เลือกเพจจากช่องด้านบนขวาของการ์ดนี้' });
  }
  return h;
}

/** วาดการ์ดสื่อรายเพจใหม่ (เฉพาะตอนแท็บนี้เปิดอยู่) */
function redrawMedia_(container: HTMLElement): void {
  const box = container.querySelector<HTMLElement>('#ca-media');
  if (!box) return;
  box.innerHTML = mediaSectionHtml();
  bindMedia(container);
}

function fetchMediaPages(container: HTMLElement): void {
  if (mediaPagesLoading) return;
  mediaPagesLoading = true;
  serverCall<any>('apiPageMedia', {}).then(function (res) {
    mediaPages = (res && res.pages) || [];
    mediaPagesLoading = false;
    redrawMedia_(container);
  }).catch(function () {
    mediaPagesLoading = false;
    const box = container.querySelector<HTMLElement>('#ca-media');
    if (box) {
      box.innerHTML = stateHtml('error', {
        actionsHtml: '<button type="button" class="btn" id="ca-media-retry">' + icon('refresh-cw', { size: 16 }) + 'ลองใหม่</button>',
      });
      const b = box.querySelector('#ca-media-retry');
      if (b) b.addEventListener('click', function () { box.innerHTML = mediaSectionHtml(); fetchMediaPages(container); });
    }
  });
}

function fetchMedia(container: HTMLElement): void {
  const seq = ++mediaReq;
  serverCall<any>('apiPageMedia', { pageId: mediaPageId }).then(function (res) {
    if (seq !== mediaReq) return;
    mediaData = res;
    redrawMedia_(container);
  }).catch(function () {
    if (seq !== mediaReq) return;
    toast('โหลดสื่อของเพจไม่สำเร็จ', 'error', { action: { label: 'ลองใหม่', fn: function () { fetchMedia(container); } } });
  });
}

function bindMedia(container: HTMLElement): void {
  const sel = container.querySelector('#ca-media-page') as HTMLSelectElement | null;
  if (sel) sel.addEventListener('change', function () {
    mediaPageId = sel.value;
    mediaData = null;
    redrawMedia_(container);
    if (mediaPageId) fetchMedia(container);
  });
  const box = container.querySelector<HTMLElement>('#ca-media');
  if (box) {
    makeSortable(box, 'table.ca-media-tbl', { id: 'ca-media' });
    bindImgFallback_(box);
  }
}

/* ---------------- แผ่นตัวกรอง (มือถือ — F1) ---------------- */

/** แผ่นเลือกจากด้านล่าง: ตัวกรอง 4 ช่องเดียวกับจอคอม — เปลี่ยนแล้วมีผลทันที (ปิดแผ่นทางไหนก็ไม่เสียค่าที่เลือก) */
function openFilterSheet(container: HTMLElement): void {
  const data = lastData || {};
  const items = data.items || [];
  const field = function (lbl: string, sel: string): string {
    return '<label class="ca-fld"><span class="t-label">' + esc(lbl) + '</span>' + sel + '</label>';
  };
  const doneLabel = function (): string {
    return 'ดูผล ' + fmtNum(filteredItems(lastData || data).length) + ' แอด';
  };
  const html = '<div class="modal-head"><h3>ตัวกรอง</h3>' + modalCloseBtn() + '</div>' +
    '<div class="ca-fsheet">' +
      field('สถานะ', statusSelectHtml_('ca-fs-status')) +
      field('บัญชีแอด', selectHtml_('ca-fs-account', 'บัญชีแอด', 'ทุกบัญชีแอด', uniqueAccounts(items), filter.account)) +
      field('เพจ', selectHtml_('ca-fs-page', 'เพจ', 'ทุกเพจ', uniquePages(items), filter.page)) +
      field('สินค้า (30 อันดับแรก)', selectHtml_('ca-fs-product', 'สินค้า', 'ทุกสินค้า', uniqueProducts(items), filter.product)) +
    '</div>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn" id="ca-fs-clear">ล้างตัวกรอง</button>' +
      '<button type="button" class="btn primary" id="ca-fs-done" data-autofocus>' + esc(doneLabel()) + '</button>' +
    '</div>';
  openModal(html, { cls: 'modal-ca-filter' });
  const root = document.getElementById('modal-root');
  if (!root) return;
  const done = root.querySelector<HTMLElement>('#ca-fs-done');
  const apply = function (): void {
    render(container, lastData || data);          // หน้าข้างหลังอัปเดตทันที (ตาราง + ป้ายจำนวนบนปุ่มตัวกรอง)
    if (done) done.textContent = doneLabel();
  };
  const wire = function (id: string, key: 'status' | 'account' | 'page' | 'product'): void {
    const el = root.querySelector('#' + id) as HTMLSelectElement | null;
    if (el) el.addEventListener('change', function () { filter[key] = el.value; apply(); });
  };
  wire('ca-fs-status', 'status');
  wire('ca-fs-account', 'account');
  wire('ca-fs-page', 'page');
  wire('ca-fs-product', 'product');
  const clear = root.querySelector('#ca-fs-clear');
  if (clear) clear.addEventListener('click', function () {
    filter.status = ''; filter.account = ''; filter.page = ''; filter.product = '';
    root.querySelectorAll('.ca-fsheet select').forEach(function (s) { (s as HTMLSelectElement).value = ''; });
    apply();
  });
  if (done) done.addEventListener('click', closeModal);
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
    html += noticeHtml_('warn', String(data.adDaysWarning), data.adDaysFix ? String(data.adDaysFix) : undefined);
  }
  // แถวออร์แกนิกดึงไม่สำเร็จรอบนี้ (server ไม่ล้มทั้งหน้าแล้ว) — บอกตรงๆ ไม่ใช่ให้แถวหายเงียบ
  if (data && data.organicError) {
    html += noticeHtml_('warn', 'แถวออร์แกนิก (โพสต์ที่ไม่ได้ยิงแอด) โหลดไม่สำเร็จรอบนี้ — ตัวเลขของแอดใช้ได้ตามปกติ กดรีเฟรชเพื่อลองใหม่');
  }
  // มีแอดแต่ไม่มีสื่อสักตัว = ยังไม่ได้เปิดใช้ตาราง ad_creative (บอกให้ชัด ไม่ใช่ปล่อยกล่องรูปว่าง)
  if (data && !data.needAdSetup && items.length && !num(data.creativeCount)) {
    html += noticeHtml_('info', 'ยังไม่มีรูปครีเอทีฟของแอด — ตัวเลขใช้ได้ตามปกติ กรุณาแจ้งผู้ดูแลระบบ',
      'รัน db/migrations/2026-07-27-ad-creative.sql ใน Supabase แล้วสั่ง npm run backfill:ad-creatives ' +
      '(หลังจากนั้นเติมเองอัตโนมัติทุกชั่วโมง)');
  }
  html += tabsHtml(data);
  html += '<div class="ca-panel" id="ca-panel" role="tabpanel" aria-labelledby="ca-tab-' + caTab + '">';
  if (caTab === 'alerts') {
    html += '<div class="toolbar">' + rangeChipsHtml() + '</div>' + asofHtml();
    html += alertsPanelHtml(data);
  } else if (caTab === 'ads') {
    html += adsToolbarHtml(items) + asofHtml();
    html += adsPanelHtml(items, list, !!(data && data.needAdSetup));
  } else {
    // สื่อรายเพจ — ใช้แคชโมดูล (ไม่ refetch ตอน re-render จาก filter ฝั่ง client)
    html += '<div class="card ca-media-card" id="ca-media">' + mediaSectionHtml() + '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
  caContainer = container;
  bind(container, data);
  // รูปย่อในตาราง: ขอเฉพาะ 30 แถวที่เห็นและยังไม่มี (ตัวกรอง/อันดับเปลี่ยน = ชุดใหม่ ขอเฉพาะตัวที่ขาด)
  if (caTab === 'ads' && hasCreatives) {
    ensureMedia_(list.slice(0, TOP_N)
      .filter(function (it: any) { return !it.organicPost && !it.media; })
      .map(function (it: any) { return String(it.adId); }));
  }
  if (caTab === 'media') {
    bindMedia(container);
    if (!mediaPages) fetchMediaPages(container);
  }
}

function bind(container: HTMLElement, data: any): void {
  function current() { return lastData || data; }
  function rerender() { render(container, current()); }

  // แท็บ: คลิก + ลูกศรซ้าย/ขวาเลื่อนแท็บ (รูปแบบแท็บมาตรฐานของโปรแกรมอ่านหน้าจอ)
  const tabs = Array.from(container.querySelectorAll<HTMLElement>('[data-catab]'));
  tabs.forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      const t = btn.getAttribute('data-catab') as CaTab;
      if (t === caTab) return;
      setTab_(t);
      rerender();
      const again = container.querySelector<HTMLElement>('[data-catab="' + t + '"]');
      if (again) again.focus({ preventScroll: true });
    });
    btn.addEventListener('keydown', function (e: KeyboardEvent) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (next) next.click();
    });
  });

  const q = container.querySelector('#ca-q') as HTMLInputElement | null;
  if (q) {
    q.addEventListener('change', function () {
      if (q.value.trim() !== filter.q) { filter.q = q.value.trim(); rerender(); }
    });
    q.addEventListener('keydown', function (e: KeyboardEvent) {
      if (e.key === 'Enter') { filter.q = q.value.trim(); rerender(); }
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
  const fo = container.querySelector('#ca-filter-open');
  if (fo) fo.addEventListener('click', function () { openFilterSheet(container); });
  const clr = container.querySelector('#ca-clear-empty');
  if (clr) clr.addEventListener('click', function () {
    filter.q = ''; filter.status = ''; filter.account = ''; filter.page = ''; filter.product = '';
    rerender();
  });

  container.querySelectorAll('[data-cadays]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const d = Number(btn.getAttribute('data-cadays')) || 7;
      if (d === rangeDays) return;
      rangeDays = d;
      container.innerHTML = contentadsSkel(); // ต้องดึงใหม่จาก server — กรองฝั่ง client ไม่ได้
      fetchFresh(container, false);
    });
  });

  const rk = container.querySelector('#ca-rank') as HTMLSelectElement | null;
  if (rk) rk.addEventListener('change', function () { filter.rank = rk.value; rerender(); });

  const tog = container.querySelector('#ca-alert-toggle');
  if (tog) tog.addEventListener('click', function () {
    alertShowAll = !alertShowAll;
    rerender();
    const again = container.querySelector<HTMLElement>('#ca-alert-toggle');
    if (again) again.focus({ preventScroll: true });
  });

  bindDownloadMenu(container, 'ca-dl', {
    csv: function () { exportCSV(current()); },
    xls: function () { exportXLS(current()); },
  });

  container.querySelectorAll('[data-ca-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openAnalysis(current(), btn.getAttribute('data-ca-view'));
    });
  });

  // กดหัวคอลัมน์เรียง 30 แถวที่เห็น — จำการเรียงแยกตาม "30 อันดับแรกตาม…" แต่ละแบบ
  // (เปลี่ยนแบบจัดอันดับแล้วต้องเห็นลำดับของแบบนั้นก่อน ไม่ใช่โดนการเรียงหัวคอลัมน์ของแบบเก่าทับ)
  makeSortable(container, 'table.ca-tbl', { id: 'ca-ads-' + filter.rank });

  bindImgFallback_(container);
}

/* ---------------- fetch + register ---------------- */

function fetchFresh(container: HTMLElement, background: boolean): void {
  // รีเฟรชเบื้องหลัง (ทุก 5 นาที / กลับเข้าหน้านี้) ระหว่างที่คำขอช่วงเดียวกันยังวิ่งอยู่ = ข้าม — เดิมยิงซ้อน กินคิวฐานข้อมูลเป็นเท่าตัว
  if (background && fetchDays === rangeDays) return;
  const seq = ++fetchSeq;
  fetchDays = rangeDays;
  serverCall('apiContentAds', { days: rangeDays }).then(function (data) {
    // มีคำขอใหม่กว่าแล้ว (กดเปลี่ยนช่วงวันรัวๆ) — ผลที่มาช้าห้ามทับ (เดิมป้าย "7 วัน" ขึ้นทับตัวเลข 30 วันได้)
    if (seq !== fetchSeq) return;
    fetchDays = 0;
    lastData = data || {};
    seedMedia_(lastData);
    render(container, lastData);
  }).catch(function (err: any) {
    if (seq !== fetchSeq) return;
    fetchDays = 0;
    if (background) {
      toast('โหลดข้อมูลแอดใหม่ไม่สำเร็จ — แสดงข้อมูลเดิมไปก่อน', 'error', {
        action: { label: 'ลองใหม่', fn: function () { fetchFresh(container, true); } },
      });
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
