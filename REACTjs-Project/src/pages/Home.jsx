import { Link } from "react-router-dom";
import { navItems } from "../components/Sidebar";
import { useOptionalAuth } from "../context/AuthContext";

function toCleanText(value) {
  return String(value || "").trim();
}

export default function Home() {
  const auth = useOptionalAuth();
  const userRole = toCleanText(auth?.user?.role).toUpperCase();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || userRole === "ADMIN");

  return (
    <section className="page-placeholder home-page">
      <div className="home-page-heading">
        <h1>หน้าหลัก</h1>
        <p>เลือกงานที่ต้องการเริ่มใช้งาน</p>
      </div>

      <div className="home-menu-grid" aria-label="เมนูหลัก">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} className="home-menu-card" aria-label={item.label}>
              <span className="home-menu-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="home-menu-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
