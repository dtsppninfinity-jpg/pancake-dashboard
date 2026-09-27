// lib/ui/first-calls.ts — คำขอแรกของแต่ละหน้าตอนเปิดเว็บ (ตัวกรองค่าเริ่มต้น)
// ใช้ทั้งฝั่ง server (app/page.tsx) และ browser — ห้ามแตะ window/document ในไฟล์นี้
//
// ทำไมมี: เดิมคำขอข้อมูลหน้าแรกเริ่มได้หลัง HTML → JS ของ Next → hydrate → โหลดก้อน app-core (ทุกหน้ารวมกัน)
//   → initApp → view.load เสร็จทั้งสาย (~0.3 วิบนคอม ~1-2 วิบนมือถือ) ทั้งที่ params ของหน้าแรกรู้อยู่แล้ว
//   ตอนนี้ page.tsx ยิงคำขอเหล่านี้ตั้งแต่ HTML มาถึง แล้ว serverCall (lib/ui/helpers.ts) หยิบผลไปใช้
//
// ⚠️ params ต้องตรงกับที่ view ส่งตอนโหลดครั้งแรก "ทุกตัวอักษร รวมลำดับ key" (เทียบด้วย JSON.stringify)
//    ไม่ตรง = คำขอล่วงหน้าไม่ถูกใช้ — ตัวเลขยังถูกเสมอ (view ยิงใหม่เอง) แต่เปลือง 1 คำขอ
//    และจะมีคำเตือน "[prefetch] ไม่ถูกใช้" ใน console ของเบราว์เซอร์ · แก้ค่าเริ่มต้นตัวกรองของหน้าไหน ต้องแก้ที่นี่ด้วย
export const FIRST_CALLS: Record<string, Array<[string, unknown]>> = {
  me: [['apiMe', { preset: 'today', from: '', to: '' }]],                                   // views/me.ts fetchAndRender
  dashboard: [['apiDashboard', { preset: 'today', from: '', to: '', channel: '' }]],         // views/dashboard.ts buildParams
  sales: [['apiSales', { preset: 'today', from: '', to: '', channel: 'facebook', compare: 'prev' }]], // views/sales.ts buildParams
  contentads: [['apiContentAds', { days: 7 }]],                                              // views/contentads.ts rangeDays
  profit: [['apiProfit', {}]],
  unitperf: [['apiUnitPerf', {}]],                                                           // state.month ว่าง = {}
  report: [['apiReport', { month: 0 }]],                                                     // ส่วนซื้อซ้ำโหลดทีหลัง (เลื่อนถึง)
  admins: [['apiAdmins', {}], ['apiScoreConfig', {}]],
  adminperf: [
    ['apiAdminPerf', { preset: 'today', from: '', to: '', channel: '' }],
    ['apiScoreConfig', {}],
    ['apiAdminCom', { month: '' }],
  ],
  kpi: [['apiKpi', { month: 0 }]],
  umap: [['apiUMap', {}]],
  users: [['apiUsers', { action: 'list' }]],
};
