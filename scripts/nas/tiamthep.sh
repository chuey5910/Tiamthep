#!/bin/bash
# ตัวช่วยสั่งงานระบบขนส่งบน NAS — สั่งจากโฟลเดอร์ /volume1/docker/tiamthep/app
#
#   bash scripts/nas/tiamthep.sh up       เปิดระบบ (สร้างอิมเมจให้ถ้ายังไม่มี)
#   bash scripts/nas/tiamthep.sh down     ปิดระบบ (ข้อมูลไม่หาย)
#   bash scripts/nas/tiamthep.sh update   ดึงโค้ดล่าสุด สร้างใหม่ แล้วเปิดต่อ
#   bash scripts/nas/tiamthep.sh status   ดูว่ากล่องไหนทำงานอยู่
#   bash scripts/nas/tiamthep.sh logs     ดูข้อความล่าสุด (ออกด้วย Ctrl+C)
#   bash scripts/nas/tiamthep.sh backup   สำรองข้อมูลเดี๋ยวนี้
#   bash scripts/nas/tiamthep.sh restore ไฟล์.sql.gz   กู้ข้อมูลจากไฟล์สำรอง
#   bash scripts/nas/tiamthep.sh psql     เปิดหน้าจอสั่งงานฐานข้อมูลโดยตรง
#   bash scripts/nas/tiamthep.sh run ...  สั่งคำสั่งของระบบ เช่น run npm run list:users
set -e

cd "$(dirname "$0")/../.."   # → โฟลเดอร์ app/
ROOT="$(pwd)"
ENV_FILE="$ROOT/../secrets/.env"
COMPOSE="docker compose --env-file $ENV_FILE -f $ROOT/docker-compose.nas.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ไม่พบไฟล์ตั้งค่า: $ENV_FILE"
  echo "   ก๊อปตัวอย่างไปตั้งค่าก่อน:  cp .env.nas.example ../secrets/.env"
  exit 1
fi

# docker บน NAS มักต้องใช้สิทธิ์ root
DOCKER_OK=$(docker ps >/dev/null 2>&1 && echo yes || echo no)
if [ "$DOCKER_OK" = "no" ]; then
  if [ "$(id -u)" != "0" ]; then
    echo "ℹ ต้องใช้สิทธิ์ root — รันใหม่ด้วย:  sudo bash scripts/nas/tiamthep.sh $*"
    exit 1
  fi
fi

# NAS บางรุ่น (เช่น UGOS) ลง git ลงเครื่องไม่ได้ เพราะชุดแพ็กเกจถูกดัดแปลงไว้
# ถ้าไม่มี git ก็ยืมจาก Docker แทน — ได้ผลเหมือนกัน และไม่แตะระบบของ NAS
git_run() {
  if command -v git >/dev/null 2>&1; then
    git -C "$ROOT" "$@"
  else
    docker run --rm -v "$ROOT:/w" -w /w alpine/git -c safe.directory=/w "$@"
  fi
}

cmd="${1:-status}"
shift || true

case "$cmd" in
  up)
    $COMPOSE up -d --build
    echo
    echo "เปิดระบบแล้ว — รอสักครู่ให้ฐานข้อมูลพร้อม แล้วเข้าใช้งานที่:"
    echo "  ในบ้าน:    http://$(hostname -I 2>/dev/null | awk '{print $1}'):$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2)"
    echo "  นอกบ้าน:   http://<IP 100.x ของ NAS>:$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2)"
    ;;

  down)
    $COMPOSE down
    echo "ปิดระบบแล้ว — ข้อมูลใน data/db ยังอยู่ครบ เปิดใหม่ได้ด้วย up"
    ;;

  update)
    echo "▶ สำรองข้อมูลก่อนอัปเดต..."
    bash "$0" backup || { echo "❌ สำรองไม่สำเร็จ — หยุดไว้ก่อน ไม่อัปเดต"; exit 1; }
    echo "▶ ดึงโค้ดล่าสุด..."
    git_run pull --ff-only
    echo "▶ สร้างใหม่และเปิดต่อ..."
    $COMPOSE up -d --build
    echo "✅ อัปเดตเสร็จ"
    ;;

  status)
    $COMPOSE ps
    ;;

  logs)
    $COMPOSE logs -f --tail=100 "$@"
    ;;

  backup)
    ts=$(date +%Y%m%d-%H%M%S)
    out="/backup/tiamthep-$ts.sql"
    # เขียนไฟล์ก่อน แล้วค่อยตรวจว่าได้ข้อมูลจริง จึงบีบอัด — กันได้ไฟล์เปล่าที่ดูเหมือนสำเร็จ
    $COMPOSE exec -T backup sh -c "pg_dump --clean --if-exists --file $out && [ -s $out ] && gzip -f $out"
    echo "✅ สำรองข้อมูลแล้ว: ../data/backup/tiamthep-$ts.sql.gz"
    ;;

  restore)
    file="$1"
    [ -n "$file" ] || { echo "ใช้: tiamthep.sh restore ไฟล์.sql.gz"; exit 1; }
    [ -f "$file" ] || { echo "ไม่พบไฟล์: $file"; exit 1; }
    echo "⚠ จะเขียนทับข้อมูลทั้งหมดในฐานข้อมูลด้วยไฟล์: $file"
    read -r -p "พิมพ์ YES เพื่อยืนยัน: " ans
    [ "$ans" = "YES" ] || { echo "ยกเลิก"; exit 1; }
    gunzip -c "$file" | $COMPOSE exec -T db psql -U "$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2)" -d "$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2)"
    echo "✅ กู้ข้อมูลเรียบร้อย"
    ;;

  psql)
    $COMPOSE exec db psql -U "$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2)" -d "$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2)"
    ;;

  run)
    [ $# -gt 0 ] || { echo "ใช้: tiamthep.sh run <คำสั่ง> เช่น  run npm run list:users"; exit 1; }
    $COMPOSE exec web "$@"
    ;;

  *)
    sed -n '2,14p' "$0"
    exit 1
    ;;
esac
