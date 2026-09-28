'use client';

import { useEffect } from 'react';
import { preloadView } from '@/lib/ui/view-loaders';

// แทน <script>App.init();</script> ท้าย body ของ Index.html
// โหลด app-core แบบ dynamic (client-only) แล้วรัน initApp() ครั้งเดียวหลัง mount
// เริ่มโหลดก้อน app-core ตั้งแต่ไฟล์นี้ถูกรัน (ก่อน hydrate) — เดิมเริ่มใน useEffect หลัง hydrate + วาดจอ
// เสียเวลารออีกทอดหนึ่งก่อนจะรู้ว่าต้องโหลดก้อนใหญ่นี้ · ฝั่ง server ไม่โหลด (app-core ใช้ DOM)
const coreP = typeof window !== 'undefined' ? import('@/lib/ui/app-core') : null;
// ก้อนโค้ดของหน้าแรกโหลดคู่กับ app-core (ไม่ต้องรอ app-core เสร็จก่อนค่อยรู้ว่าต้องโหลดหน้าไหน)
// หน้าที่จะเปิดมาจากสคริปต์ใน page.tsx (window.__pnView — ตัดสินจาก # และสิทธิ์) · พลาดไม่เป็นไร app-core โหลดซ้ำเอง
if (typeof window !== 'undefined') {
  try {
    const first = (window as any).__pnView;
    const p = first ? preloadView(String(first)) : null;
    if (p) p.catch(() => {});
  } catch (e) { /* ไม่มีผลกับการเปิดหน้า */ }
}

// return null — ไม่ render DOM ซ้ำ (โครง HTML มาจาก page.tsx แล้ว)
export default function DashboardClient() {
  useEffect(() => {
    if (coreP) coreP.then((m) => m.initApp());
  }, []);
  return null;
}
