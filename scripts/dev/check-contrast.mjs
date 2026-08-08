import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// อ่านค่า token จาก app/globals.css จริง แล้ววัดคอนทราสต์ (ไม่ใช่ค่าที่พิมพ์ไว้ในสคริปต์)
const css = fs.readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8');

function block(sel) {
  const i = css.indexOf(sel);
  if (i < 0) return {};
  const s = css.indexOf('{', i), e = css.indexOf('}', s);
  const out = {};
  css.slice(s + 1, e).split(';').forEach((l) => {
    const m = l.match(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/);
    if (m) out[m[1]] = m[2].toLowerCase();
  });
  return out;
}
const dark = block(':root {');
const light = { ...dark, ...block(':root[data-theme="light"]') };

const L = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const R = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ตัวอักษรต้อง 4.5:1 / เส้นขอบ-องค์ประกอบต้อง 3:1
const TEXT = ['--text', '--text-2', '--text-3', '--green', '--amber', '--red', '--blue'];
const UI = ['--primary', '--gold', '--silver', '--bronze'];
let fails = 0;

function check(name, vars, min) {
  const bgs = [['การ์ด', vars['--surface']], ['พื้นรอง', vars['--surface-2']]];
  console.log('\n' + name);
  [...TEXT.map((v) => [v, 4.5]), ...UI.map((v) => [v, 3])].forEach(([v, need]) => {
    const hex = vars[v];
    if (!hex) return;
    const worst = Math.min(...bgs.filter((b) => b[1]).map((b) => R(hex, b[1])));
    const ok = worst >= need;
    if (!ok) fails++;
    console.log('  ' + v.padEnd(11), hex, worst.toFixed(2).padStart(6),
      '(ต้อง ≥' + need + ')', ok ? '✓' : '✗ ตก');
  });
}
check('ธีมมืด', dark, 4.5);
check('ธีมสว่าง', light, 4.5);
console.log('\n' + (fails ? '✗ ยังตก ' + fails + ' ค่า' : '✓ ผ่านหมดทั้งสองธีม'));
