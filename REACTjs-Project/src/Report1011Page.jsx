import { useCallback, useEffect, useMemo, useState } from "react";
import ActionButtonsBar from "./components/report1011/ActionButtonsBar";
import LotReceiveCard from "./components/report1011/LotReceiveCard";
import Report1011Header from "./components/report1011/Report1011Header";
import ReportPreview from "./components/report1011/ReportPreview";
import ReportTypeSelectCard from "./components/report1011/ReportTypeSelectCard";
import { BRANCHES, getBranchNameOnly } from "./data/branches";
import { REPORT_TYPE_OPTIONS } from "./data/report1011Products";
import { useReport1011Products } from "./hooks/useReport1011Products";
import { buildReport } from "./lib/report1011/buildReport";
import { DEFAULT_SKU, LS_SKU_KEY } from "./lib/report1011/constants";
import { buildReportCsv } from "./lib/report1011/exportCsv";

const toCsvText = (rows) => {
  const header = "pid,full_name";
  const esc = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) => `${esc(row.pid)},${esc(row.full_name)}`).join("\n");
  return `${header}\n${body}`;
};

export default function Report1011Page() {
  const [branchId, setBranchId] = useState("");
  const [reportType, setReportType] = useState("");
  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState(DEFAULT_SKU);
  const [isSkuEditing, setIsSkuEditing] = useState(false);
  const [csvSalesFile, setCsvSalesFile] = useState(null);
  const [patientsCsvText, setPatientsCsvText] = useState("");
  const [patientsStatus, setPatientsStatus] = useState("ยังไม่ได้โหลด");
  const [lotDraft, setLotDraft] = useState({
    batch: "",
    date: "",
    boxes: "1",
    strips: "50",
  });
  const [lots, setLots] = useState([]);
  const [lotsFinalized, setLotsFinalized] = useState(false);
  const [pages, setPages] = useState([]);
  const [lastReportMeta, setLastReportMeta] = useState(null);
  const [lotWarning, setLotWarning] = useState(null);

  const { productOptions, inferredMaker, parsedProduct } = useReport1011Products({
    reportType,
    productName,
  });

  useEffect(() => {
    const saved = (localStorage.getItem(LS_SKU_KEY) || DEFAULT_SKU).trim();
    setSku(saved);
  }, []);

  useEffect(() => {
    setProductName("");
    setLotWarning(null);
  }, [reportType]);

  const fetchPatients = useCallback(async () => {
    setPatientsStatus("กำลังโหลด...");
    try {
      const apiKey = import.meta.env.VITE_API_KEY;
      const res = await fetch("/api/patients", {
        headers: apiKey ? { "X-API-KEY": apiKey } : undefined,
      });
      if (!res.ok) {
        throw new Error("โหลดรายชื่อผู้ป่วยไม่สำเร็จ");
      }
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) {
        setPatientsCsvText("");
        setPatientsStatus("ไม่พบรายชื่อผู้ป่วย");
        return "";
      }
      const csvText = toCsvText(data);
      setPatientsCsvText(csvText);
      setPatientsStatus(`โหลดแล้ว ${data.length} รายการ`);
      return csvText;
    } catch (err) {
      setPatientsCsvText("");
      setPatientsStatus("โหลดไม่สำเร็จ");
      return "";
    }
  }, []);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  const canBuild = useMemo(() => {
    const hasBasics = branchId && reportType && productName;
    return hasBasics && lotsFinalized && lots.length > 0;
  }, [branchId, reportType, productName, lotsFinalized, lots.length]);

  const canDownload = useMemo(() => {
    return pages.length > 0 && lastReportMeta;
  }, [pages, lastReportMeta]);

  const lotSummary = useMemo(() => {
    if (!lots.length) {
      return "ยังไม่มีลอต";
    }
    const totals = lots.reduce(
      (acc, lot) => {
        const boxes = Number(lot.boxes || 0);
        const strips = Number(lot.strips || 0);
        acc.boxes += boxes;
        acc.strips += boxes * strips;
        return acc;
      },
      { boxes: 0, strips: 0 }
    );
    return `รวมทั้งหมด: ${totals.boxes.toLocaleString("th-TH")} กล่อง = ${totals.strips.toLocaleString(
      "th-TH"
    )} แผง`;
  }, [lots]);

  const handleSkuEdit = () => setIsSkuEditing(true);

  const handleSkuSave = () => {
    const value = sku.trim() || DEFAULT_SKU;
    setSku(value);
    localStorage.setItem(LS_SKU_KEY, value);
    setIsSkuEditing(false);
  };

  const handleSkuCancel = () => {
    const value = (localStorage.getItem(LS_SKU_KEY) || DEFAULT_SKU).trim();
    setSku(value);
    setIsSkuEditing(false);
  };

  const handleLotDraftChange = (field, value) => {
    setLotDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddLot = () => {
    const nextLot = {
      batch: lotDraft.batch.trim(),
      date: lotDraft.date,
      boxes: Math.max(1, Number(lotDraft.boxes || 1)),
      strips: Math.max(1, Number(lotDraft.strips || 1)),
    };
    setLots((prev) => [...prev, nextLot]);
    setLotDraft({ batch: "", date: "", boxes: "1", strips: "50" });
  };

  const handleDeleteLot = (index) => {
    if (lotsFinalized) return;
    setLots((prev) => prev.filter((_, lotIndex) => lotIndex !== index));
  };

  const handleFinalizeLots = () => {
    if (!lots.length) {
      window.alert("โปรดเพิ่มลอตอย่างน้อย 1 รายการ");
      return;
    }
    setLotsFinalized(true);
  };

  const handleEditLots = () => {
    setLotsFinalized(false);
  };

  const handleBuildReport = async () => {
    setLotWarning(null);
    if (!lotsFinalized || !lots.length) {
      window.alert("โปรดยืนยันลอตก่อน");
      return;
    }
    if (!csvSalesFile) {
      window.alert("โปรดอัปโหลดไฟล์ CSV ยอดขาย");
      return;
    }
    if (!csvSalesFile.name.toLowerCase().endsWith(".csv")) {
      window.alert("ไฟล์ยอดขายต้องเป็น .csv เท่านั้น");
      return;
    }

    let patientsText = patientsCsvText;
    if (!patientsText) {
      const csvText = await fetchPatients();
      patientsText = csvText || patientsCsvText;
    }
    if (!patientsText) {
      window.alert("ไม่สามารถโหลดรายชื่อผู้ป่วยได้");
      return;
    }

    let salesText = "";
    try {
      salesText = await csvSalesFile.text();
    } catch (err) {
      console.error("Failed to read sales CSV:", err);
      window.alert("อ่านไฟล์ CSV ยอดขายไม่สำเร็จ");
      return;
    }

    const result = buildReport({
      lots,
      salesCsvText: salesText,
      patientsCsvText: patientsText,
      productName,
      maker: inferredMaker,
      sku,
      branchId,
    });

    if (result.error) {
      window.alert(result.error);
      return;
    }

    if (result.warning) {
      setLotWarning(result.warning);
      setPages([]);
      setLastReportMeta(null);
      return;
    }

    setPages(result.pages);
    setLastReportMeta(result.meta);
  };

  const handleDownload = () => {
    if (!pages.length || !lastReportMeta) {
      window.alert("ยังไม่มีรายงานให้ส่งออก");
      return;
    }
    const { filename, csvText } = buildReportCsv({ pages, meta: lastReportMeta });
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  const previewMeta = useMemo(() => {
    if (lastReportMeta) return lastReportMeta;
    if (!productName) return null;
    return {
      product: parsedProduct.name,
      packSize: parsedProduct.packSize,
      maker: inferredMaker,
      sku,
      branchNameOnly: getBranchNameOnly(branchId),
    };
  }, [lastReportMeta, productName, parsedProduct, inferredMaker, sku, branchId]);

  return (
    <div className="report1011">
      <Report1011Header />
      <main className="report1011-main">
        <div className="report1011-grid">
          <ReportTypeSelectCard
            branches={BRANCHES}
            branchId={branchId}
            onBranchChange={setBranchId}
            reportType={reportType}
            onReportTypeChange={setReportType}
            reportTypeOptions={REPORT_TYPE_OPTIONS}
            productName={productName}
            onProductChange={setProductName}
            productOptions={productOptions}
            sku={sku}
            isSkuEditing={isSkuEditing}
            onSkuChange={setSku}
            onSkuEdit={handleSkuEdit}
            onSkuSave={handleSkuSave}
            onSkuCancel={handleSkuCancel}
            maker={inferredMaker}
            onSalesFileChange={setCsvSalesFile}
            patientsStatus={patientsStatus}
          />
          <LotReceiveCard
            lotDraft={lotDraft}
            onLotDraftChange={handleLotDraftChange}
            lots={lots}
            onAddLot={handleAddLot}
            onDeleteLot={handleDeleteLot}
            lotsFinalized={lotsFinalized}
            onFinalizeLots={handleFinalizeLots}
            onEditLots={handleEditLots}
            lotSummary={lotSummary}
          />
        </div>
        {lotWarning ? (
          <div className="lot-warning">
            <p>
              ยอดขายใน CSV = <b>{lotWarning.totalSold.toLocaleString("th-TH")}</b> แผง มากกว่าแผงจากลอตที่
              ยืนยัน = <b>{lotWarning.totalFromLots.toLocaleString("th-TH")}</b> แผง
            </p>
            <p>
              ขาดอีก <b>{lotWarning.deficit.toLocaleString("th-TH")}</b> แผง ≈ ต้องเพิ่ม <b>{lotWarning.needBoxes}</b> กล่อง
              (หากกล่องละ {lotWarning.stripsPerBox} แผง). โปรดกด “แก้ไขลอต” แล้วเพิ่มลอตใหม่ จากนั้นยืนยันอีกครั้งก่อนสร้างรายงาน.
            </p>
          </div>
        ) : null}
        <ReportPreview pages={pages} meta={previewMeta} />
      </main>
      <ActionButtonsBar
        canBuild={canBuild}
        onBuild={handleBuildReport}
        onPrint={handlePrint}
        onDownload={handleDownload}
        canDownload={canDownload}
      />
    </div>
  );
}
