import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAiBidTaskProcessingStatus,
  isAiBidTaskScoringVisibleStatus,
  isAiBidTaskStartableStatus,
  isAiBidderParsedStatus,
  isAiBidderProcessingStatus,
  isAiBidderReadyStatus,
} from './status';

test('groups current bidder statuses for parsing display', () => {
  assert.equal(isAiBidderProcessingStatus('OCR_PROCESSING'), true);
  assert.equal(isAiBidderProcessingStatus('EXTRACTING'), true);
  assert.equal(isAiBidderProcessingStatus('SCORING'), true);
  assert.equal(isAiBidderProcessingStatus('DEVIATION_ANALYZING'), true);

  assert.equal(isAiBidderParsedStatus('OCR_COMPLETED'), true);
  assert.equal(isAiBidderParsedStatus('EXTRACTING'), true);
  assert.equal(isAiBidderParsedStatus('EXTRACTED'), true);
  assert.equal(isAiBidderParsedStatus('SCORED'), true);
  assert.equal(isAiBidderParsedStatus('COMPLETED'), true);

  assert.equal(isAiBidderReadyStatus('OCR_COMPLETED'), true);
  assert.equal(isAiBidderReadyStatus('EXTRACTED'), true);
  assert.equal(isAiBidderReadyStatus('SCORED'), true);
  assert.equal(isAiBidderReadyStatus('COMPLETED'), true);

  assert.equal(isAiBidderProcessingStatus('PENDING'), false);
  assert.equal(isAiBidderParsedStatus('PENDING'), false);
  assert.equal(isAiBidderReadyStatus('FAILED'), false);
});

test('groups current task statuses for start and workspace display', () => {
  assert.equal(isAiBidTaskStartableStatus('CREATED'), true);
  assert.equal(isAiBidTaskStartableStatus('TENDER_UPLOADING'), true);
  assert.equal(isAiBidTaskStartableStatus('TENDER_READY'), true);
  assert.equal(isAiBidTaskStartableStatus('BIDDERS_UPLOADING'), true);
  assert.equal(isAiBidTaskStartableStatus('ANALYZING'), false);

  assert.equal(isAiBidTaskProcessingStatus('ANALYZING'), true);
  assert.equal(isAiBidTaskProcessingStatus('TENDER_PROCESSING'), true);
  assert.equal(isAiBidTaskProcessingStatus('BIDDERS_PROCESSING'), true);
  assert.equal(isAiBidTaskProcessingStatus('CREATED'), false);

  assert.equal(isAiBidTaskScoringVisibleStatus('COMPLETED'), true);
  assert.equal(isAiBidTaskScoringVisibleStatus('FAILED'), true);
  assert.equal(isAiBidTaskScoringVisibleStatus('CANCELLED'), true);
  assert.equal(isAiBidTaskScoringVisibleStatus('ANALYZING'), false);
});
