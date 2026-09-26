/**
 * ชุดไอคอนกลางของทั้งเว็บ — ใช้แทนอีโมจิ (ตรวจ UI รอบ 2, 26 ก.ย. 69)
 *
 * ทำไมไม่ใช้อีโมจิ: อีโมจิมีสีของตัวเอง (ไม่เข้ากับชุดสีเว็บ ไม่เปลี่ยนตามธีม) หน้าตาต่างกันใน
 * Windows / iPhone / Android และตัวใหม่ๆ ขึ้นเป็นกล่องว่างบนเครื่องรุ่นเก่า
 *
 * ไอคอนลายเส้น = Lucide (ISC License, https://lucide.dev) · โลโก้แบรนด์ = Simple Icons (CC0)
 * ฝังเป็นข้อความในไฟล์นี้เลย ไม่โหลดจากเว็บอื่น — view เป็น HTML string จึงเรียก icon() ได้ทุกที่
 *
 * ⚠️ ไฟล์นี้สร้างด้วยสคริปต์ scripts/dev/gen-icons.mjs (แม่แบบ scripts/dev/icons.template.ts) — อยากได้ไอคอนเพิ่ม
 *    ให้เติมชื่อในรายการของสคริปต์แล้วรันใหม่ อย่าแก้ path ด้วยมือ · รายชื่อทั้งหมดดู ICON_NAMES
 *
 * กติกาใช้งาน
 * - icon('ชื่อ') คืน <svg> สีเดียวกับตัวหนังสือรอบข้าง (stroke = currentColor) เปลี่ยนสีตามธีมเอง
 * - ขนาดมาตรฐาน: ปุ่ม/ข้อความ 14-16 · เมนูซ้าย 18 · กล่องตัวเลขใหญ่ 20-22
 * - ไอคอนที่อยู่ข้างคำ = ตกแต่ง (aria-hidden ให้อยู่แล้ว) · ปุ่มที่มีแต่ไอคอน ต้องใส่ aria-label + title ที่ปุ่มเอง
 * - 1 ความหมาย = 1 ไอคอน — เลือกจากพจนานุกรม ICON_FOR ด้านล่างก่อนเสมอ
 */

const PATHS: Record<string, string> = /*__PATHS__*/{};

const BRANDS: Record<string, { d: string; hex: string; title: string }> = /*__BRANDS__*/{};

export const ICON_NAMES = Object.keys(PATHS);

export interface IconOpts {
  size?: 12 | 14 | 16 | 18 | 20 | 22 | 24 | 28 | 32;
  /** class เพิ่มเติม เช่น 'ic-muted' */
  cls?: string;
  /** ใส่เมื่อไอคอนสื่อความหมายเองโดยไม่มีคำข้างๆ (โปรแกรมอ่านหน้าจอจะอ่านคำนี้) */
  label?: string;
}

const escAttr_ = (s: string) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** ไอคอนลายเส้น — คืน HTML string ของ <svg> · ชื่อที่ไม่มีในชุด = ว่าง (และเตือนใน console ตอน dev) */
export function icon(name: string, opts: IconOpts = {}): string {
  const p = PATHS[name];
  if (!p) {
    if (process.env.NODE_ENV !== 'production') console.warn('[icon] ไม่มีไอคอนชื่อ', name);
    return '';
  }
  const size = opts.size || 16;
  const a11y = opts.label ? 'role="img" aria-label="' + escAttr_(opts.label) + '"' : 'aria-hidden="true"';
  return '<svg class="ic' + (opts.cls ? ' ' + opts.cls : '') + '" viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" ' +
    a11y + '>' + p + '</svg>';
}

/** โลโก้แบรนด์ (Facebook / LINE / ...) สีแบรนด์จริง — ห้ามยืดหรือเปลี่ยนสีตามแนวทางของเจ้าของแบรนด์ */
export function brandIcon(name: string, opts: { size?: number; cls?: string; label?: boolean } = {}): string {
  const b = BRANDS[name];
  if (!b) return '';
  const size = opts.size || 14;
  const a11y = opts.label ? 'role="img" aria-label="' + b.title + '"' : 'aria-hidden="true"';
  return '<svg class="ic brand-ic brand-' + name + (opts.cls ? ' ' + opts.cls : '') + '" viewBox="0 0 24 24" width="' + size +
    '" height="' + size + '" fill="' + b.hex + '" focusable="false" ' + a11y + '><path d="' + b.d + '"/></svg>';
}

/* ---------- ป้ายสถานะ: จุดสี + คำ (แทน 🟢🟡🔴⚪ ✅ ❌ ⚠️ ที่เคยใส่ในป้าย) ----------
 * สีมาจากชุดสีกลางผ่าน class — ห้ามใส่รหัสสีเอง
 * good  = ดี/สำเร็จ/ออนไลน์/ถึงเป้า
 * warn  = เฝ้าระวัง/พัก/ช้ากว่าแผน/รอ
 * bad   = ด่วน/ผิดพลาด/ขาดทุน/ต่ำกว่าแผนมาก/ไม่ว่าง
 * info  = ตามแผน/ข้อมูลทั่วไป
 * muted = ออฟไลน์/ปิดใช้งาน/ไม่มีข้อมูล
 * brand = สีหลักของเว็บ (ม่วง) */
export type StatusKind = 'good' | 'warn' | 'bad' | 'info' | 'muted' | 'brand';

/** ป้ายมีพื้นอ่อน + จุดสีนำหน้า: statusPill('good', 'ถึงเป้าแล้ว') — textHtml ต้อง escape มาแล้ว */
export function statusPill(kind: StatusKind, textHtml: string, extraCls = ''): string {
  return '<span class="st st-' + kind + (extraCls ? ' ' + extraCls : '') + '">' + textHtml + '</span>';
}

/** จุดสีเดี่ยวๆ (ไม่มีพื้น) ไว้หน้าคำในแถวรายการ — ถ้าไม่มีคำข้างๆ ให้ส่ง label */
export function statusDot(kind: StatusKind, label?: string): string {
  return '<span class="st-dot st-' + kind + '"' +
    (label ? ' role="img" aria-label="' + escAttr_(label) + '"' : ' aria-hidden="true"') + '></span>';
}

/** ป้ายอันดับ: วงกลมเลข 1/2/3 สีทอง/เงิน/ทองแดง ที่เหลือสีเทา (แทน 🥇🥈🥉) */
export function rankBadge(n: number, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const k = n === 1 ? 'r1' : n === 2 ? 'r2' : n === 3 ? 'r3' : 'rn';
  return '<span class="rank rank-' + size + ' ' + k + '" role="img" aria-label="อันดับ ' + n + '">' + n + '</span>';
}

/* ---------- ไอคอนนำหน้าตัวเลข (ชิป/กล่องตัวเลข) — มีสีตามหมวด ----------
 * พีขอ 26 ก.ย. 69: สมัยอีโมจิ ชิปตัวเลขทุกอันมีรูปนำหน้า ตัดทิ้งแล้วอ่านยากขึ้น
 * สีตามหมวด (ไม่ใช่สีดี/แย่) ให้ตาจับกลุ่มตัวเลขได้เร็ว: เงิน / ออเดอร์ / ลูกค้า / แอด / แชท / อื่นๆ
 * ชื่อหมวด → สี อยู่ที่ token --cat-* ใน globals.css (มีค่าแยกโหมดสว่าง) */
export type StatCat = 'money' | 'order' | 'cust' | 'ads' | 'chat' | 'misc';

/** ตัวเลขแต่ละเรื่องใช้ไอคอน+หมวดอะไร — ทุกหน้าหยิบจากที่นี่ ตัวเลขเรื่องเดียวกันจะหน้าตาเหมือนกันทั้งเว็บ */
export const STAT = {
  revenue: ['banknote', 'money'], perBill: ['receipt', 'money'], afterAds: ['wallet', 'money'], profit: ['piggy-bank', 'money'],
  bills: ['receipt', 'order'], orders: ['shopping-cart', 'order'], confirmed: ['circle-check', 'order'], qty: ['package', 'order'],
  customers: ['users', 'cust'], repeat: ['repeat', 'cust'], cycle: ['timer', 'cust'], returning: ['history', 'cust'],
  newCustomer: ['user-plus', 'cust'], admin: ['user', 'cust'], crm: ['headset', 'cust'],
  adSpend: ['megaphone', 'ads'], roas: ['trending-up', 'ads'], costPerMsg: ['hand-coins', 'ads'],
  inquiries: ['messages-square', 'chat'], closeRate: ['percent', 'chat'], newInbox: ['inbox', 'chat'], comment: ['message-square', 'chat'],
  pages: ['store', 'misc'], share: ['chart-pie', 'misc'], cancelRate: ['trending-down', 'misc'], date: ['calendar', 'misc'],
  target: ['target', 'misc'], units: ['layers', 'misc'],
} as const satisfies Record<string, readonly [string, StatCat]>;

export type StatKey = keyof typeof STAT;

/** ไอคอนเล็กนำหน้าตัวเลขตามพจนานุกรม STAT เช่น statIcon('revenue') + THB(x) */
export function statIcon(key: StatKey, size: 14 | 16 | 18 | 20 | 22 = 14): string {
  const [name, cat] = STAT[key];
  return icon(name, { size, cls: 'si si-' + cat });
}

/** พจนานุกรม: ความหมาย → ชื่อไอคอน (1 ความหมาย 1 รูป — เลือกจากที่นี่ก่อนเสมอ) */
export const ICON_FOR = {
  // เมนู
  dashboard: 'layout-dashboard', sales: 'chart-column', contentads: 'megaphone', profit: 'wallet', unitperf: 'target',
  report: 'file-chart-column', admins: 'users', adminperf: 'trophy', kpi: 'gauge', umap: 'network', me: 'user-round', users: 'shield',
  // หัวเว็บ/ระบบ
  menu: 'menu', themeLight: 'sun', themeDark: 'moon', refresh: 'refresh-cw', logout: 'log-out',
  // ปุ่ม
  close: 'x', add: 'plus', edit: 'pencil', delete: 'trash-2', save: 'save', settings: 'settings', csv: 'download',
  excel: 'file-spreadsheet', pause: 'pause', play: 'play', resetPassword: 'key-round', search: 'search', filter: 'funnel',
  copy: 'copy', open: 'external-link', expand: 'chevron-down', collapse: 'chevron-up', next: 'chevron-right',
  back: 'chevron-left', analyze: 'sparkles', undo: 'undo-2', target: 'target',
  // ตัวเลข/เรื่อง
  orders: 'receipt', revenue: 'banknote', customers: 'users', newCustomer: 'user-plus', chats: 'messages-square',
  inbox: 'inbox', comment: 'message-square', adSpend: 'megaphone', roas: 'trending-up', closeRate: 'percent',
  product: 'package', cart: 'shopping-cart', time: 'clock', wait: 'hourglass', date: 'calendar', alert: 'triangle-alert',
  error: 'circle-x', ok: 'circle-check', info: 'info', help: 'circle-help', trendUp: 'trending-up', trendDown: 'trending-down',
  repeat: 'repeat', organic: 'sprout', urgent: 'flame', fast: 'zap', leader: 'crown', page: 'store', link: 'link',
  phone: 'phone', autoReply: 'bot',
} as const;
