-- P1-1：旧轨代解密授权记录（办法第30条留痕）
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "hostDecryptAuthorized" BOOLEAN NOT NULL DEFAULT false;
