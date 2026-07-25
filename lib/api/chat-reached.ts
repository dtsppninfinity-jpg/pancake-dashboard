// จัดสรร "คนทัก" (บทสนทนาอินบ็อกซ์ใหม่ + ความคิดเห็น) ระดับเพจ → รายแอดมิน
//
// ทำไม: statistics/users รายแอดมิน "ไม่มี" field new_inbox — มีแค่ unique_inbox_count ที่
// นับบทสนทนาเดียวกันซ้ำให้ทุกแอดมินที่เข้าไปตอบ (ผลรวมรายแอดมิน > ยอดเพจจริง เช่น เพจ
// โคคอลลี่ รวมรายแอดมิน 287 แต่ยอดเพจจริง 124). ส่วน customer_engagements ให้ new_inbox+
// comment ที่ตรงจอ Pancake แต่เป็น "ระดับเพจ" ไม่แยกรายแอดมิน
//
// วิธี: เอายอดคนทักระดับเพจ (new_inbox+comment) มากระจายให้แอดมินตามสัดส่วนที่แต่ละคน
// "แตะบทสนทนา" (unique_inbox_count) ในเพจ-วันนั้น → ผลรวมรายแอดมินกลับมาตรงยอดเพจ และ
// ถ้าเพจมีแอดมินคนเดียว แอดมินคนนั้นได้ยอดเพจเต็ม = ตรงจอ Pancake เป๊ะ (เคส Eiei 1 เพจ = 383)
//
// ใช้เป็นทั้งตัวเลข "แชท" ที่โชว์ และเป็นตัวหารของ %ปิดการขาย (orders ÷ คนทัก) ให้ไม่เพี้ยน

type ChatRow = { date: unknown; user_id: unknown; page_id: unknown; unique_inbox_count: unknown };
type EngRow = { date: unknown; page_id: unknown; new_inbox: unknown; comment: unknown };

const n_ = (v: unknown): number => { const x = Number(v); return isFinite(x) ? x : 0; };
const dk_ = (d: unknown): string => String(d ?? '').slice(0, 10); // date เป็น 'yyyy-mm-dd'

/**
 * @param chatRows แถว admin_chat_daily (ต้องมี page_id) — กรองช่วงวันที่มาแล้ว
 * @param engRows  แถว chat_engagement_daily ช่วงเดียวกัน (new_inbox, comment)
 * @returns { user_id: จำนวนคนทักที่จัดสรรแล้ว (ปัดจำนวนเต็ม) }
 */
export function allocateReached(chatRows: ChatRow[], engRows: EngRow[]): Record<string, number> {
  // ยอดคนทักระดับ (วันที่|เพจ)
  const engByKey: Record<string, number> = {};
  engRows.forEach((e) => {
    engByKey[dk_(e.date) + '|' + String(e.page_id || '')] = n_(e.new_inbox) + n_(e.comment);
  });

  // unique_inbox รายแอดมิน จัดกลุ่มต่อ (วันที่|เพจ)
  const grp: Record<string, { admins: Record<string, number>; sum: number }> = {};
  chatRows.forEach((c) => {
    const pid = String(c.page_id || '');
    if (!pid) return;
    const key = dk_(c.date) + '|' + pid;
    if (!grp[key]) grp[key] = { admins: {}, sum: 0 };
    const uid = String(c.user_id);
    const u = n_(c.unique_inbox_count);
    grp[key].admins[uid] = (grp[key].admins[uid] || 0) + u;
    grp[key].sum += u;
  });

  const reached: Record<string, number> = {};
  Object.keys(grp).forEach((key) => {
    const g = grp[key];
    const E = engByKey[key];
    if (E !== undefined && g.sum > 0) {
      // มียอดเพจ → กระจายตามสัดส่วน unique_inbox
      Object.keys(g.admins).forEach((uid) => {
        reached[uid] = (reached[uid] || 0) + E * (g.admins[uid] / g.sum);
      });
    } else {
      // ไม่มียอด engagement ของเพจนี้ (เพจ LINE ที่ API ไม่คืน หรือยังไม่ sync) → ใช้ unique_inbox ดิบ
      Object.keys(g.admins).forEach((uid) => {
        reached[uid] = (reached[uid] || 0) + g.admins[uid];
      });
    }
  });
  Object.keys(reached).forEach((uid) => { reached[uid] = Math.round(reached[uid]); });
  return reached;
}
