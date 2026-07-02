/* themes.js — daftar preset tema + switcher (localStorage) */
(function () {
  "use strict";

  const THEMES = [
    { id: "sporty", label: "🏁 Sporty (Default)" },
    { id: "kemerdekaan", label: "🇮🇩 Kemerdekaan" },
    { id: "valentine", label: "💗 Valentine" },
    { id: "lebaran", label: "🌙 Lebaran" },
    { id: "natal", label: "🎄 Natal" },
    { id: "malam", label: "🌃 Malam Neon" },
  ];

  const STORAGE_KEY = "tcr-theme";

  function applyTheme(id) {
    if (!THEMES.some((t) => t.id === id)) id = "sporty";
    document.body.setAttribute("data-theme", id);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        getComputedStyle(document.body)
          .getPropertyValue("--bg-grad-2")
          .trim() || "#0f172a",
      );
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
  }

  function init() {
    const select = document.getElementById("theme-select");
    if (!select) return;
    THEMES.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.label;
      select.appendChild(o);
    });
    let saved = "sporty";
    try { saved = localStorage.getItem(STORAGE_KEY) || "sporty"; } catch (e) {}
    if (!THEMES.some((t) => t.id === saved)) saved = "sporty";
    select.value = saved;
    applyTheme(saved);
    select.addEventListener("change", () => applyTheme(select.value));
  }

  window.TCR_THEMES = { applyTheme, THEMES };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();