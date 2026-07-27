#!/bin/bash
# ═════════════════════════════════════════════════════════════
#  ติดตั้งระบบบริหารงานขนส่ง เทียมเทพ บน Mac (CHUEY-Server)
#  ดับเบิลคลิกไฟล์นี้ใน Finder ได้เลย — ทำทุกขั้นตอนให้อัตโนมัติ
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
echo "  ระบบบริหารงานขนส่ง เทียมเทพ — ติดตั้งบน Mac"
echo "═════════════════════════════════════════════"
echo

# ── 1) ตรวจโปรแกรมพื้นฐาน ──────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "ยังไม่มี Docker
   1. ดาวน์โหลด Docker Desktop จาก https://www.docker.com/products/docker-desktop/
   2. ติดตั้งแล้วเปิดโปรแกรม รอจนไอคอนวาฬบนแถบเมนูนิ่ง
   3. ดับเบิลคลิกไฟล์นี้ใหม่อีกครั้ง"

docker info >/dev/null 2>&1 || fail "Docker ติดตั้งแล้วแต่ยังไม่ทำงาน
   เปิดโปรแกรม Docker Desktop รอจนไอคอนวาฬบนแถบเมนูนิ่ง แล้วดับเบิลคลิกไฟล์นี้ใหม่"

command -v node >/dev/null 2>&1 || fail "ยังไม่มี Node.js
   ติดตั้งตัว LTS จาก https://nodejs.org แล้วดับเบิลคลิกไฟล์นี้ใหม่"

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js เวอร์ชันเก่าเกินไป (พบ $(node -v) ต้องการ 20 ขึ้นไป)
   ติดตั้งตัว LTS ใหม่จาก https://nodejs.org"

echo "✓ Docker และ Node.js พร้อมแล้ว ($(node -v))"

# ── 2) สร้างไฟล์ตั้งค่า + รหัสผ่านฐานข้อมูลแบบสุ่ม ─────────────
if [ ! -f .env ]; then
  PW=$(openssl rand -hex 16)
  sed "s/เปลี่ยนรหัสนี้ก่อนใช้จริง/$PW/g" .env.example > .env
  echo "✓ สร้างไฟล์ .env พร้อมรหัสผ่านฐานข้อมูลแบบสุ่มแล้ว"
else
  echo "✓ มีไฟล์ .env อยู่แล้ว — ใช้ค่าเดิม"
fi

# ── 3) เลี่ยงพอร์ตชน — บาง Mac มี PostgreSQL ตัวอื่นใช้ 5432 อยู่แล้ว ──
port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
db_running() { docker inspect --format '{{.State.Running}}' tiamthep-db 2>/dev/null | grep -q true; }

CUR_PORT=$(grep -E '^DB_PORT=' .env | head -1 | cut -d= -f2)
CUR_PORT=${CUR_PORT:-5432}
if ! db_running && port_in_use "$CUR_PORT"; then
  NEW_PORT=""
  for p in 5433 5434 5435 5436 5437; do
    port_in_use "$p" || { NEW_PORT=$p; break; }
  done
  [ -n "$NEW_PORT" ] || fail "พอร์ต 5432-5437 ถูกใช้หมด — ปิดโปรแกรมฐานข้อมูลอื่นในเครื่องก่อนแล้วลองใหม่"
  if grep -q '^DB_PORT=' .env; then
    sed -i '' "s/^DB_PORT=.*/DB_PORT=$NEW_PORT/" .env
  else
    printf '\nDB_PORT=%s\n' "$NEW_PORT" >> .env
  fi
  sed -i '' "s|@127.0.0.1:$CUR_PORT/|@127.0.0.1:$NEW_PORT/|" .env
  echo "✓ พอร์ต $CUR_PORT มีโปรแกรมอื่นใช้อยู่ — ย้ายฐานข้อมูลของเราไปพอร์ต $NEW_PORT ให้แล้ว"
fi

# ── 4) เปิดฐานข้อมูล PostgreSQL ─────────────────────────────
echo
echo "▶ กำลังเปิดฐานข้อมูล..."
docker compose up -d

DB_STATE=starting
for _ in $(seq 1 60); do
  DB_STATE=$(docker inspect --format '{{.State.Health.Status}}' tiamthep-db 2>/dev/null || echo starting)
  [ "$DB_STATE" = healthy ] && break
  sleep 2
done
[ "$DB_STATE" = healthy ] || fail "ฐานข้อมูลเปิดไม่สำเร็จ
   ลองปิดแล้วเปิด Docker Desktop ใหม่ จากนั้นดับเบิลคลิกไฟล์นี้อีกครั้ง"
echo "✓ ฐานข้อมูลพร้อมแล้ว"

# ── 5) ติดตั้งระบบ + สร้างตาราง + นำเข้าข้อมูล ─────────────────
echo
echo "▶ กำลังติดตั้ง (ครั้งแรกใช้เวลา 3-5 นาที)..."
npm install
npm run setup
echo
echo "▶ กำลังเตรียมหน้าเว็บ..."
npm run build

# ── 6) ตั้งให้เปิดเองอัตโนมัติ + เริ่มทำงานทันที ─────────────────
PLIST="$HOME/Library/LaunchAgents/com.tiamthep.server.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.tiamthep.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PWD/scripts/mac/run-server.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PWD/server.log</string>
  <key>StandardErrorPath</key><string>$PWD/server.log</string>
</dict>
</plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✓ ตั้งให้ระบบเปิดเองอัตโนมัติตอนเข้าเครื่องแล้ว"

# รอเว็บพร้อม
echo
echo "▶ กำลังเปิดเว็บ..."
WEB_UP=no
for _ in $(seq 1 45); do
  curl -s -o /dev/null http://localhost:3000 && { WEB_UP=yes; break; }
  sleep 2
done
[ "$WEB_UP" = yes ] || fail "เว็บยังไม่ตอบสนอง — เปิดไฟล์ server.log ในโฟลเดอร์นี้ดูข้อความผิดพลาด"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "IP-ของเครื่องนี้")
echo
echo "═════════════════════════════════════════════"
echo "  ✅ ติดตั้งเสร็จสมบูรณ์ — ระบบทำงานแล้ว"
echo
echo "  เครื่องนี้:        http://localhost:3000"
echo "  เครื่องอื่นในออฟฟิศ:  http://$IP:3000"
echo
echo "  หน้าเว็บที่เปิดขึ้นมาจะให้ตั้งบัญชี"
echo "  ผู้ดูแลระบบคนแรกด้วยตัวเอง"
echo "═════════════════════════════════════════════"
echo
open http://localhost:3000
read -r -p "กด Enter เพื่อปิดหน้าต่างนี้..."
