#!/bin/bash
# ═════════════════════════════════════════════════════════════
#  อัปเดตระบบบริหารงานขนส่ง เทียมเทพ เป็นเวอร์ชันล่าสุด (Mac)
#  ดับเบิลคลิกไฟล์นี้ใน Finder ได้เลย
#
#  ปลอดภัยกับข้อมูล: ดึงโค้ดใหม่ + ปรับโครงสร้างฐานข้อมูลเท่านั้น
#  ไม่ล้างข้อมูลงาน/ค่าใช้จ่าย/ผู้ใช้ที่บันทึกไว้แล้ว
# ═════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

fail() {
  echo
  echo "❌ $1"
  echo
  read -r -p "กด Enter เพื่อปิดหน้าต่างนี้..."
  exit 1
}

echo "═════════════════════════════════════════════"
echo "  อัปเดตระบบบริหารงานขนส่ง เทียมเทพ"
echo "═════════════════════════════════════════════"
echo

docker info >/dev/null 2>&1 || fail "Docker ยังไม่ทำงาน — เปิด Docker Desktop ก่อนแล้วดับเบิลคลิกไฟล์นี้ใหม่"

echo "▶ ดึงโค้ดเวอร์ชันล่าสุด..."
git pull --ff-only || fail "ดึงโค้ดไม่สำเร็จ — เช็คอินเทอร์เน็ตแล้วลองใหม่"

echo "▶ ติดตั้งไลบรารีที่เพิ่มใหม่..."
npm install

echo "▶ เปิดฐานข้อมูล..."
docker compose up -d
DB_STATE=starting
for _ in $(seq 1 60); do
  DB_STATE=$(docker inspect --format '{{.State.Health.Status}}' tiamthep-db 2>/dev/null || echo starting)
  [ "$DB_STATE" = healthy ] && break
  sleep 2
done
[ "$DB_STATE" = healthy ] || fail "ฐานข้อมูลไม่พร้อม — ลองปิด/เปิด Docker Desktop แล้วรันใหม่"

echo "▶ ปรับโครงสร้างฐานข้อมูล (ข้อมูลเดิมอยู่ครบ)..."
npx prisma migrate deploy
npx prisma generate

echo "▶ สร้างหน้าเว็บเวอร์ชันใหม่ (ใช้เวลา 1-2 นาที)..."
npm run build

# รีสตาร์ทระบบ — ผ่าน launchd ถ้าติดตั้งตัวเปิดอัตโนมัติไว้
PLIST="$HOME/Library/LaunchAgents/com.tiamthep.server.plist"
if [ -f "$PLIST" ]; then
  echo "▶ รีสตาร์ทระบบ..."
  launchctl unload "$PLIST" 2>/dev/null || true
  sleep 1
  launchctl load "$PLIST"
else
  # ไม่มีตัวเปิดอัตโนมัติ — ปิดตัวเก่าที่ยึดพอร์ต 3000 แล้วเปิดใหม่เอง
  # (สำคัญ: ถ้าปล่อยตัวเก่ารันต่อหลังอัปเดตไฟล์ จะเจอบางหน้าขึ้น 404)
  echo "▶ รีสตาร์ทระบบ..."
  PIDS=$(lsof -ti tcp:3000 2>/dev/null || true)
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null || true
  sleep 2
  nohup npm start >> server.log 2>&1 &
fi

WEB_UP=no
for _ in $(seq 1 45); do
  curl -s -o /dev/null http://localhost:3000 && { WEB_UP=yes; break; }
  sleep 2
done

echo
if [ "$WEB_UP" = yes ]; then
  echo "═════════════════════════════════════════════"
  echo "  ✅ อัปเดตเสร็จ — ระบบเวอร์ชันใหม่ทำงานแล้ว"
  echo "═════════════════════════════════════════════"
  open http://localhost:3000
else
  echo "อัปเดตโค้ดเสร็จ แต่เว็บยังไม่ตอบ — เปิดด้วย start-mac.command"
  echo "หรือดูข้อความผิดพลาดในไฟล์ server.log"
fi
echo
read -r -p "กด Enter เพื่อปิดหน้าต่างนี้..."
