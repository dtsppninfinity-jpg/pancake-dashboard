import './globals.css';
import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';

export const metadata: Metadata = {
  title: 'PN Infinity — Pancake Dashboard',
  description: 'Pancake POS Dashboard (Next.js + Supabase)',
};

// ฟอนต์ของเว็บเอง (ตรวจ UI ข้อ C7) — เดิมใช้ฟอนต์ในเครื่อง ('Segoe UI' → 'Leelawadee UI' → …)
// Windows / Mac / Android จึงเห็นตัวอักษรคนละแบบ ความกว้างตัวเลขไม่เท่ากัน ตารางกับการ์ดเลยล้นไม่เหมือนกันทุกเครื่อง
// IBM Plex Sans Thai: ไทย+อังกฤษตระกูลเดียว ตัวเลขชัดแบบงานตาราง
// next/font ดาวน์โหลดไฟล์ตอน build แล้วเสิร์ฟจากโดเมนเราเอง (ไม่วิ่งไป Google ตอนเปิดเว็บ)
// display 'swap' = โชว์ฟอนต์สำรองก่อนระหว่างโหลด หน้าไม่ขาวโล่ง · ค่าออกมาเป็นตัวแปร --font-body
// ที่ <html> — globals.css ใช้ต่อที่ body { font-family: var(--font-body), ... } (หน้า login ใช้ layout นี้ด้วย)
const bodyFont = IBM_Plex_Sans_Thai({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  display: 'swap',
  variable: '--font-body',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning จำเป็นและถูกต้องตรงนี้ (ไม่ใช่การกลบปัญหา):
    // <html> — สคริปต์ตั้งธีมใน app/page.tsx ต้องเขียน data-theme ก่อน React จะ hydrate
    //          ไม่งั้นจอจะกระพริบขาวหนึ่งครั้งทุกครั้งที่โหลด ฝั่ง server จึงไม่มีทางรู้ล่วงหน้า
    //          ว่าเครื่องนี้เลือกธีมอะไร แอตทริบิวต์ 2 ฝั่งต่างกันโดยธรรมชาติ
    //          (data-boot-view ที่สคริปต์เดียวกันเขียนตอนเปิดลิงก์ #ชื่อหน้า ก็เป็นกรณีเดียวกัน)
    // <body>  — ส่วนขยายของเบราว์เซอร์ (เช่น ColorZilla ยัด cz-shortcut-listen) แก้ HTML
    //          ก่อน React โหลด เราคุมไม่ได้
    // ⚠️ ปิดเสียงแค่ระดับแท็กนี้เท่านั้น ความไม่ตรงกันที่เกิดข้างในยังฟ้องปกติ
    <html lang="th" className={bodyFont.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
