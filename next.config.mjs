/** @type {import('next').NextConfig} */
const nextConfig = {
  // sync worker (scripts/) รันแยกด้วย tsx — ไม่ให้ Next เอาไป build
  eslint: { ignoreDuringBuilds: true },
  // รุ่นเว็บ (เปลี่ยนทุก build) — ตัวเลขที่จำไว้ให้ F5 (lib/ui/helpers.ts) ใช้ข้ามรุ่นไม่ได้ รูปข้อมูลอาจเปลี่ยน
  env: { PN_BUILD_ID: String(Date.now()) },
};
export default nextConfig;
