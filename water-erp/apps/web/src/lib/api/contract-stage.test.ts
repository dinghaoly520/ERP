import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canAcceptContract,
  canCompleteContractFulfillment,
  canRegisterContractSigning,
  contractProofAssetUrl,
  formatContractProofMetadata,
  uploadContractProof,
  CONTRACT_STATUS_LABEL,
  type ContractFulfillment,
  type ContractProofAsset,
} from './contract';

const proofAsset: ContractProofAsset = {
  id: 'asset-proof-1',
  originalName: '验收报告.pdf',
  size: 1_572_864,
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  mimeType: 'application/pdf',
  createdAt: '2026-09-03T08:30:00.000Z',
};

function fulfillment(overrides: Partial<ContractFulfillment> = {}): ContractFulfillment {
  return {
    id: 'fulfillment-1',
    contractId: 'contract-1',
    type: 'delivery',
    title: '首批设备到货',
    status: 'pending',
    proofAssetId: null,
    proofAsset: null,
    ...overrides,
  };
}

test('fulfillment cannot be completed without an existing or simultaneously selected proof', () => {
  assert.equal(canCompleteContractFulfillment(fulfillment(), false), false);
  assert.equal(canCompleteContractFulfillment(fulfillment({ proofAssetId: proofAsset.id }), false), true);
  assert.equal(canCompleteContractFulfillment(fulfillment(), true), true);
});

test('acceptance closure requires a proof-backed completed acceptance node or a newly selected proof', () => {
  const unprovedAcceptance = fulfillment({ type: 'acceptance', status: 'done' });
  const provedAcceptance = fulfillment({
    type: 'acceptance',
    status: 'done',
    proofAssetId: proofAsset.id,
    proofAsset,
  });

  assert.equal(canAcceptContract([], false), false);
  assert.equal(canAcceptContract([unprovedAcceptance], false), false);
  assert.equal(canAcceptContract([provedAcceptance], false), true);
  assert.equal(canAcceptContract([], true), true);
});

test('contract signing is enabled only after review approval and selection of a signed document', () => {
  assert.equal(CONTRACT_STATUS_LABEL.approved_for_signing, '内审通过·待签署');
  assert.equal(canRegisterContractSigning('internal_review', true), false);
  assert.equal(canRegisterContractSigning('approved_for_signing', false), false);
  assert.equal(canRegisterContractSigning('approved_for_signing', true), true);
  assert.equal(canRegisterContractSigning('signed', true), true);
  assert.equal(canRegisterContractSigning('performing', true), false);
});

test('proof metadata exposes authenticated URL and audit fields', () => {
  assert.equal(contractProofAssetUrl(proofAsset.id), '/api/upload/files/asset-proof-1');
  assert.equal(contractProofAssetUrl('asset/proof 2'), '/api/upload/files/asset%2Fproof%202');

  const metadata = formatContractProofMetadata(proofAsset);
  assert.equal(metadata.name, '验收报告.pdf');
  assert.equal(metadata.size, '1.50 MB');
  assert.equal(metadata.mimeType, 'application/pdf');
  assert.equal(metadata.sha256, proofAsset.sha256);
  assert.match(metadata.createdAt, /2026/);
});

test('contract proof upload always uses the contract_document category', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestBody: BodyInit | null | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestBody = init?.body;
    return new Response(JSON.stringify(proofAsset), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const file = new File(['proof'], '验收报告.pdf', { type: 'application/pdf' });
    await uploadContractProof(file);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestedUrl, '/api/upload?category=contract_document');
  assert.ok(requestBody instanceof FormData);
  assert.equal((requestBody as FormData).get('file') instanceof File, true);
});

test('contract stage modal renders proof audit details and gates completion actions', () => {
  const source = readFileSync(
    new URL('../../components/contracts/contract-stage-modal.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /formatContractProofMetadata/);
  assert.match(source, /contractProofAssetUrl/);
  assert.match(source, /SHA-256/);
  assert.match(source, /预览/);
  assert.match(source, /下载/);
  assert.match(source, /canCompleteContractFulfillment/);
  assert.match(source, /canAcceptContract/);
  assert.match(source, /uploadContractProof/);
  assert.match(source, /approved_for_signing/);
  assert.match(source, /signedAsset/);
  assert.match(source, /canRegisterContractSigning/);
  assert.match(source, /选择签署件/);
  assert.match(source, /签署件/);
});

test('online award supplier is initialized from the project and cannot be mistyped', () => {
  const source = readFileSync(
    new URL('../../components/contracts/contract-stage-modal.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /const awardedSupplierName = item\.awardedSupplier\?\.trim\(\)\s*\?\?\s*''/);
  assert.match(source, /value=\{awardedSupplierName \|\| form\.supplierName\}/);
  assert.match(source, /readOnly=\{Boolean\(awardedSupplierName\)\}/);
  assert.doesNotMatch(source, /defaultValue=\{item\.awardedSupplier/);
});
