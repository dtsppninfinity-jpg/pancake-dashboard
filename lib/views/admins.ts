// lib/views/admins.ts — จัดการแอดมิน (Views.admins)
// ข้อมูลจริงจาก apiAdmins() กรอง/เรียงฝั่ง client ทั้งหมด
// อัปเกรดตามต้นแบบ AI-Pancake-Chat-Automation: ระงับบัญชี / สถานะ override /
// modal สิทธิ์-ตั้งค่า / แท็บตำแหน่งงาน & หน้าที่ / ป้ายเพดานแชท / สถิติ + timeline จริง
// การตั้งค่าเก็บจริงใน Supabase (apiAdminSettings) — ไม่มีอะไรถูกส่งไป Pancake
// ฟังก์ชัน pure รันบน browser เท่านั้น — ห้าม import อะไรจากฝั่ง server
//
// ตรวจ UI รอบ 3 (B4): มุมมองหลักเปลี่ยนจาก "การ์ดใหญ่ 90 ใบ" เป็น "แอดมินละแถว" (สลับกลับเป็นการ์ดได้)
// คนที่ทำงานอยู่ขึ้นก่อน กลุ่มออฟไลน์/ระงับอยู่พับเป็นแถวเดียว · คำสั่งต่อคนรวมไว้ในปุ่ม ⋯

import {
  serverCall,
  esc,
  fmtNum,
  THB,
  avatarHtml,
  openModal,
  closeModal,
  toast,
  undoToast,
  withBusy,
  showError,
  downloadCSV,
  downloadMenuHtml,
  bindDownloadMenu,
  relTime,
  infoTip,
  stateHtml,
  modalCloseBtn,
  dash,
  floaterOpened,
  floaterClosed,
} from '@/lib/ui/helpers';
import { adminsSkel } from '@/lib/ui/skeletons';
import {
  ADMIN_ROLES,
  PERM_LABELS,
  effectiveStatus,
  capacityOf,
  RolePerms,
  DEFAULT_MAX_ACTIVE,
} from '@/lib/adminconfig';
import { computeScore, normalizeConfig, type MetricConfig } from '@/lib/scoring';
import { icon, brandIcon, statusPill, statusDot, statIcon, ICON_FOR, type StatusKind } from '@/lib/ui/icons';

/* ---------------- types ---------------- */

interface AdminToday {
  replies?: number;
  chats?: number;
  phones?: number;
  respMins?: number | null;
  respMinMins?: number | null;
  respMaxMins?: number | null;
  orders?: number;
  revenue?: number;
}

interface OnlineToday {
  mins: number;
  gapMins: number | null;
  marks: [number, boolean][];
}

interface Admin {
  id: string | number;
  posId?: string | number;
  name?: string;
  nickname?: string;    // ชื่อเล่นที่ใช้แสดง (พิมพ์ทับ > เดาจากคำแรกของชื่อ)
  nicknameSet?: string; // ค่าที่พิมพ์ทับไว้จริง ('' = ยังใช้ค่าเดา) — ใช้เติมในฟอร์มแก้ไข
  email?: string;
  online?: boolean;
  statusInPage?: string;
  pages?: string;
  pageCount?: number;
  permissions?: string;
  department?: string;
  saleGroup?: string;
  avatar?: string;
  today?: AdminToday;
  waiting?: number;
  waitingComment?: number; // ในแชทรอตอบ เป็นคอมเมนต์ใต้โพสต์กี่รายการ (ที่เหลือ = อินบ็อกซ์)
  overSla?: number;
  active?: number;
  /* ---- ตั้งค่า (admin_settings) ---- */
  enabled?: boolean;
  statusOverride?: string;
  role?: string;
  channels?: string;
  productGroups?: string;
  maxActive?: number;
  maxPending?: number;
  note?: string;
  status?: string; // effective: online|away|busy|offline|disabled
  capacity?: { key: string; label: string; cls: string };
  onlineToday?: OnlineToday | null;
  orderMarks?: [number, number][];
}

interface AdminsKpis {
  total?: number;
  activeTotal?: number;
  online?: number;
  away?: number;
  offline?: number;
  disabled?: number;
  fullCap?: number;
  withSalesToday?: number;
  repliedToday?: number;
  waitingTotal?: number;
  waitingInboxTotal?: number;   // ในแชทรอตอบรวม เป็นอินบ็อกซ์กี่รายการ
  waitingCommentTotal?: number; // ...และคอมเมนต์ใต้โพสต์กี่รายการ
  overSlaTotal?: number;
  phonesToday?: number;
}

interface AdminsData {
  kpis?: AdminsKpis;
  admins?: Admin[];
  rolePerms?: RolePerms;
  setupNeeded?: boolean;
  slaMins?: number;
  chatSyncedAt?: string | null; // เวลาที่ admin_chat_daily ถูก sync ล่าสุด (สแนปช็อต)
}

/** ผลของ apiAdminSettings (บันทึกแอดมิน 1 คน) */
interface SaveRes {
  ok?: boolean;
  error?: string;
  needSetup?: boolean;
  warning?: string;
  warningDetail?: string;
}

/* ---------------- state ---------------- */

let lastData: AdminsData | null = null;
let tab: 'cards' | 'roles' = 'cards';
const filter = { q: '', status: '', role: '', dept: '', channel: '', group: '', cap: '' };
let saving = false;  // กันกดบันทึกซ้อน
let dataSeq = 0;     // เพิ่มทุกครั้งที่ผู้ใช้แก้อะไรใน state — กัน refetch เบื้องหลัง (ข้อมูลเก่ากว่า) มาทับ

/* ---- มุมมอง: แถว (ค่าเริ่มต้น) / การ์ด — จำไว้ต่อเครื่อง ---- */
type ViewMode = 'rows' | 'cards';
const VIEW_KEY = 'pn.admins.view';
let viewMode: ViewMode | null = null; // อ่านจาก localStorage ตอนเปิดหน้าครั้งแรก (ไม่อ่านตอน import — ฝั่ง server ไม่มี localStorage)

function readViewMode(): ViewMode {
  // ค่าเริ่มต้น = การ์ด (พีเลือก 27 ก.ย. 69) · แบบแถวยังสลับได้ และจำค่าที่เลือกไว้ในเครื่อง
  // private window / ปิด cookie แล้ว localStorage โยน error ได้ — ใช้ค่าเริ่มต้นแทน ห้ามพังทั้งหน้า
  try { return localStorage.getItem(VIEW_KEY) === 'rows' ? 'rows' : 'cards'; } catch { return 'cards'; }
}
function writeViewMode(v: ViewMode): void {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* จำไม่ได้ก็แค่กลับเป็นค่าเริ่มต้นรอบหน้า */ }
}

/** กลุ่มที่พับไว้ (ออฟไลน์ / ระงับอยู่) — กดแถวหัวกลุ่มเพื่อกาง · อยู่ในหน่วยความจำระหว่างเปิดหน้าเท่านั้น */
const groupOpen = { offline: false, disabled: false };
/**
 * B3: ทาส้ม "เต็มเพดานแชท" ต่อแถว/การ์ด เฉพาะตอนที่คนเต็มยังเป็นส่วนน้อย — ถ้าเกินครึ่งทีมเต็มพร้อมกัน
 * สีส้มทุกแถวไม่ได้บอกอะไร (ตาชิน) จึงเป็นสีปกติ แล้วให้กล่องสรุป "เต็มเพดานแชท" บอกจำนวนแทน
 * คิดใหม่ทุกครั้งที่วาดรายชื่อ (renderGrid)
 */
let capColorOn = true;
/** B3 กติกาเดียวกันกับป้าย "เกิน SLA" และ "หายไป …" — แทบทุกคนติดทุกวัน ถ้าเกินครึ่งของที่เห็นอยู่ = ป้ายเทา (ตัวเลขยังอยู่ครบ) */
let slaColorOn = true;
let gapColorOn = true;
/** แถวที่กางรายละเอียดอยู่ (user id) — ต้องจำไว้ เพราะหน้าวาดใหม่ทุกครั้งที่บันทึก/รีเฟรช */
const openRows: Record<string, boolean> = {};
/** แผงตัวกรองบนมือถือเปิดอยู่ไหม (จอ ≥900 โชว์ตัวกรองครบเสมอ) */
let filtersOpen = false;

/* ---- เกณฑ์คะแนนรวม (ชุดเดียวกับหน้าอันดับแอดมิน — โหลดครั้งเดียว) ---- */
let scoreCfg: MetricConfig[] | null = null;
let scoreCfgLoaded = false;

async function loadScoreCfg(): Promise<void> {
  if (scoreCfgLoaded) return;
  try {
    const res = await serverCall<{ config: unknown }>('apiScoreConfig', {});
    scoreCfg = normalizeConfig(res && res.config);
  } catch (e) {
    scoreCfg = normalizeConfig(null); // ใช้เกณฑ์ default เมื่อโหลดไม่สำเร็จ
  }
  scoreCfgLoaded = true;
}

/** คะแนนรวมของวันนี้ (เกณฑ์เดียวกับหน้าอันดับแอดมิน) — null เมื่อคิดไม่ได้ */
function scoreOf(a: Admin): number | null {
  if (!scoreCfg) return null;
  const t = a.today || {};
  const chats = Number(t.chats) || 0;
  const orders = Number(t.orders) || 0;
  const revenue = Number(t.revenue) || 0;
  return computeScore({
    revenue,
    orders,
    chats,
    replies: Number(t.replies) || 0,
    phones: Number(t.phones) || 0,
    avgRespMins: (t.respMins === null || t.respMins === undefined) ? null : Number(t.respMins),
    closeRate: chats ? Math.min(100, Math.round((orders / chats) * 1000) / 10) : null,
    avgOrder: orders ? Math.round(revenue / orders) : 0,
  }, scoreCfg).score;
}

// ช่องทางที่รับผิดชอบ: ข้อความล้วน (ใช้ใน title/CSV) + แบบมีโลโก้แบรนด์ (ใช้บนจอ)
// เดิมใช้ 📘/🟢 แทน FB/LINE — วงกลมเขียวไปชนกับ "ออนไลน์" จึงเปลี่ยนเป็นโลโก้จริง
const CH_TEXT: Record<string, string> = { both: 'FB + LINE', facebook: 'FB', line: 'LINE' };

/** คีย์ช่องทางของแอดมิน — ค่าแปลก/ว่าง = ทั้งสองช่องทาง (เหมือนเดิม) */
function chKeyOf(a: Admin): string {
  const ch = String(a.channels || 'both');
  return CH_TEXT[ch] ? ch : 'both';
}

/** โลโก้ช่องทาง — long = มีคำกำกับครบ (ใช้ในหน้าต่างสถิติที่มีที่พอ) */
function chHtml(ch: string, long?: boolean): string {
  const fb = brandIcon('facebook'), ln = brandIcon('line');
  if (ch === 'facebook') return fb + (long ? ' Facebook' : ' FB');
  if (ch === 'line') return ln + ' LINE';
  return long ? fb + ' Facebook + ' + ln + ' LINE' : fb + ' ' + ln;
}

// สถานะแอดมิน → คำ + สีป้าย (ป้ายใน lib/adminconfig.ts ยังมีอีโมจินำหน้า จึงไม่ใช้ label ตรงนั้นแสดงผลแล้ว)
// B3 งบสีแดง: "ไม่ว่าง" กับ "ระงับอยู่" ไม่ใช่เรื่องด่วนที่ต้องแก้วันนี้ → ส้ม/เทา ไม่ใช่แดง
// F4: คำ "ปิดใช้งาน" → "ระงับอยู่" (คู่กับปุ่ม "ระงับบัญชี")
const STATUS_VIEW: Record<string, { word: string; kind: StatusKind }> = {
  online: { word: 'ออนไลน์', kind: 'good' },
  away: { word: 'พัก', kind: 'warn' },
  busy: { word: 'ไม่ว่าง', kind: 'warn' },
  offline: { word: 'ออฟไลน์', kind: 'muted' },
  disabled: { word: 'ระงับอยู่', kind: 'muted' },
};

function statusView(a: Admin): { word: string; kind: StatusKind } {
  return STATUS_VIEW[statusOf(a)] || STATUS_VIEW.offline;
}

/* ---------------- helpers ภายใน view ---------------- */

/** ผู้ดูแลระบบเห็นข้อความเทคนิค (ชื่อตาราง/migration) ต่อท้ายข้อความผิดพลาดได้ — คนอื่นเห็นแต่ภาษาคน */
function isSuper(): boolean {
  const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
  return !!app && app.getAttribute('data-role') === 'superadmin';
}

function cut(s: unknown, n: number): string {
  const str = String(s === undefined || s === null ? '' : s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/** เวลาตอบเฉลี่ยเป็นข้อความ "0.4 น." — ไม่มีข้อมูล = '—' (ใช้ได้ทั้งใน esc/title) */
function respTxt(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  return (Math.round(Number(v) * 10) / 10) + ' น.';
}

/** เวลาตอบเฉลี่ยแบบ HTML — ไม่มีข้อมูล = ขีดสีจางแบบเดียวทั้งเว็บ */
function respHtml(v: number | null | undefined): string {
  const s = respTxt(v);
  return s === '—' ? dash() : esc(s);
}

function hhmm(ts: number): string {
  // ปักโซนไทยเสมอ — ไม่งั้นเปิดจากเครื่อง/ที่ที่โซนอื่นแล้วเวลาใน timeline เพี้ยน
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

function hrsFmt(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? h + ' ชม. ' + m + ' น.' : m + ' น.';
}

function statusOf(a: Admin): string {
  return a.status || effectiveStatus(a.enabled !== false, String(a.statusOverride || ''), !!a.online);
}

/** ชื่อเล่น (ฝั่ง server เดาจากคำแรกให้แล้วถ้ายังไม่พิมพ์ทับ) — ชื่อหลักที่ใช้เรียกบนการ์ด */
function nickOf(a: Admin): string {
  return String(a.nickname || a.name || '');
}

/** ชื่อเต็มเฉพาะเมื่อต่างจากชื่อเล่น (ไม่งั้นซ้ำ) */
function fullNameSub(a: Admin): string {
  const full = String(a.name || '');
  return full && full !== nickOf(a) ? full : '';
}

/** ชื่อเล่นที่ระบบจะเดาให้ถ้าไม่พิมพ์ทับ = คำแรกของชื่อ Pancake (ใช้เป็น placeholder ในฟอร์ม) */
function autoNick(a: Admin): string {
  const s = String(a.name || '').trim().replace(/\s+/g, ' ');
  return s ? s.split(' ')[0].slice(0, 40) : '';
}

/** เวลาที่ online ครั้งล่าสุดวันนี้ (จาก log จริง) — 'ตอนนี้' ถ้ายังออนไลน์อยู่ */
function lastOnlineStr(a: Admin): string {
  if (a.online) return 'ตอนนี้ ' + statusDot('good', 'ออนไลน์');
  const marks = (a.onlineToday && a.onlineToday.marks) || [];
  for (let i = marks.length - 1; i >= 0; i--) {
    if (!marks[i][1]) return hhmm(marks[i][0]) + ' น.'; // จุดที่เปลี่ยนเป็นออฟไลน์ล่าสุด = เห็นออนไลน์ล่าสุด
  }
  return dash();
}

function statusBadge(a: Admin): string {
  const st = statusView(a);
  return statusPill(st.kind, esc(st.word));
}

function capOf(a: Admin): { key: string; label: string; cls: string } {
  return a.capacity || capacityOf(Number(a.active) || 0, Number(a.maxActive) || DEFAULT_MAX_ACTIVE);
}

/** ป้ายเพดานแชท — B3: "เต็มแล้ว" มีเกือบ 1 ใน 3 ของทีมทุกวัน จึงเป็นส้ม (เฝ้าดู) ไม่ใช่แดง */
function capPill(a: Admin): string {
  const cap = capOf(a);
  // เกินครึ่งทีมเต็มพร้อมกัน → เทา (ส้มทุกใบไม่บอกอะไร — ดูจำนวนที่กล่อง "เต็มเพดานแชท" แทน)
  const kind: StatusKind = cap.key === 'available' ? 'good' : (capColorOn ? 'warn' : 'muted');
  return statusPill(kind, esc(cap.label));
}

/** ตัวเลขในการ์ด/หน้าต่างสถิติ — subHtml = บรรทัดย่อยใต้ป้าย (HTML ที่ escape แล้ว) */
function cellHtml(val: string | number, label: string, cls: string, title?: string, subHtml?: string): string {
  return '<div class="cell' + (cls ? ' ' + cls : '') + '"' +
    (title ? ' title="' + esc(title) + '"' : '') + '>' +
    '<b>' + val + '</b><span>' + esc(label) + '</span>' +
    (subHtml ? '<span class="cell-sub">' + subHtml + '</span>' : '') + '</div>';
}

/** "อินบ็อกซ์ 6 · คอมเมนต์ 21" แบบสั้น: ไอคอน + ตัวเลข อยู่บรรทัดเดียวเสมอ */
function waitSplitHtml_(inbox: number, cmt: number): string {
  return '<span class="adm-nw">' + icon(ICON_FOR.inbox, { size: 12, label: 'อินบ็อกซ์' }) + ' ' + fmtNum(inbox) +
    ' · ' + icon(ICON_FOR.comment, { size: 12, label: 'คอมเมนต์' }) + ' ' + fmtNum(cmt) + '</span>';
}

/** แถวรายละเอียด "หัวข้อ : ค่า" (ชิ้นส่วนกลาง .kv) — valueHtml ต้อง escape มาแล้ว */
function kvRow(label: string, valueHtml: string): string {
  return '<div class="kv-row"><span class="kv-k">' + esc(label) + '</span><span class="kv-v">' + valueHtml + '</span></div>';
}

function splitList(s: unknown): string[] {
  const out: string[] = [];
  const parts = String(s === undefined || s === null ? '' : s).split(', ');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].replace(/^\s+|\s+$/g, '');
    if (p) out.push(p);
  }
  return out;
}

/** กลุ่มสินค้าของแอดมิน 1 คน (คั่นด้วย ,) */
function groupsOf(a: Admin): string[] {
  return String(a.productGroups || '').split(',')
    .map(function (g) { return g.trim(); })
    .filter(function (g) { return !!g; });
}

/** กลุ่มสินค้าทั้งหมดที่มีใครสักคนตั้งไว้ (สำหรับ filter + chip ใน modal) */
function allGroups(): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  ((lastData && lastData.admins) || []).forEach(function (a) {
    groupsOf(a).forEach(function (g) {
      if (!seen[g]) { seen[g] = true; out.push(g); }
    });
  });
  out.sort(function (a, b) { return a.localeCompare(b, 'th'); });
  return out;
}

/** บรรทัด "ตำแหน่ง • ช่องทาง • กลุ่มสินค้า • N เพจ" — text สำหรับ title / html สำหรับโชว์ (มีโลโก้ช่องทาง) */
function metaOf(a: Admin): { text: string; html: string } {
  const groups = String(a.productGroups || '');
  const chKey = chKeyOf(a);
  const head = a.role ? a.role : (a.department || '—');
  const tail = (groups ? ' • ' + cut(groups, 20) : (a.saleGroup ? ' • ' + a.saleGroup : '')) +
    ' • ' + fmtNum(a.pageCount || 0) + ' เพจ';
  return { text: head + ' • ' + CH_TEXT[chKey] + tail, html: esc(head) + ' • ' + chHtml(chKey) + esc(tail) };
}

/** ป้ายเวลาออนไลน์วันนี้ + ช่วงหายนานสุด (จาก log จริง ความละเอียด ~15 นาที) */
function onlineBadgesHtml(a: Admin): string {
  const ot = a.onlineToday;
  if (!ot) {
    return '<span class="badge neutral" title="เริ่มเก็บประวัติออนไลน์อัตโนมัติ — จะแสดงเมื่อมีข้อมูล">รอเก็บข้อมูล</span>';
  }
  return '<span class="badge neutral" title="เวลาออนไลน์รวมวันนี้ (จากประวัติจริง ความละเอียด ~15 นาที)">' +
      '<span class="mini-lbl">ออนไลน์วันนี้</span>' + esc(hrsFmt(ot.mins)) + '</span>' +
    (ot.gapMins
      // ห่อ span เพื่อใส่ title — statusPill ไม่รับ title เอง
      ? '<span title="ช่วงหายนานสุดวันนี้ (หลังออนไลน์ครั้งแรก)">' +
        statusPill(ot.gapMins > 45 && gapColorOn ? 'warn' : 'muted', 'หายไป ' + esc(hrsFmt(ot.gapMins))) + '</span>'
      : '');
}

/** ป้ายเกิน SLA — B3: แทบทุกคนมีแชทเกินเกณฑ์ทุกวัน ป้ายแดงทุกแถวทำให้ตาชิน → ส้ม (เฝ้าดู) · เกินครึ่งของที่เห็น = เทา */
function slaPillHtml(a: Admin): string {
  const overSla = Number(a.overSla) || 0;
  if (!(overSla > 0)) return '';
  const slaMins = Number(lastData && lastData.slaMins) || 60;
  return '<span title="แชทที่ลูกค้ารอเกิน ' + slaMins + ' นาที (นับจากเวลาข้อความล่าสุดของแชท)">' +
    statusPill(slaColorOn ? 'warn' : 'muted', 'เกิน SLA ' + esc(fmtNum(overSla))) + '</span>';
}

/* ---------------- persistence ---------------- */

function recomputeLocal(a: Admin): void {
  a.status = effectiveStatus(a.enabled !== false, String(a.statusOverride || ''), !!a.online);
  a.capacity = capacityOf(Number(a.active) || 0, Number(a.maxActive) || DEFAULT_MAX_ACTIVE);
}

/** ค่าตั้งของแอดมิน 1 คน (ไว้คืนค่าเดิมเมื่อบันทึกไม่สำเร็จ) */
function snapshotOf(a: Admin): Partial<Admin> {
  return {
    enabled: a.enabled, statusOverride: a.statusOverride, role: a.role, channels: a.channels,
    productGroups: a.productGroups, maxActive: a.maxActive, maxPending: a.maxPending, note: a.note,
    nickname: a.nickname, nicknameSet: a.nicknameSet,
  };
}

/** ข้อความเมื่อบันทึกไม่สำเร็จ — ภาษาคน · ข้อความเทคนิคต่อท้ายเฉพาะผู้ดูแลระบบ */
function saveErrMsg(res: SaveRes | null, err?: unknown): string {
  if (res && res.needSetup) return 'ยังบันทึกไม่ได้ — ส่วนตั้งค่าแอดมินยังไม่พร้อม กรุณาแจ้งผู้ดูแลระบบ';
  const raw = (res && res.error) || (err && (err as Error).message) || '';
  return 'บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง' + (isSuper() && raw ? ' (' + String(raw).slice(0, 140) + ')' : '');
}

/** ข้อความเมื่อบันทึกได้บางช่อง (ฐานข้อมูลยังไม่มีคอลัมน์ใหม่) */
function saveWarnMsg(res: SaveRes): string {
  return String(res.warning || '') + (isSuper() && res.warningDetail ? ' (' + res.warningDetail + ')' : '');
}

/**
 * แก้ค่าตั้งของแอดมิน 1 คนแล้วบันทึกทันที (ปุ่มในเมนู ⋯ / ช่องสถานะบนการ์ด)
 * apply() แก้ค่าใน object แล้วคืน field ที่จะส่ง (partial — server merge กับแถวเดิม
 * กัน tab อื่นที่เปิดค้างเขียนทับ field ที่คนอื่นเพิ่งแก้)
 * ล้มเหลว → คืนค่าเดิม + ข้อความผิดพลาดที่มีปุ่ม "ลองใหม่" (ทำ apply ซ้ำ)
 * onOk = ทำแทนข้อความสำเร็จปกติ (เช่น แถบ "ระงับแล้ว · เลิกทำ")
 */
function commitAdmin(
  a: Admin, apply: () => Record<string, unknown>, container: HTMLElement,
  okMsg: string | (() => string), onOk?: () => void,
): void {
  if (saving) {
    toast('กำลังบันทึกรายการก่อนหน้า — รอสักครู่แล้วลองอีกครั้ง', 'warn');
    return;
  }
  const before = snapshotOf(a);
  const changed = apply();
  recomputeLocal(a);
  renderBody(container);
  saving = true;
  dataSeq++; // มีการแก้ state — refetch เบื้องหลังที่เริ่มก่อนหน้านี้ห้ามเอาข้อมูลมาทับ
  const fail = function (res: SaveRes | null, err?: unknown): void {
    saving = false;
    Object.assign(a, before);
    recomputeLocal(a); // ห้ามลืม — ไม่งั้น status/capacity ที่คำนวณจากค่าใหม่ค้างอยู่ทั้งที่คืนค่าแล้ว
    renderBody(container);
    toast(saveErrMsg(res, err), 'error', {
      action: { label: 'ลองใหม่', fn: function () { commitAdmin(a, apply, container, okMsg, onOk); } },
    });
  };
  serverCall<SaveRes>('apiAdminSettings', { admin: { user_id: String(a.id), ...changed } }).then(function (res) {
    if (!(res && res.ok)) { fail(res); return; }
    saving = false;
    if (res.warning) toast(saveWarnMsg(res), 'warn');
    else if (onOk) onOk();
    else toast(typeof okMsg === 'function' ? okMsg() : okMsg, 'ok');
  }).catch(function (err) { fail(null, err); });
}

/** เปลี่ยนสถานะ override (อัตโนมัติ / พัก / ไม่ว่าง) — บันทึกทันที */
function setStatusOverride(a: Admin, v: string, container: HTMLElement): void {
  if (String(a.statusOverride || '') === v) return;
  commitAdmin(a, function () {
    a.statusOverride = v;
    return { status_override: v };
  }, container, function () {
    // คิดข้อความตอนบันทึกสำเร็จ — ต้องใช้คำของสถานะหลังเปลี่ยน
    return 'เปลี่ยนสถานะ "' + nickOf(a) + '" เป็น ' + statusView(a).word + ' แล้ว';
  });
}

/**
 * F4 ระงับบัญชี: ทำทันที (ไม่มีกล่องถาม) แล้วขึ้นแถบ "ระงับ '<ชื่อ>' แล้ว · เลิกทำ" ค้าง 5 วินาที
 * เปิดใช้งานอีกครั้ง: ทำทันที ข้อความสำเร็จธรรมดา
 */
function setEnabled(a: Admin, enable: boolean, container: HTMLElement, restoreOverride?: string): void {
  const nick = nickOf(a);
  const prevOverride = String(a.statusOverride || '');
  commitAdmin(a, function () {
    a.enabled = enable;
    // ระงับ = ล้างสถานะพัก/ไม่ว่าง (เหมือนเดิม) · เลิกทำ = คืนสถานะที่เคยตั้งไว้
    a.statusOverride = enable ? String(restoreOverride || '') : '';
    return { enabled: enable, status_override: String(a.statusOverride || '') };
  }, container,
  'เปิดใช้งาน "' + nick + '" อีกครั้งแล้ว',
  enable ? undefined : function () {
    undoToast('ระงับ “' + nick + '” แล้ว', function () { setEnabled(a, true, container, prevOverride); });
  });
}

/* ---------------- filter / sort ---------------- */

function matches(a: Admin): boolean {
  if (filter.q) {
    // ค้นได้ทั้งชื่อเต็มและชื่อเล่น — ทีมเรียกกันด้วยชื่อเล่นเป็นหลัก
    const q = filter.q.toLowerCase();
    const hay = (String(a.name || '') + ' ' + nickOf(a)).toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  if (filter.status && statusOf(a) !== filter.status) return false;
  if (filter.role && String(a.role || '') !== filter.role) return false;
  if (filter.dept && String(a.department || '') !== filter.dept) return false;
  if (filter.channel) {
    const ch = String(a.channels || 'both');
    if (ch !== 'both' && ch !== filter.channel) return false;
  }
  if (filter.group && groupsOf(a).indexOf(filter.group) < 0) return false;
  if (filter.cap === 'slow') {
    const r = a.today && a.today.respMins;
    if (r === null || r === undefined || Number(r) <= 8) return false;
  } else if (filter.cap && capOf(a).key !== filter.cap) return false;
  return true;
}

function getFiltered(): Admin[] {
  const admins = (lastData && lastData.admins) || [];
  const list = admins.filter(matches);
  list.sort(function (a, b) {
    const ea = a.enabled !== false ? 1 : 0, eb = b.enabled !== false ? 1 : 0;
    if (eb !== ea) return eb - ea; // ระงับอยู่ไปท้ายสุด
    const oa = a.online ? 1 : 0, ob = b.online ? 1 : 0;
    if (ob !== oa) return ob - oa;
    const ra = (a.today && a.today.revenue) || 0;
    const rb = (b.today && b.today.revenue) || 0;
    if (rb !== ra) return rb - ra;
    return String(a.name || '').localeCompare(String(b.name || ''), 'th');
  });
  return list;
}

/** จำนวนตัวกรอง (ไม่นับช่องค้นหา) ที่ใช้อยู่ — โชว์บนปุ่ม "ตัวกรอง (n)" ของมือถือ */
function activeFilterCount(): number {
  return ['status', 'role', 'dept', 'channel', 'group', 'cap'].filter(function (k) {
    return !!filter[k as keyof typeof filter];
  }).length;
}

function findAdmin(id: string | null): Admin | null {
  const admins = (lastData && lastData.admins) || [];
  for (let i = 0; i < admins.length; i++) {
    if (String(admins[i].id) === String(id)) return admins[i];
  }
  return null;
}

/* ---------------- มุมมองแถว (ค่าเริ่มต้น) ---------------- */

/** ช่องตัวเลข 1 ช่องในแถว — ป้ายคำเห็นบนมือถือ (เรียงเป็นบรรทัดเดียว) จอกว้างซ่อนเพราะมีหัวคอลัมน์แล้ว
 *  (ซ่อนแบบที่โปรแกรมอ่านหน้าจอยังอ่านได้ — ปุ่มทั้งแถวจะถูกอ่านว่า "ตอบวันนี้ 6,473 …") */
function numCell(label: string, valHtml: string, cls: string, extra?: string): string {
  return '<span class="adm-n' + (extra ? ' ' + extra : '') + '"><span class="adm-k">' + esc(label) + '</span>' +
    '<span class="adm-v' + (cls ? ' ' + cls : '') + '">' + valHtml + '</span></span>';
}

/** หัวคอลัมน์ของมุมมองแถว (โชว์เฉพาะจอ ≥900 — มือถือแต่ละช่องมีป้ายคำของตัวเอง) */
function listHeadHtml(): string {
  return '<div class="adm-head">' +
    '<span class="adm-h-who">แอดมิน</span>' +
    '<span>สถานะ</span>' +
    '<span class="adm-h-n">ตอบวันนี้</span>' +
    '<span class="adm-h-n">แชทที่ดูแล' +
      infoTip('แชทที่ถูกมอบหมายให้คนนี้ใน 24 ชม.ล่าสุด / เพดานที่ตั้งไว้ • ตัวส้ม = เต็มเพดานแล้ว (ถ้าเกินครึ่งทีมเต็มพร้อมกัน จะไม่ทาส้มทุกแถว — ดูจำนวนที่กล่อง "เต็มเพดานแชท" แทน)', 'แชทที่ดูแล') + '</span>' +
    '<span class="adm-h-n">รอตอบ' +
      infoTip('แชทที่ลูกค้ารอตอบตอนนี้ (24 ชม.ล่าสุด) รวมอินบ็อกซ์และคอมเมนต์ใต้โพสต์ • ตัวส้ม = เกินเพดานรอตอบที่ตั้งไว้ • แยกอินบ็อกซ์/คอมเมนต์ดูได้เมื่อกดที่แถว', 'รอตอบ') + '</span>' +
    '<span class="adm-h-n">ตอบเฉลี่ย</span>' +
    '<span class="adm-h-n">ยอดขายวันนี้</span>' +
    '<span class="adm-h-menu" aria-hidden="true"></span>' +
  '</div>';
}

function rowHtml(a: Admin): string {
  const id = String(a.id);
  const t = a.today || {};
  const enabled = a.enabled !== false;
  const cap = capOf(a);
  const active = Number(a.active) || 0;
  const maxActive = Number(a.maxActive) || DEFAULT_MAX_ACTIVE;
  const waiting = Number(a.waiting) || 0;
  const maxPending = Number(a.maxPending) || 0;
  // B3: รอตอบ > 0 มีแทบทุกคน ทาส้มทุกแถว = ไม่มีความหมาย → ส้มเฉพาะคนที่เกินเพดานที่ตั้งไว้
  const overPending = maxPending > 0 && waiting > maxPending;
  const st = statusView(a);
  const full = fullNameSub(a);
  const open = !!openRows[id];
  return '<div class="adm-row' + (enabled ? '' : ' off') + (open ? ' open' : '') + '" data-admin-id="' + esc(id) + '">' +
    '<button type="button" class="adm-row-btn" data-adrow="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') +
      '" aria-controls="adm-det-' + esc(id) + '">' +
      '<span class="adm-av">' + avatarHtml(a.id, a.name, !!a.online && enabled, 'sm') + '</span>' +
      '<span class="adm-name"><span class="adm-nick">' + esc(nickOf(a)) + '</span>' +
        (full ? '<span class="adm-full">' + esc(full) + '</span>' : '') + '</span>' +
      '<span class="adm-st">' + statusDot(st.kind) + '<span>' + esc(st.word) + '</span></span>' +
      '<span class="adm-nums">' +
        numCell('ตอบวันนี้', esc(fmtNum(t.replies || 0)), '') +
        numCell('แชทที่ดูแล', esc(fmtNum(active) + '/' + fmtNum(maxActive)), capColorOn && cap.key === 'full' ? 'v-warn' : '') +
        numCell('รอตอบ', esc(fmtNum(waiting) + (maxPending > 0 ? '/' + fmtNum(maxPending) : '')), overPending ? 'v-warn' : '') +
        numCell('ตอบเฉลี่ย', respHtml(t.respMins), '') +
      '</span>' +
      numCell('ยอดขายวันนี้', esc(THB(t.revenue || 0)), 'v-plain', 'adm-rev') +
    '</button>' +
    '<div class="menu-wrap adm-menu">' +
      '<button type="button" class="btn-mini btn-text btn-icon adm-more" data-admore="' + esc(id) + '"' +
        ' aria-haspopup="menu" aria-expanded="false" aria-label="' + esc('คำสั่งสำหรับ ' + nickOf(a)) + '">' +
        icon('ellipsis', { size: 20 }) + '</button>' +
    '</div>' +
    '<div class="adm-det" id="adm-det-' + esc(id) + '"' + (open ? '' : ' hidden') + '>' + (open ? detailHtml(a) : '') + '</div>' +
  '</div>';
}

/** รายละเอียดที่กางใต้แถว = ข้อมูลทุกอย่างที่เคยอยู่บนการ์ด แต่ไม่ได้อยู่ในแถว */
function detailHtml(a: Admin): string {
  const t = a.today || {};
  const meta = metaOf(a);
  const waiting = Number(a.waiting) || 0;
  const waitCmt = Number(a.waitingComment) || 0;
  const pages = splitList(a.pages);
  return '<div class="adm-det-meta" title="' + esc(meta.text) + '">' + meta.html + '</div>' +
    '<div class="adm-det-badges">' + capPill(a) + onlineBadgesHtml(a) + slaPillHtml(a) + '</div>' +
    '<div class="kv adm-det-kv">' +
      kvRow('ออเดอร์วันนี้', esc(fmtNum(t.orders || 0))) +
      kvRow('รอตอบ (แยกประเภท)', waitSplitHtml_(Math.max(0, waiting - waitCmt), waitCmt)) +
      kvRow('เพจที่ดูแล', pages.length
        ? '<span title="' + esc(pages.join(', ')) + '">' + esc(cut(pages.join(', '), 60)) + '</span>'
        : esc('ไม่มีเพจ')) +
      (a.note ? kvRow('โน้ต', esc(a.note)) : '') +
    '</div>' +
    '<div class="adm-det-actions">' +
      '<button type="button" class="btn-mini btn-text" data-adstats="' + esc(String(a.id)) + '">' +
        icon('chart-bar', { size: 14 }) + 'ดูสถิติและเหตุการณ์วันนี้</button>' +
    '</div>';
}

/* ---------------- มุมมองการ์ด (สลับกลับได้) ---------------- */

function cardHtml(a: Admin): string {
  const t = a.today || {};
  const enabled = a.enabled !== false;
  const cap = capOf(a);
  const active = Number(a.active) || 0;
  const maxActive = Number(a.maxActive) || DEFAULT_MAX_ACTIVE;
  const waiting = Number(a.waiting) || 0;
  const maxPending = Number(a.maxPending) || 0;
  const overPending = maxPending > 0 && waiting > maxPending;
  const meta = metaOf(a);
  const pages = a.pages || '';

  // แชทรอตอบ แยกอินบ็อกซ์/คอมเมนต์ — คนละงานกันสำหรับแอดมิน (คอมเมนต์ใต้โพสต์ ~41% ของที่ค้าง)
  const waitCmt = Number(a.waitingComment) || 0;
  const waitInbox = Math.max(0, waiting - waitCmt);
  const cells =
    cellHtml(fmtNum(t.replies || 0), 'ตอบวันนี้', '') +
    cellHtml(fmtNum(active) + '/' + fmtNum(maxActive), 'แชทดูแล (24ชม.)',
      capColorOn && cap.key === 'full' ? 'warn' : '') +
    // B3: ส้มเฉพาะคนที่เกินเพดานรอตอบ (เดิมส้มทุกใบที่มีแชทรอ = เกือบทั้งทีม)
    cellHtml(fmtNum(waiting) + (maxPending > 0 ? '/' + fmtNum(maxPending) : ''),
      'รอตอบ' + (maxPending > 0 ? ' (เพดาน)' : ''),
      overPending ? 'warn' : '',
      'แชทที่ลูกค้ารอตอบตอนนี้ (24 ชม.ล่าสุด) — อินบ็อกซ์ ' + fmtNum(waitInbox) +
        ' • คอมเมนต์ใต้โพสต์ ' + fmtNum(waitCmt) + ' (คนละงานกัน จึงแยกให้เห็น)',
      waitSplitHtml_(waitInbox, waitCmt)) +
    cellHtml(respHtml(t.respMins), 'ตอบเฉลี่ย', '') +
    cellHtml(fmtNum(t.orders || 0), 'ออเดอร์วันนี้', '') +
    cellHtml(esc(THB(t.revenue || 0)), 'ยอดขาย', '');
  const id = esc(String(a.id));

  return '<div class="admin-card' + (enabled ? '' : ' off') + '" data-admin-id="' + id + '">' +
    '<div class="admin-head">' +
      avatarHtml(a.id, a.name, !!a.online && enabled) +
      '<div class="adm-card-who">' +
        // ชื่อเล่นเป็นตัวหลัก (ทีมเรียกกันแบบนี้) + ชื่อเต็มจาก Pancake เป็นตัวรอง
        '<div class="admin-name" title="' + esc(String(a.name || '')) + '">' + esc(nickOf(a)) +
          (fullNameSub(a) ? '<span class="admin-fullname">' + esc(fullNameSub(a)) + '</span>' : '') +
        '</div>' +
        '<div class="admin-meta" title="' + esc(meta.text) + '">' + meta.html + '</div>' +
      '</div>' +
      '<div class="adm-card-pills">' + statusBadge(a) + capPill(a) + '</div>' +
    '</div>' +
    '<div class="page-stats">' + cells + '</div>' +
    '<div class="page-status-row">' +
      onlineBadgesHtml(a) +
      slaPillHtml(a) +
      '<span class="adm-flex"></span>' +
      '<span class="chip" title="' + esc(pages || 'ไม่มีเพจ') + '">' + icon(ICON_FOR.page, { size: 14 }) +
        esc(pages ? cut(pages, 26) : 'ไม่มีเพจ') + '</span>' +
    '</div>' +
    // C2: "สถิติ" ซ้ำทุกการ์ด = ปุ่มแบบข้อความ · ระงับบัญชี = ปุ่มอันตราย (กรอบแดง)
    '<div class="admin-actions">' +
      '<button type="button" class="btn-mini btn-text" data-adstats="' + id + '">' + icon('chart-bar') + 'สถิติ</button>' +
      '<button type="button" class="btn-mini" data-adedit="' + id + '" title="ตำแหน่งงาน / ช่องทาง / กลุ่มสินค้า / เพดานแชท">' +
        icon(ICON_FOR.edit) + 'สิทธิ์และตั้งค่า</button>' +
      '<select class="input ad-status-sel" data-adstatus="' + id + '"' + (enabled ? '' : ' disabled') +
        ' aria-label="' + esc('สถานะของ ' + nickOf(a)) + '">' +
        '<option value=""' + (!a.statusOverride ? ' selected' : '') + '>สถานะอัตโนมัติ</option>' +
        '<option value="away"' + (a.statusOverride === 'away' ? ' selected' : '') + '>พัก</option>' +
        '<option value="busy"' + (a.statusOverride === 'busy' ? ' selected' : '') + '>ไม่ว่าง</option>' +
      '</select>' +
      (enabled
        ? '<button type="button" class="btn-mini danger" data-adtoggle="' + id + '">' + icon('ban') + 'ระงับบัญชี</button>'
        : '<button type="button" class="btn-mini" data-adtoggle="' + id + '">' + icon('user-check') + 'เปิดใช้งานอีกครั้ง</button>') +
    '</div>' +
  '</div>';
}

/* ---------------- เมนู ⋯ ต่อคน (สร้างตอนกด — ไม่วาดซ่อนไว้ 90 ชุด) ---------------- */

let menuBtn: HTMLElement | null = null;
let menuPop: HTMLElement | null = null;
/** ปุ่มย้อนกลับของมือถือปิดเมนู ⋯ (ลงทะเบียนเป็นของลอยที่ helpers) — เดิมกดย้อนกลับแล้วออกจากหน้าไปเลย */
const menuBack = (): void => closeMenu(false);
/** ตำแหน่งที่เลือกดูในตารางหน้าที่แบบมือถือ (จำไว้ข้ามการวาดใหม่) */
let permRole: string = ADMIN_ROLES[0];

function menuItemsHtml(a: Admin): string {
  const enabled = a.enabled !== false;
  const cur = String(a.statusOverride || '');
  const stItem = function (v: string, label: string): string {
    const on = cur === v;
    return '<button type="button" class="menu-item" role="menuitemradio" aria-checked="' + (on ? 'true' : 'false') + '"' +
      (enabled ? '' : ' disabled') + ' data-act="status" data-v="' + v + '">' +
      '<span class="adm-pop-check">' + (on ? icon('check', { size: 16 }) : '') + '</span>' + esc(label) + '</button>';
  };
  return '<button type="button" class="menu-item" role="menuitem" data-act="stats">' + icon('chart-bar', { size: 16 }) + 'ดูสถิติ</button>' +
    '<button type="button" class="menu-item" role="menuitem" data-act="edit">' + icon(ICON_FOR.edit, { size: 16 }) + 'สิทธิ์และตั้งค่า</button>' +
    '<div class="adm-pop-sep" role="separator"></div>' +
    '<div role="group" aria-label="สถานะ">' +
      '<div class="adm-pop-lbl" aria-hidden="true">สถานะ' + (enabled ? '' : ' (ระงับอยู่ — เปลี่ยนไม่ได้)') + '</div>' +
      stItem('', 'อัตโนมัติ (ตามออนไลน์จริง)') + stItem('away', 'พัก') + stItem('busy', 'ไม่ว่าง') +
    '</div>' +
    '<div class="adm-pop-sep" role="separator"></div>' +
    (enabled
      ? '<button type="button" class="menu-item adm-pop-danger" role="menuitem" data-act="toggle">' + icon('ban', { size: 16 }) + 'ระงับบัญชี</button>'
      : '<button type="button" class="menu-item" role="menuitem" data-act="toggle">' + icon('user-check', { size: 16 }) + 'เปิดใช้งานอีกครั้ง</button>');
}

function menuItems(): HTMLElement[] {
  return menuPop ? Array.prototype.slice.call(menuPop.querySelectorAll('.menu-item:not([disabled])')) : [];
}

function onMenuOutside(e: Event): void {
  const t = e.target as Node;
  if (menuPop && menuPop.contains(t)) return;
  if (menuBtn && menuBtn.contains(t)) return;
  closeMenu(false);
}

function onMenuKey(e: KeyboardEvent): void {
  if (!menuPop) return;
  if (e.key === 'Escape') {
    // capture + หยุดตรงนี้ — ไม่ให้ Esc ไปปิดอย่างอื่นข้างหลังด้วย
    e.preventDefault(); e.stopPropagation();
    closeMenu(true);
    return;
  }
  if (e.key === 'Tab') { closeMenu(false); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = menuItems();
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    items[n].focus();
  }
}

function closeMenu(focusBtn: boolean): void {
  floaterClosed(menuBack);
  if (menuPop) menuPop.remove();
  if (menuBtn) {
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.removeAttribute('aria-controls');
    if (focusBtn && menuBtn.isConnected) menuBtn.focus();
  }
  menuPop = null;
  menuBtn = null;
  document.removeEventListener('pointerdown', onMenuOutside, true);
  document.removeEventListener('keydown', onMenuKey, true);
}

function openMenu(btn: HTMLElement, a: Admin, container: HTMLElement): void {
  const same = menuBtn === btn;
  closeMenu(false);
  if (same) return; // กดปุ่มเดิมซ้ำ = ปิด
  const wrap = btn.parentElement;
  if (!wrap) return;
  const pop = document.createElement('div');
  pop.className = 'menu-pop adm-pop';
  pop.id = 'adm-pop';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'คำสั่งสำหรับ ' + nickOf(a));
  pop.innerHTML = menuItemsHtml(a);
  wrap.appendChild(pop);
  // ใกล้ขอบล่างจอ → เด้งขึ้นด้านบนปุ่มแทน (ไม่ต้องเลื่อนจอตามหาเมนู)
  const r = pop.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) {
    if (btn.getBoundingClientRect().top > r.height + 8) pop.classList.add('up');
    else {
      // มือถือแนวนอน (สูง ~390px): ข้างบน-ข้างล่างไม่พอทั้งคู่ → จำกัดสูงตามที่ว่างข้างล่าง แล้วเลื่อนในเมนูเอง
      // เดิมเมนูยาวเลยขอบล่างจอ "พัก / ไม่ว่าง / ระงับบัญชี" มองไม่เห็น
      pop.style.maxHeight = Math.max(160, Math.floor(window.innerHeight - r.top - 8)) + 'px';
      pop.style.overflowY = 'auto';
    }
  }
  menuBtn = btn;
  menuPop = pop;
  floaterOpened(menuBack);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-controls', 'adm-pop');
  document.addEventListener('pointerdown', onMenuOutside, true);
  document.addEventListener('keydown', onMenuKey, true);
  pop.addEventListener('click', function (e) {
    const it = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!it || (it as HTMLButtonElement).disabled) return;
    const act = it.getAttribute('data-act');
    closeMenu(act === 'status' || act === 'toggle');
    if (act === 'stats') openStats(a);
    else if (act === 'edit') openSettings(a, container);
    else if (act === 'status') setStatusOverride(a, String(it.getAttribute('data-v') || ''), container);
    else if (act === 'toggle') setEnabled(a, a.enabled === false, container);
    if (act === 'status' || act === 'toggle') {
      // รายชื่อถูกวาดใหม่ ปุ่ม ⋯ เดิมหายไป — คืนโฟกัสให้ปุ่ม ⋯ ของคนเดิม (คนใช้คีย์บอร์ดไม่หลงตำแหน่ง)
      const again = container.querySelector('[data-admore="' + String(a.id).replace(/"/g, '') + '"]') as HTMLElement | null;
      if (again) again.focus({ preventScroll: true });
    }
  });
  const items = menuItems();
  if (items.length) items[0].focus();
}

/* ---------------- modal สิทธิ์/ตั้งค่า ---------------- */

function openSettings(a: Admin, container: HTMLElement): void {
  const groupsVal = String(a.productGroups || '');
  const savedNick = String(a.nicknameSet || ''); // '' = ยังไม่พิมพ์ทับ (ช่องว่างไว้ ให้เห็น placeholder)
  const html =
    '<div class="modal-head">' +
      '<div class="adm-mh">' +
        avatarHtml(a.id, a.name, !!a.online) +
        '<div class="adm-mh-txt"><h3>' + esc(nickOf(a)) + '</h3>' +
        (fullNameSub(a) ? '<div class="admin-meta">' + esc(fullNameSub(a)) + '</div>' : '') +
        '<div class="adm-mh-pills">' + statusBadge(a) + '</div></div>' +
      '</div>' +
      modalCloseBtn() +
    '</div>' +
    '<div class="hint-box">การตั้งค่านี้ใช้ในเว็บนี้เท่านั้น (จัดทีม / กรอง / จัดอันดับ) — ' +
      '<b>ไม่มีผลกับบัญชี Pancake</b> ของแอดมิน • หน้าที่ของแต่ละตำแหน่งแก้ได้ที่แท็บ "ตำแหน่งงาน & หน้าที่"</div>' +
    '<div class="adm-form">' +
      '<label class="adm-field"><span>ตำแหน่งงาน</span>' +
        '<select class="input" id="adf-role">' +
          '<option value=""' + (!a.role ? ' selected' : '') + '>— ยังไม่กำหนด —</option>' +
          ADMIN_ROLES.map(function (r) {
            return '<option value="' + esc(r) + '"' + (a.role === r ? ' selected' : '') + '>' + esc(r) + '</option>';
          }).join('') +
        '</select></label>' +
      '<label class="adm-field"><span>ช่องทางที่รับผิดชอบ</span>' +
        '<select class="input" id="adf-channel">' +
          '<option value="both"' + ((a.channels || 'both') === 'both' ? ' selected' : '') + '>ทั้งสองช่องทาง (Facebook + LINE)</option>' +
          '<option value="facebook"' + (a.channels === 'facebook' ? ' selected' : '') + '>Facebook เท่านั้น</option>' +
          '<option value="line"' + (a.channels === 'line' ? ' selected' : '') + '>LINE เท่านั้น</option>' +
        '</select></label>' +
      '<label class="adm-field adm-field-full"><span>กลุ่มสินค้าที่ดูแล (คั่นด้วย , — เว้นว่าง = ทุกกลุ่ม)</span>' +
        '<input class="input" id="adf-groups" value="' + esc(groupsVal) + '" placeholder="เช่น UN1, UN8">' +
        (allGroups().length
          ? '<div class="pill-grid adm-gchips" id="adf-group-chips">' +
            allGroups().map(function (g) {
              const on = groupsOf(a).indexOf(g) >= 0;
              return '<button type="button" class="filter-btn' + (on ? ' active' : '') +
                '" data-gchip="' + esc(g) + '">' + esc(g) + '</button>';
            }).join('') + '</div>'
          : '') +
      '</label>' +
      '<label class="adm-field"><span>เพดานแชทที่ดูแลพร้อมกัน (ป้ายเพดานแชท)</span>' +
        '<input class="input" id="adf-max" type="number" min="1" max="9999" value="' + esc(String(a.maxActive || DEFAULT_MAX_ACTIVE)) + '"></label>' +
      '<label class="adm-field"><span>เพดานแชทรอตอบ (0 = ไม่กำหนด)</span>' +
        '<input class="input" id="adf-maxpend" type="number" min="0" max="9999" value="' + esc(String(a.maxPending || 0)) + '"></label>' +
      // ชื่อเล่น: เว้นว่าง = ใช้คำแรกของชื่อ Pancake อัตโนมัติ (ไม่ต้องกรอกทีละคน)
      '<label class="adm-field"><span>ชื่อเล่น (เว้นว่าง = ใช้ "' + esc(autoNick(a)) + '" อัตโนมัติ)</span>' +
        '<input class="input" id="adf-nick" maxlength="40" value="' + esc(savedNick) +
        '" placeholder="' + esc(autoNick(a)) + '"></label>' +
      '<label class="adm-field"><span>โน้ต (เห็นเฉพาะทีมเรา)</span>' +
        '<input class="input" id="adf-note" value="' + esc(String(a.note || '')) + '" placeholder="เช่น ถนัดปิดการขาย LINE"></label>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn" id="adf-cancel">ยกเลิก</button>' +
      '<button type="button" class="btn primary" id="adf-save">' + icon(ICON_FOR.save) + 'บันทึก</button>' +
    '</div>';
  openModal(html);
  const $id = function (id: string) { return document.getElementById(id) as any; };
  const cancel = $id('adf-cancel');
  if (cancel) cancel.addEventListener('click', closeModal);

  // chip กลุ่มสินค้า: คลิกเพื่อเพิ่ม/เอาออกจากช่องกรอก (ช่องกรอกยังพิมพ์เองได้)
  const chipWrap = $id('adf-group-chips');
  if (chipWrap) chipWrap.addEventListener('click', function (e: any) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-gchip]') : null;
    if (!btn) return;
    const g = String(btn.getAttribute('data-gchip') || '');
    const inp = $id('adf-groups');
    if (!g || !inp) return;
    const cur = String(inp.value || '').split(',')
      .map(function (x: string) { return x.trim(); })
      .filter(function (x: string) { return !!x; });
    const idx = cur.indexOf(g);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(g);
    inp.value = cur.join(', ');
    btn.classList.toggle('active', idx < 0);
  });

  // F4: บันทึกแล้วรอผลในหน้าต่าง (ปุ่มหมุน "กำลังบันทึก…" กดซ้ำไม่ได้) — ไม่สำเร็จ หน้าต่างยังเปิดอยู่ ค่าที่พิมพ์ไม่หาย กดบันทึกซ้ำได้เลย
  const save = $id('adf-save') as HTMLButtonElement | null;
  if (save) save.addEventListener('click', function () {
    if (saving) {
      toast('กำลังบันทึกรายการก่อนหน้า — รอสักครู่แล้วกดบันทึกอีกครั้ง', 'warn');
      return;
    }
    // ชื่อเล่น: เว้นว่าง = กลับไปใช้ค่าเดาอัตโนมัติ (คำแรกของชื่อ Pancake)
    const nickSet = String($id('adf-nick').value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    let mx = Math.round(Number($id('adf-max').value));
    if (!isFinite(mx) || mx < 1) mx = DEFAULT_MAX_ACTIVE;
    if (mx > 9999) mx = 9999;
    let mp = Math.round(Number($id('adf-maxpend').value));
    if (!isFinite(mp) || mp < 0) mp = 0;
    if (mp > 9999) mp = 9999;
    const vals = {
      nicknameSet: nickSet,
      nickname: nickSet || autoNick(a),
      role: String($id('adf-role').value || ''),
      channels: String($id('adf-channel').value || 'both'),
      productGroups: String($id('adf-groups').value || '').slice(0, 200),
      maxActive: mx,
      maxPending: mp,
      note: String($id('adf-note').value || '').slice(0, 300),
    };
    saving = true;
    dataSeq++; // กัน refetch เบื้องหลังที่เริ่มก่อนหน้านี้เอาข้อมูลเก่ามาทับ
    withBusy(save, 'กำลังบันทึก…', function () {
      return serverCall<SaveRes>('apiAdminSettings', {
        admin: {
          user_id: String(a.id), role: vals.role, channels: vals.channels, product_groups: vals.productGroups,
          max_active: vals.maxActive, max_pending: vals.maxPending, nickname: vals.nicknameSet, note: vals.note,
        },
      });
    }).then(function (res) {
      saving = false;
      if (!(res && res.ok)) { toast(saveErrMsg(res), 'error'); return; }
      Object.assign(a, vals);
      recomputeLocal(a);
      closeModal();
      renderBody(container);
      if (res.warning) toast(saveWarnMsg(res), 'warn');
      else toast('บันทึกตั้งค่า "' + nickOf(a) + '" แล้ว', 'ok');
    }).catch(function (err) {
      saving = false;
      toast(saveErrMsg(null, err), 'error');
    });
  });
}

/* ---------------- modal สถิติ + timeline ---------------- */

function openStats(a: Admin): void {
  const t = a.today || {};
  const ot = a.onlineToday;
  const pageList = splitList(a.pages);
  const pagesHtml = pageList.length
    ? pageList.map(function (p) { return icon(ICON_FOR.page, { size: 14, cls: 'ic-muted' }) + ' ' + esc(p); }).join('<br>')
    : dash();
  const perms = splitList(a.permissions);
  const permsHtml = perms.length
    ? '<div class="pill-grid adm-pills">' +
        perms.map(function (p) { return '<span class="badge neutral">' + esc(p) + '</span>'; }).join('') +
      '</div>'
    : dash();

  // หน้าที่ตามตำแหน่งงาน (จากแท็บ ตำแหน่งงาน & หน้าที่)
  const rp = (lastData && lastData.rolePerms) || null;
  let rolePermHtml = dash();
  if (a.role && rp && rp[a.role]) {
    const onPerms = Object.keys(PERM_LABELS).filter(function (k) { return rp[a.role as string][k]; });
    rolePermHtml = onPerms.length
      ? '<div class="pill-grid adm-pills">' +
          onPerms.map(function (k) {
            return '<span class="badge ai">' + esc(PERM_LABELS[k].split(' (')[0]) + '</span>';
          }).join('') +
        '</div>'
      : '<span class="badge neutral">ไม่มีสิทธิ์ (ดูอย่างเดียว)</span>';
  }

  // timeline วันนี้: จุดเปลี่ยนออนไลน์ (log จริง) + ออเดอร์ (เวลาจริง)
  type Ev = { ts: number; icon: string; text: string };
  const evs: Ev[] = [];
  if (ot) ot.marks.forEach(function (m) {
    evs.push({ ts: m[0], icon: statusDot(m[1] ? 'good' : 'muted'), text: m[1] ? 'ออนไลน์' : 'ออฟไลน์' });
  });
  (a.orderMarks || []).forEach(function (m) {
    evs.push({ ts: m[0], icon: icon(ICON_FOR.orders, { size: 14, cls: 'tx-good' }), text: 'ปิดออเดอร์ ' + THB(m[1]) });
  });
  evs.sort(function (x, y) { return y.ts - x.ts; });
  const evHtml = evs.length
    ? '<div class="adm-tl">' +
        evs.slice(0, 25).map(function (e) {
          return '<div class="adm-tl-row">' +
            // กล่องกว้างเท่ากันทุกแถว — จุดสี 8px กับไอคอน 14px จะได้ไม่ดันข้อความให้เหลื่อมกัน
            '<span class="adm-tl-ic">' + e.icon + '</span>' +
            '<span class="adm-tl-txt">' + esc(e.text) + '</span>' +
            '<span class="adm-tl-time">' + esc(hhmm(e.ts)) + ' น.</span></div>';
        }).join('') +
      '</div>'
    : stateHtml(ot ? 'nodata' : 'wait', {
      title: 'ยังไม่มีเหตุการณ์วันนี้',
      body: ot ? '' : 'ระบบเพิ่งเริ่มเก็บประวัติออนไลน์ — จะแสดงตั้งแต่วันแรกที่มีข้อมูล',
    });

  const sc = scoreOf(a);
  const html =
    '<div class="modal-head">' +
      '<div class="adm-mh">' +
        avatarHtml(a.id, a.name, !!a.online) +
        '<div class="adm-mh-txt">' +
          '<h3>' + esc(nickOf(a)) + '</h3>' +
          (fullNameSub(a) ? '<div class="admin-meta">' + esc(fullNameSub(a)) + '</div>' : '') +
          '<div class="adm-mh-pills">' + statusBadge(a) +
            (a.role ? '<span class="badge brand">' + esc(a.role) + '</span>' : '') +
            (sc === null ? '' :
              '<span class="badge brand" title="คะแนนรวมจากตัวเลขวันนี้ — เกณฑ์ชุดเดียวกับหน้าอันดับแอดมิน (ปรับได้ที่นั่น)">คะแนน ' +
              esc(String(sc)) + '</span>') +
          '</div>' +
        '</div>' +
      '</div>' +
      modalCloseBtn() +
    '</div>' +
    '<div class="kv adm-kv">' +
      kvRow('อีเมล', a.email ? esc(a.email) : dash()) +
      kvRow('แผนก', a.department ? esc(a.department) : dash()) +
      kvRow('กลุ่มขาย (Pancake)', a.saleGroup ? esc(a.saleGroup) : dash()) +
      kvRow('กลุ่มสินค้า (ตั้งเอง)', esc(a.productGroups || 'ทุกกลุ่ม')) +
      kvRow('ช่องทาง', chHtml(chKeyOf(a), true)) +
      (a.note ? kvRow('โน้ต', esc(a.note)) : '') +
      kvRow('เพจที่ดูแล (' + fmtNum(a.pageCount || 0) + ')', pagesHtml) +
      kvRow('สิทธิ์จริงใน Pancake', permsHtml) +
      (a.role ? kvRow('หน้าที่ตามตำแหน่ง (ทะเบียนเรา)', rolePermHtml) : '') +
    '</div>' +
    '<h4 class="t-section adm-sec">สถิติวันนี้</h4>' +
    '<div class="page-stats adm-cells-5">' +
      cellHtml(fmtNum(t.replies || 0), 'ตอบ', '') +
      cellHtml(fmtNum(t.chats || 0), 'คนทัก', '') +
      cellHtml(fmtNum(t.phones || 0), 'เบอร์โทร', '') +
      cellHtml(fmtNum(t.orders || 0), 'ออเดอร์', '') +
      cellHtml(esc(THB(t.revenue || 0)), 'ยอดขาย', '') +
    '</div>' +
    '<div class="page-stats adm-cells-3">' +
      cellHtml(respHtml(t.respMins), 'ตอบเฉลี่ย', '') +
      cellHtml(
        (t.respMinMins !== null && t.respMinMins !== undefined)
          ? esc(respTxt(t.respMinMins) + ' / ' + respTxt(t.respMaxMins)) : dash(),
        'เร็วสุด/ช้าสุด (รายเพจ)', '') +
      cellHtml(lastOnlineStr(a), 'ออนไลน์ล่าสุด', '') +
    '</div>' +
    '<div class="page-stats adm-cells-2">' +
      cellHtml(ot ? esc(hrsFmt(ot.mins)) : dash(), 'ออนไลน์รวมวันนี้', '') +
      cellHtml(ot && ot.gapMins ? esc(hrsFmt(ot.gapMins)) : dash(), 'หายนานสุด',
        ot && ot.gapMins && ot.gapMins > 45 ? 'warn' : '') +
    '</div>' +
    '<h4 class="t-section adm-sec">เหตุการณ์วันนี้</h4>' +
    evHtml +
    '<div class="modal-actions">' +
      '<button type="button" class="btn" id="adm-dt-close">ปิด</button>' +
    '</div>';
  openModal(html);
  const b = document.getElementById('adm-dt-close');
  if (b) b.addEventListener('click', closeModal);
}

/* ---------------- แท็บ ตำแหน่งงาน & หน้าที่ ---------------- */

function rolesTabHtml(): string {
  const rp = (lastData && lastData.rolePerms) || ({} as RolePerms);
  const rows = Object.keys(PERM_LABELS).map(function (perm) {
    return '<tr><td class="adm-perm-name">' + esc(PERM_LABELS[perm]) + '</td>' +
      ADMIN_ROLES.map(function (role) {
        const checked = rp[role] && rp[role][perm];
        // label เต็มช่อง = แตะตรงไหนในช่องก็ติ๊กได้ (เดิมโดนแค่กล่อง 15px — ติ๊กแล้วบันทึกทันที แตะพลาด = เปลี่ยนสิทธิ์จริง)
        return '<td class="adm-perm-cell"><label class="perm-hit"><input type="checkbox" class="perm-cb" data-role="' +
          esc(role) + '" data-perm="' + esc(perm) + '"' + (checked ? ' checked' : '') +
          (role === 'Disabled' ? ' disabled' : '') +
          ' aria-label="' + esc(role + ' — ' + PERM_LABELS[perm]) + '"></label></td>';
      }).join('') +
    '</tr>';
  }).join('');
  // มือถือ (<600): ตาราง 7 ตำแหน่ง กว้าง 880px ในจอ 360 มองไม่เห็นช่องติ๊กเลย (คอลัมน์ชื่อหน้าที่ตรึงบังหมด)
  // → เลือกตำแหน่งทีละตำแหน่ง แล้วติ๊กรายการหน้าที่แถวละ 1 ช่องใหญ่ · ช่องติ๊กชุดนี้ใช้ class/data เดียวกับตาราง
  //   ตัวบันทึก (delegation 'change') จึงใช้ร่วมกันได้ และซิงก์ติ๊กให้อีกชุดตรงกันเสมอ
  const pr = (ADMIN_ROLES as readonly string[]).indexOf(permRole) >= 0 ? permRole : ADMIN_ROLES[0];
  const phone = '<div class="adm-perm-phone">' +
    '<label class="adm-field adm-perm-pick"><span>ตำแหน่ง</span>' +
      '<select class="input" id="adm-perm-role">' +
        ADMIN_ROLES.map(function (r) {
          return '<option value="' + esc(r) + '"' + (r === pr ? ' selected' : '') + '>' + esc(r) + '</option>';
        }).join('') +
      '</select></label>' +
    ADMIN_ROLES.map(function (role) {
      return '<div class="adm-perm-list" data-perm-role="' + esc(role) + '"' + (role === pr ? '' : ' hidden') + '>' +
        (role === 'Disabled' ? '<div class="card-sub">ตำแหน่งนี้ (บัญชีที่ถูกระงับ) แก้ไขไม่ได้</div>' : '') +
        Object.keys(PERM_LABELS).map(function (perm) {
          const checked = rp[role] && rp[role][perm];
          return '<label class="adm-perm-row"><span>' + esc(PERM_LABELS[perm]) + '</span>' +
            '<input type="checkbox" class="perm-cb" data-role="' + esc(role) + '" data-perm="' + esc(perm) + '"' +
            (checked ? ' checked' : '') + (role === 'Disabled' ? ' disabled' : '') + '></label>';
        }).join('') +
      '</div>';
    }).join('') +
  '</div>';
  return '<div class="card">' +
    '<div class="card-head"><h3 class="card-title">ตำแหน่งงาน &amp; หน้าที่' +
      infoTip('ติ๊ก = ตำแหน่งนั้นทำได้ • บันทึกอัตโนมัติทุกครั้งที่ติ๊ก • ใช้เป็นทะเบียนทีมในเว็บนี้ (แสดงผล / รายงาน) • ไม่มีผลกับบัญชี Pancake', 'ตำแหน่งงาน & หน้าที่') +
    '</h3></div>' +
    '<div class="card-sub">ติ๊ก = ตำแหน่งนั้นทำได้ — บันทึกอัตโนมัติ ไม่มีผลกับบัญชี Pancake</div>' +
    // data-cards="off" = ตารางเมทริกซ์ (หน้าที่ × ตำแหน่ง) ทำเป็นการ์ดต่อแถวไม่ได้ ต้องเห็นเป็นตารางถึงจะเทียบตำแหน่งได้
    // ความกว้างขั้นต่ำใช้ .tbl-scroll-x ไม่ใช่ inline style — inline จะทับกฎ min-width:0 ตอนจอกว้าง
    phone +
    '<div class="table-scroll adm-perm-matrix"><table class="tbl tbl-scroll-x tbl-wide" data-cards="off"><thead><tr>' +
      '<th>หน้าที่</th>' +
      ADMIN_ROLES.map(function (r) { return '<th class="adm-perm-th">' + esc(r) + '</th>'; }).join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
  '</div>';
}

let roleSaveTimer: ReturnType<typeof setTimeout> | null = null;
let roleSaving = false;

function saveRolePerms(): void {
  if (roleSaveTimer) clearTimeout(roleSaveTimer);
  roleSaveTimer = setTimeout(function () {
    roleSaveTimer = null; // เคลียร์ handle — ตัวเช็คใน fetchData จะได้ไม่ค้าง
    const rp = (lastData && lastData.rolePerms) || null;
    if (!rp) return;
    roleSaving = true;
    const retry = { label: 'ลองใหม่', fn: saveRolePerms };
    serverCall<SaveRes>('apiAdminSettings', { rolePerms: rp }).then(function (res) {
      roleSaving = false;
      if (res && res.ok) toast('บันทึกหน้าที่ของตำแหน่งแล้ว', 'ok');
      else toast(saveErrMsg(res), 'error', { action: retry });
    }).catch(function (err) {
      roleSaving = false;
      toast(saveErrMsg(null, err), 'error', { action: retry });
    });
  }, 600);
}

/* ---------------- export CSV ---------------- */

function exportCsv(): void {
  const list = getFiltered();
  if (!list.length) {
    toast('ไม่มีข้อมูลแอดมินให้ดาวน์โหลด', 'warn');
    return;
  }
  const rows: unknown[][] = [[
    'ชื่อเล่น', 'ชื่อ', 'อีเมล', 'Role', 'เปิดใช้งาน', 'สถานะ', 'ช่องทาง', 'กลุ่มสินค้า', 'แผนก', 'กลุ่มขาย', 'เพจ',
    'ตอบวันนี้', 'แชทดูแล(24ชม.)', 'เพดาน', 'รอตอบ', 'รอตอบ-อินบ็อกซ์', 'รอตอบ-คอมเมนต์',
    'เพดานรอตอบ', 'เกิน SLA', 'ตอบเฉลี่ย(นาที)',
    'ออเดอร์วันนี้', 'ยอดขายวันนี้', 'คะแนน Overall (วันนี้)', 'ออนไลน์วันนี้(นาที)', 'หายนานสุด(นาที)', 'โน้ต'
  ]];
  list.forEach(function (a) {
    const t = a.today || {};
    const ot = a.onlineToday;
    const sc = scoreOf(a);
    const waitN = Number(a.waiting) || 0;
    const waitCmt = Number(a.waitingComment) || 0;
    rows.push([
      nickOf(a), a.name || '', a.email || '', a.role || '', a.enabled !== false ? 'ใช่' : 'ไม่',
      statusView(a).word, a.channels || 'both', a.productGroups || '', a.department || '',
      a.saleGroup || '', a.pages || '',
      t.replies || 0, Number(a.active) || 0, Number(a.maxActive) || DEFAULT_MAX_ACTIVE, waitN,
      Math.max(0, waitN - waitCmt), waitCmt,
      Number(a.maxPending) || 0, Number(a.overSla) || 0,
      (t.respMins === null || t.respMins === undefined) ? '' : t.respMins,
      t.orders || 0, t.revenue || 0, sc === null ? '' : sc,
      ot ? ot.mins : '', ot && ot.gapMins ? ot.gapMins : '', a.note || ''
    ]);
  });
  downloadCSV(rows, 'admin-report');
}

/* ---------------- render ---------------- */

/** แถวหัวกลุ่มที่พับได้ "ออฟไลน์ 61 คน — กดเพื่อแสดง" */
function groupToggleHtml(key: 'offline' | 'disabled', n: number): string {
  if (!n) return '';
  const open = groupOpen[key];
  const word = key === 'offline' ? 'ออฟไลน์' : 'ระงับอยู่';
  return '<button type="button" class="adm-group" data-admgroup="' + key + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
    statusDot('muted') + '<span class="adm-group-t">' + word + ' ' + fmtNum(n) + ' คน</span>' +
    '<span class="adm-group-h">— ' + (open ? 'กดเพื่อซ่อน' : 'กดเพื่อแสดง') + '</span>' +
    icon(open ? 'chevron-up' : 'chevron-down', { size: 16, cls: 'adm-group-c' }) +
  '</button>';
}

function renderGrid(container: HTMLElement): void {
  const wrap = container.querySelector('#adm-grid-wrap');
  if (!wrap) return;
  closeMenu(false); // ปุ่มที่เมนูเกาะอยู่กำลังจะถูกวาดใหม่
  const admins = (lastData && lastData.admins) || [];
  if (!admins.length) {
    wrap.innerHTML = stateHtml('wait', {
      title: 'ยังไม่มีรายชื่อแอดมิน',
      body: 'ระบบดึงรายชื่อแอดมินจาก Pancake ทุกชั่วโมง — ลองกลับมาดูอีกครั้งในอีกสักครู่',
    });
    return;
  }
  const list = getFiltered();
  if (!list.length) {
    wrap.innerHTML = stateHtml('nodata', {
      title: 'ไม่พบแอดมินตามตัวกรอง',
      body: 'ลองล้างตัวกรองหรือเปลี่ยนคำค้น',
      actionsHtml: '<button type="button" class="btn" id="adm-clear">' + icon('x', { size: 16 }) + 'ล้างตัวกรอง</button>',
    });
    const clr = wrap.querySelector('#adm-clear');
    if (clr) clr.addEventListener('click', function () {
      Object.keys(filter).forEach(function (k) { filter[k as keyof typeof filter] = ''; });
      render(container);
    });
    return;
  }
  const rows = viewMode === 'rows';
  const item = rows ? rowHtml : cardHtml;
  const block = function (arr: Admin[]): string {
    if (!arr.length) return '';
    return rows ? arr.map(item).join('') : '<div class="admin-grid">' + arr.map(item).join('') + '</div>';
  };
  // พับกลุ่มออฟไลน์/ระงับอยู่ เฉพาะตอนดูภาพรวม — ถ้ากำลังค้นชื่อหรือกรองสถานะ ต้องเห็นผลครบทันที
  // (ค้น "นล" แล้วเจอแต่แถว "ออฟไลน์ 1 คน — กดเพื่อแสดง" = เหมือนค้นไม่เจอ)
  const fold = !filter.q && !filter.status;
  const working = fold ? list.filter(function (a) { const s = statusOf(a); return s !== 'offline' && s !== 'disabled'; }) : list;
  const offline = fold ? list.filter(function (a) { return statusOf(a) === 'offline'; }) : [];
  const disabled = fold ? list.filter(function (a) { return statusOf(a) === 'disabled'; }) : [];
  // B3: เกินครึ่งติดเรื่องเดียวกัน = ไม่ทาส้มทุกแถว — ฐานคือ "คนที่ทำงานอยู่" (ไม่ออฟไลน์/ไม่ระงับ) ในข้อมูลทั้งหมด
  // ห้ามขึ้นกับแถวที่เห็น/ตัวกรอง: เดิมกางกลุ่มออฟไลน์หรือค้นชื่อแล้วคนเดิมเปลี่ยนเทา↔ส้ม ทั้งที่ข้อมูลเขาไม่ได้เปลี่ยน
  // ห้ามนับคนออฟไลน์ด้วย: เขาไม่มีวันเต็มเพดาน/เกิน SLA ฐานจะใหญ่จนกติกาไม่เคยทำงาน (ส้มเกือบทุกแถว)
  const shown = ((lastData && lastData.admins) || []).filter(function (a) {
    const s = statusOf(a);
    return a.enabled !== false && s !== 'offline' && s !== 'disabled';
  });
  const half = function (n: number): boolean { return n * 2 <= shown.length; };
  capColorOn = half(shown.filter(function (a) { return capOf(a).key === 'full'; }).length);
  slaColorOn = half(shown.filter(function (a) { return (Number(a.overSla) || 0) > 0; }).length);
  gapColorOn = half(shown.filter(function (a) { return !!(a.onlineToday && Number(a.onlineToday.gapMins) > 45); }).length);
  let body: string;
  if (fold) {
    body = (working.length
        ? block(working)
        : '<div class="adm-none">' + icon('moon-star', { size: 16 }) + 'ตอนนี้ยังไม่มีแอดมินออนไลน์</div>') +
      groupToggleHtml('offline', offline.length) + (groupOpen.offline ? block(offline) : '') +
      groupToggleHtml('disabled', disabled.length) + (groupOpen.disabled ? block(disabled) : '');
  } else {
    body = block(list);
  }
  wrap.innerHTML = rows
    ? '<div class="adm-list">' + listHeadHtml() + body + '</div>'
    : '<div class="adm-cards">' + body + '</div>';
}

/** วาดเฉพาะส่วนใต้ tab (กรอง/รายชื่อ หรือ ตารางหน้าที่) — ใช้หลัง action ที่ไม่แตะกล่องสรุป */
function renderBody(container: HTMLElement): void {
  if (tab === 'cards') renderGrid(container);
  else {
    const wrap = container.querySelector('#adm-grid-wrap');
    if (wrap) wrap.innerHTML = rolesTabHtml();
  }
}

/** กล่องตัวเลขสรุป 1 กล่อง (ชิ้นส่วนกลาง .stat-box) — valHtml ต้อง escape มาแล้ว · ic = HTML ไอคอน */
function sumBox(label: string, valHtml: string, ic: string, opts?: { cls?: string; sub?: string; tip?: string }): string {
  const o = opts || {};
  return '<div class="stat-box">' +
    '<div class="sb-label">' + ic + '<span>' + esc(label) + '</span>' + (o.tip ? infoTip(o.tip, label) : '') + '</div>' +
    '<div class="sb-value ' + (o.cls || 'v-plain') + '">' + valHtml + '</div>' +
    (o.sub ? '<div class="sb-sub">' + o.sub + '</div>' : '') +
  '</div>';
}

/** 12 กล่อง = 2 กลุ่ม × 6 (ทีม / งานวันนี้) — เต็มแถวพอดีทุกขนาดจอ (2 / 3 / 4 / 6 คอลัมน์) */
function summaryHtml(d: AdminsData): string {
  const k = d.kpis || {};
  const waitingTotal = Number(k.waitingTotal) || 0;
  const waitingCmt = Number(k.waitingCommentTotal) || 0;
  const waitingInbox = (k.waitingInboxTotal === undefined)
    ? Math.max(0, waitingTotal - waitingCmt) : Number(k.waitingInboxTotal) || 0;
  const overSlaTotal = Number(k.overSlaTotal) || 0;
  const slaMins = Number(d.slaMins) || 60;
  const fullN = Number(k.fullCap) || 0;
  const n = function (v: unknown): string { return esc(fmtNum(Number(v) || 0)); };
  const ic = function (name: string, cat: string): string { return icon(name, { size: 14, cls: 'si si-' + cat }); };
  // E3: จำนวนคนเฉยๆ ไม่ได้ตัดสินอะไร = ตัวหนาสีปกติ (เดิม "ออนไลน์"/"มียอดขายวันนี้" เป็นเขียว)
  //     ส้ม = เรื่องที่ควรเฝ้าดู (เต็มเพดาน / แชทรอ / เกิน SLA) · ไม่มีแดง เพราะไม่ใช่เรื่องที่มีไม่กี่เรื่องแล้วต้องทำทันที
  return '<div class="stat-boxes adm-sum">' +
    sumBox('แอดมินทั้งหมด', n(k.total), statIcon('admin')) +
    sumBox('ออนไลน์', n(k.online), statusDot('good')) +
    sumBox('พัก/ไม่ว่าง', n(k.away), statusDot('warn')) +
    sumBox('ออฟไลน์', n(k.offline), statusDot('muted')) +
    sumBox('ระงับอยู่', n(k.disabled), ic('ban', 'misc')) +
    sumBox('เต็มเพดานแชท', n(fullN), ic('gauge', 'chat'), {
      cls: fullN > 0 ? 'v-warn' : 'v-plain',
      tip: 'จำนวนแอดมินที่แชทที่ดูแล (24 ชม.) ถึงเพดานที่ตั้งไว้แล้ว • ตั้งเพดานต่อคนได้ที่เมนู ⋯ > สิทธิ์และตั้งค่า',
    }) +
    sumBox('ตอบแชทวันนี้', n(k.repliedToday), ic('message-circle-reply', 'chat'), {
      tip: 'จำนวนแอดมินที่ตอบแชทอย่างน้อย 1 ข้อความวันนี้',
    }) +
    sumBox('มียอดขายวันนี้', n(k.withSalesToday), statIcon('orders'), {
      tip: 'จำนวนแอดมินที่มีออเดอร์อย่างน้อย 1 ออเดอร์วันนี้',
    }) +
    sumBox('แชทที่ดูแลรวม (24 ชม.)', n(k.activeTotal), statIcon('inquiries')) +
    // แชทรอตอบ = อินบ็อกซ์ + คอมเมนต์ใต้โพสต์ (คนละงานกัน — ~41% ที่ค้างเป็นคอมเมนต์)
    sumBox('แชทรอตอบ', n(waitingTotal), ic('hourglass', 'chat'), {
      cls: waitingTotal > 0 ? 'v-warn' : 'v-plain',
      sub: waitSplitHtml_(waitingInbox, waitingCmt),
      tip: 'แชทที่ลูกค้ารอตอบตอนนี้ (24 ชม.ล่าสุด) • แยกเป็นอินบ็อกซ์กับคอมเมนต์ใต้โพสต์ เพราะเป็นงานคนละแบบ',
    }) +
    sumBox('เกิน SLA ' + slaMins + ' น.', n(overSlaTotal), ic('clock', 'chat'), {
      cls: overSlaTotal > 0 ? 'v-warn' : 'v-plain',
      tip: 'แชทที่ลูกค้ารอเกิน ' + slaMins + ' นาที (นับจากเวลาข้อความล่าสุดของแชท) • เปลี่ยนเกณฑ์ได้ที่ปุ่ม SLA',
    }) +
    sumBox('เบอร์โทรวันนี้', n(k.phonesToday), ic('phone', 'cust')) +
  '</div>';
}

/** กล่อง "ข้อมูลนี้มาจากไหน" — เดิมเป็นกล่องคำอธิบาย 3 บรรทัดโชว์ตลอด ตอนนี้พับไว้ (ข้อความครบเหมือนเดิม แต่เป็นภาษาคน) */
function sourceNoteHtml(): string {
  return '<details class="adm-src">' +
    '<summary>' + icon('circle-help', { size: 14 }) + 'ข้อมูลนี้มาจากไหน</summary>' +
    '<ul class="adm-src-body">' +
      '<li><b>ตัวเลขแชท</b> (ตอบวันนี้ / ตอบเฉลี่ย) อัปเดตทุกประมาณ 15 นาที ไม่ใช่วินาทีต่อวินาที</li>' +
      '<li>เพจ ' + brandIcon('facebook') + ' Facebook ตรงกับ Pancake ทุกตัว • เพจ ' + brandIcon('line') +
        ' LINE บางเพจ Pancake ไม่ส่งตัวเลขรายแอดมินมาให้ จึงนับได้ไม่ครบ 100%</li>' +
      '<li>ออเดอร์และยอดขาย LINE นับครบ (ดูได้ที่หน้ายอดขาย) • คนทัก LINE นับจากเพจที่ Pancake ส่งตัวเลขมาให้</li>' +
      '<li>ตัวกรอง <b>“ช่องทาง”</b> กรองตามช่องทางที่ตั้งให้แอดมินรับผิดชอบ (ตั้งที่เมนู ⋯ > สิทธิ์และตั้งค่า) ไม่ได้กรองแหล่งข้อมูล</li>' +
      '<li><b>แชทรอตอบ</b> = แชทที่ลูกค้ารอตอบตอนนี้ (24 ชม.ล่าสุด) รวมอินบ็อกซ์และคอมเมนต์ใต้โพสต์ • ' +
        '<b>เกิน SLA</b> = รอนานเกินเกณฑ์ที่ตั้ง นับจากเวลาข้อความล่าสุดของแชท</li>' +
    '</ul>' +
  '</details>';
}

function selectHtml(id: string, aria: string, cur: string, opts: { v: string; t: string }[]): string {
  return '<select class="input" id="' + id + '" aria-label="' + esc(aria) + '">' +
    opts.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (cur === o.v ? ' selected' : '') + '>' + esc(o.t) + '</option>';
    }).join('') + '</select>';
}

function toolbarHtml(depts: string[], groups: string[], slaMins: number, d: AdminsData): string {
  const nFilt = activeFilterCount();
  const more =
    selectHtml('adm-status', 'กรองตามสถานะ', filter.status, [
      { v: '', t: 'ทุกสถานะ' }, { v: 'online', t: 'ออนไลน์' }, { v: 'away', t: 'พัก' },
      { v: 'busy', t: 'ไม่ว่าง' }, { v: 'offline', t: 'ออฟไลน์' }, { v: 'disabled', t: 'ระงับอยู่' },
    ]) +
    selectHtml('adm-role', 'กรองตามตำแหน่งงาน', filter.role,
      [{ v: '', t: 'ทุกตำแหน่ง' }].concat(ADMIN_ROLES.map(function (r) { return { v: r, t: r }; }))) +
    selectHtml('adm-dept', 'กรองตามแผนก', filter.dept,
      [{ v: '', t: 'ทุกแผนก' }].concat(depts.map(function (x) { return { v: x, t: x }; }))) +
    selectHtml('adm-channel', 'กรองตามช่องทางที่รับผิดชอบ', filter.channel, [
      { v: '', t: 'ทุกช่องทาง' }, { v: 'facebook', t: 'Facebook' }, { v: 'line', t: 'LINE' },
    ]) +
    (groups.length
      ? selectHtml('adm-group', 'กรองตามกลุ่มสินค้า', filter.group,
        [{ v: '', t: 'ทุกกลุ่มสินค้า' }].concat(groups.map(function (g) { return { v: g, t: g }; })))
      : '') +
    selectHtml('adm-cap', 'กรองตามเพดานแชท', filter.cap, [
      { v: '', t: 'เพดานแชท: ทั้งหมด' }, { v: 'available', t: 'ว่างรับแชท' }, { v: 'near', t: 'ใกล้เต็ม' },
      { v: 'full', t: 'เต็มแล้ว' }, { v: 'slow', t: 'ตอบช้า (>8 นาที)' },
    ]);
  const vsw = function (v: ViewMode, ic: string, label: string): string {
    const on = viewMode === v || (!viewMode && v === 'cards');
    return '<button type="button" class="filter-btn' + (on ? ' active' : '') + '" data-admview="' + v + '">' +
      icon(ic, { size: 16 }) + '<span>' + label + '</span></button>';
  };
  return '<div class="toolbar adm-toolbar">' +
      '<div class="tb-filters adm-filters' + (filtersOpen ? ' open' : '') + '">' +
        // ความกว้างขั้นต่ำอยู่ที่กรอบ .search-box (ไอคอนแว่นขยายวางซ้อนในกรอบ)
        '<div class="search-box adm-search">' + icon(ICON_FOR.search) +
          '<input class="input" id="adm-q" type="text" placeholder="ค้นหาชื่อแอดมิน..." aria-label="ค้นหาชื่อแอดมิน" ' +
          'value="' + esc(filter.q) + '"></div>' +
        // มือถือ: ตัวกรอง 6 ช่องพับไว้หลังปุ่มเดียว (ไม่ให้กินครึ่งจอแรก) — จอ ≥900 โชว์ครบ ปุ่มนี้หายไป
        '<button type="button" class="btn adm-filt-btn" id="adm-filt-btn" aria-expanded="' + (filtersOpen ? 'true' : 'false') +
          '" aria-controls="adm-filt-more">' + icon(ICON_FOR.filter, { size: 16 }) + 'ตัวกรอง' +
          (nFilt ? ' (' + nFilt + ')' : '') + '</button>' +
        '<div class="adm-filt-more" id="adm-filt-more">' + more + '</div>' +
      '</div>' +
      '<div class="tb-actions">' +
        '<div class="adm-viewsw" role="group" aria-label="รูปแบบการแสดง">' +
          vsw('cards', 'layout-dashboard', 'การ์ด') + vsw('rows', 'list', 'แถว') +   // การ์ด = ค่าเริ่มต้น จึงอยู่ซ้าย
        '</div>' +
        '<button type="button" class="btn" id="adm-sla" title="แชทที่ลูกค้ารอเกินกี่นาทีถือว่าเกิน SLA (ใช้ร่วมกับหน้าอันดับแอดมิน)">' +
          icon(ICON_FOR.time) + 'SLA ' + slaMins + ' น.</button>' +
        downloadMenuHtml('adm-dl') +
      '</div>' +
    '</div>' +
    // สถิติแชท (ตอบวันนี้/ตอบเฉลี่ย) เป็นสแนปช็อตทุก ~15 นาที ไม่ใช่สด — บอกให้ชัด กันเข้าใจว่าไม่ตรง Pancake
    '<div class="data-asof adm-asof">' +
      icon(ICON_FOR.time, { size: 14 }) +
      '<span>ตัวเลขแชทอัปเดต' + (d.chatSyncedAt ? 'ล่าสุด ' + esc(relTime(d.chatSyncedAt)) : 'ทุก ~15 นาที') + '</span>' +
      sourceNoteHtml() +
    '</div>';
}

function render(container: HTMLElement): void {
  const d = lastData || {};
  const admins = d.admins || [];

  /* แผนกที่มีจริง (ไม่ว่าง, ไม่ซ้ำ) */
  const depts: string[] = [], seen: Record<string, boolean> = {};
  admins.forEach(function (a) {
    const dep = String(a.department || '').replace(/^\s+|\s+$/g, '');
    if (dep && !seen[dep]) { seen[dep] = true; depts.push(dep); }
  });
  depts.sort(function (a, b) { return a.localeCompare(b, 'th'); });
  if (filter.dept && !seen[filter.dept]) filter.dept = '';

  const slaMins = Number(d.slaMins) || 60;
  const groups = allGroups();
  if (filter.group && groups.indexOf(filter.group) < 0) filter.group = '';

  const tabBtn = function (key: 'cards' | 'roles', ic: string, label: string): string {
    const on = tab === key;
    return '<button type="button" class="tab" role="tab" id="adm-tab-' + key + '" aria-selected="' + (on ? 'true' : 'false') +
      '" aria-controls="adm-grid-wrap" tabindex="' + (on ? '0' : '-1') + '">' + icon(ic, { size: 16 }) + label + '</button>';
  };

  const html =
    // C2: สลับหน้าย่อย = แท็บ (ตัวหนังสือ + เส้นใต้) ไม่ใช่ปุ่มม่วงทึบ
    '<div class="tabs adm-tabs" role="tablist" aria-label="หน้าย่อยจัดการแอดมิน">' +
      tabBtn('cards', ICON_FOR.admins, 'แอดมิน') + tabBtn('roles', 'lock', 'ตำแหน่งงาน &amp; หน้าที่') +
    '</div>' +
    (d.setupNeeded
      ? stateHtml('notready', {
        title: 'ยังบันทึกการตั้งค่าแอดมินไม่ได้',
        body: 'ปุ่มระงับบัญชี / สถานะ / ตั้งค่าจะยังบันทึกไม่ได้ และยังไม่เริ่มเก็บเวลาออนไลน์ — กรุณาแจ้งผู้ดูแลระบบ',
        adminDetail: 'ตาราง admin_settings ยังไม่ถูกสร้างใน Supabase — รัน SQL migration ของ admin_settings / admin_online_log แล้วทุกอย่างจะทำงานอัตโนมัติ',
      })
      : '') +
    (tab === 'cards' ? summaryHtml(d) + toolbarHtml(depts, groups, slaMins, d) : '') +
    '<div id="adm-grid-wrap" role="tabpanel" aria-labelledby="adm-tab-' + tab + '"></div>';

  container.innerHTML = html;
  renderBody(container);
  bindEvents(container);
}

/* ---------------- events ---------------- */

function bindEvents(container: HTMLElement): void {
  const switchTab = function (key: 'cards' | 'roles'): void {
    if (tab === key) return;
    tab = key;
    render(container);
    const b = container.querySelector('#adm-tab-' + key) as HTMLElement | null;
    if (b) b.focus();
  };
  const tabCards = container.querySelector('#adm-tab-cards');
  if (tabCards) tabCards.addEventListener('click', function () { switchTab('cards'); });
  const tabRoles = container.querySelector('#adm-tab-roles');
  if (tabRoles) tabRoles.addEventListener('click', function () { switchTab('roles'); });
  // ลูกศรซ้าย/ขวาสลับแท็บ (แบบแผนของ tablist)
  const tabList = container.querySelector('.adm-tabs');
  if (tabList) tabList.addEventListener('keydown', function (e) {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); switchTab(tab === 'cards' ? 'roles' : 'cards'); }
  });

  const q = container.querySelector('#adm-q') as HTMLInputElement | null;
  if (q) q.addEventListener('input', function () {
    filter.q = q.value;
    renderGrid(container);
  });

  const selMap: [string, keyof typeof filter][] = [
    ['#adm-status', 'status'], ['#adm-role', 'role'], ['#adm-dept', 'dept'],
    ['#adm-channel', 'channel'], ['#adm-group', 'group'], ['#adm-cap', 'cap'],
  ];
  const filtBtn = container.querySelector('#adm-filt-btn') as HTMLElement | null;
  const refreshFiltCount = function (): void {
    if (!filtBtn) return;
    const n = activeFilterCount();
    filtBtn.innerHTML = icon(ICON_FOR.filter, { size: 16 }) + 'ตัวกรอง' + (n ? ' (' + n + ')' : '');
  };
  selMap.forEach(function (pair) {
    const el = container.querySelector(pair[0]) as HTMLSelectElement | null;
    if (el) el.addEventListener('change', function () {
      filter[pair[1]] = el.value;
      refreshFiltCount();
      renderGrid(container);
    });
  });
  if (filtBtn) filtBtn.addEventListener('click', function () {
    filtersOpen = !filtersOpen;
    const box = container.querySelector('.adm-filters');
    if (box) box.classList.toggle('open', filtersOpen);
    filtBtn.setAttribute('aria-expanded', filtersOpen ? 'true' : 'false');
  });

  // สลับมุมมอง แถว / การ์ด — จำไว้ต่อเครื่อง
  container.querySelectorAll('[data-admview]').forEach(function (b) {
    b.addEventListener('click', function () {
      const v: ViewMode = b.getAttribute('data-admview') === 'cards' ? 'cards' : 'rows';
      if (viewMode === v) return;
      viewMode = v;
      writeViewMode(v);
      container.querySelectorAll('[data-admview]').forEach(function (x) {
        x.classList.toggle('active', x.getAttribute('data-admview') === v);
      });
      renderGrid(container);
    });
  });

  bindDownloadMenu(container, 'adm-dl', { csv: exportCsv });

  const slaBtn = container.querySelector('#adm-sla');
  if (slaBtn) slaBtn.addEventListener('click', function () { openSlaEditor(container); });

  const wrap = container.querySelector('#adm-grid-wrap');
  if (!wrap) return;

  // คลิกในรายชื่อ (delegation — แถว/การ์ดถูกวาดใหม่บ่อย)
  wrap.addEventListener('click', function (e) {
    const el = (e.target as HTMLElement).closest(
      '[data-admore],[data-adrow],[data-admgroup],[data-adtoggle],[data-adedit],[data-adstats]') as HTMLElement | null;
    if (!el || !wrap.contains(el)) return;
    const more = el.getAttribute('data-admore');
    if (more !== null) {
      const a = findAdmin(more);
      if (a) openMenu(el, a, container);
      return;
    }
    const rowId = el.getAttribute('data-adrow');
    if (rowId !== null) {
      // แตะแถว = กาง/พับรายละเอียด (ไม่วาดทั้งรายการใหม่ — ตำแหน่งจอไม่กระโดด)
      const a = findAdmin(rowId);
      const row = el.closest('.adm-row') as HTMLElement | null;
      const det = row && row.querySelector('.adm-det') as HTMLElement | null;
      if (!a || !row || !det) return;
      const open = !openRows[rowId];
      if (open) openRows[rowId] = true; else delete openRows[rowId];
      if (open) det.innerHTML = detailHtml(a);
      det.hidden = !open;
      row.classList.toggle('open', open);
      el.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    const grp = el.getAttribute('data-admgroup');
    if (grp === 'offline' || grp === 'disabled') {
      groupOpen[grp] = !groupOpen[grp];
      renderGrid(container);
      const again = container.querySelector('[data-admgroup="' + grp + '"]') as HTMLElement | null;
      if (again) again.focus({ preventScroll: true });
      return;
    }
    const idToggle = el.getAttribute('data-adtoggle');
    if (idToggle !== null) {
      const a = findAdmin(idToggle);
      if (a) setEnabled(a, a.enabled === false, container);
      return;
    }
    const idEdit = el.getAttribute('data-adedit');
    if (idEdit !== null) {
      const a = findAdmin(idEdit);
      if (a) openSettings(a, container);
      return;
    }
    const idStats = el.getAttribute('data-adstats');
    if (idStats !== null) {
      const a = findAdmin(idStats);
      if (a) openStats(a);
    }
  });

  // เปลี่ยนสถานะ override บนการ์ด + ติ๊กตารางหน้าที่ (delegation ผ่าน event change)
  wrap.addEventListener('change', function (e) {
    const el = e.target as any;
    if (!el || !el.getAttribute) return;
    const idStatus = el.getAttribute('data-adstatus');
    if (idStatus !== null) {
      const a = findAdmin(idStatus);
      if (a) setStatusOverride(a, String(el.value || ''), container);
      return;
    }
    // ตารางหน้าที่แบบมือถือ: เลือกตำแหน่ง → โชว์รายการของตำแหน่งนั้น
    if (el.id === 'adm-perm-role') {
      permRole = String(el.value || ADMIN_ROLES[0]);
      wrap.querySelectorAll('[data-perm-role]').forEach(function (x) {
        (x as HTMLElement).hidden = x.getAttribute('data-perm-role') !== permRole;
      });
      return;
    }
    if (el.classList && el.classList.contains('perm-cb')) {
      const role = el.getAttribute('data-role');
      const perm = el.getAttribute('data-perm');
      const rp = (lastData && lastData.rolePerms) || null;
      if (rp && role && perm && rp[role]) {
        // ช่องติ๊กมี 2 ชุด (ตาราง + แบบมือถือ) — ให้อีกชุดตรงกันทันที
        wrap.querySelectorAll('.perm-cb').forEach(function (x) {
          const cb = x as HTMLInputElement;
          if (cb !== el && cb.getAttribute('data-role') === role && cb.getAttribute('data-perm') === perm) cb.checked = !!el.checked;
        });
        rp[role][perm] = !!el.checked;
        dataSeq++; // แก้ matrix ใน state แล้ว — กัน refetch เก่ามาทับก่อน save
        saveRolePerms();
      }
    }
  });
}

/* ---------------- modal ตั้งเกณฑ์ SLA (เก็บใน app_settings — ใช้ร่วมทั้งทีม/ทุกหน้า) ---------------- */

function openSlaEditor(container: HTMLElement): void {
  const cur = Number(lastData && lastData.slaMins) || 60;
  openModal(
    '<div class="modal-head"><h3>ตั้งเกณฑ์ SLA แชทรอตอบ</h3>' + modalCloseBtn() + '</div>' +
    '<div class="card-sub adm-sla-sub">' +
      'แชทที่ลูกค้ารอนานเกินกี่นาทีถือว่า <b>เกิน SLA</b> — นับจากเวลาข้อความล่าสุดของแชท ' +
      '(Pancake ไม่ได้ส่งเวลาของทุกข้อความมาให้ จึงเป็นค่าประมาณ) • ใช้เกณฑ์เดียวกันที่หน้าอันดับแอดมินด้วย</div>' +
    '<label class="adm-sla-row"><input type="number" class="input adm-sla-inp" id="sla-input" min="5" max="1440" step="5" value="' + cur +
      '" aria-label="เกณฑ์ SLA (นาที)"><span>นาที</span></label>' +
    '<div class="modal-actions">' +
      '<button type="button" class="btn" id="sla-cancel">ยกเลิก</button>' +
      '<button type="button" class="btn primary" id="sla-save">' + icon(ICON_FOR.save) + 'บันทึก</button>' +
    '</div>'
  );
  const root = document.getElementById('modal-root')!;
  const cancel = root.querySelector('#sla-cancel');
  if (cancel) cancel.addEventListener('click', closeModal);
  const save = root.querySelector('#sla-save') as HTMLButtonElement | null;
  if (save) save.addEventListener('click', function () {
    const inp = root.querySelector('#sla-input') as HTMLInputElement | null;
    const v = inp ? Math.round(Number(inp.value)) : NaN;
    if (!isFinite(v) || v < 5 || v > 1440) { toast('เกณฑ์ SLA ต้องอยู่ระหว่าง 5-1440 นาที', 'warn'); return; }
    withBusy(save, 'กำลังบันทึก…', function () {
      return serverCall('apiAppSettings', { settings: { slaMins: v } });
    }).then(function () {
      closeModal();
      toast('ตั้งเกณฑ์ SLA ' + v + ' นาทีแล้ว — กำลังคำนวณใหม่', 'ok');
      dataSeq++; // กัน refetch เบื้องหลังเก่ามาทับ
      container.innerHTML = adminsSkel();
      fetchData(container, false); // ให้ server นับ "เกิน SLA" ด้วยเกณฑ์ใหม่
    }).catch(function (err) {
      toast(saveErrMsg(null, err), 'error');
    });
  });
}

/* ---------------- fetch ---------------- */

function fetchData(container: HTMLElement, silent: boolean): void {
  const seqAtStart = dataSeq;
  serverCall<AdminsData>('apiAdmins').then(function (data) {
    if (silent) {
      // refetch เบื้องหลัง: ห้ามทับ state ถ้า (ก) ผู้ใช้เพิ่งแก้อะไรไป (ข้อมูลที่ได้มาเก่ากว่า)
      // (ข) มี save ค้างอยู่ (ค) modal เปิดอยู่ (ปิด modal ทิ้งกลางคันไม่ได้ — ถือ object เดิมอยู่)
      // (ง) เมนู ⋯ เปิดอยู่ (วาดใหม่ = เมนูหายต่อหน้า)
      const modalRoot = document.getElementById('modal-root');
      const busy = dataSeq !== seqAtStart || saving || roleSaving || roleSaveTimer !== null ||
        !!(modalRoot && modalRoot.innerHTML) || !!menuPop;
      if (busy) return;
    }
    lastData = data;
    render(container);
  }).catch(function (err) {
    const msg = (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ';
    if (silent && lastData) {
      // ข้อความดิบจากเซิร์ฟเวอร์อาจเป็นหน้า HTML ทั้งหน้า — ห้ามยัดลงข้อความเด้ง
      toast('รีเฟรชข้อมูลแอดมินไม่สำเร็จ — ลองใหม่อีกครั้ง', 'error', {
        action: { label: 'ลองใหม่', fn: function () { fetchData(container, true); } },
      });
    } else {
      showError(container, msg, function () {
        container.innerHTML = adminsSkel();
        fetchData(container, false);
      });
    }
  });
}

/* ---------------- ลงทะเบียน view ---------------- */

export const admins = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (!viewMode) viewMode = readViewMode();
    await loadScoreCfg(); // เกณฑ์คะแนนรวม (โหลดครั้งเดียว — ใช้ใน stats modal + CSV)
    if (lastData && !force) {
      render(container);
      fetchData(container, true); /* อัปเดตเบื้องหลัง */
    } else {
      container.innerHTML = adminsSkel();
      fetchData(container, false);
    }
  },
};
