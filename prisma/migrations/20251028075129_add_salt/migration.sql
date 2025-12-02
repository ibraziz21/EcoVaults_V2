/*
  Warnings:

  - A unique constraint covering the columns `[digest]` on the table `DepositIntent` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[signature]` on the table `DepositIntent` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `digest` to the `DepositIntent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `salt` to the `DepositIntent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `signature` to the `DepositIntent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DepositIntent" ADD COLUMN     "consumedAt" TIMESTAMP(3),
ADD COLUMN     "digest" TEXT NOT NULL,
ADD COLUMN     "salt" TEXT NOT NULL,
ADD COLUMN     "signature" TEXT NOT NULL,
ALTER COLUMN "adapterKey" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_digest_key" ON "DepositIntent"("digest");

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_signature_key" ON "DepositIntent"("signature");
