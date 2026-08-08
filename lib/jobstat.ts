// lib/jobstat.ts — "ใบรายงานผล" ของงาน sync (สัญญาที่งานกับตัวเฝ้าระวังคุยกัน)
//
// ทำไมต้องมี: เดิมทุกงานคืนเป็นข้อความไทยล้วน แล้วหน้าเว็บต้อง regex หา "ผิดพลาด (\d+) เพจ"
// เอาเอง — ใครแก้ถ้อยคำในข้อความ ตัวเฝ้าระวังก็ตาบอดทันทีโดยไม่มีใครรู้
// (บทเรียนจริง 2026-08-08: สถิติแชทหาย 60-120 เพจอยู่ 1 สัปดาห์ ทุกงานขึ้นเขียวหมด)
//
// ตอนนี้งานคืน "ตัวเลข" มาตรงๆ แล้วเก็บลง sync_state คีย์ `job_stat:<ชื่องาน>`
// ทั้งตัวตรวจความสมเหตุสมผล (scripts/sync/invariants.ts) และหน้าเว็บอ่านจากที่เดียวกัน
// ไม่ต้องเดาจากข้อความอีก — ข้อความเหลือหน้าที่เดียวคือให้คนอ่าน

export const JOB_STAT_PREFIX = 'job_stat:';

/** ตัวเลขที่งานหนึ่งรอบรายงานกลับมา (ทุกช่องไม่บังคับ — งานที่ไม่ได้วนเพจก็ไม่ต้องใส่) */
export interface JobStat {
  /** หน่วยที่งานนี้วนทำ: 'เพจ' | 'บัญชี' | 'ไฟล์' — ใช้ประกอบข้อความเตือน */
  subject?: string;
  unitsOk?: number;
  unitsFailed?: number;
  unitsTotal?: number;
  /** แถวที่เขียนลง DB จริงในรอบนี้ — ใช้เทียบกับรอบก่อนเพื่อจับ "ข้อมูลหายไปครึ่ง" */
  rowsWritten?: number;
  /**
   * "รอบนี้ทำข้อมูลชุดไหน" (เช่น 'engagements|2026-08-08') — เทียบจำนวนแถวข้ามรอบได้
   * เฉพาะเมื่อ scope ตรงกันเท่านั้น ไม่ใส่ = ไม่ต้องเทียบ
   * มีไว้กันเตือนมั่วตอนเที่ยงคืน: งาน "วันนี้" ขึ้นวันใหม่แถวย่อมเหลือหยิบมือเป็นเรื่องปกติ
   */
  scope?: string;
  /** ไม่ว่าง = งานนี้ไม่ได้ทำงานเลย (ขาด env / ยังไม่มีตาราง) ⇒ นับเป็น "ไม่สำเร็จ" เสมอ */
  skipped?: string;
}

/** สิ่งที่งาน sync คืนกลับมา — message ไว้ให้คนอ่าน ที่เหลือไว้ให้เครื่องอ่าน */
export interface JobResult extends JobStat {
  message: string;
  toString(): string;
}

/** งานเก่าที่ยังคืนข้อความเปล่าๆ ก็ยังใช้ได้ (ค่อยๆ ย้าย ไม่ต้องแก้ทีเดียวหมด) */
export type JobOutput = string | JobResult;

export function jobResult(message: string, stat: JobStat = {}): JobResult {
  // toString ให้ที่เรียกแบบเดิม (`'✅ ' + await job()`) ยังพิมพ์ข้อความเหมือนเดิม
  return { message, ...stat, toString: () => message };
}

export function toResult(out: JobOutput): JobResult {
  return typeof out === 'string' ? jobResult(out) : out;
}

/** สถิติรอบล่าสุดของงานหนึ่ง ที่เก็บไว้ใน sync_state */
export interface StoredJobStat extends JobStat {
  job: string;
  ts: string;
  ok: boolean;
  ms: number;
  message: string;
  /** rowsWritten ของรอบก่อนหน้า — เก็บคู่กันไว้เลย จะได้เทียบได้โดยไม่ต้องเก็บประวัติทั้งหมด */
  prevRows?: number | null;
}

/** เพจ/บัญชีพลาดเกินสัดส่วนนี้ = ข้อมูลรอบนั้นใช้ตัดสินใจไม่ได้ */
export const COVERAGE_FAIL_RATIO = 1 / 3;

/**
 * งานรอบล่าสุด "ทำงานไม่ครบ" หรือเปล่า — คืนข้อความอธิบาย ('' = ปกติ)
 * ใช้ร่วมกันทั้งฝั่ง worker (เขียนเป็นงานล้มลง sync_log) และหน้าเว็บ (ป้ายเตือน)
 */
export function coverageProblem(s: StoredJobStat): string {
  if (s.skipped) return `ไม่ได้ทำงาน: ${s.skipped}`;

  const total = Number(s.unitsTotal || 0);
  const failed = Number(s.unitsFailed || 0);
  const subject = s.subject || 'เพจ';
  if (total > 0 && failed / total > COVERAGE_FAIL_RATIO) {
    return `ดึงข้อมูลไม่ได้ ${failed} จาก ${total} ${subject} — ตัวเลขที่คิดจากงานนี้จะต่ำกว่าจริง`;
  }

  // แถวที่เขียนหายไปเกินครึ่งจากรอบก่อน = ต้นทางเงียบไปบางส่วน (token หมุน / API ตัดข้อมูล)
  // ตั้งพื้น 50 แถว กันงานเล็กที่ขึ้นๆ ลงๆ ตามธรรมชาติมาส่งเสียงรบกวน
  // (prevRows ถูกเก็บมาต่อเมื่อรอบก่อนทำ "ข้อมูลชุดเดียวกัน" — ดู scope)
  const prev = Number(s.prevRows || 0);
  const now = Number(s.rowsWritten || 0);
  if (prev >= 50 && now < prev / 2) {
    return `เขียนได้ ${now} แถว จากรอบก่อน ${prev} แถว — ข้อมูลหายเกินครึ่ง`;
  }
  return '';
}
