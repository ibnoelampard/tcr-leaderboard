/* share.js — screenshot leaderboard (html2canvas) + share WhatsApp
   Capture: clone #capture-card ke container offscreen lebar 720px,
   tinggi penuh (scrollHeight) → tidak terpotong di bawah. */
(function () {
  "use strict";

  const medals = ["🥇", "🥈", "🥉"];
  const slice = "–";
  const CAPTURE_WIDTH = 720;

  function txtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    } catch (e) { return iso; }
  }

  function buildShareText(data) {
    const clubName = data.club?.name || "Tangerang Crazy Runners";
    const isWeekly = data.filter_mode === "weekly";
    const periodTxt = isWeekly
      ? `Minggu: ${txtDate(data.week_start)} ${slice} ${txtDate(data.week_end)} (sampai sekarang)`
      : `Periode: ${txtDate(data.week_start)} ${slice} ${txtDate(data.week_end)}`;
    const header =
      `🏆 Top 10 ${clubName}\n` +
      `${periodTxt}\n` +
      `(Metric: jarak tempuh km)\n\n`;
    const lines = (data.leaderboard || []).map((e) => {
      const m = medals[e.rank - 1] || `${e.rank}.`;
      return `${m} ${e.name} — ${e.distance_km} km (${e.activities}×, ${e.pace}/km)`;
    }).join("\n");
    const footer = `\n\nLihat full leaderboard: ${location.origin + location.pathname}`;
    return header + lines + footer;
  }

  function waitForFonts() {
    if (document.fonts && document.fonts.ready) return document.fonts.ready;
    return Promise.resolve();
  }

  function cloneForCapture(source) {
    const clone = source.cloneNode(true);
    // bersihkan elemen yang tak ingin ikut
    clone.querySelectorAll(".no-capture, .toolbar, .modal, .site-footer, .share-hint")
      .forEach((el) => el.remove());
    // pastikan lebar tetap & layout konsisten
    clone.style.width = CAPTURE_WIDTH + "px";
    clone.style.margin = "0";
    clone.style.maxWidth = "none";

    const wrap = document.createElement("div");
    wrap.style.cssText =
      `position:fixed; left:-100000px; top:0; width:${CAPTURE_WIDTH}px; z-index:-1; ` +
      `background: var(--bg-grad-1); padding: 24px 22px 18px; box-sizing: border-box;`;
    // transfer tema ke wrap agar CSS variables ter-resolve
    const theme = document.body.getAttribute("data-theme") || "tcr";
    wrap.setAttribute("data-theme", theme);
    wrap.appendChild(clone);
    document.body.appendChild(wrap);
    return wrap;
  }

  async function capturePage() {
    const source = document.getElementById("capture-card");
    if (!source) throw new Error("Elemen #capture-card tidak ditemukan");
    if (typeof html2canvas === "undefined")
      throw new Error("html2canvas belum termuat (perlu internet)");

    await waitForFonts();
    // tunggu gambar lokal (logo/cover) benar-benar ready
    const imgs = source.querySelectorAll("img");
    await Promise.all(Array.from(imgs).map((img) =>
      img.complete && img.naturalWidth
        ? Promise.resolve()
        : new Promise((res) => { img.onload = img.onerror = res; })
    ));

    const wrap = cloneForCapture(source);
    try {
      const fullH = Math.max(wrap.scrollHeight, wrap.offsetHeight, 600);
      const canvas = await html2canvas(wrap, {
        backgroundColor: null,
        scale: Math.min(2, (window.devicePixelRatio || 1.5)),
        width: CAPTURE_WIDTH,
        height: fullH,
        windowWidth: CAPTURE_WIDTH,
        windowHeight: fullH,
        x: 0, y: 0, scrollX: 0, scrollY: 0,
        useCORS: true,
        allowTaint: false,
        logging: false,
      });
      return canvas;
    } finally {
      wrap.remove();
    }
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  let lastBlob = null;
  let lastText = "";

  async function openShare() {
    const modal = document.getElementById("share-modal");
    const img = document.getElementById("share-img");
    const ta = document.getElementById("share-text");
    const hint = document.getElementById("share-hint");
    const data = window.TCR_DATA;
    if (!data) { alert("Data belum dimuat."); return; }

    modal.hidden = false;
    img.src = "";
    hint.textContent = "Membuat gambar...";
    ta.value = "Menyiapkan...";

    try {
      const canvas = await capturePage();
      lastBlob = await canvasToBlob(canvas);
      img.src = canvas.toDataURL("image/png");
      lastText = buildShareText(data);
      ta.value = lastText;

      const canFilesShare =
        navigator.canShare &&
        navigator.canShare({ files: [new File([lastBlob], "tcr-leaderboard.png", { type: "image/png" })] });
      hint.textContent = canFilesShare
        ? "✅ Tekan “Buka WhatsApp” lalu pilih kontak. Gambar otomatis terlampir (mobile yang dukung Web Share)."
        : "ℹ️ Gunakan “Download gambar”, lalu lampirkan manual ke WhatsApp beserta teks di atas.";
    } catch (e) {
      console.error(e);
      hint.textContent = "⚠️ Gagal membuat gambar: " + e.message + " — teks daftar tetap bisa dibagikan.";
      lastBlob = null;
      lastText = buildShareText(data);
      ta.value = lastText;
    }
  }

  function closeShare() { document.getElementById("share-modal").hidden = true; }

  async function shareToWhatsApp() {
    const text = lastText || buildShareText(window.TCR_DATA || {});
    const file = lastBlob ? new File([lastBlob], "tcr-leaderboard.png", { type: "image/png" }) : null;
    const canFilesShare = file && navigator.canShare && navigator.canShare({ files: [file] });
    if (canFilesShare) {
      try {
        await navigator.share({ files: [file], text, title: "Top 10 Tangerang Crazy Runners" });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
        console.warn("Web Share files gagal, fallback ke wa.me", e);
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  function downloadImage() {
    if (!lastBlob) { alert("Gambar belum siap."); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(lastBlob);
    a.download = "tcr-leaderboard.png";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-share")?.addEventListener("click", openShare);
    document.getElementById("modal-close")?.addEventListener("click", closeShare);
    document.getElementById("btn-wa")?.addEventListener("click", shareToWhatsApp);
    document.getElementById("btn-download")?.addEventListener("click", downloadImage);
    document.getElementById("share-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "share-modal") closeShare();
    });
  });
})();