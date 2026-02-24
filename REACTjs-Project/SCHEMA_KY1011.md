# SCHEMA_KY1011 (PostgreSQL) - บันทึก ขย 10/11

## 1) Scope and design goals
- รองรับหลายสาขา (เริ่มจาก 001/003/004 และเพิ่มสาขาได้ในอนาคต)
- เก็บรายการยาแบบชื่อการค้า + สูตรตัวยาได้หลายสารออกฤทธิ์
- เก็บความแรงแบบโครงสร้าง (numeric + unit + optional denominator)
- รองรับลำดับหน่วยบรรจุ (base/blister/box/bottle/tube/device ฯลฯ) และการแปลงหน่วย
- ทำ ledger การเคลื่อนไหวสต็อกครบ (RECEIVE/TRANSFER/DISPENSE/ADJUST) พร้อม snapshot
- เก็บประวัติการจ่ายยา ขย 10/11 พร้อมผู้ป่วย เภสัชกร และ hash ลายเซ็น
- วาง rule engine ระดับ schema สำหรับกฎปริมาณการจ่ายต่อ visit

## 2) Migration files
- `migrations/0001_ky1011_schema.sql`: โครงสร้างตาราง, constraints, indexes, comments
- `migrations/0002_ky1011_seed_reference.sql`: seed สาขา 001/003/004, dosage forms, unit types, rules
- `migrations/0003_ky1011_example_queries.sql`: ตัวอย่าง query ใช้งานจริง

## 3) High-level model
```text
locations ─┬─< stock_movements >─ products >─ dosage_forms
           │         │               │  └─< product_ingredients >─ active_ingredients
           │         │               └─< product_unit_levels >─< product_unit_conversions
           │         │               └─< product_report_groups >─ report_groups
           │         │
           │         └─< stock_on_hand (snapshot per branch/product/lot)
           │
patients ─< dispense_headers >─ users (pharmacist)
                    └─< dispense_lines >─ products / product_lots / unit levels

dispensing_rules (scope: dosage_form_group / product_category / product)
```

## 4) Table groups and why

### 4.1 Core master
- `locations`
  - ตารางสถานที่รวมทุกประเภท (BRANCH, OFFICE, MANUFACTURER, WHOLESALER, ...)
  - ใช้เป็นแกนเดียวสำหรับ movement source/destination
- `users`
  - รองรับบทบาท `PHARMACIST`, `ADMIN`, `OPERATOR`
  - มี `password_hash` (bcrypt) และ `signature_hash`/`signature_token`
- `patients`
  - `pid` unique
  - เก็บข้อมูลบัตรประชาชน + ที่อยู่แบบ structured และ `address_raw_text`

### 4.2 Product catalog + composition + packaging
- `dosage_forms`
  - มี `dosage_form_group` เช่น `SOLID_ORAL`, `LIQUID_ORAL`, ...
  - รองรับ parent-child form (เช่น INHALER -> ACCUHALER/TURBUHALER)
- `active_ingredients`
  - รายการสารออกฤทธิ์กลาง
- `products`
  - สินค้าระดับชื่อการค้า + แบบยา + หมวดสินค้า
- `product_ingredients`
  - many-to-many ระหว่าง `products` กับ `active_ingredients`
  - เก็บความแรงแบบโครงสร้าง:
    - absolute: `strength_numerator=500`, numerator unit = `MG`, denominator = NULL
    - ratio: `125 MG / 5 ML` เก็บทั้ง numerator และ denominator
- `unit_types`
  - หน่วยวัดและหน่วยบรรจุ (`MG`, `MCG`, `ML`, `BLISTER`, `BOTTLE`, ...)
- `product_unit_levels`
  - ระดับหน่วยบรรจุของสินค้า (base/sellable)
  - ใช้ผูกราคาขายต่อหน่วยและใช้กับ movement/dispense line
- `product_unit_conversions`
  - โครงสร้างแพ็กเกจ: `1 parent = multiplier child`
  - ตัวอย่าง: 1 box = 10 blister, 1 blister = 10 tablet

### 4.3 Price
- `price_tiers`
  - เตรียมสำหรับหลายระดับราคา (RETAIL, CONTRACT, etc.)
- `product_prices`
  - ราคาตาม `product_id + unit_level_id + tier + effective date`

### 4.4 Lot + inventory
- `product_lots`
  - lot_no, mfg_date, exp_date, manufacturer/company reference
- `stock_movements` (mandatory ledger)
  - type: `RECEIVE`, `TRANSFER_OUT`, `TRANSFER_IN`, `DISPENSE`, `ADJUST`
  - มี `from_location_id`, `to_location_id`, `product_id`, `lot_id`, `quantity`, `unit_level_id`
  - เป็น audit trail หลักสำหรับตรวจสอบย้อนหลัง
- `stock_on_hand` (snapshot)
  - snapshot เร็วต่อ `branch_id + product + lot + base_unit_level`
  - ออกแบบให้ derive จาก ledger ได้ (ในอนาคตใช้ trigger/job ปรับปรุงอัตโนมัติ)

### 4.5 Dispensing (ขย 10/11)
- `dispense_headers`
  - ระดับ visit: patient, branch, pharmacist, dispensed_at, signature_hash, note
- `dispense_lines`
  - ระดับรายการยา: product, lot, unit level, quantity, price

### 4.6 Rules engine
- `dispensing_rules`
  - scope ได้ 3 แบบ: `DOSAGE_FORM_GROUP`, `PRODUCT_CATEGORY`, `PRODUCT`
  - เก็บ `max_qty` + `unit_type_id` + period (`PER_VISIT`, `PER_DAY`)
  - seed เริ่มต้น:
    - `SOLID_ORAL` max 2 `BLISTER` ต่อ visit
    - `LIQUID_ORAL` max 3 `BOTTLE` ต่อ visit

### 4.7 Regulatory report groups (ข.ย.10 / ข.ย.11)
- `report_groups`
  - master ของกลุ่มรายงานตามกฎหมาย (extensible) เช่น `KY10`, `KY11`
  - เก็บชื่อไทย + คำอธิบาย + สถานะ active
- `product_report_groups`
  - many-to-many ระหว่าง `products` กับ `report_groups`
  - ใส่ช่วงวันที่มีผล (`effective_from`, `effective_to`) เพื่อรองรับการเปลี่ยนเกณฑ์ในอนาคต
  - ช่วยตอบคำถามย้อนหลังได้ว่า "ช่วงเวลาใดสินค้านี้อยู่ในรายงานอะไร"

เหตุผลที่ใช้ many-to-many + effective dating:
- สินค้า 1 ตัวอาจอยู่หลายกลุ่มรายงานพร้อมกัน (หรือไม่อยู่เลย)
- กฎของ อย. เปลี่ยนได้ตามเวลา ต้องรักษาประวัติเดิมเพื่อ audit/re-run report ย้อนหลัง
- ลดการ hardcode enum ใน `products` และรองรับกลุ่มรายงานใหม่โดยไม่ต้องแก้โครงสร้างหลัก

## 5) Hard requirements mapping
- Multi-ingredient generic: `product_ingredients` (many-to-many) ครบ
- Structured strength: numerator/denominator + unit IDs ครบ
- Package hierarchy: `product_unit_levels` + `product_unit_conversions` ครบ
- Mandatory movement ledger: `stock_movements` ครบ field ตาม requirement
- Single locations table: `locations` ครบ
- Users with signature: `users` ครบ
- Patients PID + card metadata + structured address: `patients` ครบ
- Dispense headers/lines: `dispense_headers`, `dispense_lines` ครบ
- Rules table + seeded rules: `dispensing_rules` + seed ครบ
- Regulatory report groups: `report_groups` + `product_report_groups` ครบ
- UUID keys + `gen_random_uuid()`: ใช้ทุกตารางหลัก

## 6) Indexes included
- `patients(pid)`
- `stock_movements(product_id, occurred_at desc)`
- `stock_on_hand(branch_id, product_id)`
- `dispense_headers(patient_id, dispensed_at desc)`
- และ index สนับสนุนอื่น ๆ (from/to location, dispense_lines header, one-base-level)

## 7) Operational notes
- `stock_on_hand` เป็น snapshot เพื่อ query เร็ว; ควรอัปเดตจาก application service หรือ DB trigger/job
- การตรวจ rule ที่ต้องแปลงหน่วย (เช่นบันทึกเป็น BOX แต่ rule เป็น BLISTER) ให้แปลงผ่าน `product_unit_conversions` ก่อน aggregate
- `updated_at` ปัจจุบันเป็น default-only; หากต้องการ auto-update ทุก UPDATE ให้เพิ่ม trigger ภายหลัง

## 8) Example queries
- อยู่ในไฟล์ `migrations/0003_ky1011_example_queries.sql`
- ครอบคลุม:
  - stock on hand by branch/product
  - stock by branch/lot
  - movement ledger by product
  - dispensing history by PID + date range
  - rule violation detection per visit
  - products in KY10 / KY11 / both
  - KY11-only dispensing history by date range
  - products missing current report classification

## 9) ER diagram (textual, regulatory part)
```text
products (1) ──< product_report_groups >── (1) report_groups

product_report_groups columns:
- product_id (FK -> products.id)
- report_group_id (FK -> report_groups.id)
- effective_from (date)
- effective_to (date, nullable)

business meaning:
- one product can be in zero/one/many report groups
- one report group can contain many products
- relation is time-bounded for regulatory history and reporting reproducibility
```
