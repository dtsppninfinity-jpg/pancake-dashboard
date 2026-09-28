/* ============================================================
   โหลดโค้ดของแต่ละหน้าแยกก้อน (lazy view chunk)
   เดิม app-core import ทุกหน้า 12 ไฟล์ตั้งแต่ต้น = ก้อน JS ~460 KB (บีบแล้ว ~118 KB) ต้องโหลด + แปลงโค้ด
   ครบทุกหน้าก่อนหน้าแรกจะเริ่มทำงาน — มือถือรุ่นกลางๆ เสียเวลาแปลงโค้ดหน้าที่ยังไม่ได้เปิดเป็นร้อยมิลลิวินาที
   ตอนนี้: หน้าแรกโหลดเฉพาะก้อนของตัวเอง (เริ่มพร้อม app-core — DashboardClient เรียก preloadView ทันที)
   หน้าที่เหลือทยอยโหลดเงียบๆ หลังหน้าแรกขึ้นแล้ว (app-core) กดเมนูเมื่อไหร่ก็พร้อมใช้
   ============================================================ */

export interface ViewModule {
  load: (container: HTMLElement, force: boolean) => void | Promise<void>;
  /** วาดใหม่จากข้อมูลที่มีอยู่ ไม่ยิง server (หมุนจอข้ามเส้น 600px — กราฟเลือกขนาดตอนวาด) */
  redraw?: (container: HTMLElement) => void;
}

// import() ต้องเป็นสตริงตายตัวทีละไฟล์ — bundler จะแยกเป็นก้อนละหน้าได้ก็ต่อเมื่อเห็นชื่อไฟล์ตรงๆ
const LOADERS: Record<string, () => Promise<ViewModule>> = {
  dashboard: () => import('@/lib/views/dashboard').then((m) => m.dashboard),
  sales: () => import('@/lib/views/sales').then((m) => m.sales),
  contentads: () => import('@/lib/views/contentads').then((m) => m.contentads),
  admins: () => import('@/lib/views/admins').then((m) => m.admins),
  adminperf: () => import('@/lib/views/adminperf').then((m) => m.adminperf),
  kpi: () => import('@/lib/views/kpi').then((m) => m.kpi),
  profit: () => import('@/lib/views/profit').then((m) => m.profit),
  unitperf: () => import('@/lib/views/unitperf').then((m) => m.unitperf),
  report: () => import('@/lib/views/report').then((m) => m.report),
  umap: () => import('@/lib/views/umap').then((m) => m.umap),
  me: () => import('@/lib/views/me').then((m) => m.me),
  users: () => import('@/lib/views/users').then((m) => m.users),
};

const pending_: Record<string, Promise<ViewModule>> = {};

/** เริ่มโหลด (หรือคืนตัวที่กำลังโหลด/โหลดแล้ว) — ชื่อที่ไม่รู้จัก = null · พลาด (เน็ตหลุด) = ลืมไว้ ให้ครั้งหน้าลองใหม่ */
export function preloadView(name: string): Promise<ViewModule> | null {
  const load = LOADERS[name];
  if (!load) return null;
  if (!pending_[name]) {
    pending_[name] = load().catch((e) => { delete pending_[name]; throw e; });
  }
  return pending_[name];
}

export function isKnownView(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOADERS, name);
}
