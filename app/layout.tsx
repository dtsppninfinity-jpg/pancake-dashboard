import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PN Infinity — Pancake Dashboard',
  description: 'Pancake POS Dashboard (Next.js + Supabase)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning จำเป็นและถูกต้องตรงนี้ (ไม่ใช่การกลบปัญหา):
    // <html> — สคริปต์ตั้งธีมใน app/page.tsx ต้องเขียน data-theme ก่อน React จะ hydrate
    //          ไม่งั้นจอจะกระพริบขาวหนึ่งครั้งทุกครั้งที่โหลด ฝั่ง server จึงไม่มีทางรู้ล่วงหน้า
    //          ว่าเครื่องนี้เลือกธีมอะไร แอตทริบิวต์ 2 ฝั่งต่างกันโดยธรรมชาติ
    // <body>  — ส่วนขยายของเบราว์เซอร์ (เช่น ColorZilla ยัด cz-shortcut-listen) แก้ HTML
    //          ก่อน React โหลด เราคุมไม่ได้
    // ⚠️ ปิดเสียงแค่ระดับแท็กนี้เท่านั้น ความไม่ตรงกันที่เกิดข้างในยังฟ้องปกติ
    <html lang="th" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
