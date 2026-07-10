// lib/env.ts — โหลด .env.local ให้ก่อน (ต้อง import ไฟล์นี้เป็นบรรทัดแรกของทุก entry script)
// ตอนรันใน GitHub Actions จะไม่มี .env.local → dotenv เงียบๆ ไม่ทำอะไร แล้วใช้ค่าจาก GitHub Secrets แทน
import { config as loadEnv } from 'dotenv';
loadEnv({ path: process.env.ENV_FILE || '.env.local' });
