export const BRANCHES = [
  { value: "001", label: "001 : ตลาดแม่กลอง" },
  { value: "003", label: "003 : วัดช่องลม" },
  { value: "004", label: "004 : ตลาดบางน้อย" },
];

export const getBranchLabel = (value) => {
  const match = BRANCHES.find((branch) => branch.value === value);
  return match ? match.label : "-";
};

export const getBranchNameOnly = (value) => {
  const label = getBranchLabel(value);
  if (!label || label === "-") return "-";
  const parts = label.split(":");
  return parts.length > 1 ? parts.slice(1).join(":").trim() : label.trim();
};
