# Bulk ขย.9

The Reports page has a separate **Bulk ขย.9 · บัญชีซื้อยาหลายสาขา** section. It accepts one `ky9_bundle.json`, or a scan register (`source_records`) plus an exported Movement Trace JSON (`receipts` and `transfers`). Imports and review edits stay in the browser; download the review bundle to preserve work.

The report uses the eight columns of the [FDA KY9 template](https://drug.fda.moph.go.th/information-licensing-lic/lic6.12/). It creates landscape A4 draft pages for selected locations 000, 001, 003, 004 and 005, eight rows per page. Signatures remain blank. HQ is available as an internal source ledger; including it does not determine its licensing obligations.

## Evidence and review

- Native receipt/transfer dates, suppliers or sending branches, quantities and units are preserved. Paid and free receipt lines remain separate.
- Ada type 7 (receipt) and type 8 (dispatch) rows with the same source document, product and line represent one transfer. Keep the receipt once using its receiving date and preserve both event IDs for saved review compatibility. Differences in quantity, unit, route, lot or reversed dates block output. Dispatch-only entries remain flagged for receiving review. TB/TS document numbers in the remarks are labelled as transfer references.
- Exact invoice references or explicitly verified receipt references link purchase scans to native receipt documents. Date/quantity matches and unverified receipt hints are proposals.
- Placeholder system lots such as `1` do not override scanned lots. Transfers without a lot receive a proposal from linked upstream receipts and must be confirmed against evidence. These proposals do not subtract sales and are not stock balances.
- Lot, manufacturing date (`mfg`) and expiry (`exp`) come from the scan register or its product facts. Dates stay with the selected source through branch transfers, source review, saved bundles and CSV exports. Native placeholder expiry does not replace scanned expiry; an unrecorded manufacturing date remains blank. KY9 keeps its eight-column print template.
- Unknown codes, uncertain medicine classifications, quantity/unit differences, duplicated source mappings and unverified upstream links stay visible. Non-medicines are listed separately. An explicitly cleared mapping remains cleared.
- Confirmations store a particular source ID, so later changes cannot silently confirm a different proposed lot. Any input or review change invalidates generated documents.
- Drafts can include unresolved rows, marked **รอตรวจ**. The ready-only option filters to verified rows; it can yield an incomplete report until every source is reviewed. Conflicting duplicate events block generation.
- The default PDF includes rows linked to a scanned lot. Counts of held rows appear before generation and in each branch footer; this PDF is partial when some lots remain unlinked. The complete receipt/transfer CSV retains those rows. Download `ky9_lot_gaps.csv` for nearby receipt and invoice references to locate additional evidence; these references are lookup candidates, not confirmed lot links. An explicit checkbox can include unlinked rows in the draft PDF, labelled **รอเชื่อมล็อต** rather than a blank lot cell. Both choices are saved in the review bundle.

The KY11 allocation and purchaser-generation functions are unchanged.

## Prepare local inputs

These commands use explicitly supplied paths and do not expose database credentials to the browser. Keep private exports and scans outside the repository.

```powershell
node scripts/export-ky9-movements.mjs `
  --env-file 'C:/private/service.env' `
  --register 'C:/private/LOT_REGISTER.json' `
  --out-file 'C:/private/stockday_movements.json' `
  --date-from 2026-05-01 --date-to 2026-09-28

node scripts/prepare-ky9-bundle.mjs `
  --register 'C:/private/LOT_REGISTER.json' `
  --movements 'C:/private/stockday_movements.json' `
  --extra-sources 'C:/private/extra_sources.json' `
  --out-dir 'C:/private/prepared'
```

The exporter uses `REPEATABLE READ READ ONLY`, queries canonical `ada` receipt/transfer tables without product-name joins, and rolls back before writing local files. Candidate SKU codes from scan facts are fetched for later manual matching, not assigned automatically. Event identity includes source table, document type, branch, document number, line number and product code; native line numbers can repeat for different products.

The preparer retains scan evidence and candidate-code notes, omits previous POS-based allocation fields, and writes a bundle, purchase CSV, lot-gap CSV, source coverage CSV, manifest and Thai instructions. Both scripts accept optional `--extra-sources` for additional scanned products and `--source-updates` with a `source_updates` array keyed by existing source ID. The exporter fetches any corrected SKU codes; the preparer applies verified scan corrections without overwriting the original register. Only purchase metadata can be patched; an unknown source ID fails. Outputs refuse overwrite unless `--replace-output` is explicitly supplied; the exporter always refuses overwrite. Export enough earlier history to cover the scans' upstream receipts before filtering the report period.

## Validation

Run `npm run test:backend` and `npm run ci`. Purchase tests cover paid/free quantities, native units, duplicate conflicts, explicit matching, proposed and cleared mappings, upstream evidence, all five branches, ambiguous lots and date filters. Browser QA covers persistence, input invalidation, mobile width and PDF output.
