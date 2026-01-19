import { useMemo, useState } from "react";
import Report1011Header from "./components/Report1011Header";
import ReportTypeSelectCard from "./components/ReportTypeSelectCard";
import LotReceiveCard from "./components/LotReceiveCard";
import ActionButtonsBar from "./components/ActionButtonsBar";

const PRODUCT_OPTIONS = [
  "ยาแก้ปวด 500 มก.",
  "ยาแก้แพ้ชนิดน้ำ",
  "ยาควบคุมพิเศษ",
];

export default function Report1011Page() {
  const [branch, setBranch] = useState("");
  const [reportType, setReportType] = useState("");
  const [productName, setProductName] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sku, setSku] = useState("บริษัท เอสซีกรุ๊ป (1989) จำกัด");
  const [maker] = useState("");
  const [lots, setLots] = useState([
    { batch: "", date: "", boxes: "", strips: "" },
  ]);
  const [lotsLocked, setLotsLocked] = useState(false);

  const canBuild = useMemo(() => {
    const hasBasics = branch && reportType && productName;
    const hasLots = lots.length > 0;
    return hasBasics && hasLots && lotsLocked;
  }, [branch, reportType, productName, lots, lotsLocked]);

  return (
    <div className="report1011">
      <Report1011Header />
      <main className="report1011-main">
        <div className="report1011-grid">
          <ReportTypeSelectCard
            branch={branch}
            setBranch={setBranch}
            reportType={reportType}
            setReportType={setReportType}
            productName={productName}
            setProductName={setProductName}
            productOptions={PRODUCT_OPTIONS}
            sourceName={sourceName}
            setSourceName={setSourceName}
            sku={sku}
            setSku={setSku}
            maker={maker}
          />
          <LotReceiveCard
            lots={lots}
            setLots={setLots}
            lotsLocked={lotsLocked}
            setLotsLocked={setLotsLocked}
          />
        </div>
      </main>
      <ActionButtonsBar canBuild={canBuild} />
    </div>
  );
}
