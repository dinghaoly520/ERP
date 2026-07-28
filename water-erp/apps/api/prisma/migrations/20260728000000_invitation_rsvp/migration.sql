-- CreateTable: 采购邀请回执（RSVP）
CREATE TABLE "InvitationRsvp" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "projectId" TEXT,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseIp" TEXT,
    "responseUa" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvitationRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvitationRsvp_token_key" ON "InvitationRsvp"("token");
CREATE INDEX "InvitationRsvp_supplierId_idx" ON "InvitationRsvp"("supplierId");
CREATE INDEX "InvitationRsvp_projectId_idx" ON "InvitationRsvp"("projectId");
CREATE INDEX "InvitationRsvp_token_idx" ON "InvitationRsvp"("token");
CREATE UNIQUE INDEX "InvitationRsvp_invitationId_supplierId_key" ON "InvitationRsvp"("invitationId", "supplierId");
