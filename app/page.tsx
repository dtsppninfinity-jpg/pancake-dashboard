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
const themeInit = `(function () {
  try {
    var t = localStorage.getItem('pn-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();`;

// icon = ชื่อไอคอนลายเส้นจาก ICON_FOR (lib/ui/icons.ts) — 1 เมนู 1 รูป ห้ามซ้ำกัน
// (เดิมเป็นอีโมจิ และ 🎯 เคยซ้ำกันสองเมนู — เมนูที่ไอคอนซ้ำกันคือเมนูที่กดผิดกันบ่อย)
type NavItem = { view: string; icon: string; title: string; sub: string };

const NAV_OVERVIEW: NavItem[] = [
  { view: 'dashboard', icon: ICON_FOR.dashboard, title: 'Dashboard', sub: 'ภาพรวมแชทวันนี้' },
  { view: 'sales', icon: ICON_FOR.sales, title: 'Sales Dashboard', sub: 'ยอดขาย FB/LINE + Ranking' },
  { view: 'contentads', icon: ICON_FOR.contentads, title: 'Content & Ads Performance', sub: 'แอดที่กำลังยิง + คำแนะนำ' },
  { view: 'profit', icon: ICON_FOR.profit, title: 'กำไร & ตีกลับ', sub: 'กำไรจริงรายยูนิต/เดือน/ปี' },
  { view: 'unitperf', icon: ICON_FOR.unitperf, title: 'ผลงานราย Unit', sub: 'ยอด vs เป้า • คาดการณ์ • สัญญาณเตือน' },
  { view: 'report', icon: ICON_FOR.report, title: 'รายงาน & การตลาด', sub: 'เป้า vs จริง • ซื้อซ้ำรายยูนิต' },
];
const NAV_ADMIN: NavItem[] = [
  { view: 'admins', icon: ICON_FOR.admins, title: 'Admin Management', sub: 'รายชื่อ • สถานะ • สิทธิ์' },
  { view: 'adminperf', icon: ICON_FOR.adminperf, title: 'Admin Performance', sub: 'Ranking ยอดขาย • Top 3' },
  { view: 'kpi', icon: ICON_FOR.kpi, title: 'KPI ทีมขาย', sub: 'หัวหน้า • รอง • แอดมิน • ท็อปเซล' },
  { view: 'umap', icon: ICON_FOR.umap, title: 'U Map', sub: 'แอดมินอยู่ U ไหน • จับคู่' },
];
const NAV_ME: NavItem[] = [
  { view: 'me', icon: ICON_FOR.me, title: 'ผลงานของฉัน', sub: 'ยอดขาย • KPI • อันดับ' },
];
const NAV_SYSTEM: NavItem[] = [
  { view: 'users', icon: ICON_FOR.users, title: 'ผู้ใช้งาน', sub: 'บัญชี • ระดับสิทธิ์' },
];

function navButton(it: NavItem, active: boolean) {
  return (
    <button key={it.view} className={'nav-item' + (active ? ' active' : '')} data-view={it.view}>
      <span className="nav-icon" dangerouslySetInnerHTML={{ __html: icon(it.icon, { size: 18 }) }} />
      <span className="nav-texts">
        <span>{it.title}</span>
        <span className="nav-label-sub">{it.sub}</span>
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

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInit }} />
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

          <nav className="nav">
            {meSec.length > 0 && (
              <>
                <div className="nav-section">ของฉัน</div>
                {meSec.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {overview.length > 0 && (
              <>
                <div className="nav-section">1. ภาพรวม</div>
                {overview.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {adminSec.length > 0 && (
              <>
                <div className="nav-section">2. แอดมิน</div>
                {adminSec.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {system.length > 0 && (
              <>
                <div className="nav-section">3. ระบบ</div>
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
            <button id="btn-nav" className="btn btn-nav" aria-label="เปิด/ปิดเมนู"
              title="เปิด/ปิดแถบเมนู" dangerouslySetInnerHTML={{ __html: icon(ICON_FOR.menu, { size: 20 }) }} />
            <div className="topbar-titles">
              <h1 id="topbar-title">Dashboard</h1>
              <div id="topbar-sub" className="topbar-sub">ภาพรวมแชทวันนี้</div>
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

      <div id="modal-root"></div>
      <div id="toast-container" role="status" aria-live="polite"></div>

      <DashboardClient />
    </>
  );
}
