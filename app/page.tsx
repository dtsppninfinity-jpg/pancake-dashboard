import { headers } from 'next/headers';
import DashboardClient from './DashboardClient';
import { canView, ROLE_LABEL, type Role } from '@/lib/auth-session';
import { icon, ICON_FOR } from '@/lib/ui/icons';
import { logoMark } from '@/lib/ui/helpers';

// โครง HTML พอร์ตจาก Index.html (GAS) แบบตรงตัว — class / ข้อความไทย / โครงเดิมทุกตัวอักษร
// server component: render โครงนิ่ง ๆ แล้วให้ <DashboardClient/> (client) เรียก App.init()
//
// เมนู/ช่อง view ถูก render ตามสิทธิ์ของคนที่ล็อกอิน (role มาจาก header ที่ middleware เซ็ต)
// → ระดับแอดมินจะไม่มีแม้แต่ HTML ของหน้าอื่นให้แงะดู ไม่ใช่แค่ซ่อนด้วย CSS
export const dynamic = 'force-dynamic';

// ตั้งธีมจากที่เคยเลือกไว้ก่อน render เพื่อไม่ให้จอกระพริบ (default = มืด)
// + ถ้าเปิดมาพร้อม #ชื่อหน้า (รีเฟรช / ลิงก์ที่ส่งต่อกัน) ติดป้าย data-boot-view ไว้ที่ <html>
//   เซิร์ฟเวอร์ไม่เห็นส่วน # ของลิงก์ จึงวาดชื่อหน้าแรกของสิทธิ์นี้มาก่อน → ซ่อนชื่อหน้าบนหัวเว็บไว้
//   จน app-core สลับไปหน้าที่ถูก (ไม่งั้นเห็นชื่อหน้าผิดวาบหนึ่ง) · ติดที่ <html> เพราะเป็นแท็กเดียว
//   ที่ยอมให้แก้ก่อน React hydrate (suppressHydrationWarning ใน layout.tsx)
const themeInit = `(function () {
  try {
    var t = localStorage.getItem('pn-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
  try {
    if (location.hash.length > 1) document.documentElement.setAttribute('data-boot-view', '1');
  } catch (e) {}
})();`;

// คู่กับ data-boot-view ข้างบน — ถ้า JS ไม่มาภายใน 2 วิ (เน็ตช้า/สคริปต์พัง) ให้ชื่อหน้าโผล่เองอยู่ดี
// ไม่อยู่ใน globals.css เพราะเป็นกลไกเฉพาะจังหวะบูตของหน้านี้ ไม่ใช่หน้าตา
const bootCss =
  'html[data-boot-view] .topbar-titles{visibility:hidden;animation:pn-boot-reveal 0s linear 2s forwards}' +
  '@keyframes pn-boot-reveal{to{visibility:visible}}';

// icon = ชื่อไอคอนลายเส้นจาก ICON_FOR (lib/ui/icons.ts) — 1 เมนู 1 รูป ห้ามซ้ำกัน
// (เดิมเป็นอีโมจิ และ 🎯 เคยซ้ำกันสองเมนู — เมนูที่ไอคอนซ้ำกันคือเมนูที่กดผิดกันบ่อย)
// ชื่อเมนูภาษาไทยสั้น ภาษาเดียวทั้งเว็บ (ตรวจ UI ข้อ D2) — เดิมปนอังกฤษ/ไทย ยาวจนตัดบรรทัด และมีบรรทัดรองใต้ทุกเมนู
//   title = ชื่อเมนู = ชื่อหน้าบนหัวเว็บ · sub = บรรทัดใต้ชื่อหน้าบนหัวเว็บ · tip = คำอธิบายตอนชี้เมาส์ที่เมนู
// ⚠️ title/sub ต้องตรงกับ VIEW_META ใน lib/ui/app-core.ts (ตัวนั้นใช้ตอนสลับหน้า — ที่นี่ใช้วาดรอบแรกจากเซิร์ฟเวอร์)
type NavItem = { view: string; icon: string; title: string; sub: string; tip: string };

const NAV_OVERVIEW: NavItem[] = [
  { view: 'dashboard', icon: ICON_FOR.dashboard, title: 'ภาพรวมแชท',
    sub: 'ลูกค้าทักเข้ามาเท่าไหร่ ตอบไปแล้วเท่าไหร่ และแชทที่ยังรอตอบ', tip: 'ภาพรวมแชทวันนี้' },
  { view: 'sales', icon: ICON_FOR.sales, title: 'ยอดขาย',
    sub: 'ยอดขายเพจและไลน์ แยกตามยูนิต ช่องทาง และสินค้า', tip: 'ยอดขาย FB/LINE + อันดับ' },
  { view: 'contentads', icon: ICON_FOR.contentads, title: 'โฆษณา & คอนเทนต์',
    sub: 'แอดที่กำลังยิงอยู่ คุ้มหรือไม่คุ้ม และควรทำอะไรต่อ', tip: 'แอดที่กำลังยิง + คำแนะนำ' },
  { view: 'profit', icon: ICON_FOR.profit, title: 'กำไร & ตีกลับ',
    sub: 'กำไรจริงและยอดตีกลับ รายยูนิต รายเดือน และรายปี', tip: 'กำไรจริงรายยูนิต/เดือน/ปี' },
  { view: 'unitperf', icon: ICON_FOR.unitperf, title: 'ผลงานรายยูนิต',
    sub: 'แต่ละยูนิตทำได้เท่าไหร่เทียบเป้า และคาดว่าจะจบเดือนที่เท่าไหร่', tip: 'ยอด vs เป้า • คาดการณ์ • สัญญาณเตือน' },
  { view: 'report', icon: ICON_FOR.report, title: 'รายงานการตลาด',
    sub: 'เป้าเทียบยอดจริง รายสัปดาห์ รายเดือน รายปี และลูกค้าซื้อซ้ำ', tip: 'เป้า vs จริง • ซื้อซ้ำรายยูนิต' },
];
const NAV_ADMIN: NavItem[] = [
  { view: 'admins', icon: ICON_FOR.admins, title: 'จัดการแอดมิน',
    sub: 'รายชื่อแอดมิน ใครออนไลน์อยู่ และสิทธิ์ของแต่ละคน', tip: 'รายชื่อ • สถานะ • สิทธิ์' },
  { view: 'adminperf', icon: ICON_FOR.adminperf, title: 'อันดับแอดมิน',
    sub: 'อันดับยอดขายและการตอบแชทของแอดมินแต่ละคน', tip: 'อันดับยอดขาย • ท็อป 3' },
  { view: 'kpi', icon: ICON_FOR.kpi, title: 'KPI ทีมขาย',
    sub: 'คะแนน KPI ของหัวหน้า รองหัวหน้า และแอดมิน', tip: 'หัวหน้า • รอง • แอดมิน • ท็อปเซล' },
  { view: 'umap', icon: ICON_FOR.umap, title: 'จับคู่ยูนิต',
    sub: 'แอดมินและเพจแต่ละตัวอยู่ยูนิตไหน', tip: 'แอดมินอยู่ยูนิตไหน • จับคู่' },
];
const NAV_ME: NavItem[] = [
  { view: 'me', icon: ICON_FOR.me, title: 'ผลงานของฉัน',
    sub: 'ยอดขาย KPI และอันดับของคุณ', tip: 'ยอดขาย • KPI • อันดับ' },
];
const NAV_SYSTEM: NavItem[] = [
  { view: 'users', icon: ICON_FOR.users, title: 'บัญชีผู้ใช้',
    sub: 'บัญชีเข้าใช้งานเว็บ และระดับสิทธิ์ของแต่ละคน', tip: 'บัญชี • ระดับสิทธิ์' },
];

// บรรทัดรองใต้ชื่อเมนูเอาออกแล้ว (หัวเว็บมีคำอธิบายใต้ชื่อหน้าอยู่แล้ว) — ย้ายไปเป็น title ตอนชี้เมาส์
// data-nav-tip = สำเนาข้อความเดิม ให้ app-core ต่อท้ายเหตุผลของป้ายตัวเลขได้โดยไม่ทับคำอธิบายหาย
function navButton(it: NavItem, active: boolean) {
  return (
    <button key={it.view} type="button" className={'nav-item' + (active ? ' active' : '')} data-view={it.view}
      title={it.tip} data-nav-tip={it.tip} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon" dangerouslySetInnerHTML={{ __html: icon(it.icon, { size: 18 }) }} />
      <span className="nav-texts">
        <span className="nav-label">{it.title}</span>
      </span>
    </button>
  );
}

export default async function Page() {
  const h = await headers();
  const role = (h.get('x-pn-role') || '') as Role;
  const displayName = h.get('x-pn-user') || '';

  const allow = (items: NavItem[]) => items.filter((it) => canView(role, it.view));
  const overview = allow(NAV_OVERVIEW);
  const adminSec = allow(NAV_ADMIN);
  const meSec = allow(NAV_ME);
  const system = allow(NAV_SYSTEM);

  // view แรกที่เปิดได้ = หน้าเริ่มต้น (ระดับแอดมินจะเริ่มที่ "ผลงานของฉัน")
  const ordered = [...meSec, ...overview, ...adminSec, ...system];
  const firstView = ordered.length ? ordered[0].view : '';
  const firstItem = ordered.length ? ordered[0] : null;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      <style dangerouslySetInnerHTML={{ __html: bootCss }} />
      <div id="app" data-role={role} data-first-view={firstView}>
        {/* ฉากหลังทึบตอนเปิดเมนูบนมือถือ — กดแล้วปิดเมนู */}
        <div id="nav-backdrop" className="nav-backdrop"></div>

        <aside className="sidebar" id="sidebar">
          <div className="brand">
            <div className="brand-logo" dangerouslySetInnerHTML={{ __html: logoMark(38) }} />
            <div className="brand-text">
              <div className="brand-name">PN Infinity</div>
              <div className="brand-sub">Pancake POS Dashboard</div>
            </div>
          </div>

          <nav className="nav" aria-label="เมนูหลัก">
            {meSec.length > 0 && (
              <>
                <div className="nav-section">ของฉัน</div>
                {meSec.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {overview.length > 0 && (
              <>
                <div className="nav-section">ภาพรวม</div>
                {overview.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {adminSec.length > 0 && (
              <>
                <div className="nav-section">แอดมิน</div>
                {adminSec.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {system.length > 0 && (
              <>
                <div className="nav-section">ระบบ</div>
                {system.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
          </nav>

          <div className="sidebar-footer">
            <div className="me-box">
              <div className="me-name" title={displayName}>{displayName || '—'}</div>
              <div className="me-role">{ROLE_LABEL[role] || '—'}</div>
              <button id="btn-logout" className="btn btn-logout" title="ออกจากระบบ"
                dangerouslySetInnerHTML={{ __html: icon(ICON_FOR.logout, { size: 14 }) + 'ออกจากระบบ' }} />
            </div>
            {/* สถานะงานดึงข้อมูลเบื้องหลัง (ชื่องาน/เวลาทีละงาน) ย้ายออกจากตรงนี้แล้ว — เป็นศัพท์ช่าง ทีมขายอ่านแล้วตกใจ
                ตอนนี้โชว์บนหัวเว็บเป็น "อัปเดตล่าสุด HH:MM" แทน ส่วนรายละเอียดงานที่มีปัญหาเห็นเฉพาะผู้ดูแลระบบ (ดู renderSyncInfo) */}
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            {/* ปุ่มเมนูโผล่เฉพาะจอแคบ (ดู globals.css) */}
            {/* จอแคบ = เปิดลิ้นชักเมนู • จอกว้าง = พับ/กางแถบเมนูที่ปักซ้าย (จำค่าไว้) */}
            {/* aria-expanded อัปเดตโดย app-core (จอแคบ = ลิ้นชักเปิดไหม · จอกว้าง = แถบเมนูกางอยู่ไหม) */}
            <button id="btn-nav" type="button" className="btn btn-nav" aria-label="เปิด/ปิดเมนู"
              aria-controls="sidebar" aria-expanded="false"
              title="เปิด/ปิดแถบเมนู" dangerouslySetInnerHTML={{ __html: icon(ICON_FOR.menu, { size: 20 }) }} />
            <div className="topbar-titles">
              {/* tabIndex -1: ปุ่ม "กลับขึ้นบน" ย้ายโฟกัสมาที่ชื่อหน้า (คนใช้คีย์บอร์ดไม่ต้องกด Tab ไล่จากท้ายหน้า) */}
              <h1 id="topbar-title" tabIndex={-1}>{firstItem ? firstItem.title : ''}</h1>
              <div id="topbar-sub" className="topbar-sub">{firstItem ? firstItem.sub : ''}</div>
            </div>
            <div className="topbar-right">
              {/* เนื้อในเติมโดย renderSyncInfo (app-core) ตามสิทธิ์ของคนที่ล็อกอิน */}
              <span id="sync-chip" className="sync-chip"></span>
              {/* ไอคอนของ "โหมดที่จะสลับไป" มีทั้ง 2 ตัว CSS เลือกโชว์ตาม data-theme (ตั้งโดย themeInit ก่อนวาดจอ)
                  จึงถูกตั้งแต่เฟรมแรก ไม่กระพริบรอ JS · ชื่อปุ่มค่าเริ่มต้น = โหมดมืด → setTheme() ใน app-core แก้ให้ตรงหลังโหลด */}
              <button id="btn-theme" type="button" className="btn btn-icon" aria-label="เปลี่ยนเป็นโหมดสว่าง"
                title="เปลี่ยนเป็นโหมดสว่าง" dangerouslySetInnerHTML={{ __html:
                  '<span class="theme-ic theme-ic-light">' + icon(ICON_FOR.themeLight, { size: 18 }) + '</span>' +
                  '<span class="theme-ic theme-ic-dark">' + icon(ICON_FOR.themeDark, { size: 18 }) + '</span>' }} />
              <button id="btn-refresh" type="button" className="btn" aria-label="รีเฟรช" title="โหลดข้อมูลใหม่"
                dangerouslySetInnerHTML={{ __html: icon(ICON_FOR.refresh, { size: 16 }) + '<span class="btn-word">รีเฟรช</span>' }} />
            </div>
          </header>

          {/* render เฉพาะช่องของ view ที่สิทธิ์นี้เปิดได้ */}
          {ordered.map((it) => (
            <section
              key={it.view}
              id={'view-' + it.view}
              className={'view' + (it.view === firstView ? ' active' : '')}
            ></section>
          ))}
        </main>
      </div>

      {/* ปุ่มกลับขึ้นบน — app-core โชว์ (.show) เมื่อเลื่อนลงเกิน 2 จอแล้วเริ่มปัดขึ้น
          ตอนซ่อนต้องกด Tab ไม่ถึงด้วย (tabIndex/aria-hidden สลับโดย app-core) */}
      <button id="back-top" type="button" className="back-top" aria-label="กลับขึ้นบน" title="กลับขึ้นบน"
        tabIndex={-1} aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon('arrow-up', { size: 20 }) }} />

      <div id="modal-root"></div>
      {/* กล่องซ้อนข้อความเด้ง — helpers.toast() ใช้ #toast-stack (ไม่มีก็สร้างเอง) · การอ่านออกเสียงอยู่ที่กล่องประกาศแยกของ helpers
          ตัวกล่องนี้จึงไม่เป็น aria-live เอง (ไม่งั้นโปรแกรมอ่านหน้าจออ่านซ้ำ 2 รอบ) */}
      <div id="toast-stack"></div>

      <DashboardClient />
    </>
  );
}
