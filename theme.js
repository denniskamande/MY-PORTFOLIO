const STORAGE_KEY = "theme";
const root = document.documentElement;
const button = document.querySelector("#theme-toggle");

function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function savedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // storage blocked (private mode, etc.)
  }
}

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  button?.setAttribute("aria-pressed", String(theme === "dark"));
}

applyTheme(savedTheme() ?? systemTheme());

button?.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
});
