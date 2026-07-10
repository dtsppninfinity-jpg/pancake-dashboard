/** @type {import('next').NextConfig} */
const nextConfig = {
  // sync worker (scripts/) รันแยกด้วย tsx — ไม่ให้ Next เอาไป build
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
