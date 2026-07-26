/**
 * แปลง DATABASE_URL ของ Prisma ให้เครื่องมือของ PostgreSQL (psql, pg_dump) ใช้ได้
 *
 * Prisma ต้องการ ?schema=public ต่อท้าย แต่ psql/pg_dump ไม่รู้จักพารามิเตอร์นี้
 * และจะฟ้อง invalid URI query parameter แล้วออกทันที
 * ฟังก์ชันนี้จึงตัดพารามิเตอร์ที่เป็นของ Prisma ล้วนๆ ออกให้
 */

/** พารามิเตอร์ที่ Prisma ใช้เอง ไม่ใช่ของ libpq */
const PRISMA_ONLY = new Set([
  "schema",
  "connection_limit",
  "pool_timeout",
  "socket_timeout",
  "pgbouncer",
  "statement_cache_size",
]);

export function pgUrlForCli(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (PRISMA_ONLY.has(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    // แปลงไม่ได้ก็ส่งคืนของเดิม ให้เครื่องมือปลายทางฟ้องเอง
    return url;
  }
}
