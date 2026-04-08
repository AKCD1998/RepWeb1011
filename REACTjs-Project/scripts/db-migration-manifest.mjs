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
};

export function getManagedMigrationDefinition(fileName) {
  return migrationManifest[fileName] || null;
}
