import { NavLink, useNavigate } from "react-router-dom";
import {
  FiBox,
  FiCode,
  FiClock,
  FiFileText,
  FiHome,
  FiLogOut,
  FiMenu,
  FiMapPin,
  FiTruck,
} from "react-icons/fi";
import { useOptionalAuth } from "../context/AuthContext";
import { clearAuthStorage, logoutRequest } from "../lib/authApi";

function PosScannerIcon() {
  return (
    <svg
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      viewBox="0 0 24 24"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      <path d="M6 6.5h6.5a2.5 2.5 0 0 1 2.5 2.5v1.5H9a3 3 0 0 0-3 3v1.5H5A2 2 0 0 1 3 13V9.5a3 3 0 0 1 3-3Z" />
      <path d="M9 10.5h5.25a2.75 2.75 0 0 1 2.75 2.75v5.25a1 1 0 0 1-1.71.71l-1.04-1.04a2 2 0 0 0-1.42-.59H12a3 3 0 0 1-3-3v-4.08Z" />
      <path d="M8 14h5" />
      <path d="M8 17h3.5" />
      <path d="M15.75 7.25 21 4" />
      <path d="M16.75 9.5 21 8.25" />
    </svg>
  );
}

const navItems = [
  { to: "/", label: "หน้าหลัก", icon: FiHome, end: true },
  { to: "/reports", label: "หน้าเอกสารรายงาน", icon: FiFileText },
  { to: "/products", label: "จัดการสินค้า", icon: FiBox },
  { to: "/deliver", label: "หน้าส่งมอบยา", icon: PosScannerIcon },
  { to: "/patient-history", label: "ประวัติการจ่ายยา", icon: FiClock },
  { to: "/receiving", label: "รับยาเข้า", icon: FiTruck },
  { to: "/sql-editor", label: "SQL Editor", icon: FiCode, adminOnly: true },
];

const BRANCH_LABELS = {
  "000": "admin",
  "001": "สาขาตลาดแม่กลอง",
  "003": "สาขาวัดช่องลม",
  "004": "สาขาตลาดบางน้อย",
  "005": "สาขาถนนเอกชัยสมทุรสาคร",
};

function toCleanText(value) {
  return String(value || "").trim();
}

function resolveSidebarBranch(user) {
  const role = toCleanText(user?.role).toUpperCase();
  const branchCode = toCleanText(user?.branchCode || user?.branch_code);

  if (role === "ADMIN") {
    return {
      code: "000",
      label: BRANCH_LABELS["000"],
      fullLabel: "000 : admin",
    };
  }

  const label = BRANCH_LABELS[branchCode];
  if (branchCode && label) {
    return {
      code: branchCode,
      label,
      fullLabel: `${branchCode} : ${label}`,
    };
  }

  if (branchCode) {
    return {
      code: branchCode,
      label: "สาขาไม่อยู่ในรายการ",
      fullLabel: `${branchCode} : สาขาไม่อยู่ในรายการ`,
    };
  }

  return {
    code: "",
    label: "ไม่พบข้อมูลสาขา",
    fullLabel: "ไม่พบข้อมูลสาขา",
  };
}

export default function Sidebar({ collapsed, onToggle }) {
  const navigate = useNavigate();
  const auth = useOptionalAuth();
  const activeBranch = resolveSidebarBranch(auth?.user);
  const userRole = toCleanText(auth?.user?.role).toUpperCase();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || userRole === "ADMIN");

  async function fallbackLogout() {
    try {
      await logoutRequest();
    } catch {
      // Ignore network/backend errors for safe client-side logout.
    } finally {
      clearAuthStorage();
      navigate("/login", { replace: true });
    }
  }

  async function handleLogout() {
    try {
      if (auth?.logout) {
        await auth.logout();
        return;
      }
    } catch {
      // Fall back to local cleanup if context logout fails unexpectedly.
    }

    await fallbackLogout();
  }

  return (
    <aside className="app-sidebar">
      <div className="sidebar-header">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
          aria-expanded={!collapsed}
        >
          <FiMenu />
        </button>
        <div className="sidebar-brand">
          <strong>Rx1011</strong>
          <span>เมนูหลัก</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "sidebar-link active" : "sidebar-link")}
              title={item.label}
              aria-label={item.label}
            >
              <span className="sidebar-icon">
                <Icon />
              </span>
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div
        className="sidebar-branch-card"
        title={activeBranch.fullLabel}
        aria-label={`สาขาที่ใช้งาน ${activeBranch.fullLabel}`}
      >
        <span className="sidebar-icon">
          <FiMapPin />
        </span>
        <div className="sidebar-branch-copy">
          <strong>สาขาที่ใช้งาน</strong>
          <span>{activeBranch.fullLabel}</span>
        </div>
      </div>
      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
          aria-label="ออกจากระบบ"
          title="ออกจากระบบ"
        >
          <span className="sidebar-icon">
            <FiLogOut />
          </span>
          <span className="sidebar-label">ออกจากระบบ</span>
        </button>
      </div>
    </aside>
  );
}
