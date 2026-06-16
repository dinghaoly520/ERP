# Expert Phone Verification — Design Spec

**Date:** 2026-06-16  
**Status:** Draft  
**Scope:** Add SMS verification code to expert identity verification step in evaluation workflow

---

## 1. Motivation

The current identity verification ("身份核验") step in the expert evaluation wizard is a no-op: clicking a button sets `signedIn=true` on the `BidExpert` record with no second factor to prove the operator is actually the expert. This adds a phone SMS verification code as a required step before sign-in.

## 2. Decisions

| Decision | Choice |
|----------|--------|
| SMS gateway | Stub (dev: console.log, fixed code `123456`), real gateway interface reserved |
| Phone source | `ExpertProfile.phone` — if null, prompt "contact admin" |
| Code format | 6-digit numeric |
| Code expiry | 5 minutes (Redis TTL) |
| Resend cooldown | 60 seconds |
| Max attempts | 5 per code, exceeded → must re-request |
| Architecture | Independent `VerificationModule` (reusable for supplier registration, password reset, etc.) |

## 3. Data Model

### 3.1 No new database table

Verification codes are transient — stored in Redis only.

```
Key:   verification:<scene>:<userId>:<targetId>
Value: JSON { "code": "384729", "phone": "138****5678", "attempts": 0 }
TTL:   300s
```

### 3.2 Prisma schema change

Add one field to `BidExpert`:

```prisma
model BidExpert {
  // ... existing fields ...
  phoneVerified  Boolean  @default(false)
}
```

### 3.3 No change to `User` table

Phone number reads from `ExpertProfile.phone` (already exists).

## 4. API Design

### 4.1 Module structure

```
apps/api/src/verification/
├── verification.module.ts
├── verification.service.ts
├── verification.controller.ts
└── dto/
    ├── send-code.dto.ts
    └── verify-code.dto.ts
```

### 4.2 Endpoints

**POST `/api/verification/send-code`**

```json
// Request
{ "scene": "expert_sign_in", "targetId": "cmq..." }
// Response 200
{ "ok": true, "maskedPhone": "138****5678" }
// Response 400
{ "statusCode": 400, "code": "PHONE_NOT_FOUND", "error": "未绑定手机号，请联系管理员" }
// Response 429
{ "statusCode": 429, "code": "TOO_FREQUENT", "error": "请60秒后再试" }
```

**POST `/api/verification/verify-code`**

```json
// Request
{ "scene": "expert_sign_in", "targetId": "cmq...", "code": "384729" }
// Response 200
{ "ok": true }
// Response 400
{ "statusCode": 400, "code": "CODE_INVALID", "error": "验证码错误，剩余 3 次尝试" }
// Response 400
{ "statusCode": 400, "code": "CODE_EXPIRED", "error": "验证码已过期，请重新获取" }
// Response 400
{ "statusCode": 400, "code": "ATTEMPTS_EXCEEDED", "error": "尝试次数过多，请重新获取验证码" }
```

### 4.3 Scene enum

```ts
type VerificationScene = 'expert_sign_in' | 'supplier_registration' | 'password_reset';
```

Only `expert_sign_in` implemented initially; others are forward-looking placeholders.

### 4.4 Modified sign-in endpoint

`POST /expert/projects/:projectId/sign-in` now checks `BidExpert.phoneVerified`. If `false`, returns `403 Forbidden` with message "请先完成手机验证".

### 4.5 Rate limiting (Redis)

| Limit | Key | TTL |
|-------|-----|-----|
| Resend cooldown per expert+project | `verification:cooldown:<scene>:<userId>:<targetId>` | 60s |
| Max 5 code attempts | `attempts` field in verification key | same as code (300s) |
| IP rate limit (max 10/min) | `verification:ip:<ip>` | 60s |

## 5. Frontend Changes

### 5.1 File changed

`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`

### 5.2 New client state

```ts
const [phoneMasked, setPhoneMasked] = useState('')
const [verificationCode, setVerificationCode] = useState('')
const [codeSent, setCodeSent] = useState(false)
const [codeVerified, setCodeVerified] = useState(false)
const [sendingCode, setSendingCode] = useState(false)
const [verifying, setVerifying] = useState(false)
const [countdown, setCountdown] = useState(0)
const [codeError, setCodeError] = useState('')
const [attemptsLeft, setAttemptsLeft] = useState(5)
```

### 5.3 User flow

1. Page loads → `GET /expert/projects/:id` returns `phoneMasked` and `phoneVerified`
2. If `phoneMasked` is null → show "未绑定手机号，请联系管理员完善资料"
3. Phone exists → show masked phone + "获取验证码" button
4. Click "获取验证码" → `POST /verification/send-code` → button enters 60s countdown
5. User types 6-digit code → auto-verify on 6th digit, or manual "验证" button
6. Verify success → green checkmark, "确认签到" button enabled
7. Verify failure → error message + remaining attempts shown
8. Exceeded 5 attempts → must request new code

### 5.4 UI layout

Inside the existing identity verification card, above the sign-in button:
- Expert identity info (name, masked ID number, masked phone) — read-only display
- Phone verification row: 6-digit input + "获取验证码"/"N s 后重发" button
- Hint text: "验证码6位数字，5分钟内有效"
- Sign-in button disabled until `codeVerified === true`

### 5.5 API service functions

New functions in the page (or extracted to a service file):

```ts
sendVerificationCode(scene: string, targetId: string) → { ok, maskedPhone }
verifyCode(scene: string, targetId: string, code: string) → { ok }
```

## 6. API Response Changes

### 6.1 `GET /expert/projects/:projectId`

Response adds to `myExpertRecord`:
```json
{
  "myExpertRecord": {
    // ...existing fields...
    "phoneMasked": "138****5678",
    "phoneVerified": false
  }
}
```

### 6.2 `POST /expert/projects/:projectId/sign-in`

Now gates on `phoneVerified === true`. Returns 403 if phone not verified.

## 7. Stub SMS Behavior

```
// Dev mode (no SMS gateway configured):
// - send-code generates a real 6-digit code, stores in Redis
// - console.log(`[SMS-STUB] 验证码: ${code} → ${phone}`)
// - Accept any code entered? NO — accept the real generated code
//
// For dev convenience, a hardcoded bypass:
// - If env SMS_DEBUG_BYPASS=true, accept "123456" always (for testing)
```

## 8. Testing

### 8.1 API tests (`apps/api/test/`)

- `POST /verification/send-code` — success, phone not found, rate limited
- `POST /verification/verify-code` — success, wrong code, expired, exceeded attempts
- `POST /expert/projects/:id/sign-in` — blocked before phone verified, succeeds after

### 8.2 Manual testing

- Visit `http://localhost:3006/evaluate/<projectId>`
- Verify phone verification flow in the identity step
- Check console for stub SMS output
- Confirm sign-in button activates only after verification

## 9. Migration

```sql
ALTER TABLE "BidExpert" ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false;
```

Run via `pnpm db:migrate` after schema change.

## 10. Seed Data

Update `BidExpert` seed entries to include `phoneVerified: false`. Ensure seed experts (`wangjg`, `liuxm`, `chenzq`) have `phone` set in their `ExpertProfile` entries.

---

*Spec version: 1.0*
