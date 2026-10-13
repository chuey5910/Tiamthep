-- ใบสั่งงานร้านค้า (PO) จากไลน์บอท
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "staffCode" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "shopCode" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "pricedAt" TIMESTAMP(3),
    "billUrls" TEXT,
    "rawText" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShopOrder_orderedAt_idx" ON "ShopOrder"("orderedAt");
CREATE INDEX "ShopOrder_shopName_orderedAt_idx" ON "ShopOrder"("shopName", "orderedAt");
CREATE INDEX "ShopOrder_status_idx" ON "ShopOrder"("status");

CREATE TABLE "ShopOrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT,
    "answer" TEXT,
    "shopPrice" DOUBLE PRECISION,
    "expenseId" INTEGER,
    "stockInId" INTEGER,
    "postedAmount" DOUBLE PRECISION,
    "postedTarget" TEXT,
    "postedCategory" TEXT,
    "postedItemCode" TEXT,
    "postedAt" TIMESTAMP(3),
    CONSTRAINT "ShopOrderItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopOrderItem_expenseId_key" ON "ShopOrderItem"("expenseId");
CREATE UNIQUE INDEX "ShopOrderItem_stockInId_key" ON "ShopOrderItem"("stockInId");
CREATE UNIQUE INDEX "ShopOrderItem_orderId_seq_key" ON "ShopOrderItem"("orderId", "seq");
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
