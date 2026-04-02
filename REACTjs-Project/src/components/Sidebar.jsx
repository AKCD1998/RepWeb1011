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
      <path d="M8.75 5.5h7.75A2.5 2.5 0 0 1 19 8v3.5a2.5 2.5 0 0 1-2.5 2.5h-4.4l1.18 5.23a1.15 1.15 0 0 1-1.69 1.24l-2.18-1.18a1.2 1.2 0 0 1-.59-.8L7.66 14H7.5A2.5 2.5 0 0 1 5 11.5V8a2.5 2.5 0 0 1 2.5-2.5Z" />
      <path d="m7.1 5.9 1.72 8.1" />
      <path d="M13.75 10.2h2.75" />
      <path d="M3.9 9.2a3.5 3.5 0 0 0 0 3.6" />
      <path d="M2.1 7.4a6.5 6.5 0 0 0 0 7.2" />
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
