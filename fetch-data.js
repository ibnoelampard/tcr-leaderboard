#!/usr/bin/env node
/**
 * fetch-data.js — Tangerang Crazy Runners leaderboard
 *
 * Ambil aktivitas club dari Strava, agregasi jarak, tulis Top 10 ke data/data.json.
 * Download logo & cover club ke data/assets/ (sama-origin → capture html2canvas bebas taint).
 *
 * AUTH:
 *  1) Session cookie (RECOMMENDED, filter mingguan akurat):
 *     export STRAVA_SESSION_COOKIE='_strava4_session=...'
 *     Cookie dipakai untuk auth endpoint /api/v3 → Strava mengembalikan start_date + athlete id.
 *  2) Bearer token (fallback, scope terbatas, TANPA tanggal → tidak bisa filter mingguan):
 *     token di config.js
 *
 * Jalankan:  node fetch-data.js
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");

const STRAVA_BASE = "https://www.strava.com/api/v3";
const SESSION_COOKIE = process.env.STRAVA_SESSION_COOKIE || "";
const USE_COOKIE = !!SESSION_COOKIE;

function authHeaders() {
  if (USE_COOKIE) {
    return {
      Cookie: SESSION_COOKIE,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    };
  }
  return { Authorization: `Bearer ${config.ACCESS_TOKEN}` };
}

async function stravaGet(p) {
  const url = `${STRAVA_BASE}${p}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) {
    throw new Error(
      USE_COOKIE
        ? "Cookie session tidak valid / expired (401). Login Strava di browser, ambil cookie baru."
        : "Token Strava tidak valid / expired (401). Perbarui config.js."
    );
  }
  if (res.status === 404) return null;
  if (res.status === 429) {
    console.warn("Rate limited (429), menunggu 15s...");
    await new Promise((r) => setTimeout(r, 15000));
    return stravaGet(p);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} pada ${url}`);
  return res.json();
}

// ===== WIB week range: Senin 00:00 WIB s/d sekarang =====
function getWeekRangeWIB(date = new Date()) {
  const wibOffsetMin = 7 * 60;
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const wibNow = new Date(utcMs + wibOffsetMin * 60000);
  const dayWIB = wibNow.getDay();
  const daysFromMonday = (dayWIB + 6) % 7;
  wibNow.setHours(0, 0, 0, 0);
  wibNow.setDate(wibNow.getDate() - daysFromMonday);
  const mondayWIB = new Date(wibNow.getTime() - wibOffsetMin * 60000);
  return { start: mondayWIB, end: date };
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// ===== Athlete key & display =====
function uid(a) {
  return `${(a.firstname || "").trim()}__${(a.lastname || "").trim()}`.toLowerCase();
}
function display(a) {
  const f = (a.firstname || "").trim();
  const l = (a.lastname || "").trim();
  return `${f}${l ? " " + l : ""}`.trim();
}

function pacePerKm(m, s) { return m && s ? s / (m / 1000) : 0; }
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

// ===== Download helper (logo + cover) =====
async function downloadAsset(url, filePath) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    console.log(`   ✓ download ${path.basename(filePath)} (${(buf.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (e) {
    console.warn(`   ! gagal download ${url}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`>> Mode auth: ${USE_COOKIE ? "SESSION COOKIE" : "BEARER TOKEN (fallback)"}`);
  console.log(">> Mengambil info club...");
  const club = await stravaGet(`/clubs/${config.CLUB_ID}`);
  console.log(`   Club: ${club.name} (${club.member_count} anggota)`);

  const { start, end } = getWeekRangeWIB();
  console.log(`>> Rentang minggu (WIB): ${fmtDate(start)} → ${fmtDate(end)} (sampai sekarang)`);

  // Download logo + cover lokal
  const assetsDir = path.join(__dirname, "data", "assets");
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  const logoPath = path.join(assetsDir, "logo.jpg");
  const coverPath = path.join(assetsDir, "cover.jpg");
  await downloadAsset(club.profile, logoPath);
  await downloadAsset(club.cover_photo, coverPath);

  const byAthlete = new Map();
  let dateFilterApplied = false;
  let totalActs = 0;

  for (let page = 1; page <= config.MAX_PAGES; page++) {
    console.log(`>> Ambil halaman ${page}...`);
    const acts = await stravaGet(
      `/clubs/${config.CLUB_ID}/activities?page=${page}&per_page=200`,
    );
    if (!acts || !acts.length) { console.log("   Tidak ada lagi aktivitas."); break; }

    // Cek apakah response punya start_date
    const hasDates = acts.some((a) => a.start_date || a.start_date_local);
    if (hasDates) dateFilterApplied = true;

    let stillRelevant = false;
    if (hasDates) {
      for (const a of acts) {
        const d = a.start_date_local
          ? new Date(a.start_date_local.endsWith("Z") ? a.start_date_local : a.start_date_local + "Z")
          : new Date(a.start_date);
        if (d >= start) stillRelevant = true;
      }
      if (page > 1 && !stillRelevant) { console.log("   Sisa aktivitas di luar minggu ini. Berhenti."); break; }
    }

    for (const a of acts) {
      // Filter tanggal bila tersedia
      if (hasDates) {
        const d = a.start_date_local
          ? new Date(a.start_date_local.endsWith("Z") ? a.start_date_local : a.start_date_local + "Z")
          : new Date(a.start_date);
        if (d < start || d > end) continue;
      }
      const isRun =
        a.sport_type === "Run" || a.sport_type === "VirtualRun" ||
        a.type === "Run" || a.type === "VirtualRun";
      if (!isRun) continue;

      const id = uid(a.athlete);
      let entry = byAthlete.get(id);
      if (!entry) {
        entry = {
          name: display(a.athlete),
          distance: 0, moving_time: 0, activities: 0, elev_gain: 0,
          athlete_id: a.athlete?.id || null,
          profile: a.athlete?.profile || null,
        };
        byAthlete.set(id, entry);
      }
      entry.distance += a.distance || 0;
      entry.moving_time += a.moving_time || 0;
      entry.activities += 1;
      entry.elev_gain += a.total_elevation_gain || 0;
      totalActs++;
    }
    // Bila tidak ada tanggal, feed Strava sudah reverse-kronolog; ambil beberapa halaman saja cukup.
    if (!hasDates && page >= 3) { console.log("   (tanpa tanggal: batasi ambil 3 halaman terbaru)"); break; }
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
    filter_mode: dateFilterApplied ? "weekly" : "recent",
    auth_mode: USE_COOKIE ? "cookie" : "bearer",
    club: {
      id: club.id, name: club.name, city: club.city, state: club.state,
      country: club.country, member_count: club.member_count,
      profile: "assets/logo.jpg",
      cover_photo: "assets/cover.jpg",
      url: club.url,
    },
    week_start: fmtDate(start),
    week_end: fmtDate(end),
    metric: "distance",
    total_athletes: list.length,
    total_activities: totalActs,
    leaderboard: top10,
  };

  const outDir = path.join(__dirname, "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "data.json"), JSON.stringify(payload, null, 2), "utf8");
  console.log(`✅ Tulis data/data.json`);
  console.log(`   Filter: ${payload.filter_mode} | Auth: ${payload.auth_mode}`);
  console.log(`   Total atlet: ${list.length} | Total aktivitas: ${totalActs}`);
  if (!dateFilterApplied) {
    console.warn("   ⚠ TANPA filter tanggal (API tak beri start_date).");
    console.warn("     Untuk filter mingguan akurat, set env STRAVA_SESSION_COOKIE.");
  }
  top10.forEach((t) => console.log(`   ${t.rank}. ${t.name} — ${t.distance_km} km`));
}

main().catch((e) => { console.error("❌ Gagal:", e.message); process.exit(1); });