export const defaultManagedMigrationFile = "0022_incident_report_resolution_actions.sql";

export const migrationManifest = {
  "0022_incident_report_resolution_actions.sql": {
    fileName: "0022_incident_report_resolution_actions.sql",
    description:
      "Adds incident_report_resolution_actions so corrective stock actions and retrospective dispense records can be traced back to a single incident report.",
    checkMode: "schema-probe",
    probeQuery: `
      SELECT
        to_regclass('public.incident_reports') IS NOT NULL AS has_incident_reports,
        to_regclass('public.incident_report_resolution_actions') IS NOT NULL AS has_resolution_actions_table,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'incident_report_resolution_actions'
            AND column_name = 'action_type'
        ) AS has_action_type_column,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'incident_report_resolution_actions'
            AND column_name = 'applied_stock_movement_id'
        ) AS has_applied_stock_movement_id_column,
        EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_incident_report_resolution_actions_incident_line'
        ) AS has_incident_line_index
    `,
    interpretProbe(row) {
      const prerequisitesMet = Boolean(row?.has_incident_reports);
      const applied = Boolean(
        row?.has_resolution_actions_table &&
          row?.has_action_type_column &&
          row?.has_applied_stock_movement_id_column &&
          row?.has_incident_line_index
      );

      return {
        applied,
        prerequisitesMet,
        details: [
          {
            label: "incident_reports table",
            ok: prerequisitesMet,
          },
          {
            label: "incident_report_resolution_actions table",
            ok: Boolean(row?.has_resolution_actions_table),
          },
          {
            label: "action_type column",
            ok: Boolean(row?.has_action_type_column),
          },
          {
            label: "applied_stock_movement_id column",
            ok: Boolean(row?.has_applied_stock_movement_id_column),
          },
          {
            label: "incident-line index",
            ok: Boolean(row?.has_incident_line_index),
          },
        ],
      };
    },
  },
  "0023_stock_movement_delete_audits.sql": {
    fileName: "0023_stock_movement_delete_audits.sql",
    description:
      "Adds stock_movement_delete_audits so admin-deleted manual receive transactions keep an audit snapshot and stock reversal trace.",
    checkMode: "schema-probe",
    probeQuery: `
      SELECT
        to_regclass('public.stock_movements') IS NOT NULL AS has_stock_movements,
        to_regclass('public.stock_movement_delete_audits') IS NOT NULL AS has_delete_audits_table,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'stock_movement_delete_audits'
            AND column_name = 'deleted_movement_id'
        ) AS has_deleted_movement_id_column,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'stock_movement_delete_audits'
            AND column_name = 'movement_snapshot'
        ) AS has_movement_snapshot_column,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'stock_movement_delete_audits'
            AND column_name = 'reversed_delta_qty_base'
        ) AS has_reversed_delta_qty_base_column,
        EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_stock_movement_delete_audits_deleted_at'
        ) AS has_deleted_at_index
    `,
    interpretProbe(row) {
      const prerequisitesMet = Boolean(row?.has_stock_movements);
      const applied = Boolean(
        row?.has_delete_audits_table &&
          row?.has_deleted_movement_id_column &&
          row?.has_movement_snapshot_column &&
          row?.has_reversed_delta_qty_base_column &&
          row?.has_deleted_at_index
      );

      return {
        applied,
        prerequisitesMet,
        details: [
          {
            label: "stock_movements table",
            ok: prerequisitesMet,
          },
          {
            label: "stock_movement_delete_audits table",
            ok: Boolean(row?.has_delete_audits_table),
          },
          {
            label: "deleted_movement_id column",
            ok: Boolean(row?.has_deleted_movement_id_column),
          },
          {
            label: "movement_snapshot column",
            ok: Boolean(row?.has_movement_snapshot_column),
          },
          {
            label: "reversed_delta_qty_base column",
            ok: Boolean(row?.has_reversed_delta_qty_base_column),
          },
          {
            label: "deleted_at index",
            ok: Boolean(row?.has_deleted_at_index),
          },
        ],
      };
    },
  },
  "0024_incident_report_admin_audits.sql": {
    fileName: "0024_incident_report_admin_audits.sql",
    description:
      "Adds soft-delete metadata and admin audit rows for incident report edits/deletes while preserving movement traceability.",
    checkMode: "schema-probe",
    probeQuery: `
      SELECT
        to_regclass('public.incident_reports') IS NOT NULL AS has_incident_reports,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'incident_reports'
            AND column_name = 'deleted_at'
        ) AS has_deleted_at_column,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'incident_reports'
            AND column_name = 'delete_reason_text'
        ) AS has_delete_reason_text_column,
        to_regclass('public.incident_report_admin_audits') IS NOT NULL AS has_admin_audits_table,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'incident_report_admin_audits'
            AND column_name = 'previous_snapshot'
        ) AS has_previous_snapshot_column,
        EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_incident_report_admin_audits_incident_changed_at'
        ) AS has_incident_changed_at_index
    `,
    interpretProbe(row) {
      const prerequisitesMet = Boolean(row?.has_incident_reports);
      const applied = Boolean(
        row?.has_deleted_at_column &&
          row?.has_delete_reason_text_column &&
          row?.has_admin_audits_table &&
          row?.has_previous_snapshot_column &&
          row?.has_incident_changed_at_index
      );

      return {
        applied,
        prerequisitesMet,
        details: [
          {
            label: "incident_reports table",
            ok: prerequisitesMet,
          },
          {
            label: "incident_reports.deleted_at column",
            ok: Boolean(row?.has_deleted_at_column),
          },
          {
            label: "incident_reports.delete_reason_text column",
            ok: Boolean(row?.has_delete_reason_text_column),
          },
          {
            label: "incident_report_admin_audits table",
            ok: Boolean(row?.has_admin_audits_table),
          },
          {
            label: "previous_snapshot column",
            ok: Boolean(row?.has_previous_snapshot_column),
          },
          {
            label: "incident-changed-at index",
            ok: Boolean(row?.has_incident_changed_at_index),
          },
        ],
      };
    },
  },
  "0025_product_lot_normalization_audits.sql": {
    fileName: "0025_product_lot_normalization_audits.sql",
    description:
      "Adds product_lot_normalization_audits so admin lot rename/merge operations keep a traceable reason and moved-reference counts.",
    checkMode: "schema-probe",
    probeQuery: `
      SELECT
        to_regclass('public.product_lots') IS NOT NULL AS has_product_lots,
        to_regclass('public.product_lot_normalization_audits') IS NOT NULL AS has_normalization_audits_table,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'product_lot_normalization_audits'
            AND column_name = 'operation_type'
        ) AS has_operation_type_column,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'product_lot_normalization_audits'
            AND column_name = 'stock_movement_rows_updated'
        ) AS has_stock_movement_rows_updated_column,
        EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_product_lot_normalization_audits_product_at'
        ) AS has_product_at_index
    `,
    interpretProbe(row) {
      const prerequisitesMet = Boolean(row?.has_product_lots);
      const applied = Boolean(
        row?.has_normalization_audits_table &&
          row?.has_operation_type_column &&
          row?.has_stock_movement_rows_updated_column &&
          row?.has_product_at_index
      );

      return {
        applied,
        prerequisitesMet,
        details: [
          {
            label: "product_lots table",
            ok: prerequisitesMet,
          },
          {
            label: "product_lot_normalization_audits table",
            ok: Boolean(row?.has_normalization_audits_table),
          },
          {
            label: "operation_type column",
            ok: Boolean(row?.has_operation_type_column),
          },
          {
            label: "stock_movement_rows_updated column",
            ok: Boolean(row?.has_stock_movement_rows_updated_column),
          },
          {
            label: "product-at index",
            ok: Boolean(row?.has_product_at_index),
          },
        ],
      };
    },
  },
};

export function getManagedMigrationDefinition(fileName) {
  return migrationManifest[fileName] || null;
}
