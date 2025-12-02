/*
  Warnings:

  - You are about to drop the column `bridgeDstTxHash` on the `DepositIntent` table. All the data in the column will be lost.
  - You are about to drop the column `key` on the `DepositIntent` table. All the data in the column will be lost.
  - You are about to drop the column `routeId` on the `DepositIntent` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[fromTxHash]` on the table `DepositIntent` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `adapterKey` to the `DepositIntent` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."DepositIntent_bridgeDstTxHash_key";

-- DropIndex
DROP INDEX "public"."DepositIntent_depositTxHash_key";

-- DropIndex
DROP INDEX "public"."DepositIntent_mintTxHash_key";

-- DropIndex
DROP INDEX "public"."DepositIntent_routeId_key";

-- AlterTable
ALTER TABLE "DepositIntent" DROP COLUMN "bridgeDstTxHash",
DROP COLUMN "key",
DROP COLUMN "routeId",
ADD COLUMN     "adapterKey" TEXT NOT NULL,
ADD COLUMN     "fromChainId" INTEGER,
ADD COLUMN     "fromTxHash" TEXT,
ADD COLUMN     "toAddress" TEXT,
ADD COLUMN     "toChainId" INTEGER,
ADD COLUMN     "toTokenAddress" TEXT,
ADD COLUMN     "toTokenSymbol" TEXT,
ADD COLUMN     "toTxHash" TEXT,
ALTER COLUMN "deadline" SET DATA TYPE TEXT,
ALTER COLUMN "nonce" SET DATA TYPE TEXT,
ALTER COLUMN "status" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_fromTxHash_key" ON "DepositIntent"("fromTxHash");
