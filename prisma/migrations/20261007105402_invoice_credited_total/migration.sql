-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "creditedTTC" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: what the credit notes already issued took off each invoice.
UPDATE "Invoice" i
SET "creditedTTC" = c.total
FROM (
  SELECT "creditedInvoiceId" AS id, ROUND(ABS(SUM("totalTTC"))::numeric, 2)::double precision AS total
  FROM "Invoice"
  WHERE "kind" = 'CREDIT_NOTE' AND "status" <> 'DRAFT' AND "creditedInvoiceId" IS NOT NULL
  GROUP BY "creditedInvoiceId"
) c
WHERE i.id = c.id;
