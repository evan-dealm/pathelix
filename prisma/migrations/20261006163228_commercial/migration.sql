-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "companyAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "companyIban" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "companyLegalName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "companySiret" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "creditNotePrefix" TEXT NOT NULL DEFAULT 'AV',
ADD COLUMN     "defaultQuoteTerms" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "defaultVatRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
ADD COLUMN     "latePaymentTerms" TEXT NOT NULL DEFAULT 'Pénalités de retard : 3 fois le taux d''intérêt légal. Indemnité forfaitaire pour frais de recouvrement : 40 €.',
ADD COLUMN     "orderPrefix" TEXT NOT NULL DEFAULT 'CMD',
ADD COLUMN     "quotePrefix" TEXT NOT NULL DEFAULT 'DEV',
ADD COLUMN     "quoteValidityDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "receivesInvoices" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "validFrom" TEXT,
    "validTo" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'UNIT',
    "amount" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT,
    "priceListId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "renewal" TEXT NOT NULL DEFAULT 'NONE',
    "noticeDays" INTEGER NOT NULL DEFAULT 30,
    "billingFrequency" TEXT NOT NULL DEFAULT 'PER_OPERATION',
    "rentalFreeDays" INTEGER NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL DEFAULT '',
    "issueDate" TEXT NOT NULL,
    "validUntil" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "totalHT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVAT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTTC" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "refusalReason" TEXT NOT NULL DEFAULT '',
    "orderId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'UNIT',
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "amountHT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "explanation" TEXT NOT NULL DEFAULT '',
    "missionType" TEXT,
    "containerTypeId" TEXT,
    "materialId" TEXT,
    "plannedDate" TEXT,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT,
    "contractId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "kind" TEXT NOT NULL DEFAULT 'ONE_OFF',
    "title" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "totalHT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'UNIT',
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "amountHT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "explanation" TEXT NOT NULL DEFAULT '',
    "missionType" TEXT,
    "containerTypeId" TEXT,
    "materialId" TEXT,
    "plannedDate" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'INVOICE',
    "creditedInvoiceId" TEXT,
    "clientId" TEXT NOT NULL,
    "orderId" TEXT,
    "contractId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TEXT,
    "dueDate" TEXT,
    "periodStart" TEXT,
    "periodEnd" TEXT,
    "clientName" TEXT NOT NULL DEFAULT '',
    "billingAddress" TEXT NOT NULL DEFAULT '',
    "clientSiret" TEXT NOT NULL DEFAULT '',
    "totalHT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVAT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTTC" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "exportedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'UNIT',
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "amountHT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "explanation" TEXT NOT NULL DEFAULT '',
    "missionId" TEXT,
    "containerId" TEXT,
    "weighingId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'TRANSFER',
    "reference" TEXT NOT NULL DEFAULT '',
    "receivedAt" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "provider" TEXT,
    "providerRef" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weighing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "missionId" TEXT,
    "stepId" TEXT,
    "driverId" TEXT,
    "exutoireId" TEXT,
    "containerId" TEXT,
    "materialId" TEXT,
    "clientId" TEXT,
    "ticketNumber" TEXT NOT NULL DEFAULT '',
    "grossKg" DOUBLE PRECISION,
    "tareKg" DOUBLE PRECISION,
    "netKg" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'VALIDATED',
    "aiJobId" TEXT,
    "documentId" TEXT,
    "weighedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Weighing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "clientId" TEXT,
    "missionId" TEXT,
    "quoteId" TEXT,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "contractId" TEXT,
    "weighingId" TEXT,
    "containerId" TEXT,
    "visibleToClient" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientContact_tenantId_clientId_idx" ON "ClientContact"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "CustomerNote_tenantId_clientId_at_idx" ON "CustomerNote"("tenantId", "clientId", "at");

-- CreateIndex
CREATE INDEX "PriceList_tenantId_clientId_idx" ON "PriceList"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "PriceRule_tenantId_priceListId_idx" ON "PriceRule"("tenantId", "priceListId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_tenantId_kind_year_key" ON "DocumentSequence"("tenantId", "kind", "year");

-- CreateIndex
CREATE INDEX "Contract_tenantId_clientId_idx" ON "Contract"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Contract_tenantId_status_endDate_idx" ON "Contract"("tenantId", "status", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_tenantId_number_key" ON "Contract"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_orderId_key" ON "Quote"("orderId");

-- CreateIndex
CREATE INDEX "Quote_tenantId_clientId_idx" ON "Quote"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Quote_tenantId_status_validUntil_idx" ON "Quote"("tenantId", "status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_tenantId_number_key" ON "Quote"("tenantId", "number");

-- CreateIndex
CREATE INDEX "QuoteLine_tenantId_quoteId_idx" ON "QuoteLine"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "Order_tenantId_clientId_idx" ON "Order"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Order_tenantId_status_idx" ON "Order"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_number_key" ON "Order"("tenantId", "number");

-- CreateIndex
CREATE INDEX "OrderLine_tenantId_orderId_idx" ON "OrderLine"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_clientId_idx" ON "Invoice"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_dueDate_idx" ON "Invoice"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_missionId_idx" ON "InvoiceLine"("tenantId", "missionId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_clientId_idx" ON "Payment"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_invoiceId_idx" ON "Payment"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "Weighing_tenantId_missionId_idx" ON "Weighing"("tenantId", "missionId");

-- CreateIndex
CREATE INDEX "Weighing_tenantId_status_idx" ON "Weighing"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Weighing_tenantId_clientId_weighedAt_idx" ON "Weighing"("tenantId", "clientId", "weighedAt");

-- CreateIndex
CREATE INDEX "Weighing_tenantId_weighedAt_idx" ON "Weighing"("tenantId", "weighedAt");

-- CreateIndex
CREATE INDEX "Document_tenantId_clientId_idx" ON "Document"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Document_tenantId_missionId_idx" ON "Document"("tenantId", "missionId");

-- CreateIndex
CREATE INDEX "Document_tenantId_invoiceId_idx" ON "Document"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "Document_tenantId_quoteId_idx" ON "Document"("tenantId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_tenantId_storageKey_key" ON "Document"("tenantId", "storageKey");

-- CreateIndex
CREATE INDEX "Mission_orderId_idx" ON "Mission"("orderId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_creditedInvoiceId_fkey" FOREIGN KEY ("creditedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weighing" ADD CONSTRAINT "Weighing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
