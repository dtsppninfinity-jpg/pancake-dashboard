// lib/meta.ts — Meta (Facebook) Marketing API client สำหรับดึงค่าแอด "จริง" จาก Meta โดยตรง
//
// ทำไม: ค่าแอดเดิมดึงจาก Pancake /statistics/ads ซึ่งไม่ครบทุกบัญชี (ต่ำกว่าจอ Meta จริง ~7%)
// Meta Marketing API insights ให้ spend/impressions/clicks/purchases/value ที่ตรงหน้า Meta Ads
// dashboard เป๊ะ. token อยู่ใน env META_ACCESS_TOKEN (USER token, scope ads_read/ads_management)
//
// เก็บลง ad_daily โดย "ทับเฉพาะ spend + เลข Meta" คงค่า page_id/name ที่ Pancake ใส่ไว้ (upsert
// merge — คอลัมน์ที่ไม่ส่งจะไม่ถูกแตะ) → หน้า Sales/Content&Ads ได้ค่าแอดจริงโดยไม่ต้องแก้ read

import { sleep } from './config';

const V = 'v21.0';
const BASE = `https://graph.facebook.com/${V}`;

function metaToken(): string {
  return process.env.META_ACCESS_TOKEN || '';
}

/** GET Graph API + retry เมื่อโดน rate-limit (code 4/17/32/613/80000-80004) */
async function metaGet(path: string, params: Record<string, string>, tries = 3): Promise<any> {
  const qs = new URLSearchParams({ access_token: metaToken(), ...params }).toString();
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    let j: any;
    try {
      const res = await fetch(`${BASE}/${path}?${qs}`);
      j = await res.json();
    } catch (e: any) { lastErr = e.message; await sleep(2000 * (i + 1)); continue; }
    if (j && j.error) {
      const code = Number(j.error.code);
      const rateLimited = [4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004].indexOf(code) >= 0;
      if (rateLimited && i < tries - 1) { await sleep(5000 * (i + 1)); continue; }
      throw new Error(`meta ${code}: ${j.error.message}`);
    }
    return j;
  }
  throw new Error(lastErr || 'meta fetch ล้มเหลว');
}

export interface MetaAccount { account_id: string; name: string; account_status: number; }

/** ทุกบัญชีโฆษณาที่ token เข้าถึง (paginate) */
export async function metaListAdAccounts(): Promise<MetaAccount[]> {
  const out: MetaAccount[] = [];
  let after: string | undefined;
  do {
    const p: Record<string, string> = { fields: 'account_id,name,account_status', limit: '200' };
    if (after) p.after = after;
    const r = await metaGet('me/adaccounts', p);
    (r.data || []).forEach((a: any) => out.push({
      account_id: String(a.account_id), name: String(a.name || ''), account_status: Number(a.account_status),
    }));
    after = (r.paging && r.paging.next && r.paging.cursors) ? r.paging.cursors.after : undefined;
    await sleep(60);
  } while (after);
  return out;
}

export interface MetaAdInsight {
  date: string; ad_id: string; ad_name: string; spend: number; impressions: number; clicks: number;
  reach: number; purchases: number; purchase_value: number; msgs: number;
}

function sumActions(arr: any[], re: RegExp): number {
  let s = 0;
  (arr || []).forEach((a: any) => { if (re.test(String(a.action_type))) s += Number(a.value) || 0; });
  return s;
}

// omni_purchase = ยอด "ซื้อ" ที่ Meta ตัดซ้ำแล้ว (ตรงตัวเลขบนจอ) — ใช้ตัวนี้ตัวเดียว ไม่รวม pixel/onsite ซ้ำ
const PURCHASE_RE = /^omni_purchase$/;
const MSG_RE = /messaging_conversation_started/;

/**
 * insights ระดับ "แอด" ของ 1 บัญชี ในช่วง since..until — แตกเป็นรายวัน (time_increment=1)
 * ช่วง 1 วัน → since=until=วันนั้น (ได้ 1 แถว/แอด). ช่วงยาว (backfill) → 1 คอลได้ทุกวันในช่วง
 */
export async function metaAccountAdInsights(accountId: string, since: string, until: string): Promise<MetaAdInsight[]> {
  const out: MetaAdInsight[] = [];
  let after: string | undefined;
  do {
    const p: Record<string, string> = {
      time_range: JSON.stringify({ since, until }),
      time_increment: '1',
      level: 'ad',
      fields: 'ad_id,ad_name,spend,impressions,clicks,reach,actions,action_values',
      limit: '500',
    };
    if (after) p.after = after;
    const r = await metaGet(`act_${accountId}/insights`, p);
    (r.data || []).forEach((row: any) => {
      out.push({
        date: String(row.date_start || since),
        ad_id: String(row.ad_id || ''),
        ad_name: String(row.ad_name || ''),
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        reach: Number(row.reach) || 0,
        purchases: sumActions(row.actions, PURCHASE_RE),
        purchase_value: sumActions(row.action_values, PURCHASE_RE),
        msgs: sumActions(row.actions, MSG_RE),
      });
    });
    after = (r.paging && r.paging.next && r.paging.cursors) ? r.paging.cursors.after : undefined;
    await sleep(60);
  } while (after);
  return out;
}
