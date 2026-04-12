import { useTheme } from "../ThemeProvider";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด";
  const nextModeText = isDark ? "โหมดสว่าง" : "โหมดมืด";

  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={label}>
      <span className={`theme-toggle-icon ${isDark ? "sun" : "moon"}`} aria-hidden="true">
        {isDark ? "☀" : "☾"}
      </span>
      <span className="theme-toggle-label">{nextModeText}</span>
    </button>
  );
}
