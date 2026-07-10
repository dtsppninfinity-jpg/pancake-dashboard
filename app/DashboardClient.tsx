'use client';

import { useEffect } from 'react';

// แทน <script>App.init();</script> ท้าย body ของ Index.html
// โหลด app-core แบบ dynamic (client-only) แล้วรัน initApp() ครั้งเดียวหลัง mount
// return null — ไม่ render DOM ซ้ำ (โครง HTML มาจาก page.tsx แล้ว)
export default function DashboardClient() {
  useEffect(() => {
    import('@/lib/ui/app-core').then((m) => m.initApp());
  }, []);
  return null;
}
