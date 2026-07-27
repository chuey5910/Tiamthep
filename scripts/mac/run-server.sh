#!/bin/bash
# เปิดฐานข้อมูลแล้วรันเว็บ — ใช้ทั้งตอนเปิดเองและตอน launchd เรียกอัตโนมัติหลังบูตเครื่อง
cd "$(dirname "$0")/../.."

# launchd เรียกสคริปต์ด้วย PATH แบบย่อ ต้องเติมที่อยู่ของ node/docker เอง
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# หลังบูตเครื่อง Docker Desktop ใช้เวลาเปิดตัวสักพัก — รอได้สูงสุด 3 นาที
for _ in $(seq 1 90); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done
if ! docker info >/dev/null 2>&1; then
  echo "Docker ยังไม่ทำงาน — เปิด Docker Desktop ก่อนแล้วลองใหม่" >&2
  exit 1
fi

docker compose up -d

# รอฐานข้อมูลพร้อมรับงานก่อนเปิดเว็บ
for _ in $(seq 1 60); do
  docker inspect --format '{{.State.Health.Status}}' tiamthep-db 2>/dev/null | grep -q '^healthy$' && break
  sleep 2
done

exec npm start
