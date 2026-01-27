import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";

const MOBILE_QUERY = "(max-width: 900px)";

const getInitialCollapsed = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(MOBILE_QUERY)?.matches ?? false;
};

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia(MOBILE_QUERY);
    const handleChange = (event) => setCollapsed(event.matches);

    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return (
    <div className="app-shell" data-collapsed={collapsed ? "true" : "false"}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((prev) => !prev)} />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
