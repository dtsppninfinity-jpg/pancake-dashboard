// scripts/dev/mobile-audit.mjs — วัดหน้าเว็บบนขนาดจอมือถือด้วย Chrome จริง (ไม่ต้องลง puppeteer)
//
// ใช้:  npm run dev  (อีกหน้าต่าง)  แล้ว  node scripts/dev/mobile-audit.mjs [กว้าง] [สูง] [หน้า,หน้า]
// ตอบว่า "หน้าไหนล้นออกนอกจอ กว้างเกินไปกี่ px และ element ไหนเป็นต้นตอ" + นับปุ่มที่เล็กกว่าเกณฑ์นิ้ว
//
// ⚠️ ต้องรอให้หน้าโหลดข้อมูลเสร็จก่อนวัด (dev server ตอบ API 7-12 วิ) ไม่งั้นจะไปวัดโครงโหลด
//    แล้วได้ผลว่า "ไม่ล้น" ทั้งที่ล้นจริง — เคยพลาดมาแล้ว
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const BASE = 'http://localhost:3000';
const WIDTH = Number(process.argv[2] || 390);   // iPhone 14 = 390x844
const HEIGHT = Number(process.argv[3] || 844);
const VIEWS = (process.argv[4] || 'dashboard,sales,contentads,adminperf,kpi,profit,report,admins,umap,me,users').split(',');

// อ่าน .env.local เอง (ไม่พิมพ์ค่าออกมา)
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/cdp-mobile-audit', 'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

async function main() {
  // รอ CDP พร้อม
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page');
    } catch { await sleep(250); }
  }
  if (!target) throw new Error('เปิด Chrome ไม่ได้');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 3, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // ล็อกอินผ่าน API แล้วยัด cookie เข้า browser
  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: env.TEST_LOGIN_USER, password: env.TEST_LOGIN_PASS }),
  });
  const cookies = (res.headers.getSetCookie?.() || []).map((c) => {
    const [nv] = c.split(';');
    const i = nv.indexOf('=');
    return { name: nv.slice(0, i).trim(), value: nv.slice(i + 1), domain: 'localhost', path: '/' };
  });
  if (!cookies.length) throw new Error('ล็อกอินไม่ผ่าน (' + res.status + ')');
  await send('Network.setCookies', { cookies });

  const PROBE = `(() => {
    const vw = document.documentElement.clientWidth;
    const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const bad = [];
    document.querySelectorAll('#app *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const right = r.right + window.scrollX;
      if (right > vw + 1) {
        // เอาเฉพาะ "ต้นตอ" — ถ้าพ่อล้นอยู่แล้วก็ไม่ต้องรายงานลูกซ้ำ
        const p = el.parentElement;
        const pr = p ? p.getBoundingClientRect().right + window.scrollX : 0;
        if (p && pr > vw + 1 && Math.abs(pr - right) < 2) return;
        const cs = getComputedStyle(el);
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          id: el.id || '',
          w: Math.round(r.width), right: Math.round(right),
          overflowX: cs.overflowX, minW: cs.minWidth, ws: cs.whiteSpace,
          txt: (el.textContent || '').trim().slice(0, 40),
        });
      }
    });
    // ปุ่มที่เล็กกว่าเกณฑ์นิ้ว
    const small = [];
    document.querySelectorAll('#app button, #app a[href], #app [role=button], #app input, #app select').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.height < 40 || r.width < 32) {
        small.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,40),
          w: Math.round(r.width), h: Math.round(r.height), txt: (el.textContent||'').trim().slice(0,24) });
      }
    });
    return JSON.stringify({ vw, docW, over: docW - vw, bad: bad.slice(0, 12), smallCount: small.length, small: small.slice(0, 8) });
  })()`;

  // ⚠️ ห้ามใช้ "รอ N วินาที" เฉยๆ — หน้า Content & Ads ใช้เวลาโหลด 60 วิ+ บน dev
  //    เคยวัดตอนหน้ายังเป็นโครงโหลดแล้วสรุปว่า "ไม่ล้น" ทั้งที่ล้นจริง พลาดมาแล้ว 2 รอบ
  //    ต้องรอจนไม่เหลือโครงโหลด/สปินเนอร์ในหน้านั้น แล้วค่อยวัด
  const READY = (v) => `(() => {
    const c = document.getElementById('view-${v}');
    if (!c) return 'ไม่มีหน้านี้';
    if (c.querySelector('.skel, .skel-line, .loading')) return 'กำลังโหลด';
    return c.textContent.trim().length > 200 ? 'พร้อม' : 'ยังว่าง';
  })()`;

  async function waitReady(v, maxMs) {
    const t0 = Date.now();
    for (;;) {
      const s = (await send('Runtime.evaluate', { expression: READY(v), returnByValue: true })).result.value;
      if (s === 'พร้อม' || s === 'ไม่มีหน้านี้') return { สถานะ: s, วินาที: Math.round((Date.now() - t0) / 1000) };
      if (Date.now() - t0 > maxMs) return { สถานะ: 'หมดเวลา (' + s + ')', วินาที: Math.round((Date.now() - t0) / 1000) };
      await sleep(1000);
    }
  }

  console.log(`\n📱 จอ ${WIDTH}×${HEIGHT}\n${'='.repeat(64)}`);
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(4000);

  for (const v of VIEWS) {
    await send('Runtime.evaluate', { expression: `window.App && App.switchView(${JSON.stringify(v)})` });
    const ready = await waitReady(v, 150000);
    if (ready.สถานะ !== 'พร้อม') { console.log(`\n${v.padEnd(11)} ⏭️  ข้าม — ${ready.สถานะ} หลังรอ ${ready.วินาที} วิ`); continue; }
    await sleep(600);   // เผื่อ layout นิ่ง
    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    let d;
    try { d = JSON.parse(r.result.value); } catch { console.log(v, '— อ่านผลไม่ได้'); continue; }
    const flag = d.over > 1 ? `🔴 ล้น ${d.over}px` : '🟢 ไม่ล้น';
    console.log(`\n${v.padEnd(11)} ${flag}   (หน้ากว้าง ${d.docW} / จอ ${d.vw})  ปุ่มเล็กกว่าเกณฑ์ ${d.smallCount}  [โหลด ${ready.วินาที} วิ]`);
    d.bad.forEach((b) => console.log(`   ├ ${b.tag}.${b.cls || '-'} กว้าง ${b.w} ชนขวาที่ ${b.right}  overflowX:${b.overflowX} minW:${b.minW}  "${b.txt}"`));
    if (d.small.length) console.log('   └ ปุ่มเล็ก: ' + d.small.map((s) => `${s.txt || s.tag}(${s.w}×${s.h})`).join(', '));
  }
  ws.close();
}

main().then(() => { proc.kill(); process.exit(0); })
  .catch((e) => { console.error('FAIL', e.message); proc.kill(); process.exit(1); });
