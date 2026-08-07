-- CreateTable: SupplierDocument
CREATE TABLE IF NOT EXISTS "SupplierDocument" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "note" TEXT,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupplierDocument_supplierId_idx" ON "SupplierDocument"("supplierId");

-- CreateTable: SupplierFavorite
CREATE TABLE IF NOT EXISTS "SupplierFavorite" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierFavorite_supplierId_userId_key" ON "SupplierFavorite"("supplierId", "userId");
CREATE INDEX IF NOT EXISTS "SupplierFavorite_userId_idx" ON "SupplierFavorite"("userId");
