#!/usr/bin/env node
/**
 * fetch-data.js — Tangerang Crazy Runners leaderboard
 *
 * Sumber data:
 *  - OAuth /clubs/{id}/activities     → statistik (jarak/waktu/elev) semua atlet, TANPA tanggal/foto
 *  - Web  /clubs/{id}/feed (cookie)   → foto profil atlet (akumulasi di data/athlete-photos.json)
 *
 * Auth:
 *  - Token OAuth di config.js (untuk statistik)
 *  - Session cookie via env STRAVA_SESSION_COOKIE (untuk foto; opsional)
 *
 * Jalankan:  node fetch-data.js
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");

const STRAVA_BASE = "https://www.strava.com/api/v3";
const SESSION_COOKIE = process.env.STRAVA_SESSION_COOKIE || "";
const USE_COOKIE = !!SESSION_COOKIE;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const PHOTO_MAP_FILE = path.join(__dirname, "data", "athlete-photos.json");
const ATHLETE_ASSET_DIR = path.join(__dirname, "data", "assets", "athletes");

// ===== Auth =====
function apiHeaders() {
  return { Authorization: `Bearer ${config.ACCESS_TOKEN}` };
}
function webHeaders() {
  return {
    Cookie: SESSION_COOKIE,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "application/json",
    Referer: "https://www.strava.com/clubs/tangerangcrazyrunners",
  };
}

async function stravaGet(p) {
  const url = `${STRAVA_BASE}${p}`;
  const res = await fetch(url, { headers: apiHeaders() });
  if (res.status === 401) throw new Error("Token OAuth expired (401). Perbarui config.js.");
  if (res.status === 404) return null;
  if (res.status === 429) { console.warn("Rate limited (429), tunggu 15s..."); await new Promise(r=>setTimeout(r,15000)); return stravaGet(p); }
  if (!res.ok) throw new Error(`HTTP ${res.status} pada ${url}`);
  return res.json();
}

async function webFeed() {
  if (!USE_COOKIE) return null;
  try {
    const r = await fetch(`https://www.strava.com/clubs/${config.CLUB_ID}/feed`, { headers: webHeaders() });
    if (!r.ok) { console.warn(`   web feed HTTP ${r.status}, foto dilewati`); return null; }
    return await r.json();
  } catch (e) { console.warn("   web feed gagal:", e.message); return null; }
}

// ===== WIB helpers =====
function fmtDate(date) {
  const w = new Date(date.getTime() + WIB_OFFSET_MS);
  return w.toISOString().slice(0, 10);
}
function getWeekRangeWIB(date = new Date()) {
  const wibEpoch = date.getTime() + WIB_OFFSET_MS;
  const w = new Date(wibEpoch);
  const day = w.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  const msIntoDay = w.getUTCHours()*3600000 + w.getUTCMinutes()*60000 + w.getUTCSeconds()*1000 + w.getUTCMilliseconds();
  const mondayWibEpoch = wibEpoch - msIntoDay - daysFromMonday*86400000;
  return { start: new Date(mondayWibEpoch - WIB_OFFSET_MS), end: date };
}

// ===== Athlete helpers =====
function uid(a) {
  return `${(a.firstname||"").trim()}__${(a.lastname||"").trim()}`.toLowerCase();
}
function display(a) {
  const f=(a.firstname||"").trim(), l=(a.lastname||"").trim();
  return `${f}${l?" "+l:""}`.trim();
}
// normalized key for name matching: firstname + first char of lastname
function nameKey(name) {
  const parts = String(name||"").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0];
  const lastInit = (parts[1]||"").replace(/\W/g,"")[0] || "";
  return (first + lastInit).toLowerCase().replace(/[^a-z0-9]/g,"");
}

function pacePerKm(m,s){ return m&&s ? s/(m/1000) : 0; }
function fmtPace(spk){ if(!spk||!isFinite(spk))return"--"; const m=Math.floor(spk/60); const s=Math.round(spk%60).toString().padStart(2,"0"); return `${m}:${s}`; }
function fmtDuration(sec){ sec=Math.round(sec); const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return h?`${h}j ${m}m`:`${m}m ${s}s`; }

// ===== Download helpers =====
async function downloadAsset(url, filePath) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    return true;
  } catch (e) { console.warn(`   ! download gagal ${path.basename(filePath)}: ${e.message}`); return false; }
}

function loadPhotoMap() {
  try { return JSON.parse(fs.readFileSync(PHOTO_MAP_FILE,"utf8")) || {}; }
  catch { return {}; }
}
function savePhotoMap(m) {
  fs.writeFileSync(PHOTO_MAP_FILE, JSON.stringify(m, null, 2), "utf8");
}

async function fetchPhotos(leaderboard, photoMap) {
  if (!USE_COOKIE) { console.log("   (tanpa cookie: foto dilewati, pakai inisial)"); return; }
  const feed = await webFeed();
  if (!feed || !feed.entries) { console.log("   web feed kosong, foto dilewati"); return; }
  if (!fs.existsSync(ATHLETE_ASSET_DIR)) fs.mkdirSync(ATHLETE_ASSET_DIR, { recursive: true });

  let added = 0;
  for (const e of feed.entries) {
    const a = e.activity?.athlete;
    if (!a || !a.avatarUrl) continue;
    // skip avatar default Strava (bukan foto atlet)
    if (!/\/athletes\//.test(a.avatarUrl)) continue;
    const key = nameKey(a.athleteName || `${a.firstName} ${a.athleteName}`);
    if (!key) continue;
    if (photoMap[key] && photoMap[key].url === a.avatarUrl) continue;
    const aid = a.athleteId || key;
    const localPath = `assets/athletes/${aid}.jpg`;
    const ok = await downloadAsset(a.avatarUrl, path.join(ATHLETE_ASSET_DIR, `${aid}.jpg`));
    if (ok) { photoMap[key] = { url: a.avatarUrl, path: localPath, name: a.athleteName }; added++; }
  }
  console.log(`   ✓ foto atlet: ${added} baru (total ${Object.keys(photoMap).length})`);

  // attach ke leaderboard
  for (const e of leaderboard) {
    const k = nameKey(e.name);
    if (photoMap[k]) e.photo = photoMap[k].path;
  }
}

async function main() {
  console.log(`>> Mode foto: ${USE_COOKIE ? "SESSION COOKIE (web feed)" : "TIDAK ADA (inisial)"}`);
  console.log(">> Mengambil info club...");
  const club = await stravaGet(`/clubs/${config.CLUB_ID}`);
  console.log(`   Club: ${club.name} (${club.member_count} anggota)`);

  const { start, end } = getWeekRangeWIB();
  console.log(`>> Minggu (WIB): ${fmtDate(start)} → ${fmtDate(end)} (Senin s/d sekarang)`);

  // Download logo + cover lokal
  const assetsDir = path.join(__dirname, "data", "assets");
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  await downloadAsset(club.profile, path.join(assetsDir, "logo.jpg"));
  await downloadAsset(club.cover_photo, path.join(assetsDir, "cover.jpg"));

  // Ambil aktivitas OAuth (statistik)
  const byAthlete = new Map();
  let totalActs = 0;
  for (let page=1; page<=config.MAX_PAGES; page++) {
    console.log(`>> Aktivitas halaman ${page}...`);
    const acts = await stravaGet(`/clubs/${config.CLUB_ID}/activities?page=${page}&per_page=200`);
    if (!acts || !acts.length) { console.log("   selesai."); break; }
    for (const a of acts) {
      const isRun = a.sport_type==="Run"||a.sport_type==="VirtualRun"||a.type==="Run"||a.type==="VirtualRun";
      if (!isRun) continue;
      const id = uid(a.athlete);
      let en = byAthlete.get(id);
      if (!en) { en = { name: display(a.athlete), distance:0, moving_time:0, activities:0, elev_gain:0 }; byAthlete.set(id, en); }
      en.distance += a.distance||0;
      en.moving_time += a.moving_time||0;
      en.activities += 1;
      en.elev_gain += a.total_elevation_gain||0;
      totalActs++;
    }
  }

  let list = Array.from(byAthlete.values()).map(e => ({
    name: e.name,
    distance_km: +(e.distance/1000).toFixed(2),
    moving_time_sec: e.moving_time,
    moving_time: fmtDuration(e.moving_time),
    pace: fmtPace(pacePerKm(e.distance, e.moving_time)),
    activities: e.activities,
    elev_m: Math.round(e.elev_gain),
  }));
  list.sort((a,b)=>b.distance_km-a.distance_km);
  const top10 = list.slice(0,10).map((e,i)=>({ rank:i+1, ...e }));

  // Foto (web feed + akumulasi)
  console.log(">> Mengambil foto atlet...");
  const photoMap = loadPhotoMap();
  await fetchPhotos(top10, photoMap);
  savePhotoMap(photoMap);

  const payload = {
    generated_at: new Date().toISOString(),
    filter_mode: "weekly",
    club: {
      id: club.id, name: club.name, city: club.city, state: club.state,
      country: club.country, member_count: club.member_count,
      profile: "assets/logo.jpg", cover_photo: "assets/cover.jpg", url: club.url,
    },
    week_start: fmtDate(start),
    week_end: fmtDate(end),
    metric: "distance",
    total_athletes: list.length,
    total_activities: totalActs,
    leaderboard: top10,
  };

  fs.writeFileSync(path.join(__dirname,"data","data.json"), JSON.stringify(payload,null,2),"utf8");
  console.log(`✅ Tulis data/data.json`);
  console.log(`   Total atlet: ${list.length} | aktivitas: ${totalActs}`);
  top10.forEach(t => console.log(`   ${t.rank}. ${t.name} — ${t.distance_km} km${t.photo?" [foto]":""}`));
}

main().catch(e => { console.error("❌ Gagal:", e.message); process.exit(1); });