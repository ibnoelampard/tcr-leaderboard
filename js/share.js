/* share.js — screenshot leaderboard (html2canvas) + share WhatsApp */
(function () {
  "use strict";

  const medals = ["🥇", "🥈", "🥉"];
  const slice = "–";

  function txtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    } catch (e) { return iso; }
  }

  function buildShareText(data) {
    const header =
      `🏆 Top 10 ${data.club?.name || "Tangerang Crazy Runners"}\n` +
      `Minggu: ${txtDate(data.week_start)} ${slice} ${txtDate(data.week_end)}\n` +
      `(Metric: jarak tempuh km)\n\n`;
    const lines = (data.leaderboard || []).map((e) => {
      const m = medals[e.rank - 1] || `${e.rank}.`;
      return `${m} ${e.name} — ${e.distance_km} km (${e.activities}×, ${e.pace}/km)`;
    }).join("\n");
    const footer = `\n\nLihat full leaderboard: ${location.origin + location.pathname}`;
    return header + lines + footer;
  }

  async function capturePage() {
    const page = document.querySelector(".page");
    if (!page) throw new Error("Elemen .page tidak ditemukan");
    if (typeof html2canvas === "undefined")
      throw new Error("html2canvas belum termuat (perlu internet)");

    // Sembunyikan elemen yang tak perlu ikut screenshot
    const ignore = [];
    const ignoreSelectors = [".toolbar", ".site-footer", ".modal"];
    ignoreSelectors.forEach((s) =>
      page.querySelectorAll(s).forEach((el) => {
        const prev = el.style.display;
        el.setAttribute("data-prev-display", prev);
        el.style.display = "none";
        ignore.push(el);
      })
    );

    // Beri padding aman & background pada capture
    const prevBg = page.style.background;
    page.style.background = "transparent";
    try {
      const canvas = await html2canvas(page, {
        backgroundColor: null,
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        logging: false,
        useCORS: true,
        allowTaint: true,
      });
      return canvas;
    } finally {
      ignore.forEach((el) => {
        el.style.display = el.getAttribute("data-prev-display") || "";
        el.removeAttribute("data-prev-display");
      });
      page.style.background = prevBg;
    }
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });
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
      if (canFilesShare) {
        hint.textContent = "✅ Tekan “Buka WhatsApp” lalu pilih kontak. Gambar akan otomatis terlampir di perangkat mobile yang mendukung Web Share.";
      } else {
        hint.textContent =
          "ℹ️ Perangkat ini tidak mendukung kirim gambar otomatis. Gunakan “Download gambar”, lalu lampirkan manual ke WhatsApp beserta teks di atas.";
      }
    } catch (e) {
      console.error(e);
      hint.textContent = "⚠️ Gagal membuat gambar: " + e.message + " — teks daftar tetap bisa dibagikan.";
      lastBlob = null;
      lastText = buildShareText(data);
      ta.value = lastText;
    }
  }

  function closeShare() {
    document.getElementById("share-modal").hidden = true;
  }

  async function shareToWhatsApp() {
    const text = lastText || buildShareText(window.TCR_DATA || {});
    const file = lastBlob ? new File([lastBlob], "tcr-leaderboard.png", { type: "image/png" }) : null;
    const canFilesShare =
      file && navigator.canShare && navigator.canShare({ files: [file] });

    if (canFilesShare) {
      try {
        await navigator.share({
          files: [file],
          text,
          title: "Top 10 Tangerang Crazy Runners",
        });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // user batal
        console.warn("Web Share files gagal, fallback ke wa.me", e);
      }
    }
    // Fallback: buka WhatsApp dengan teks saja
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
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