CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  generic_name TEXT,
  strength_value NUMERIC,
  strength_unit TEXT,
  pack_sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
  routes JSONB NOT NULL DEFAULT '[]'::jsonb,
  dosage_form TEXT,
  price NUMERIC(12, 2) NOT NULL,
  report_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  limited_qty_per_bill TEXT,
  other_qty INTEGER,
  manufacturer TEXT,
  barcode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
