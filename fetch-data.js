#!/usr/bin/env node
/**
 * fetch-data.js
 * Ambil aktivitas club Tangerang Crazy Runners dari Strava,
 * agregasi jarak minggu berjalan (Senin 00:00 WIB s/d sekarang),
 * tulis Top 10 ke data/data.json.
 *
 * Jalankan:  node fetch-data.js
 * Tidak butuh dependency pihak ketiga (Node 18+ fetch).
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");

const STRAVA_BASE = "https://www.strava.com/api/v3";

// WIB = UTC+7. Senin = hari ke-1 di JS (0=Minggu).
function getWeekRangeWIB(date = new Date()) {
  const now = new Date(date);
  // Hitung hari Senin 00:00:00 WIB. WIB offset = +7.
  // Cari Senin di zona waktu WIB: konversi "sekarang" ke WIB dulu.
  const wibOffsetMin = 7 * 60;
  // UTC saat ini
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const wibNow = new Date(utcMs + wibOffsetMin * 60000);
  const dayWIB = wibNow.getDay(); // 0=Minggu..6=Sabtu
  const daysFromMonday = (dayWIB + 6) % 7; // 0=Senin
  wibNow.setHours(0, 0, 0, 0);
  wibNow.setDate(wibNow.getDate() - daysFromMonday);
  // Monday 00:00 WIB sebagai Date UTC
  const mondayWIB = new Date(wibNow.getTime() - wibOffsetMin * 60000);
  // End = sekarang
  const end = now;
  return { start: mondayWIB, end };
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function uid(a) {
  return `${(a.firstname || "").trim()}__${(a.lastname || "").trim()}`.toLowerCase();
}

function display(a) {
  const f = (a.firstname || "").trim();
  const l = (a.lastname || "").trim();
  // Strava club activities hanya kasih firstname + initial lastname. Gabungkan.
  return `${f}${l ? " " + l : ""}`.trim();
}

async function stravaGet(path) {
  const url = `${STRAVA_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.ACCESS_TOKEN}` },
  });
  if (res.status === 401) {
    throw new Error("Token Strava tidak valid / expired (401). Perbarui config.js");
  }
  if (res.status === 404) {
    return null;
  }
  if (res.status === 429) {
    // rate limit -> tunggu sebentar lalu retry sekali
    console.warn("Rate limited (429), menunggu 15s...");
    await new Promise((r) => setTimeout(r, 15000));
    return stravaGet(path);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} pada ${url}`);
  }
  return res.json();
}

function pacePerKm(distanceMeters, movingSeconds) {
  if (!distanceMeters || !movingSeconds) return 0;
  return movingSeconds / (distanceMeters / 1000); // detik per km
}

function fmtPace(spk) {
  if (!spk || !isFinite(spk)) return "--";
  const m = Math.floor(spk / 60);
  const s = Math.round(spk % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmtDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}j ${m}m`;
  return `${m}m ${s}s`;
}

async function main() {
  console.log(">> Mengambil info club...");
  const club = await stravaGet(`/clubs/${config.CLUB_ID}`);
  console.log(`   Club: ${club.name} (${club.member_count} anggota)`);

  const { start, end } = getWeekRangeWIB();
  const startISO = start.toISOString();
  const endISO = end.toISOString();
  console.log(`>> Periode minggu berjalan (WIB): ${fmtDate(start)} ... ${fmtDate(end)}`);

  const byAthlete = new Map();

  for (let page = 1; page <= config.MAX_PAGES; page++) {
    console.log(`>> Ambil halaman ${page}...`);
    const acts = await stravaGet(
      `/clubs/${config.CLUB_ID}/activities?page=${page}&per_page=200`,
    );
    if (!acts || !acts.length) {
      console.log("   Tidak ada lagi aktivitas.");
      break;
    }
    // Hentikan bila seluruh aktivitas di halaman lebih lama dari awal minggu.
    let stillRelevant = false;
    for (const a of acts) {
      if (!a.start_date && !a.start_date_local) continue;
      const d = a.start_date_local
        ? new Date(a.start_date_local + "Z")
        : new Date(a.start_date);
      if (d >= start) stillRelevant = true;
    }
    if (page > 1 && !stillRelevant) {
      console.log("   Sisa aktivitas di luar minggu berjalan. Berhenti.");
      break;
    }

    for (const a of acts) {
      const d = a.start_date_local
        ? new Date(a.start_date_local + "Z")
        : new Date(a.start_date);
      if (d < start || d > end) continue;
      // Hanya lari (Run / VirtualRun / replacement by sport_type)
      const isRun =
        a.sport_type === "Run" ||
        a.sport_type === "VirtualRun" ||
        a.type === "Run" ||
        a.type === "VirtualRun";
      if (!isRun) continue;

      const id = uid(a.athlete);
      let entry = byAthlete.get(id);
      if (!entry) {
        entry = {
          name: display(a.athlete),
          distance: 0,
          moving_time: 0,
          activities: 0,
          elev_gain: 0,
        };
        byAthlete.set(id, entry);
      }
      entry.distance += a.distance || 0;
      entry.moving_time += a.moving_time || 0;
      entry.activities += 1;
      entry.elev_gain += a.total_elevation_gain || 0;
    }
  }

  let list = Array.from(byAthlete.values()).map((e) => ({
    name: e.name,
    distance_km: +(e.distance / 1000).toFixed(2),
    moving_time_sec: e.moving_time,
    moving_time: fmtDuration(e.moving_time),
    pace: fmtPace(pacePerKm(e.distance, e.moving_time)),
    activities: e.activities,
    elev_m: Math.round(e.elev_gain),
  }));
  list.sort((a, b) => b.distance_km - a.distance_km);
  const top10 = list.slice(0, 10).map((e, i) => ({ rank: i + 1, ...e }));

  const payload = {
    generated_at: new Date().toISOString(),
    club: {
      id: club.id,
      name: club.name,
      city: club.city,
      state: club.state,
      country: club.country,
      member_count: club.member_count,
      profile: club.profile,
      cover_photo: club.cover_photo,
      url: club.url,
    },
    week_start: fmtDate(start),
    week_end: fmtDate(end),
    metric: "distance",
    total_athletes: list.length,
    leaderboard: top10,
  };

  if (top10.length === 0) {
    console.warn(
      "!! Peringatan: leaderboard kosong. Mungkin belum ada aktivitas minggu ini.",
    );
  }

  const outDir = path.join(__dirname, "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "data.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`✅ Tulis ${outPath}`);
  console.log(`   Total atlet minggu ini: ${list.length}`);
  console.log(`   Top 10: ${top10.length}`);
  top10.forEach((t) =>
    console.log(`   ${t.rank}. ${t.name} — ${t.distance_km} km`),
  );
}

main().catch((e) => {
  console.error("❌ Gagal:", e.message);
  process.exit(1);
});