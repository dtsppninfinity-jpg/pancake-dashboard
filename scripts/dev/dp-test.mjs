// scripts/dev/dp-test.mjs — เทสปฏิทินเลือกช่วงวัน (โหมด "กำหนดเอง") ด้วย Chrome จริง
//
// ใช้:  npm run dev (อีกหน้าต่าง)  แล้ว  node scripts/dev/dp-test.mjs [กว้าง] [สูง] [พอร์ต]
// ตรวจ: เปิด/ปิด, เลือกช่วง, ระบายช่วงระหว่างหัวท้าย, ปุ่มแสดง, คีย์บอร์ด, ล้นจอ, ขนาดปุ่ม
//
// ⚠️ ต้องรอให้หน้าโหลดข้อมูลเสร็จก่อนเทส (dev server ตอบ API ช้า) ไม่งั้นจะไปคลิกโครงโหลด
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9344;
const W = Number(process.argv[2] || 1280);
const H = Number(process.argv[3] || 900);
const APP_PORT = Number(process.argv[4] || 3001);
const BASE = process.env.DP_BASE || ('http://localhost:' + APP_PORT);
const MOBILE = W < 600;

const env = Object.fromEntries(fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-dp-test', 'about:blank'],
  { stdio: 'ignore' });

let ws;
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + ((r.exceptionDetails.exception||{}).description||'') + ' :: ' + expr.slice(0,120));
  return r.result.value;
};
const press = async (k, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(150);
};

// ---- เมาส์จริง ----
// ⚠️ ต้องมีเทสชุดนี้: การสั่ง .click() ด้วยโค้ดข้ามลำดับ mousedown/mouseup ของจริง
// บั๊กที่ปุ่มถูกวาดใหม่ระหว่างกดค้าง (คลิกไม่ติด) จะไม่มีทางถูกจับได้เลยถ้าเทสด้วย .click()
const rectOf = (sel) => evalJs('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');' +
  'if(!e) return null; var r=e.getBoundingClientRect();' +
  'return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()');
const dayRect = (n) => evalJs('(function(){var g=document.querySelectorAll(".dp-month")[0];' +
  'var d=[].slice.call(g.querySelectorAll(".dp-day"));' +
  'var t=d.filter(function(x){return x.textContent.trim()==="' + n + '";})[0];' +
  'if(!t) return null; var r=t.getBoundingClientRect();' +
  'return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()');
const mouseAt = async (pt, type, extra = {}) => {
  if (!pt) throw new Error('หาตำแหน่งไม่เจอ');
  await send('Input.dispatchMouseEvent', Object.assign({ type, x: pt.x, y: pt.y, button: 'left' }, extra));
};
const realClickPt = async (pt) => {
  await mouseAt(pt, 'mouseMoved');
  await sleep(60);
  await mouseAt(pt, 'mousePressed', { clickCount: 1 });
  await sleep(40);
  await mouseAt(pt, 'mouseReleased', { clickCount: 1 });
  await sleep(200);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log((ok ? '[ผ่าน] ' : '[ตก]  ') + name + (detail ? '  — ' + detail : ''));
};

// คลิกวันที่มีตัวเลขตรงกับ n ในเดือนซ้าย
const clickDay = (n) => evalJs(
  '(function(){var g=document.querySelectorAll(".dp-month")[0];' +
  'var d=[].slice.call(g.querySelectorAll(".dp-day"));' +
  'var t=d.filter(function(x){return x.textContent.trim()==="' + n + '";})[0];' +
  'if(t){t.click();return true;} return false;})()');

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await fetch('http://127.0.0.1:' + PORT + '/json/list').then((r) => r.json());
      target = list.find((t) => t.type === 'page');
    } catch { await sleep(250); }
  }
  if (!target) throw new Error('เปิด Chrome ไม่ได้');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: MOBILE ? 3 : 1, mobile: MOBILE });

  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: env.TEST_LOGIN_USER, password: env.TEST_LOGIN_PASS }),
  });
  const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => {
    const nv = c.split(';')[0];
    const i = nv.indexOf('=');
    return { name: nv.slice(0, i).trim(), value: nv.slice(i + 1), domain: new URL(BASE).hostname, path: '/' };
  });
  if (!cookies.length) throw new Error('ล็อกอินไม่ผ่าน ' + res.status);
  await send('Network.setCookies', { cookies });

  await send('Page.navigate', { url: BASE + '/#dashboard' });
  for (let i = 0; i < 90; i++) {
    const ready = await evalJs('(function(){var a=document.querySelector("#app");' +
      'return !!a && !a.querySelector(".skel,.skel-line,.loading") && !!document.querySelector("[data-preset]");})()')
      .catch(() => false);
    if (ready) break;
    await sleep(1000);
  }
  check('หน้า Dashboard โหลดเสร็จ', await evalJs('!!document.querySelector("[data-preset=\\"custom\\"]")'));

  // 1) เข้าโหมดกำหนดเอง
  await evalJs('document.querySelector("[data-preset=\\"custom\\"]").click()');
  await sleep(700);
  check('เลิกใช้ช่อง input type=date เดิม', !(await evalJs('!!document.querySelector("input[type=date]")')));
  check('มีปุ่มเปิดปฏิทินแทน', await evalJs('!!document.querySelector(".dp-trigger")'),
    await evalJs('(document.querySelector(".dp-trigger")||{}).textContent||""'));

  // 2) เปิดปฏิทิน
  await evalJs('document.querySelector(".dp-trigger").click()');
  await sleep(400);
  check('ปฏิทินเปิดได้', await evalJs('!!document.querySelector(".dp-pop")'));
  check('aria-expanded เป็น true', await evalJs('document.querySelector(".dp-trigger").getAttribute("aria-expanded")==="true"'));
  const months = await evalJs('document.querySelectorAll(".dp-month").length');
  check('แสดง 2 เดือน', months === 2, 'เจอ ' + months);
  check('ตารางวันประกาศ role=grid', (await evalJs('document.querySelectorAll(".dp-grid[role=grid]").length')) === 2);
  check('วันนี้มีขอบไฮไลต์', await evalJs('!!document.querySelector(".dp-day.dp-today")'));

  // 3) เลือกช่วง 5 → 12
  await clickDay(5);
  await sleep(250);
  check('กดวันแรกแล้วบอกให้เลือกวันสิ้นสุด',
    (await evalJs('document.querySelector(".dp-sum").textContent')).indexOf('สิ้นสุด') >= 0);
  check('ปุ่มแสดงถูกปิดไว้ตอนเลือกยังไม่ครบ', await evalJs('!!document.querySelector("[data-dp=apply]").disabled'));
  await clickDay(12);
  await sleep(250);
  const inRange = await evalJs('document.querySelectorAll(".dp-day.dp-in").length');
  check('ระบายช่วงระหว่างหัวท้าย', inRange === 6, 'ระบาย ' + inRange + ' วัน (คาด 6 = วันที่ 6-11)');
  check('หัวท้ายทึบ 2 จุด', (await evalJs('document.querySelectorAll(".dp-day.dp-sel").length')) === 2);
  const sum = await evalJs('document.querySelector(".dp-sum").textContent');
  check('สรุปช่วงพร้อมจำนวนวัน', sum.indexOf('8 วัน') >= 0, sum);
  check('ปุ่มแสดงเปิดใช้ได้แล้ว', !(await evalJs('document.querySelector("[data-dp=apply]").disabled')));

  // 4) คีย์บอร์ด
  await press('ArrowRight', 39);
  check('ลูกศรเลื่อนโฟกัสได้', await evalJs('!!document.querySelector(".dp-day[data-focus=\\"1\\"]")'),
    'โฟกัสวันที่ ' + (await evalJs('(document.querySelector(".dp-day[data-focus=\\"1\\"]")||{}).textContent||""')));
  await press('Escape', 27);
  check('Esc ปิดปฏิทิน', !(await evalJs('!!document.querySelector(".dp-pop")')));
  check('ปิดแล้ว aria-expanded กลับเป็น false',
    await evalJs('document.querySelector(".dp-trigger").getAttribute("aria-expanded")==="false"'));

  // 5) กดแสดงจริง
  await evalJs('document.querySelector(".dp-trigger").click()');
  await sleep(400);
  await clickDay(5);
  await sleep(200);
  await clickDay(12);
  await sleep(200);
  await evalJs('document.querySelector("[data-dp=apply]").click()');
  await sleep(3000);
  check('กดแสดงแล้วปฏิทินปิด', !(await evalJs('!!document.querySelector(".dp-pop")')));
  const label = await evalJs('(document.querySelector(".dp-trigger")||{}).textContent||""');
  check('ป้ายปุ่มกลายเป็นช่วงที่เลือก', /\u2013/.test(label), label);

  // 5ข) เลือกช่วงด้วย "เมาส์จริง" — ลากผ่านวันกลางทางเหมือนคนใช้งานจริง
  await evalJs('document.querySelector(".dp-trigger").click()');
  await sleep(400);
  await realClickPt(await dayRect(13));
  check('เมาส์จริง: กดวันเริ่มติด',
    (await evalJs('document.querySelector(".dp-sum").textContent')).indexOf('สิ้นสุด') >= 0 ||
    (await evalJs('!!document.querySelector(".dp-day.dp-sel")')));
  // ลากผ่าน 14→20 ให้เกิด hover หลายครั้ง (จุดที่เคยทำให้ปุ่มถูกวาดใหม่จนกดไม่ติด)
  for (const n of [14, 16, 18, 20]) {
    const pt = await dayRect(n);
    if (pt) { await mouseAt(pt, 'mouseMoved'); await sleep(70); }
  }
  const tinted = await evalJs('document.querySelectorAll(".dp-day.dp-in").length');
  check('เมาส์จริง: ระบายช่วงล่วงหน้าตามเมาส์', tinted > 0, 'ระบาย ' + tinted + ' วัน');
  await realClickPt(await dayRect(21));
  const sum2 = await evalJs('document.querySelector(".dp-sum").textContent');
  check('เมาส์จริง: กดวันสิ้นสุดติด', sum2.indexOf('9 วัน') >= 0, sum2);
  check('เมาส์จริง: ปุ่มแสดงกดได้', !(await evalJs('document.querySelector("[data-dp=apply]").disabled')));
  const applyPt = await rectOf('[data-dp=apply]');
  await realClickPt(applyPt);
  await sleep(2500);
  check('เมาส์จริง: กดแสดงแล้วปิด + ป้ายเปลี่ยน',
    !(await evalJs('!!document.querySelector(".dp-pop")')) &&
    /13 .*21 /.test(await evalJs('(document.querySelector(".dp-trigger")||{}).textContent||""')),
    await evalJs('(document.querySelector(".dp-trigger")||{}).textContent||""'));

  // 6) ล้นจอ + ขนาดปุ่ม
  await evalJs('document.querySelector(".dp-trigger").click()');
  await sleep(400);
  const over = await evalJs('(function(){var vw=document.documentElement.clientWidth;' +
    'var p=document.querySelector(".dp-pop"); if(!p) return -1; var r=p.getBoundingClientRect();' +
    'return Math.max(0,Math.round(r.right-vw))+Math.max(0,Math.round(-r.left));})()');
  check('ปฏิทินไม่ล้นออกนอกจอ', over === 0, over > 0 ? 'ล้น ' + over + 'px' : '');
  const small = await evalJs('(function(){var n=0;' +
    'document.querySelectorAll(".dp-pop button").forEach(function(b){var r=b.getBoundingClientRect();' +
    'if(r.height>0&&(r.height<32||r.width<28))n++;});return n;})()');
  check('ปุ่มในปฏิทินไม่เล็กเกินนิ้ว', small === 0, small ? 'เล็กเกิน ' + small + ' ปุ่ม' : '');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = 'temp/dp-' + W + 'x' + H + '.png';
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('\nภาพหน้าจอ: ' + out);
  const bad = results.filter((r) => !r.ok);
  console.log('\nสรุป ' + W + 'x' + H + ': ผ่าน ' + (results.length - bad.length) + '/' + results.length +
    (bad.length ? ' | ตก: ' + bad.map((b) => b.name).join(', ') : ''));
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((e) => { console.error('ล้มเหลว:', e.message); process.exitCode = 1; })
  .finally(() => { try { if (ws) ws.close(); } catch { /* ปิดไปแล้ว */ } proc.kill(); });
