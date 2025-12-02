/*
  Warnings:

  - You are about to drop the column `lockedAt` on the `DepositIntent` table. All the data in the column will be lost.
  - You are about to drop the column `lockedBy` on the `DepositIntent` table. All the data in the column will be lost.
  - You are about to drop the column `routeId` on the `DepositIntent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DepositIntent" DROP COLUMN "lockedAt",
DROP COLUMN "lockedBy",
DROP COLUMN "routeId",
ADD COLUMN     "processingLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "processingOwner" VARCHAR(64);

-- CreateIndex
CREATE INDEX "DepositIntent_status_updatedAt_idx" ON "DepositIntent"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "DepositIntent_processingLeaseUntil_idx" ON "DepositIntent"("processingLeaseUntil");
