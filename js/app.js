/* app.js — render leaderboard dari data/data.json */
(function () {
  "use strict";

  const DATA_URL = "data/data.json";
  const medals = ["🥇", "🥈", "🥉"];

  function initials(name) {
    return name
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 2)
      .map((s) => s[0] || "")
      .join("")
      .toUpperCase() || "?";
  }

  function fmtDate(iso) {
    try {
      return new Date(iso)
        .toLocaleDateString("id-ID", {
          day: "2-digit", month: "short", year: "numeric",
        });
    } catch (e) { return iso; }
  }

  function fmtDateShort(iso) {
    try {
      return new Date(iso)
        .toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    } catch (e) { return iso; }
  }

  function fmtGenerated(iso) {
    try {
      return new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch (e) { return iso; }
  }

  // Warna avatar deterministic per nama (palette kohesif pink-ish tapi bervariasi)
  const AV_PALETTE = [
    ["#f472b6", "#ec4899"],
    ["#fb7185", "#e11d48"],
    ["#c084fc", "#a855f7"],
    ["#fbbf24", "#f59e0b"],
    ["#fda4af", "#f472b6"],
    ["#a5b4fc", "#818cf8"],
    ["#5eead4", "#14b8a6"],
    ["#f9a8d4", "#db2777"],
  ];
  function avatarGradient(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const [a, b] = AV_PALETTE[h % AV_PALETTE.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
  }

  // bangun element avatar: foto bila ada, else inisial bergradient
  function buildAvatar(el, entry) {
    el.innerHTML = "";
    if (entry.photo) {
      const img = document.createElement("img");
      img.src = entry.photo;
      img.alt = entry.name;
      img.referrerpolicy = "no-referrer";
      img.onerror = () => { el.innerHTML = initials(entry.name); el.style.background = avatarGradient(entry.name); el.style.color = "#1f1721"; };
      el.appendChild(img);
    } else {
      el.textContent = initials(entry.name);
      el.style.background = avatarGradient(entry.name);
      el.style.color = "#1f1721";
    }
  }

  function fillPodium(card, entry) {
    const rank = entry.rank;
    card.querySelector(".pod-avatar")?.remove();
    card.querySelector(".pod-name")?.remove();
    card.querySelector(".pod-dist")?.remove();
    card.querySelector(".pod-acts")?.remove();

    const av = document.createElement("div");
    av.className = "pod-avatar";
    buildAvatar(av, entry);
    card.appendChild(av);

    const nm = document.createElement("div");
    nm.className = "pod-name";
    nm.textContent = entry.name;
    card.appendChild(nm);

    const d = document.createElement("div");
    d.className = "pod-dist";
    d.textContent = `${entry.distance_km} km`;
    card.appendChild(d);

    const ac = document.createElement("div");
    ac.className = "pod-acts";
    ac.textContent = `${entry.activities}× lari • pace ${entry.pace}/km`;
    card.appendChild(ac);
  }

  function makeRow(entry) {
    const row = document.createElement("div");
    row.className = "row";
    const medal = medals[entry.rank - 1] || "";
    const av = document.createElement("div");
    av.className = "av";
    buildAvatar(av, entry);
    row.innerHTML = `
      <div class="rank">${medal || entry.rank}</div>
    `;
    row.appendChild(av);
    const info = document.createElement("div");
    info.className = "info";
    info.innerHTML = `
      <div class="name">${entry.name}</div>
      <div class="sub">${entry.activities}× lari • pace ${entry.pace}/km • waktu ${entry.moving_time}</div>
    `;
    row.appendChild(info);
    const dist = document.createElement("div");
    dist.className = "dist";
    const elevBadge = entry.elev_m ? `<span class="badge">⛰ ${entry.elev_m} m</span>` : "";
    dist.innerHTML = `
      <div class="km">${entry.distance_km}<span class="unit"> km</span></div>
      <div class="badges">
        <span class="badge">⏱ ${entry.pace}/km</span>
        ${elevBadge}
      </div>
    `;
    row.appendChild(dist);
    return row;
  }

  function render(data) {
    const clubName = document.getElementById("club-name");
    const clubMeta = document.getElementById("club-meta");
    const periodRange = document.getElementById("period-range");
    const periodLabel = document.getElementById("period-label");
    const updatedAt = document.getElementById("updated-at");
    const logo = document.getElementById("club-logo");
    const heroCover = document.getElementById("hero-cover");

    if (data.club) {
      clubName.textContent = data.club.name || "Tangerang Crazy Runners 🔥";
      const meta = [data.club.city, data.club.state, data.club.country]
        .filter(Boolean).join(", ");
      clubMeta.textContent = meta || "";
      if (data.club.profile && logo) {
        logo.src = data.club.profile;
        logo.onerror = () => { logo.style.visibility = "hidden"; };
      }
      if (data.club.cover_photo && heroCover) {
        heroCover.style.backgroundImage = `url("${data.club.cover_photo}")`;
      }
    }

    const isWeekly = data.filter_mode === "weekly";
    if (periodLabel) {
      periodLabel.textContent = "Top 10 — Minggu Berjalan";
    }
    const range = `Senin, ${fmtDateShort(data.week_start)} — ${fmtDateShort(data.week_end)} (sampai sekarang)`;
    periodRange.textContent = range;
    updatedAt.textContent = fmtGenerated(data.generated_at);

    const lb = data.leaderboard || [];
    if (lb.length === 0) {
      document.getElementById("rank-list").innerHTML =
        '<div class="foot-note">Belum ada aktivitas minggu ini. Cek kembali nanti. 🏃</div>';
      return;
    }

    // podium: posisi 2, 1, 3
    const p2 = document.querySelector(".podium-card.rank-2");
    const p1 = document.querySelector(".podium-card.rank-1");
    const p3 = document.querySelector(".podium-card.rank-3");
    const byRank = Object.fromEntries(lb.map((e) => [e.rank, e]));
    if (p1 && byRank[1]) fillPodium(p1, byRank[1]);
    if (p2 && byRank[2]) fillPodium(p2, byRank[2]);
    if (p3 && byRank[3]) fillPodium(p3, byRank[3]);

    const list = document.getElementById("rank-list");
    list.innerHTML = "";
    lb.filter((e) => e.rank >= 4).forEach((e) => list.appendChild(makeRow(e)));
  }

  async function load() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      window.TCR_DATA = data;
      render(data);
    } catch (e) {
      console.error(e);
      document.getElementById("rank-list").innerHTML =
        `<div class="foot-note">⚠️ Gagal memuat data: ${e.message}.<br>Jalankan <code>node fetch-data.js</code> untuk membuat data.json.</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", load);

  const refreshBtn = document.getElementById("btn-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", load);
})();