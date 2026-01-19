import { useTheme } from "../ThemeProvider";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด";

  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={label}>
      <span className="theme-toggle-icon sun" aria-hidden="true">
        ☀
      </span>
      <span className="theme-toggle-icon moon" aria-hidden="true">
        ☾
      </span>
    </button>
  );
}
