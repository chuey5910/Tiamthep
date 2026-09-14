# อิมเมจของเว็บ TMS สำหรับรันบน NAS (หรือเครื่อง Linux อื่น)
#
# สร้างบนเครื่องที่จะรันจริงเสมอ (docker compose build) — NAS เป็น Intel
# ส่วน Mac เป็นชิป Apple อิมเมจที่สร้างคนละชิปใช้ข้ามกันไม่ได้
#
# ในอิมเมจมี node_modules ครบทั้งชุด (ไม่ตัด devDependencies) ตั้งใจไว้แบบนี้
# เพราะคำสั่งดูแลระบบที่ใช้ประจำต้องพึ่ง prisma กับ tsx เช่น
#   db:migrate · db:backup · routes:add · list:users · set:password
# รันได้จากในกล่องเดียวกันหมด ไม่ต้องลง Node บน NAS

FROM node:22-bookworm-slim

# openssl — Prisma ต้องใช้ · tzdata — ให้เวลาในกล่องตรงกับไทย มีผลกับการตัดวันในรายงาน
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Bangkok
ENV NODE_ENV=production
# ให้เว็บรับการเชื่อมต่อจากนอกกล่อง ไม่ใช่เฉพาะในกล่องเอง
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

# ลงไลบรารีก่อน แล้วค่อยก๊อปโค้ด — แก้โค้ดแล้ว build ใหม่จะเร็วขึ้นมาก
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

# ตอน build ยังไม่มีฐานข้อมูล ใส่ค่าหลอกไว้ให้ prisma generate ผ่าน
# ค่าจริงมาจากไฟล์ .env ตอนรัน
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" npm run build

EXPOSE 3000

# ทุกครั้งที่กล่องเริ่มทำงาน: ปรับโครงสร้างฐานข้อมูลให้ตรงกับโค้ดก่อน แล้วค่อยเปิดเว็บ
# migrate deploy รันซ้ำได้เสมอ ถ้าไม่มีอะไรต้องปรับก็ผ่านไปเฉยๆ ไม่แตะข้อมูล
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
