#!/usr/bin/env node
/**
 * fetch-data.js — Tangerang Crazy Runners leaderboard
 *
 * Strategi:
 *  1. Foto atlet dari web feed (cookie).
 *  2. Semua aktivitas minggu ini (Senin 00:00 WIB → sekarang) via OAuth API pagination.
 *     activity-store.json DIREPLACE tiap run (data mentah mingguan).
 *  3. aggregateWeekly → data.json (top 10) untuk landing page.
 *
 * Jalankan:  node fetch-data.js
 */

const fs = require("fs");
const path = require("path");

let config = { ACCESS_TOKEN: "", CLUB_ID: 223457, MAX_PAGES: 30 };
try { Object.assign(config, require("./config")); } catch (e) {}
const CLUB_ID = Number(process.env.STRAVA_CLUB_ID || config.CLUB_ID);
const MAX_PAGES = Number(process.env.STRAVA_MAX_PAGES || config.MAX_PAGES || 30);
const CLIENT_ID = process.env.STRAVA_CLIENT_ID || config.CLIENT_ID || "";
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || config.CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN || config.REFRESH_TOKEN || "";
let ACCESS_TOKEN = process.env.STRAVA_ACCESS_TOKEN || config.ACCESS_TOKEN || "";
const CAN_AUTO_REFRESH = !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);

const STRAVA_BASE = "https://www.strava.com/api/v3";
const SESSION_COOKIE = process.env.STRAVA_SESSION_COOKIE || "";
const USE_COOKIE = !!SESSION_COOKIE;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "activity-store.json");
const PHOTO_MAP_FILE = path.join(DATA_DIR, "athlete-photos.json");
const ATHLETE_ASSET_DIR = path.join(DATA_DIR, "assets", "athletes");

// ===== Auth =====
async function refreshAccessToken() {
  if (!CAN_AUTO_REFRESH) throw new Error("Token expired & tidak ada refresh creds.");
  console.log("   ⤵ access_token expired, exchange refresh_token...");
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    grant_type: "refresh_token", refresh_token: REFRESH_TOKEN,
  });
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!res.ok) { const t = await res.text().catch(()=> ""); throw new Error(`Refresh gagal (HTTP ${res.status}): ${t.slice(0,200)}`); }
  const j = await res.json();
  ACCESS_TOKEN = j.access_token;
  console.log(`   ✓ token baru (expires ${new Date(j.expires_at*1000).toISOString().slice(11,19)}Z)`);
}
function apiHeaders() { return { Authorization: `Bearer ${ACCESS_TOKEN}` }; }
function webHeaders() {
  return {
    Cookie: SESSION_COOKIE,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "application/json",
    Referer: "https://www.strava.com/clubs/tangerangcrazyrunners",
  };
}
async function stravaGet(p) {
  const url = `${STRAVA_BASE}${p}`;
  let res = await fetch(url, { headers: apiHeaders() });
  if (res.status === 401) {
    if (CAN_AUTO_REFRESH) { await refreshAccessToken(); res = await fetch(url, { headers: apiHeaders() }); }
    if (res.status === 401) throw new Error("Token invalid & refresh gagal (401).");
  }
  if (res.status === 404) return null;
  if (res.status === 429) { console.warn("Rate limited (429), tunggu 15s..."); await new Promise(r=>setTimeout(r,15000)); return stravaGet(p); }
  if (!res.ok) throw new Error(`HTTP ${res.status} pada ${url}`);
  return res.json();
}

// ===== WIB helpers =====
function fmtDate(date) { return new Date(date.getTime()+WIB_OFFSET_MS).toISOString().slice(0,10); }
function toWIBNaive(date) { return new Date(date.getTime()+WIB_OFFSET_MS).toISOString().slice(0,19); }
function getWeekRangeWIB(date = new Date()) {
  const wibEpoch = date.getTime()+WIB_OFFSET_MS;
  const w = new Date(wibEpoch);
  const day = w.getUTCDay();
  const daysFromMonday = (day+6)%7;
  const msIntoDay = w.getUTCHours()*3600000 + w.getUTCMinutes()*60000 + w.getUTCSeconds()*1000 + w.getUTCMilliseconds();
  return { start: new Date(wibEpoch - msIntoDay - daysFromMonday*86400000 - WIB_OFFSET_MS), end: date };
}

// ===== Athlete helpers =====
function uid(a) { return `${(a.firstname||"").trim()}__${(a.lastname||"").trim()}`.toLowerCase(); }
function display(a) { const f=(a.firstname||"").trim(), l=(a.lastname||"").trim(); return `${f}${l?" "+l:""}`.trim(); }
function nameKey(name) {
  const p = String(name||"").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  if (!p.length) return "";
  return (p[0] + (p[1]||"").replace(/\W/g,"").slice(0,1)).toLowerCase().replace(/[^a-z0-9]/g,"");
}
function pacePerKm(m,s){ return m&&s ? s/(m/1000) : 0; }
function fmtPace(spk){ if(!spk||!isFinite(spk))return"--"; const m=Math.floor(spk/60); const s=Math.round(spk%60).toString().padStart(2,"0"); return `${m}:${s}`; }
function fmtDuration(sec){ sec=Math.round(sec); const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return h?`${h}j ${m}m`:`${m}m ${s}s`; }

// ===== Stat parser (web feed HTML stats) =====
function stripHtml(s){ return String(s||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim(); }
function statValue(stats, key){
  const e = stats.find(s => s.key === key);
  return e ? e.value : "";
}
function parseDistanceKm(stats){
  const raw = stripHtml(statValue(stats, "stat_one"));
  const m = raw.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}
function parseMovingSec(stats){
  const raw = stripHtml(statValue(stats, "stat_three"));
  let sec=0; const re=/(\d+)\s*([hms])/g; let m;
  while((m=re.exec(raw))){ const n=parseInt(m[1]); if(m[2]==="h")sec+=n*3600; else if(m[2]==="m")sec+=n*60; else sec+=n; }
  return sec;
}

// ===== Download =====
async function downloadAsset(url, filePath) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch(e){ return false; }
}

// ===== Photo map =====
function loadPhotoMap(){ try { return JSON.parse(fs.readFileSync(PHOTO_MAP_FILE,"utf8"))||{}; } catch { return {}; } }
function savePhotoMap(m){ fs.writeFileSync(PHOTO_MAP_FILE, JSON.stringify(m,null,2),"utf8"); }

async function fetchWebFeed() {
  if (!USE_COOKIE) return null;
  try {
    const r = await fetch(`https://www.strava.com/clubs/${CLUB_ID}/feed`, { headers: webHeaders() });
    if (!r.ok) { console.warn(`   web feed HTTP ${r.status}`); return null; }
    return await r.json();
  } catch(e){ console.warn("   web feed gagal:", e.message); return null; }
}

// ===== Ingest aktivitas + foto dari web feed =====
async function ingestWebFeed(store, photoMap, weekStart) {
  if (!USE_COOKIE) return 0;
  const weekStartIso = weekStart.toISOString();
  if (!fs.existsSync(ATHLETE_ASSET_DIR)) fs.mkdirSync(ATHLETE_ASSET_DIR, { recursive: true });
  let newActs = 0, newPhotos = 0;

  const feed = await fetchWebFeed();
  if (!feed || !feed.entries) { console.log("   web feed kosong"); return 0; }

  for (const e of feed.entries) {
    const a = e.activity;
    if (!a || !a.id) continue;
    if (a.type !== "Run" && a.type !== "VirtualRun") continue;
    if (a.startDate && a.startDate < weekStartIso) continue;

    const athlete = a.athlete || {};
    const athleteName = athlete.athleteName || display({firstname:athlete.firstName});
    const distance_km = parseDistanceKm(a.stats);
    const moving_time_sec = parseMovingSec(a.stats);

    store.activities[a.id] = {
      id: a.id,
      athlete: athleteName,
      athleteId: athlete.athleteId || null,
      startDate: a.startDate,
      type: a.type,
      distance_km,
      moving_time_sec,
      distance_m: Math.round(distance_km * 1000),
    };
    newActs++;

    const key = nameKey(athleteName);
    if (key && athlete.avatarUrl && /\/athletes\//.test(athlete.avatarUrl) && !photoMap[key]) {
      const aid = athlete.athleteId || key;
      const ok = await downloadAsset(athlete.avatarUrl, path.join(ATHLETE_ASSET_DIR, `${aid}.jpg`));
      if (ok) { photoMap[key] = { url: athlete.avatarUrl, path: `assets/athletes/${aid}.jpg`, name: athleteName }; newPhotos++; }
    }
  }

  console.log(`   ✓ web feed: ${newActs} aktivitas, ${newPhotos} foto baru`);
  return newActs;
}

// ===== Backfill OAuth ke store (aktivity tambahan) =====
async function fetchWeeklyActivities(store, weekStart) {
  const weekStartIso = weekStart.toISOString();
  let newActs = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`   oauth page ${page} (per_page=200)`);
    const acts = await stravaGet(`/clubs/${CLUB_ID}/activities?page=${page}&per_page=200`);
    if (!acts || !acts.length) { console.log(`   page ${page}: kosong, berhenti`); break; }

    let pageHasRecent = false;

    for (const a of acts) {
      const isRun = a.sport_type === "Run" || a.sport_type === "VirtualRun" || a.type === "Run" || a.type === "VirtualRun";
      if (!isRun) continue;
      if (!a.start_date || a.start_date < weekStartIso) continue;
      pageHasRecent = true;
      if (store.activities[a.id]) continue;

      store.activities[a.id] = {
        id: a.id,
        athlete: display(a.athlete),
        athleteId: a.athlete?.id || null,
        startDate: a.start_date,
        type: a.type,
        distance_km: +((a.distance || 0) / 1000).toFixed(2),
        moving_time_sec: a.moving_time || 0,
        distance_m: a.distance || 0,
      };
      newActs++;
    }

    if (!pageHasRecent) { console.log(`   page ${page}: semua sebelum Senin, berhenti`); break; }
  }

  return newActs;
}

function aggregateWeekly(store, photoMap, weekStart, weekEnd) {
  const startStr = toWIBNaive(weekStart);
  const endStr = toWIBNaive(weekEnd);
  const byAthlete = new Map();
  for (const a of Object.values(store.activities)) {
    let wib;
    try { wib = toWIBNaive(new Date(a.startDate)); } catch { continue; }
    if (wib < startStr || wib > endStr) continue;
    const key = nameKey(a.athlete) || a.athlete.toLowerCase();
    let en = byAthlete.get(key);
    if (!en) { en = { name: a.athlete, distance_km:0, moving_time_sec:0, activities:0 }; byAthlete.set(key, en); }
    en.distance_km += a.distance_km;
    en.moving_time_sec += a.moving_time_sec;
    en.activities += 1;
  }
  let list = Array.from(byAthlete.values()).map(e => ({
    name: e.name,
    distance_km: +e.distance_km.toFixed(2),
    moving_time_sec: e.moving_time_sec,
    moving_time: fmtDuration(e.moving_time_sec),
    pace: fmtPace(pacePerKm(e.distance_km*1000, e.moving_time_sec)),
    activities: e.activities,
    elev_m: 0,
  }));
  list.sort((a,b)=>b.distance_km-a.distance_km);
  list.forEach(e => { const k = nameKey(e.name); if (photoMap[k]) e.photo = photoMap[k].path; });
  return list.slice(0,10).map((e,i)=>({ rank:i+1, ...e }));
}

// ===== Fallback OAuth (tanpa cookie, tanpa tanggal) =====
async function fetchOAuthFallback() {
  console.log(">> Mode fallback OAuth (tanpa cookie, tanpa tanggal)");
  const byAthlete = new Map();
  let total = 0;
  for (let page=1; page<=MAX_PAGES; page++) {
    const acts = await stravaGet(`/clubs/${CLUB_ID}/activities?page=${page}&per_page=200`);
    if (!acts || !acts.length) break;
    for (const a of acts) {
      const isRun = a.sport_type==="Run"||a.sport_type==="VirtualRun"||a.type==="Run"||a.type==="VirtualRun";
      if (!isRun) continue;
      const id = uid(a.athlete);
      let en = byAthlete.get(id); if (!en){ en={name:display(a.athlete),distance:0,moving_time:0,activities:0,elev_gain:0}; byAthlete.set(id,en);} 
      en.distance += a.distance||0; en.moving_time += a.moving_time||0; en.activities+=1; en.elev_gain += a.total_elevation_gain||0; total++;
    }
  }
  const photoMap = loadPhotoMap();
  let list = Array.from(byAthlete.values()).map(e => {
    const k = nameKey(e.name);
    return { name:e.name, distance_km:+(e.distance/1000).toFixed(2), moving_time_sec:e.moving_time, moving_time:fmtDuration(e.moving_time), pace:fmtPace(pacePerKm(e.distance,e.moving_time)), activities:e.activities, elev_m:Math.round(e.elev_gain), photo: photoMap[k]?.path };
  });
  list.sort((a,b)=>b.distance_km-a.distance_km);
  return { list: list.slice(0,10).map((e,i)=>({rank:i+1,...e, photo:e.photo||undefined})), total, filter:"recent" };
}

async function main() {
  console.log(`>> Mode: ${USE_COOKIE ? "OAUTH (filter mingguan)" : "OAuth FALLBACK (recent)"}`);
  const { start, end } = getWeekRangeWIB();
  console.log(`>> Minggu (WIB): ${fmtDate(start)} → ${fmtDate(end)} (Senin s/d sekarang)`);

  const club = await stravaGet(`/clubs/${CLUB_ID}`);
  console.log(`   Club: ${club.name} (${club.member_count} anggota)`);
  const assetsDir = path.join(DATA_DIR, "assets");
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  await downloadAsset(club.profile, path.join(assetsDir,"logo.jpg"));
  await downloadAsset(club.cover_photo, path.join(assetsDir,"cover.jpg"));

  let leaderboard, filterMode, totalActs, totalAthletes;

  if (USE_COOKIE) {
    const store = { activities: {} };
    const photoMap = loadPhotoMap();

    // 1. Web feed: aktivitas + foto (minimal 20 entry, pasti ada)
    console.log(">> Ingest web feed (aktivitas + foto)...");
    const wfCount = await ingestWebFeed(store, photoMap, start);
    savePhotoMap(photoMap);

    // 2. OAuth backfill: lengkapi aktivitas yang terlewat
    console.log(">> OAuth backfill (jika token punya akses)...");
    const oaCount = await fetchWeeklyActivities(store, start);

    // 3. Simpan store (replace tiap run)
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
    const total = Object.keys(store.activities).length;
    console.log(`   Store: ${total} aktivitas (web feed: ${wfCount}, oauth: ${oaCount})`);

    // 4. Agregasi → data.json
    console.log(">> Agregasi mingguan (Senin → sekarang)...");
    leaderboard = aggregateWeekly(store, photoMap, start, end);
    filterMode = "weekly";
    totalActs = total;
    totalAthletes = leaderboard.length ? leaderboard.length : 0;
  } else {
    const fb = await fetchOAuthFallback();
    leaderboard = fb.list; filterMode = fb.filter; totalActs = fb.total; totalAthletes = leaderboard.length;
  }

  const payload = {
    generated_at: new Date().toISOString(),
    filter_mode: filterMode,
    club: { id:club.id, name:club.name, city:club.city, state:club.state, country:club.country, member_count:club.member_count, profile:"assets/logo.jpg", cover_photo:"assets/cover.jpg", url:club.url },
    week_start: fmtDate(start), week_end: fmtDate(end),
    metric: "distance",
    total_activities: totalActs,
    total_athletes: totalAthletes,
    leaderboard,
  };

  fs.writeFileSync(path.join(DATA_DIR,"data.json"), JSON.stringify(payload,null,2),"utf8");
  console.log(`✅ Tulis data/data.json | filter: ${filterMode} | atlet minggu ini: ${totalAthletes}`);
  leaderboard.forEach(t => console.log(`   ${t.rank}. ${t.name} — ${t.distance_km} km${t.photo?" 📸":""}`));
}

main().catch(e => { console.error("❌ Gagal:", e.message); process.exit(1); });
