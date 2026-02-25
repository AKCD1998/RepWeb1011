import { NavLink, useNavigate } from "react-router-dom";
import { FiBox, FiDownload, FiFileText, FiHome, FiLogOut, FiMenu, FiTruck } from "react-icons/fi";
import { useOptionalAuth } from "../context/AuthContext";

const navItems = [
  { to: "/", label: "หน้าหลัก", icon: FiHome, end: true },
  { to: "/reports", label: "หน้าเอกสารรายงาน", icon: FiFileText },
  { to: "/products", label: "จัดการสินค้า", icon: FiBox },
  { to: "/deliver", label: "หน้าส่งมอบยา", icon: FiTruck },
  { to: "/receiving", label: "รับยาเข้า", icon: FiDownload },
];

export default function Sidebar({ collapsed, onToggle }) {
  const navigate = useNavigate();
  const auth = useOptionalAuth();

  async function fallbackLogout() {
    const token = String(window.localStorage.getItem("rx1011_auth_token") || "").trim();

    try {
      if (token) {
        await fetch("http://localhost:5050/api/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch {
      // Ignore network/backend errors for safe client-side logout.
    } finally {
      window.localStorage.removeItem("rx1011_auth_token");
      window.localStorage.removeItem("rx1011_auth_user");
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
        {navItems.map((item) => {
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
