export default function ActionButtonsBar({
  canBuild,
  onBuild,
  onPrint,
  onDownload,
  canDownload,
}) {
  return (
    <footer className="action-bar no-print">
      <button className="primary-button" type="button" disabled={!canBuild} onClick={onBuild}>
        สร้างรายงาน
      </button>
      <button className="outline-button" type="button" onClick={onPrint}>
        พิมพ์
      </button>
      <button className="ghost-button" type="button" onClick={onDownload} disabled={!canDownload}>
        ดาวน์โหลด CSV
      </button>
    </footer>
  );
}
