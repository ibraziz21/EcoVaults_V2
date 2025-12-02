-- AlterTable
ALTER TABLE "DepositIntent" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" VARCHAR(66);

-- AlterTable
ALTER TABLE "WithdrawIntent" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" VARCHAR(66);

-- CreateIndex
CREATE INDEX "DepositIntent_user_idx" ON "DepositIntent"("user");
