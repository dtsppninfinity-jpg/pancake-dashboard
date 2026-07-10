// lib/mappers.ts — แปลงข้อมูลดิบจาก Pancake → object ตามคอลัมน์ตาราง (port จาก Sync*.gs)
import { ORDER_STATUS_TH, TZ, num, toIso, fmtDateBkk, parsePancakeTime } from './config';

/** เดา platform จากข้อมูลออเดอร์ ถ้าไม่รู้จัก page_id */
export function guessPlatform(o: any): string {
  const src = String(o.ads_source || o.account || o.account_name || '').toLowerCase();
  if (src.includes('line')) return 'line';
  if (src.includes('shopee')) return 'shopee';
  if (src.includes('lazada')) return 'lazada';
  if (src.includes('tiktok')) return 'tiktok';
  return 'facebook';
}

/** order ดิบจาก POS → แถวตาราง orders */
export function mapOrder(o: any, platformByPage: Record<string, string>) {
  const items = (o.items || []).map((it: any) => {
    const vi = it.variation_info || {};
    return { name: vi.name || vi.product_display_id || '', qty: it.quantity || 0, price: vi.retail_price || 0 };
  });
  const productNames = items.map((it: any) => `${it.name} x${it.qty}`).join(', ');
  const seller = o.assigning_seller || {};
  const creator = o.creator || {};
  const marketer = o.marketer || {};
  const customer = o.customer || {};
  const status = (o.status === undefined || o.status === null) ? null : Number(o.status);
  const pageId = String(o.page_id || customer.page_id || '');
  return {
    id: String(o.id),
    display_id: o.display_id || '',
    status,
    status_name: (status !== null && ORDER_STATUS_TH[status]) || o.status_name || String(status ?? ''),
    inserted_at: toIso(o.inserted_at),
    updated_at: toIso(o.updated_at),
    total_price: num(o.total_price),
    cod: num(o.cod),
    transfer_money: num(o.transfer_money),
    shipping_fee: num(o.shipping_fee),
    total_discount: num(o.total_discount),
    items_count: items.reduce((s: number, it: any) => s + (it.qty || 0), 0),
    product_names: productNames.slice(0, 300),
    items_json: items,
    seller_id: seller.id != null ? String(seller.id) : '',
    seller_name: seller.name || '',
    creator_id: creator.id != null ? String(creator.id) : '',
    creator_name: creator.name || '',
    marketer_name: marketer.name || '',
    customer_id: customer.id != null ? String(customer.id) : '',
    customer_name: customer.name || '',
    page_id: pageId,
    platform: platformByPage[pageId] || guessPlatform(o),
    post_id: o.post_id || '',
    ad_id: o.ad_id || '',
    conversation_id: o.conversation_id || '',
    ads_source: o.ads_source || '',
    account_name: o.account_name || '',
    tags: (o.tags || []).map((t: any) => (t && t.name ? t.name : t)).join(', '),
  };
}

/** 1 bucket จาก statistics/pages → แถว chat_hourly */
export function mapChatHour(page: any, bucket: any) {
  const h = bucket.hour;
  const d = typeof h === 'number' ? new Date(h * 1000) : parsePancakeTime(String(h));
  if (!d) return null;
  const date = fmtDateBkk(d);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d)) % 24;
  return {
    key: `${page.page_id}|${date}T${String(hour).padStart(2, '0')}`,
    page_id: String(page.page_id),
    page_name: page.name,
    platform: page.platform,
    date,
    hour,
    new_customer_count: num(bucket.new_customer_count),
    new_inbox_count: num(bucket.new_inbox_count),
    customer_inbox_count: num(bucket.customer_inbox_count),
    customer_comment_count: num(bucket.customer_comment_count),
    page_inbox_count: num(bucket.page_inbox_count),
    page_comment_count: num(bucket.page_comment_count),
    inbox_interactive_count: num(bucket.inbox_interactive_count),
    phone_number_count: num(bucket.phone_number_count),
    uniq_phone_number_count: num(bucket.uniq_phone_number_count),
    updated_at: new Date().toISOString(),
  };
}

/** 1 บทสนทนา → แถว conversations (คำนวณ waiting = ลูกค้าส่งล่าสุด) */
export function mapConversation(page: any, c: any) {
  const last = c.last_sent_by || {};
  const isAdmin = !!(last.admin_id || last.admin_name || String(last.id || '') === String(page.page_id));
  const lastBy = isAdmin ? ((last.ai_generated || last.is_automated) ? 'ai' : 'admin') : 'customer';
  const assignees = (c.current_assign_users || []).map((u: any) => u.name).join(', ');
  return {
    id: String(c.id),
    page_id: String(page.page_id),
    page_name: page.name,
    platform: page.platform,
    type: c.type || '',
    customer_name: (c.from && c.from.name) || '',
    snippet: String(c.snippet || '').slice(0, 150),
    message_count: num(c.message_count),
    inserted_at: toIso(c.inserted_at),
    updated_at: toIso(c.updated_at),
    last_sent_by: lastBy,
    last_admin_name: isAdmin ? (last.admin_name || last.name || '') : '',
    waiting: lastBy === 'customer',
    has_phone: !!c.has_phone,
    tags: (c.tags || []).map((t: any) => (t && (t.text || t.name)) || t).join(', '),
    assignees,
    ad_ids: (c.ad_ids || []).join(', '),
    seen: !!c.seen,
  };
}

/** 1 แอด จาก Ads Manager → แถว ads */
export function mapAd(a: any, campaignNameById: Record<string, string>) {
  const ins = a.insights || {};
  const acct = a.ad_account || {};
  const marketer = a.marketer || {};
  const campaignId = String(a.campaign_id || (a.campaign && a.campaign.id) || '');
  return {
    ad_id: String(a.id),
    name: a.name || '',
    status: a.status || '',
    effective_status: a.effective_status || '',
    objective: a.objective || '',
    campaign_id: campaignId,
    campaign_name: campaignNameById[campaignId] || (a.campaign && a.campaign.name) || '',
    adset_id: String(a.adset_id || (a.ad_set && a.ad_set.id) || ''),
    ad_account_id: String(acct.id || ''),
    ad_account_name: acct.name || '',
    currency: acct.currency || 'THB',
    spend: num(ins.spend),
    impressions: num(ins.impressions),
    reach: num(ins.reach),
    clicks: num(ins.clicks),
    ctr: num(ins.ctr),
    cpm: num(ins.cpm),
    msgs_started: num(ins.onsite_conversion_messaging_conversation_started_7d),
    cost_per_msg: num(ins.cost_per_messaging_conversation_started),
    order_created: num(ins.order_created),
    order_shipped: num(ins.order_shipped),
    marketer_name: marketer.name || '',
    created_time: toIso(a.created_time),
    start_time: toIso(a.start_time),
    updated_at: new Date().toISOString(),
  };
}
