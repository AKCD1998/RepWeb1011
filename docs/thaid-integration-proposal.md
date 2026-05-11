# ThaiD Integration Proposal For Deliver Identity Verification

Date: 2026-05-10

## Executive Summary

ThaiD should be treated as a second identity verification source, not as a direct replacement for the local PID smartcard reader.

Current Deliver source:

```text
PID Smartcard Reader
  -> MQTT over WebSocket
  -> normalized identity payload
  -> Deliver.jsx
```

Future ThaiD source:

```text
ThaiD App / DOPA Digital ID
  -> OAuth2 / OpenID Connect relying-party login
  -> backend callback and token validation
  -> normalized identity payload
  -> Deliver.jsx
```

The integration should remain proposal/mock-only until the project has formal ThaiD onboarding, client credentials, approved callback URLs, allowed scopes, and a confirmed production assurance requirement for dispensing medication under this regulatory workflow.

## References Reviewed

Official/public ThaiD and digital ID references:

- ETDA ThaiD PHP RP sample: https://github.com/ETDA/ThaiD-PHP-RP
- ETDA ThaiD Python RP sample: https://github.com/ETDA/ThaiD-Python-RP
- BORA ThaiD overview: https://www.bora.dopa.go.th/app-thaid/
- BORA ThaiD supported services list: https://www.bora.dopa.go.th/thaid_authen_services/
- ETDA Connect technical specification page: https://www.etda.or.th/th/Our-Service/Digital-Trusted-services-Infrastructure/TEDA/ETDA-Connect/Technical-Specification/content1.aspx
- ETDA Connect sample code page: https://www.etda.or.th/en/Our-Service/Digital-Trusted-services-Infrastructure/TEDA/ETDA-Connect/Technical-Specification/content2.aspx

General OIDC references suitable for the current Node/Express stack:

- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
- `openid-client` for JavaScript/Node RP implementations: https://github.com/panva/openid-client

## What The Public Examples Show

The ETDA ThaiD PHP sample describes a CodeIgniter RP example using OpenID Connect and OAuth2. It configures client id, client secret, API key, callback URL, scope, well-known metadata, token introspection, revoke, public key/JWKS, and ID token validation.

The ETDA ThaiD Python sample describes a Flask RP example using Authlib. Its README shows registration with OIDC provider metadata and a scope set containing identity claims such as `openid`, `pid`, `address`, `gender`, `birthdate`, Thai and English name claims, `ial`, smartcard-related claims, and issuance/expiry dates.

These examples confirm the important architectural point: ThaiD is an RP/IdP authentication flow. It is not a local card-reader MQTT payload and should not be wired into `Deliver.jsx` as if it were another hardware bridge.

## Stack Recommendation

For this repo, prefer a Node/Express backend implementation over copying PHP or Python sample code.

Recommended library direction:

- Use `openid-client` on the backend for OIDC discovery, authorization URL creation, token exchange, ID token validation, UserInfo/protected resource calls where allowed, token introspection/revocation if required by ThaiD onboarding, and Passport strategy only if the app later standardizes on Passport.
- Keep all ThaiD tokens server-side.
- Expose only a short-lived internal identity session to React.

Reasoning:

- The repo already has an Express backend.
- React should not hold client secrets, access tokens, refresh tokens, or raw ID tokens.
- `openid-client` supports the relevant OIDC/OAuth flows and is actively maintained for JavaScript runtimes.

## Proposed Backend API Design

Example API shape only:

```text
GET /api/thaid/login
GET /api/thaid/callback
GET /api/thaid/session/:id
POST /api/thaid/session/:id/consume
DELETE /api/thaid/session/:id
```

Optional mock-only endpoints:

```text
POST /api/dev/thaid/mock-session
GET /api/dev/thaid/mock-session/:id
```

Do not enable mock endpoints in production builds.

## ThaiD Authentication Flow

Recommended real flow:

1. `Deliver.jsx` calls `GET /api/thaid/login?returnTo=deliver`.
2. Backend creates a server-side transaction:
   - `state`
   - `nonce`
   - PKCE `code_verifier`
   - return target
   - expiry timestamp
   - current authenticated staff user id
   - branch context if needed
3. Backend redirects the browser or popup to the ThaiD/OIDC authorization endpoint.
4. User authenticates and consents in ThaiD/DOPA flow.
5. ThaiD redirects to `GET /api/thaid/callback?code=...&state=...`.
6. Backend verifies:
   - `state`
   - PKCE verifier
   - token endpoint response
   - ID token issuer
   - audience/client id
   - signature/JWKS
   - expiry and issued-at tolerance
   - nonce
   - required claims and assurance level
7. Backend maps claims to a normalized identity session.
8. Backend redirects the popup/front channel to a local result page or returns an HTML bridge page that can notify the opener.
9. `Deliver.jsx` receives or polls `GET /api/thaid/session/:id`.
10. `Deliver.jsx` stores the normalized identity and uses it for final dispense validation.

## Frontend Communication Options

### Option A: Popup plus postMessage

Best for keeping the Deliver transaction on screen.

Flow:

```text
Deliver.jsx opens /api/thaid/login in popup
  -> callback creates identity session
  -> backend returns small result page
  -> result page postMessage({ type: "THAID_IDENTITY_READY", sessionId })
  -> Deliver.jsx fetches /api/thaid/session/:id
```

Security:

- Validate `event.origin`.
- Do not put tokens or raw claims in `postMessage`.
- Only pass a short-lived opaque session id.

### Option B: Full-page redirect

Simpler operationally, but Deliver must preserve the current cart and lot selections before redirect.

Flow:

```text
Deliver.jsx saves draft locally
  -> browser navigates to /api/thaid/login
  -> backend callback redirects to /#/deliver?identitySession=<id>
  -> Deliver.jsx restores draft and fetches identity session
```

This is safer if popup blocking becomes a usability problem.

### Option C: Polling page

If ThaiD supports a QR or decoupled mobile flow in the registered RP setup, backend can create a pending identity session and React can poll. Do not assume this mode until confirmed by official ThaiD onboarding.

## Normalized Identity Contract

Deliver should consume only normalized identity objects:

```json
{
  "source": "THAID",
  "pid": "1234567890123",
  "firstName": "ทดสอบ",
  "lastName": "ระบบ",
  "fullName": "นาย ทดสอบ ระบบ",
  "birthDate": "1977-01-31",
  "address": "99 หมู่ 1 แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร",
  "verifiedAt": "2026-05-10T10:00:00.000Z",
  "verificationRef": "thaid:session:abc123",
  "assuranceLevel": "IAL2.3",
  "sessionId": "abc123",
  "rawPayload": {
    "claims": "redacted-or-server-only"
  }
}
```

Allowed `source` values:

- `SMARTCARD_MQTT`
- `THAID`

Recommended extra fields:

- `expiresAt`: identity session expiry
- `displaySource`: UI label
- `claimSetVersion`: mapping/version identifier
- `verifiedByUserId`: authenticated staff user who initiated the verification
- `branchCode`: branch context when verification was initiated

## Claim Mapping Draft

ThaiD claim names must be finalized against the actual ThaiD RP registration and returned token/userinfo payload. Based on public examples, plan for these possible mappings:

| Normalized field | Possible ThaiD claim |
|---|---|
| `pid` | `pid` |
| `firstName` | `given_name` |
| `lastName` | `family_name` |
| `fullName` | `name` |
| `birthDate` | `birthdate` |
| `sex` | `gender` |
| `address` | `address` |
| `assuranceLevel` | `ial` |
| `cardIssuedDate` | `date_of_issuance` |
| `cardExpiryDate` | `date_of_expiry` |

Do not assume every claim is always present. The backend should fail closed if the minimum required claims for dispensing are not present:

- `pid`
- `name` or enough name parts to form `fullName`
- acceptable assurance level, if mandated by policy

## Deliver Integration Shape

Future `Deliver.jsx` should not care whether identity came from MQTT or ThaiD.

Suggested local state:

```js
const [verifiedIdentity, setVerifiedIdentity] = useState(null);
```

Validation should become:

```js
if (!verifiedIdentity?.pid) {
  return { error: "ต้องยืนยันตัวตนผู้รับมอบยาก่อนยืนยันการส่งมอบยา" };
}

if (!verifiedIdentity?.fullName) {
  return { error: "ข้อมูลยืนยันตัวตนยังไม่สมบูรณ์: ไม่พบชื่อผู้รับมอบยา" };
}
```

Submit payload can remain backward-compatible:

```js
patient: {
  pid: verifiedIdentity.pid,
  fullName: verifiedIdentity.fullName,
  birthDate: verifiedIdentity.birthDate,
  sex: verifiedIdentity.sex,
  addressText: verifiedIdentity.address
},
identity: {
  source: verifiedIdentity.source,
  verifiedAt: verifiedIdentity.verifiedAt,
  verificationRef: verifiedIdentity.verificationRef,
  assuranceLevel: verifiedIdentity.assuranceLevel
}
```

The `identity` object should be optional until the backend schema and controller are updated. During the first refactor, keep the existing `patient` payload exactly compatible with `POST /api/dispense`.

## Suggested Frontend Files

```text
src/utils/identityNormalizer.js
src/hooks/useSmartcardMqttIdentity.js
src/hooks/useThaiDIdentity.js
```

Responsibilities:

- `identityNormalizer.js`
  - `normalizeSmartcardIdentity(normalizedSmartcardPayload)`
  - `normalizeThaiDIdentity(thaidSessionPayload)`
  - `buildDeliverNotesFromIdentity(identity)` for compatibility with existing note/report behavior

- `useSmartcardMqttIdentity.js`
  - Owns MQTT listener lifecycle and exposes normalized identity.

- `useThaiDIdentity.js`
  - Owns popup/redirect/polling mechanics and exposes normalized identity.
  - Does not know OIDC client secrets.

## Suggested Backend Files

```text
server/routes/thaidRoutes.js
server/controllers/thaidController.js
server/services/thaidOidcClient.js
server/services/identitySessionStore.js
```

Initial implementation can use an in-memory session store for local mock/demo work. Production should use a durable or shared store compatible with the deployment topology.

## Environment Variables

Names only. Do not populate until real onboarding exists.

```env
THAID_ENABLED=false
THAID_ISSUER=
THAID_CLIENT_ID=
THAID_CLIENT_SECRET=
THAID_REDIRECT_URI=
THAID_SCOPES=
THAID_REQUIRED_IAL=
THAID_SESSION_TTL_SECONDS=300
```

Do not put these in Vite frontend env vars except a non-secret feature flag such as:

```env
VITE_THAID_ENABLED=false
```

## Security Considerations

- Use Authorization Code Flow with PKCE when supported/required.
- Generate high-entropy `state` and validate it exactly.
- Generate and validate `nonce` for ID token replay protection.
- Store `code_verifier`, `state`, and `nonce` server-side or in secure, httpOnly, sameSite cookies.
- Validate ID token issuer, audience, signature, expiry, issued-at, and nonce.
- Fetch JWKS through issuer metadata; cache according to provider guidance.
- Keep access tokens, refresh tokens, ID tokens, client secret, and raw authorization code out of React.
- Do not store tokens in localStorage, IndexedDB, or URL fragments.
- Use HTTPS for all non-local callback URLs.
- Register exact callback URLs with the ThaiD provider.
- Enforce staff authentication and branch context before starting verification.
- Bind the identity session to the staff user/session that initiated it.
- Expire unused identity sessions quickly.
- Consume identity sessions once when used to finalize a dispense, or mark them as used.
- Log only non-secret metadata: source, verified time, verification ref, assurance level, and minimal claim presence.
- Treat PID and address as sensitive personal data; avoid writing raw payloads to logs.
- If raw claims must be persisted for audit, encrypt them and define retention/deletion rules.

## Data Model Implications

Current backend accepts:

```js
patient: {
  pid,
  fullName,
  birthDate,
  sex,
  cardIssuePlace,
  cardIssuedDate,
  cardExpiryDate,
  addressText
}
```

Future audit-friendly fields could be added to `dispense_headers` or a separate verification table:

```text
identity_source
identity_verified_at
identity_verification_ref
identity_assurance_level
identity_session_id
identity_claims_hash
```

Avoid storing full raw ThaiD claims in the dispense header. Prefer a separate restricted table if legal/audit policy requires retention.

## Mock ThaiD Flow Policy

A mock/demo flow is acceptable only if clearly labeled and disabled by default.

Mock constraints:

- Endpoint path must include `/dev/` or `/mock/`.
- Mock UI must display that it is not a production ThaiD verification.
- Mock identities must use obvious test PIDs and names.
- Mock mode must not be enabled when `NODE_ENV=production`.
- Mock sessions should still use the same normalized identity contract as the real flow.

Example mock response:

```json
{
  "id": "mock-thaid-20260510-001",
  "source": "THAID",
  "pid": "1234567890123",
  "fullName": "นาย ทดสอบ ThaiD",
  "firstName": "ทดสอบ",
  "lastName": "ThaiD",
  "birthDate": "1977-01-31",
  "address": "ที่อยู่ทดสอบ",
  "verifiedAt": "2026-05-10T10:00:00.000Z",
  "verificationRef": "mock:thaid:mock-thaid-20260510-001",
  "assuranceLevel": "MOCK",
  "rawPayload": {
    "mock": true
  }
}
```

## Rollout Plan

1. Keep current MQTT smartcard flow unchanged.
2. Add source-neutral identity normalization around smartcard data.
3. Change `Deliver.jsx` to consume `verifiedIdentity` while still generating existing note text.
4. Add backend optional identity metadata fields only after reviewing reporting/audit requirements.
5. Add mock ThaiD flow behind disabled-by-default feature flags.
6. After official ThaiD onboarding, implement real backend OIDC routes.
7. Run security review before enabling in production.
8. Update operational docs with registered callback URLs, scopes, and assurance-level policy.

## Open Questions

- Which ThaiD/DOPA environment will this project be registered against?
- What exact scopes and claims will be approved for medication delivery?
- What assurance level is legally acceptable for this dispensing workflow?
- Must ThaiD verification replace card-present verification or only supplement it?
- Does the regulatory report need verification source and reference fields?
- Should one ThaiD verification be single-use per dispense or reusable for a short cart session?
- How long can identity proof be retained before finalize?
- Should branch users be allowed to start ThaiD verification, or only pharmacists/admins?
- What consent language is required before using ThaiD data for medication dispensing?

## Current Recommendation

Do not implement production ThaiD integration yet. First refactor Deliver to consume a normalized identity object while preserving the current MQTT smartcard behavior. Then add a disabled mock ThaiD path that exercises the same frontend/backend contract. Real ThaiD should be enabled only after official RP onboarding and a security review of token validation, session binding, logging, and data retention.

