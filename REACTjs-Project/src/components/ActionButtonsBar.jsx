export default function ActionButtonsBar({ canBuild }) {
  return (
    <footer className="action-bar no-print">
      <button className="primary-button" type="button" disabled={!canBuild}>
        สร้างรายงาน
      </button>
      <button className="outline-button" type="button">
        พิมพ์
      </button>
      <button className="ghost-button" type="button" disabled>
        ดาวน์โหลด CSV
      </button>
    </footer>
  );
}
