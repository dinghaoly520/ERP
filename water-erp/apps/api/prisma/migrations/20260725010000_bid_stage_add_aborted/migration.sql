-- BidStage 加 ABORTED：流标（确认后发现供应商不足可流转到此状态）
ALTER TYPE "BidStage" ADD VALUE IF NOT EXISTS 'ABORTED';
