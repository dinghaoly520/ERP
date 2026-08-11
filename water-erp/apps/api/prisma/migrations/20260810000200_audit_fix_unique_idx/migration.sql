-- Corrective: replace unique index to allow per-item passfail + per-source dispute/manual
-- Old: [projectId, supplierId, source]  (prevents multiple passfail per supplier)
-- New: [projectId, supplierId, source, scoreItemId] (passfail unique per item; dispute/manual unique per supplier via source)

DROP INDEX IF EXISTS "BidInvalidBid_projectId_supplierId_source_key";
CREATE UNIQUE INDEX "BidInvalidBid_projectId_supplierId_source_scoreItemId_key"
  ON "BidInvalidBid"("projectId", "supplierId", "source", COALESCE("scoreItemId", ''));
