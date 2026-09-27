'use client';

import { useEffect } from 'react';

// แทน <script>App.init();</script> ท้าย body ของ Index.html
// โหลด app-core แบบ dynamic (client-only) แล้วรัน initApp() ครั้งเดียวหลัง mount
// เริ่มโหลดก้อน app-core ตั้งแต่ไฟล์นี้ถูกรัน (ก่อน hydrate) — เดิมเริ่มใน useEffect หลัง hydrate + วาดจอ
// เสียเวลารออีกทอดหนึ่งก่อนจะรู้ว่าต้องโหลดก้อนใหญ่นี้ · ฝั่ง server ไม่โหลด (app-core ใช้ DOM)
const coreP = typeof window !== 'undefined' ? import('@/lib/ui/app-core') : null;

// return null — ไม่ render DOM ซ้ำ (โครง HTML มาจาก page.tsx แล้ว)
export default function DashboardClient() {
  useEffect(() => {
    if (coreP) coreP.then((m) => m.initApp());
  }, []);
  return null;
}
