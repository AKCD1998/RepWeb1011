import { NavLink } from "react-router-dom";
import { FiBox, FiDownload, FiFileText, FiHome, FiMenu, FiTruck } from "react-icons/fi";

const navItems = [
  { to: "/", label: "หน้าหลัก", icon: FiHome, end: true },
  { to: "/reports", label: "หน้าเอกสารรายงาน", icon: FiFileText },
  { to: "/products", label: "จัดการสินค้า", icon: FiBox },
  { to: "/deliver", label: "หน้าส่งมอบยา", icon: FiTruck },
  { to: "/receiving", label: "รับยาเข้า", icon: FiDownload },
];

export default function Sidebar({ collapsed, onToggle }) {
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
    </aside>
  );
}
