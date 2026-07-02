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

  function fmtGenerated(iso) {
    try {
      return new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch (e) { return iso; }
  }

  function fillPodium(card, entry) {
    const rank = entry.rank;
    card.querySelector(".pod-avatar")?.remove();
    card.querySelector(".pod-name")?.remove();
    card.querySelector(".pod-dist")?.remove();
    card.querySelector(".pod-acts")?.remove();

    const av = document.createElement("div");
    av.className = "pod-avatar";
    av.textContent = initials(entry.name);
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
    row.innerHTML = `
      <div class="rank">${medal || entry.rank}</div>
      <div class="av">${initials(entry.name)}</div>
      <div class="info">
        <div class="name">${entry.name}</div>
        <div class="sub">${entry.activities}× lari • pace ${entry.pace}/km • waktu ${entry.moving_time}</div>
      </div>
      <div class="dist">
        <div class="km">${entry.distance_km}<span class="unit"> km</span></div>
        <div class="badges">
          <span class="badge">⏱ ${entry.pace}/km</span>
          <span class="badge">⛰ ${entry.elev_m} m</span>
        </div>
      </div>
    `;
    return row;
  }

  function render(data) {
    const clubName = document.getElementById("club-name");
    const clubMeta = document.getElementById("club-meta");
    const periodRange = document.getElementById("period-range");
    const updatedAt = document.getElementById("updated-at");
    const logo = document.getElementById("club-logo");

    if (data.club) {
      clubName.textContent = data.club.name || "Tangerang Crazy Runners";
      const meta = [data.club.city, data.club.state, data.club.country]
        .filter(Boolean).join(", ");
      clubMeta.textContent = meta || "";
      if (data.club.profile && logo) {
        logo.src = data.club.profile;
        logo.onerror = () => { logo.style.display = "none"; };
      } else if (logo) {
        logo.style.display = "none";
      }
    }
    periodRange.textContent = `${fmtDate(data.week_start)} — ${fmtDate(data.week_end)}`;
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