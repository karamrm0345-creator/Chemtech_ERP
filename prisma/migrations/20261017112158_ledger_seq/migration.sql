-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_seq_key" ON "InventoryTransaction"("seq");

