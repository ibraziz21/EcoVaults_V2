-- CreateTable
CREATE TABLE "RewardsSweepRun" (
    "id" TEXT NOT NULL,
    "safeAddress" TEXT NOT NULL,
    "chainIdFrom" INTEGER NOT NULL,
    "chainIdTo" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "processingOwner" TEXT,
    "processingLeaseUntil" TIMESTAMP(3),
    "thresholdLsk" TEXT,
    "claimableLsk" TEXT,
    "claimedLsk" TEXT,
    "bridgedUsdt" TEXT,
    "bridgedAmount" TEXT,
    "bridgedTokenSymbol" TEXT,
    "claimTxHash" TEXT,
    "bridgeFromTxHash" TEXT,
    "bridgeToTxHash" TEXT,
    "fundTxHash" TEXT,
    "bridgeAttempts" INTEGER NOT NULL DEFAULT 0,
    "fundAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardsSweepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RewardsSweepRun_safeAddress_status_idx" ON "RewardsSweepRun"("safeAddress", "status");

-- CreateIndex
CREATE INDEX "RewardsSweepRun_processingLeaseUntil_idx" ON "RewardsSweepRun"("processingLeaseUntil");
