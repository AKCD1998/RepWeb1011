function inspectSpreadsheet(spreadsheetId, options) {
  options = options || {};
  var maxRows = Math.max(1, Math.min(Number(options.maxRows || 20), 200));
  var maxCols = Math.max(1, Math.min(Number(options.maxCols || 20), 100));

  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheets = spreadsheet.getSheets().map(function (sheet) {
    var dataRange = sheet.getDataRange();
    var displayValues = dataRange.getDisplayValues();

    return {
      name: sheet.getName(),
      sheetId: sheet.getSheetId(),
      rows: dataRange.getNumRows(),
      columns: dataRange.getNumColumns(),
      preview: displayValues.slice(0, maxRows).map(function (row) {
        return row.slice(0, maxCols);
      })
    };
  });

  return {
    spreadsheetId: spreadsheet.getId(),
    name: spreadsheet.getName(),
    url: spreadsheet.getUrl(),
    locale: spreadsheet.getSpreadsheetLocale(),
    timeZone: spreadsheet.getSpreadsheetTimeZone(),
    sheets: sheets
  };
}
