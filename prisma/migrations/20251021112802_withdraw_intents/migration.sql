-- CreateTable
CREATE TABLE "WithdrawIntent" (
    "id" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "amountShares" TEXT NOT NULL,
    "dstChainId" INTEGER NOT NULL,
    "dstToken" TEXT NOT NULL,
    "minAmountOut" TEXT NOT NULL,
    "deadline" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "redeemTxHash" TEXT,
    "fromTxHash" TEXT,
    "toTxHash" TEXT,
    "amountOut" TEXT,
    "burnTxHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawIntent_refId_key" ON "WithdrawIntent"("refId");

-- CreateIndex
CREATE INDEX "WithdrawIntent_user_idx" ON "WithdrawIntent"("user");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawIntent_user_nonce_key" ON "WithdrawIntent"("user", "nonce");
