-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Lookup" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Lookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "plate" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'รถบริษัท',
    "partnerId" INTEGER,
    "startDate" TIMESTAMP(3),
    "taxDueDate" TIMESTAMP(3),
    "actDueDate" TIMESTAMP(3),
    "insuranceDue" TIMESTAMP(3),
    "cargoInsDue" TIMESTAMP(3),
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("plate")
);

-- CreateTable
CREATE TABLE "Driver" (
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nationalId" TEXT,
    "licenseNo" TEXT,
    "licenseType" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "VehiclePairing" (
    "id" SERIAL NOT NULL,
    "headPlate" TEXT NOT NULL,
    "trailerPlate" TEXT NOT NULL DEFAULT '',
    "driverCode" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "VehiclePairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "taxId" TEXT,
    "branch" TEXT,
    "creditDays" INTEGER NOT NULL DEFAULT 30,
    "billingDay" TEXT,
    "fuelBasisId" INTEGER,
    "weightBasis" TEXT NOT NULL DEFAULT 'น้ำหนักปลายทาง',
    "billingDateBasis" TEXT NOT NULL DEFAULT 'วันที่ขึ้นสินค้า',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelPriceBasis" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dayOfMonth" INTEGER,
    "startDay" INTEGER,
    "endDay" INTEGER,
    "monthOffset" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "FuelPriceBasis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelPrice" (
    "date" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "note" TEXT,

    CONSTRAINT "FuelPrice_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "PriceBand" (
    "id" SERIAL NOT NULL,
    "minPrice" DOUBLE PRECISION NOT NULL,
    "maxPrice" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PriceBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" SERIAL NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "priceUnit" TEXT NOT NULL DEFAULT 'ต่อเที่ยว',
    "distanceKm" DOUBLE PRECISION,
    "targetKmPerL" DOUBLE PRECISION,
    "allowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutePrice" (
    "id" SERIAL NOT NULL,
    "routeId" INTEGER NOT NULL,
    "bandId" INTEGER NOT NULL,
    "customerPrice" DOUBLE PRECISION,
    "outsourcePrice" DOUBLE PRECISION,

    CONSTRAINT "RoutePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "loadDate" TIMESTAMP(3) NOT NULL,
    "unloadDate" TIMESTAMP(3),
    "tripCode" TEXT NOT NULL,
    "headPlate" TEXT NOT NULL,
    "trailerPlate" TEXT,
    "driverCode" TEXT,
    "customerId" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "weightOrigin" DOUBLE PRECISION,
    "weightDest" DOUBLE PRECISION,
    "cargoType" TEXT,
    "routeId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelAdvance" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "plate" TEXT,
    "driverCode" TEXT NOT NULL,
    "advance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toll" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "TravelAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "plate" TEXT,
    "driverCode" TEXT,
    "supplier" TEXT,
    "category" TEXT NOT NULL,
    "detail" TEXT,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelEntry" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "driverCode" TEXT,
    "litres" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricePerL" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mileage" DOUBLE PRECISION,
    "station" TEXT,
    "refNo" TEXT,
    "note" TEXT,

    CONSTRAINT "FuelEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelBonusOverride" (
    "tripCode" TEXT NOT NULL,
    "actualLitres" DOUBLE PRECISION NOT NULL,
    "note" TEXT,

    CONSTRAINT "FuelBonusOverride_pkey" PRIMARY KEY ("tripCode")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'ชิ้น',
    "trackingType" TEXT NOT NULL DEFAULT 'จำนวน',
    "reorderPoint" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "SerialUnit" (
    "code" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "brand" TEXT,
    "serial" TEXT,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vendor" TEXT,

    CONSTRAINT "SerialUnit_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "StockIn" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "itemCode" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vendor" TEXT,
    "billNo" TEXT,
    "note" TEXT,

    CONSTRAINT "StockIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOut" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "itemCode" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "plate" TEXT,
    "position" TEXT,
    "newUnitCode" TEXT,
    "oldUnitCode" TEXT,
    "vendor" TEXT,
    "workOrder" TEXT,
    "issuedBy" TEXT,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "StockOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "workOrder" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "billedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapPart" (
    "unitCode" TEXT NOT NULL,
    "treadMm" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'รอขาย',
    "buyer" TEXT,
    "salePrice" DOUBLE PRECISION,
    "soldAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ScrapPart_pkey" PRIMARY KEY ("unitCode")
);

-- CreateIndex
CREATE INDEX "Lookup_kind_idx" ON "Lookup"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Lookup_kind_value_key" ON "Lookup"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_name_key" ON "Partner"("name");

-- CreateIndex
CREATE INDEX "Vehicle_ownerType_idx" ON "Vehicle"("ownerType");

-- CreateIndex
CREATE INDEX "Driver_active_idx" ON "Driver"("active");

-- CreateIndex
CREATE INDEX "VehiclePairing_headPlate_trailerPlate_effectiveDate_idx" ON "VehiclePairing"("headPlate", "trailerPlate", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FuelPriceBasis_name_key" ON "FuelPriceBasis"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBand_label_key" ON "PriceBand"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Route_origin_destination_vehicleType_key" ON "Route"("origin", "destination", "vehicleType");

-- CreateIndex
CREATE UNIQUE INDEX "RoutePrice_routeId_bandId_key" ON "RoutePrice"("routeId", "bandId");

-- CreateIndex
CREATE INDEX "Job_loadDate_idx" ON "Job"("loadDate");

-- CreateIndex
CREATE INDEX "Job_headPlate_loadDate_idx" ON "Job"("headPlate", "loadDate");

-- CreateIndex
CREATE INDEX "Job_driverCode_loadDate_idx" ON "Job"("driverCode", "loadDate");

-- CreateIndex
CREATE INDEX "Job_tripCode_idx" ON "Job"("tripCode");

-- CreateIndex
CREATE INDEX "TravelAdvance_date_idx" ON "TravelAdvance"("date");

-- CreateIndex
CREATE INDEX "TravelAdvance_driverCode_date_idx" ON "TravelAdvance"("driverCode", "date");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_plate_date_idx" ON "Expense"("plate", "date");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "FuelEntry_date_idx" ON "FuelEntry"("date");

-- CreateIndex
CREATE INDEX "FuelEntry_plate_date_idx" ON "FuelEntry"("plate", "date");

-- CreateIndex
CREATE INDEX "FuelEntry_driverCode_date_idx" ON "FuelEntry"("driverCode", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FuelEntry_source_refNo_key" ON "FuelEntry"("source", "refNo");

-- CreateIndex
CREATE INDEX "StockIn_date_idx" ON "StockIn"("date");

-- CreateIndex
CREATE UNIQUE INDEX "StockOut_newUnitCode_key" ON "StockOut"("newUnitCode");

-- CreateIndex
CREATE UNIQUE INDEX "StockOut_oldUnitCode_key" ON "StockOut"("oldUnitCode");

-- CreateIndex
CREATE INDEX "StockOut_date_idx" ON "StockOut"("date");

-- CreateIndex
CREATE INDEX "StockOut_plate_date_idx" ON "StockOut"("plate", "date");

-- CreateIndex
CREATE INDEX "StockOut_workOrder_vendor_idx" ON "StockOut"("workOrder", "vendor");

-- CreateIndex
CREATE INDEX "VendorBill_date_idx" ON "VendorBill"("date");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_workOrder_vendor_date_key" ON "VendorBill"("workOrder", "vendor", "date");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehiclePairing" ADD CONSTRAINT "VehiclePairing_driverCode_fkey" FOREIGN KEY ("driverCode") REFERENCES "Driver"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_fuelBasisId_fkey" FOREIGN KEY ("fuelBasisId") REFERENCES "FuelPriceBasis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePrice" ADD CONSTRAINT "RoutePrice_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePrice" ADD CONSTRAINT "RoutePrice_bandId_fkey" FOREIGN KEY ("bandId") REFERENCES "PriceBand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_headPlate_fkey" FOREIGN KEY ("headPlate") REFERENCES "Vehicle"("plate") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_trailerPlate_fkey" FOREIGN KEY ("trailerPlate") REFERENCES "Vehicle"("plate") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialUnit" ADD CONSTRAINT "SerialUnit_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "InventoryItem"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIn" ADD CONSTRAINT "StockIn_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "InventoryItem"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "InventoryItem"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_newUnitCode_fkey" FOREIGN KEY ("newUnitCode") REFERENCES "SerialUnit"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_oldUnitCode_fkey" FOREIGN KEY ("oldUnitCode") REFERENCES "SerialUnit"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapPart" ADD CONSTRAINT "ScrapPart_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "SerialUnit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
