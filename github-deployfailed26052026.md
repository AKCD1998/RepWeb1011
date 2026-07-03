```md
# Rx1011 / RepWeb1011 System State Summary
Date: 2026-05-26

## Repos and roles
- `AKCD1998/RepWeb1011`
  - React frontend
  - deployed to GitHub Pages
  - live URL: `https://akcd1998.github.io/RepWeb1011/#/patient-history`
- `currentSC-official-website-project`
  - shared backend
  - live API base used by Pages build: `https://sc-official-website.onrender.com/api/rx1011`
  - shared backend is confirmed running on Render

## Main business issue addressed
Returned dispense rows needed to:
1. stay visible in history for audit
2. be marked visually as returned in Patient History
3. be excluded from ขย.10/11 report output
4. restore stock and keep audit trail in DB

---

## Confirmed live DB / return state
Target row:
- `dispense_line_id = 3bcabe45-30be-4aed-bcb9-1e087685061f`
- `dispense_header_id = 99018958-58a8-4b7b-ab00-eb028b135106`
- PID `1759900227974`
- branch `003`
- product `IC-002106`
- lot `QDL5D00`
- dispensed at `25/05/2026 17:36` Thailand time

Return repair was successfully applied in live DB:
- `dispense_returns.id = bfaabf93-0b1b-4eaa-aa69-1d1ef3dbea60`
- `stock_movements.id = 8e4cfb0c-758c-4922-89dd-535944300c96`
- `reference_key = fake-ui-return-2026-05-25-ultracet-003`
- `return_source = RETROACTIVE_REPAIR`

Stock result:
- before: branch `003`, lot `QDL5D00` = `19`
- after: branch `003`, lot `QDL5D00` = `20`

Report math for this line:
- `dispensed_quantity = 1.000`
- `returned_quantity = 1.000000`
- `remaining_reportable_quantity = 0.000000`

Meaning:
- stock was restored
- audit trail exists
- this line should not appear in ขย.11 output anymore

---

## Backend state
### Shared backend
Repo:
- `currentSC-official-website-project`

Status:
- shared backend is running on Render
- live history endpoint now returns return-aware fields

Live API payload for target row was verified from deployed backend:
- `returnedQuantity = "1.000000"`
- `remainingQuantity = "0.000000"`
- `returnStatus = "RETURNED"`

So backend deployment is current enough for history rendering.

### Shared backend code changes
Files changed:
- `backend/src/modules/rx1011/controllers/dispenseController.js`
- `backend/src/modules/rx1011/controllers/organicReportsController.js`
- `backend/src/modules/rx1011/migrations/0027_dispense_returns.sql`

Backend commit:
- `3af5b86` — `Add rx1011 return-aware history and report filtering`

What backend change does:
- history endpoint includes:
  - `returnedQuantity`
  - `remainingQuantity`
  - `returnStatus`
- KY10/KY11 report queries subtract returned quantity
- fully returned rows are excluded with:
  - `GREATEST(dl.quantity - COALESCE(dr.returned_quantity, 0), 0) > 0`

Backend validation done:
- Rx1011 integration tests passed
- unrelated SCCRM tests were failing elsewhere and were not part of Rx1011 fix

---

## Frontend state
### Frontend repo
Repo:
- `AKCD1998/RepWeb1011`

Main frontend commits:
- `49b4bd9` — `add red highlight on patient history`
  - actual feature commit
- `2996c82` — `trigger rebuild: deploy patient-history-return-badge to Pages`
  - harmless rebuild trigger commit

Frontend code behavior:
- history row remains visible
- fully returned rows get red row styling
- partially returned rows get partial/warning styling
- Thai badge shown:
  - `คืนสินค้าแล้ว`

Main frontend files:
- `REACTjs-Project/src/pages/PatientPurchaseHistory.jsx`
- `REACTjs-Project/src/pages/PatientPurchaseHistory.css`

Frontend logic uses:
- `returnStatus`
- `returnedQuantity`
- `remainingQuantity`

---

## GitHub Pages deployment issue and fix
### What happened
Pages was serving an older frontend bundle even though code had already been pushed.

### Root cause
GitHub Actions budget/account usage block prevented workflow execution earlier.
Also during debugging there was a transient Pages action setup/download failure.
The lasting issue was Actions not successfully publishing the newest Pages bundle.

### Fix path
- budget/usage block was removed
- Pages workflow was re-triggered
- successful workflow runs followed

Successful runs observed:
- run `#93` success
- run `#94` success

Current deployed Pages assets:
- JS: `assets/index-Cila6f0n.js`
- CSS: `assets/index-COGdFo99.css`

Verified in live deployed assets:
- `patient-history-return-badge` present
- returned-row CSS present
- `returnStatus` present
- `returnedQuantity` present
- `remainingQuantity` present
- Thai returned label string present

Conclusion:
- GitHub Pages is now serving the updated frontend bundle

---

## Current live UX state
Patient History page:
- returned row should remain visible
- returned row should show red highlight
- returned row should show Thai badge `คืนสินค้าแล้ว`

Target row expected live behavior:
- PID `1759900227974`
- branch `003`
- product `IC-002106`
- lot `QDL5D00`
- date `25/05/2026 17:36`
- visible in history for audit
- visually marked returned
- excluded from ขย.11 report math

---

## What is confirmed
- shared backend is running
- live backend history API returns return-aware fields
- return repair was actually persisted in DB
- stock was restored from `19` to `20`
- report math for the repaired line is `0` remaining
- Pages deploy was stale before
- Pages deploy is now updated
- frontend bundle now contains returned-row UI code

---

## Remaining uncertainties / optional follow-up
- If a user still does not see red highlight now, likely cause is browser cache
  - hard refresh
  - incognito/private window
  - clear site cache for `akcd1998.github.io`
- `2996c82` is only a rebuild-trigger commit and can be left as-is or cleaned later
- no full cross-check was recorded here for every other historical fake-success return
- no full end-to-end confirmation was recorded here for live return modal behavior from the shared frontend against shared backend in production, beyond history/report/DB verification

---

## Recommended next checks if needed
1. Open Patient History in incognito and verify target row is red
2. Generate live KY11 report for branch `003` on `2026-05-25`
3. Confirm target ULTRACET row is absent from report output
4. Audit whether other fake-success return attempts need repair using the repair flow
```