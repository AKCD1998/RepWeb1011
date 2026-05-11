# Deliver PID Data Source Analysis

Date: 2026-05-10

## Scope

This note documents the current PID smartcard plus MQTT identity flow used by `REACTjs-Project/src/pages/Deliver.jsx`, and identifies the seams needed before adding ThaiD as a second identity source.

Primary repo-doc sources reviewed first:

- `REACTjs-Project/README.md`
- `BACKEND_STRUCTURE.md`
- `REACTjs-Project/diary.md`
- `REACTjs-Project/SCHEMA_KY1011.md`

Targeted implementation files checked afterward:

- `REACTjs-Project/src/pages/Deliver.jsx`
- `REACTjs-Project/src/utils/deliverSmartcard.js`
- `REACTjs-Project/src/utils/deliverPatientParser.js`
- `REACTjs-Project/src/lib/api.js`
- `REACTjs-Project/server/controllers/dispenseController.js`
- `REACTjs-Project/server/controllers/helpers.js`

## Documentation Summary Before Source Verification

The markdown docs describe a page-scoped smartcard listener in the Deliver page. The configured MQTT-over-WebSocket URL and topic are:

- `VITE_SMARTCARD_MQTT_URL`, default `ws://localhost:10884/mqtt`
- `VITE_SMARTCARD_MQTT_TOPIC`, default `moph/ict/mqtt`

The active policy recorded in `diary.md` is Policy A: every finalized dispense requires real smartcard-derived patient identity. All users, including admin, are blocked from confirming dispense without smartcard data and PID. Incident reporting is separate from dispensing and does not create patient, dispense, or stock movement records.

## Current Architecture

Current flow:

```text
Thai citizen smartcard reader
  -> local smartcard bridge / broker
  -> MQTT over WebSocket
  -> src/utils/deliverSmartcard.js
  -> normalized smartcard event
  -> Deliver.jsx
  -> formatted recipient note text
  -> parseDeliverNotes(...)
  -> POST /api/dispense patient payload
  -> server upsertPatientByPid(...)
```

Important implementation points:

- `Deliver.jsx` imports `SMARTCARD_DEFAULTS`, `buildDeliverNotesFromCard`, and `startSmartcardListener` from `src/utils/deliverSmartcard.js`.
- `Deliver.jsx` resolves MQTT config from Vite env vars and falls back to `SMARTCARD_DEFAULTS`.
- A `useEffect` starts `startSmartcardListener(...)` when the page is active and stops it on unmount.
- `deliverSmartcard.js` owns the MQTT client, subscription, raw payload parsing, smartcard event state inference, and low-level field extraction.
- `Deliver.jsx` owns the transaction-level flag `hasCapturedSmartcardData` and the final dispense gate.
- Patient identity is transported inside the Deliver form as formatted Thai note text, then parsed back into a `patient` object before submit.

## MQTT Initialization And Subscription

`src/utils/deliverSmartcard.js`:

- Imports `mqtt` from the `mqtt` package.
- Creates a client id like `rx1011-smartcard-<random>`.
- Calls `mqtt.connect(resolvedBrokerUrl, ...)`.
- Uses:
  - `clean: true`
  - `connectTimeout: 5000`
  - `keepalive: 30`
  - `reconnectPeriod: 3000`
  - `resubscribe: true`
- Subscribes to the resolved topic on MQTT `connect`.
- Handles MQTT events: `reconnect`, `connect`, `message`, `offline`, `close`, and `error`.

Default broker/topic:

```js
{
  brokerUrl: "ws://localhost:10884/mqtt",
  topic: "moph/ict/mqtt"
}
```

`Deliver.jsx` uses these Vite variables:

```env
VITE_SMARTCARD_MQTT_URL=ws://localhost:10884/mqtt
VITE_SMARTCARD_MQTT_TOPIC=moph/ict/mqtt
```

## MQTT Payload Handling

`startSmartcardListener(...)` receives every message as text:

```js
client.on("message", (receivedTopic, payload) => {
  const rawText = payload ? payload.toString() : "";
  const normalized = normalizeSmartcardPayload(rawText, { topic: receivedTopic });
  ...
});
```

`normalizeSmartcardPayload(...)` returns:

```js
{
  topic,
  rawText,
  parsed,
  parseError,
  state,
  eventLabel,
  fields
}
```

Supported normalized states:

- `WAITING`
- `CARD_ENTERED`
- `READING`
- `DATA_RETRIEVED`
- `CARD_REMOVED`
- `ERROR`
- `UNKNOWN_EVENT`

Only `DATA_RETRIEVED` with meaningful card data calls `onCardData(normalized)`.

## Payload Examples

The bridge payload format is intentionally permissive. The code accepts JSON-ish nested objects and extracts fields by alias. It also infers state from event text when present.

Example payload that maps cleanly:

```json
{
  "event": "data_retrieved",
  "cid": "1234567890123",
  "th_fullname": "นาย ทดสอบ ระบบ",
  "en_fullname": "MR TEST SYSTEM",
  "birth_date": "25200131",
  "gender": "1",
  "address": "99 หมู่ 1 แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร"
}
```

Equivalent accepted aliases include:

```json
{
  "status": "card data",
  "pid": "1234567890123",
  "full_name": "นาย ทดสอบ ระบบ",
  "date_of_birth": "1977-01-31",
  "sex": "ชาย",
  "full_address": "99 หมู่ 1 แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร"
}
```

The current normalizer also supports byte-array scalar values by converting numeric arrays to characters.

## Smartcard Field Extraction

`extractCardFields(...)` currently emits:

```js
{
  cid,
  firstName,
  lastName,
  fullName,
  thaiName,
  englishName,
  birthDate,
  gender,
  issueDate,
  expireDate,
  issuer,
  address
}
```

Field aliases include:

| Normalized field | Accepted source keys |
|---|---|
| `cid` | `cid`, `pid`, `citizen_id`, `citizenid`, `card_id`, `cardid` |
| `thaiName` | `th_fullname`, `thai_fullname`, `thai_name`, `name_th`, `fullname_th` |
| `englishName` | `en_fullname`, `english_fullname`, `english_name`, `name_en`, `fullname_en` |
| `fullName` | `fullname`, `full_name`, `name`, or derived first/last name |
| `firstName` | `first_name`, `firstname`, `given_name`, `givenname` |
| `lastName` | `last_name`, `lastname`, `surname`, `family_name`, `familyname` |
| `birthDate` | `dob`, `birth_date`, `birthdate`, `date_of_birth`, `dateofbirth` |
| `gender` | `gender`, `sex` |
| `issueDate` | `issue_date`, `issuedate`, `date_of_issue`, `dateofissue` |
| `expireDate` | `expire_date`, `expiry_date`, `expiredate`, `expirydate`, `date_of_expiry` |
| `issuer` | `issuer`, `card_issuer`, `cardissuer` |
| `address` | `address`, `full_address`, `addr` |

## UI State Mapping

`Deliver.jsx` maps a smartcard event to the UI in `handleSmartcardData(...)`:

1. Calls `buildDeliverNotesFromCard(normalized.fields)`.
2. Sets `hasCapturedSmartcardData` to `true` only after usable card fields are present.
3. Deduplicates the same generated note for `SMARTCARD_DUPLICATE_WINDOW_MS`, currently 10 seconds.
4. Fills `deliverNotes` only if the field is empty or still equals the last auto-filled note.
5. Updates `smartcardStatus` with success, warning, or error text.

Generated Deliver note format:

```text
ชื่อผู้รับมอบยา: <thaiName || fullName || englishName>
เลขประจำตัวประชาชน: <cid>
ชื่อภาษาอังกฤษ: <englishName>       // only when different from primary name
วันเกิด: <YYYY-MM-DD or raw date>
เพศ: <ชาย|หญิง|raw gender>
ที่อยู่: <address>
```

The textarea is currently read-only:

```jsx
<textarea
  id="deliver-notes"
  placeholder="ข้อมูลผู้รับมอบยาจะถูกกรอกจาก smartcard เท่านั้น"
  value={deliverNotes}
  readOnly
/>
```

## Parsed Patient Mapping

`parseDeliverNotes(...)` parses the formatted note back into:

```js
{
  rawText,
  patient: {
    pid,
    fullName,
    englishName,
    birthDate,
    sex,
    cardIssuePlace,
    cardIssuedDate,
    cardExpiryDate,
    addressText
  }
}
```

Current note-to-patient mapping:

| Note label | Patient field |
|---|---|
| `ชื่อผู้รับมอบยา`, `ชื่อ`, `ชื่อสกุล` | `fullName` |
| `เลขประจำตัวประชาชน`, `เลขบัตร`, `บัตรประชาชน`, `เลขที่บัตร` | `pid` |
| `ชื่อภาษาอังกฤษ`, `englishname` | `englishName` |
| `วันเกิด` | `birthDate` |
| `เพศ` | `sex` |
| `ออกบัตร...วันที่` | `cardIssuedDate` |
| `ออกบัตรที่...` | `cardIssuePlace` |
| `หมดอายุ` | `cardExpiryDate` |
| `ที่อยู่...` | `addressText` |

Important gap: `deliverSmartcard.js` extracts `issueDate`, `expireDate`, and `issuer`, but `buildDeliverNotesFromCard(...)` does not currently include those lines. Therefore `cardIssuePlace`, `cardIssuedDate`, and `cardExpiryDate` are usually `null` in the current Deliver submit payload unless another source adds those labels to `deliverNotes`.

## Dispense Injection Point

`buildDispensePayload(...)` is where identity enters the dispensing workflow.

Identity-related validation:

- Recipient notes must exist.
- Parsed patient full name must exist.
- `hasCapturedSmartcardData` must be true.
- Parsed patient PID must exist.

Payload sent to backend:

```js
{
  branchCode,
  occurredAt,
  reportType,
  actionSource: "DELIVER_PAGE_FINAL",
  note: parsedNotes.rawText,
  deliverNotesRaw: parsedNotes.rawText,
  patient: {
    pid,
    fullName,
    birthDate,
    sex,
    cardIssuePlace,
    cardIssuedDate,
    cardExpiryDate,
    addressText
  },
  lines
}
```

Submit path:

```text
Deliver.jsx buildDispensePayload()
  -> dispenseApi.create(payload)
  -> POST /api/dispense
  -> server/controllers/dispenseController.js createDispense()
  -> upsertPatientByPid(client, patient)
  -> insert dispense header/lines and stock movement
```

Backend enforcement:

- `createDispense(...)` rejects missing `patient.pid`.
- `createDispense(...)` rejects missing `patient.fullName`.
- `upsertPatientByPid(...)` inserts or updates `patients` by unique PID and stores name, birth date, sex, card metadata, and address fields when supplied.

## Coupling Problems

Current smartcard support is workable, but not future-compatible enough for ThaiD without an identity abstraction.

Main coupling points:

- `Deliver.jsx` gates finalization on a smartcard-specific boolean: `hasCapturedSmartcardData`.
- The durable identity object is reconstructed from localized note text instead of carried as structured state.
- The read-only textarea is both UI display and data transport.
- The status messages and policy UI are smartcard-specific, not identity-source-neutral.
- `Deliver.jsx` automatically starts the MQTT listener on page mount; there is no explicit source selection model.
- `buildDeliverNotesFromCard(...)` is source-specific and currently loses some card metadata already extracted by the normalizer.
- Backend dispense validation knows only `patient.pid` and `patient.fullName`, not `identity.source`, verification time, assurance level, or verification reference.
- Raw MQTT payload is not included in the dispense payload, which limits later audit and incident analysis.
- ThaiD cannot fit into this flow as a hardware replacement because it needs a backend OAuth/OIDC callback and server-side token validation.

## Recommended Abstraction Layer

Introduce a source-neutral identity layer while preserving the current smartcard MQTT path.

Suggested files:

```text
src/utils/identityNormalizer.js
src/hooks/useSmartcardMqttIdentity.js
src/hooks/useThaiDIdentity.js
```

Suggested ownership:

- `identityNormalizer.js`
  - Converts source-specific payloads into one normalized identity object.
  - Contains `normalizeSmartcardIdentity(...)`.
  - Contains `normalizeThaiDIdentity(...)`.
  - Contains optional `buildDeliverNotesFromIdentity(...)` only for current note compatibility.

- `useSmartcardMqttIdentity.js`
  - Wraps `startSmartcardListener(...)`.
  - Exposes `{ identity, status, start, stop, reset }`.
  - Keeps MQTT broker/topic details out of `Deliver.jsx`.

- `useThaiDIdentity.js`
  - Starts a backend ThaiD login flow.
  - Polls or receives a backend-created identity session.
  - Exposes the same `{ identity, status, start, stop, reset }` shape.
  - Does not expose tokens to React.

- `Deliver.jsx`
  - Stores `verifiedIdentity`.
  - Uses source-neutral validation: `verifiedIdentity?.pid`, `verifiedIdentity?.fullName`, `verifiedIdentity?.verifiedAt`.
  - Builds legacy note text from the normalized identity only as a display/backward-compatibility artifact.
  - Keeps existing MQTT workflow intact while adding a second ThaiD button later.

## Proposed Normalized Identity Schema

Base schema:

```json
{
  "source": "SMARTCARD_MQTT",
  "pid": "1234567890123",
  "firstName": "ทดสอบ",
  "lastName": "ระบบ",
  "fullName": "นาย ทดสอบ ระบบ",
  "birthDate": "1977-01-31",
  "sex": "MALE",
  "address": "99 หมู่ 1 แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร",
  "verifiedAt": "2026-05-10T10:00:00.000Z",
  "verificationRef": "mqtt:moph/ict/mqtt:2026-05-10T10:00:00.000Z",
  "assuranceLevel": null,
  "sessionId": null,
  "rawPayload": {}
}
```

Recommended field definitions:

| Field | Meaning |
|---|---|
| `source` | `SMARTCARD_MQTT` or `THAID` |
| `pid` | Thai citizen ID / PID used by existing patient and dispense schema |
| `firstName`, `lastName`, `fullName` | Preferred Thai display name when available |
| `birthDate` | ISO `YYYY-MM-DD` when available |
| `sex` | `MALE`, `FEMALE`, `OTHER`, `UNKNOWN`, or `null` |
| `address` | Human-readable address text |
| `verifiedAt` | Time this app accepted the identity verification |
| `verificationRef` | Non-secret audit reference, not an access token |
| `assuranceLevel` | ThaiD/OIDC assurance claim such as IAL when available |
| `sessionId` | Internal backend identity session id, if applicable |
| `rawPayload` | Source payload or claims, redacted if persisted |

Smartcard adapter example:

```js
normalizeSmartcardIdentity(normalized) => ({
  source: "SMARTCARD_MQTT",
  pid: normalized.fields.cid,
  firstName: normalized.fields.firstName,
  lastName: normalized.fields.lastName,
  fullName:
    normalized.fields.thaiName ||
    normalized.fields.fullName ||
    normalized.fields.englishName,
  birthDate: normalizeDate(normalized.fields.birthDate),
  sex: normalizeSex(normalized.fields.gender),
  address: normalized.fields.address,
  verifiedAt: new Date().toISOString(),
  verificationRef: `mqtt:${normalized.topic}:${Date.now()}`,
  rawPayload: normalized
})
```

ThaiD adapter example:

```js
normalizeThaiDIdentity(session) => ({
  source: "THAID",
  pid: session.claims.pid,
  firstName: session.claims.given_name,
  lastName: session.claims.family_name,
  fullName: session.claims.name,
  birthDate: session.claims.birthdate,
  sex: normalizeSex(session.claims.gender),
  address: normalizeThaiDAddress(session.claims.address),
  verifiedAt: session.verifiedAt,
  verificationRef: session.verificationRef,
  assuranceLevel: session.claims.ial,
  sessionId: session.id,
  rawPayload: session.claims
})
```

## Suggested UI Direction

Keep the existing smartcard path as default and add ThaiD as another identity source:

```text
[อ่านจากบัตรประชาชน] [ยืนยันตัวตนด้วย ThaiD]
```

Possible behavior:

- Smartcard button starts or focuses the MQTT listener.
- ThaiD button opens a backend login popup or full-page redirect.
- The identity panel shows:
  - source label
  - verified timestamp
  - PID
  - full name
  - address if available
- Finalize requires `verifiedIdentity.pid` and `verifiedIdentity.fullName`, independent of source.

Do not remove the smartcard-only policy until ThaiD has a validated production onboarding path and the regulatory owner accepts ThaiD as an equivalent verification source for this workflow.

## Safe Refactor Sequence

1. Add `identityNormalizer.js` with smartcard normalization only.
2. Change `Deliver.jsx` to store `verifiedIdentity` when smartcard data arrives, but still generate the existing note text and submit the same `patient` payload.
3. Replace `hasCapturedSmartcardData` with source-neutral `hasVerifiedIdentity`, keeping an alias or derived value for existing smartcard UI until copy is updated.
4. Add backend optional fields later:
   - `identitySource`
   - `identityVerifiedAt`
   - `identityVerificationRef`
   - `identityAssuranceLevel`
5. Add `useThaiDIdentity.js` only as a mock/demo hook until real ThaiD credentials, callback URLs, and environment details are available.

## Non-Goals

- Do not implement production ThaiD credentials.
- Do not hardcode production ThaiD endpoints in app code.
- Do not remove MQTT or change default smartcard behavior.
- Do not create placeholder/fake patients when identity is absent.
- Do not store raw access tokens, refresh tokens, or ID tokens in React state or local storage.

