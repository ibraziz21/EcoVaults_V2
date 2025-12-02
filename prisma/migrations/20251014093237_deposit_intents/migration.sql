-- CreateTable
CREATE TABLE "DepositIntent" (
    "id" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "minAmount" TEXT NOT NULL,
    "deadline" BIGINT NOT NULL,
    "nonce" BIGINT NOT NULL,
    "refId" TEXT NOT NULL,
    "routeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bridgedAmount" TEXT,
    "bridgeDstTxHash" TEXT,
    "depositTxHash" TEXT,
    "mintTxHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_refId_key" ON "DepositIntent"("refId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_routeId_key" ON "DepositIntent"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_bridgeDstTxHash_key" ON "DepositIntent"("bridgeDstTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_depositTxHash_key" ON "DepositIntent"("depositTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_mintTxHash_key" ON "DepositIntent"("mintTxHash");
