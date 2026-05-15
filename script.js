/*
  Over or Under: Traffic Cam Challenge
  GitHub Pages frontend-only build

  V1 notes:
  - Uses game cash only. No real money, payments, crypto, prizes, or wagering.
  - Live camera media is pulled from public traffic-camera API data.
  - Vehicle counts are simulated. The game never analyzes, stores, or zooms into video frames.
  - To add real detection later, replace getRoundResultFromSimulation() with a CV/API module.
*/

// ---------- Safe browser storage ----------
const memoryStorage = new Map();
const storage = {
  get(key, fallback = null) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return memoryStorage.has(key) ? memoryStorage.get(key) : fallback;
    }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); }
    catch { memoryStorage.set(key, value); }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); }
    catch { memoryStorage.delete(key); }
  }
};

function readJSON(key, fallback) {
  try { return JSON.parse(storage.get(key, JSON.stringify(fallback))); }
  catch { return fallback; }
}
function writeJSON(key, value) { storage.set(key, JSON.stringify(value)); }

// ---------- Constants ----------
const STORAGE_KEYS = {
  balance: "trafficGame_balance",
  leaderboard: "trafficGame_leaderboard",
  player: "trafficGame_player",
  settings: "trafficGame_settings",
  tutorialSeen: "trafficGame_tutorialSeen",
  streak: "trafficGame_streak",
  achievements: "trafficGame_achievements"
};

const STARTING_BALANCE = 5000;
const ROUND_SPEED_MULTIPLIER = 12;

// Primary source: Maryland ArcGIS REST API. Its camera layer contains URL, CCTVPublicURL, and hlsurl fields.
const MARYLAND_CAMERA_API = "https://mdgeodata.md.gov/imap/rest/services/Transportation/MD_TrafficCameras/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json";

// Secondary source: Iowa open-data API. Some browsers/preview environments block it, so it is a fallback.
const IOWA_CAMERA_API = "https://data.iowa.gov/api/views/4bfg-n52x/rows.json?accessType=DOWNLOAD";

// Last-resort working examples from public 511LA API documentation samples.
// These are stream URLs shown inside the official API documentation response, not random website links.
const VERIFIED_PUBLIC_STREAMS = [
  {
    id: "la-sample-1",
    name: "I-20 at I-220 Off Ramp",
    location: "Louisiana DOTD public API sample",
    difficulty: "Medium",
    videoUrl: "https://ITSStreamingBR2.dotd.la.gov/public/shr-cam-030.streams/playlist.m3u8",
    imageUrl: "",
    sourceLabel: "511LA API sample HLS stream",
    apiSource: "https://511la.org/api/v2/get/cameras"
  },
  {
    id: "la-sample-2",
    name: "I-20 at Monkhouse Drive",
    location: "Louisiana DOTD public API sample",
    difficulty: "Medium",
    videoUrl: "https://ITSStreamingBR2.dotd.la.gov/public/shr-cam-002.streams/playlist.m3u8",
    imageUrl: "",
    sourceLabel: "511LA API sample HLS stream",
    apiSource: "https://511la.org/api/v2/get/cameras"
  }
];

let cameras = [];
let hlsPlayer = null;

const categories = [
  { key: "red cars", label: "red cars", baseRate: 2.9 },
  { key: "blue cars", label: "blue cars", baseRate: 2.4 },
  { key: "white cars", label: "white cars", baseRate: 4.3 },
  { key: "black cars", label: "black cars", baseRate: 3.6 },
  { key: "SUVs", label: "SUVs", baseRate: 3.2 },
  { key: "trucks", label: "trucks", baseRate: 1.8 },
  { key: "buses", label: "buses", baseRate: 0.9 },
  { key: "police cars", label: "police cars", baseRate: 0.25 },
  { key: "ambulances", label: "ambulances", baseRate: 0.18 },
  { key: "fire trucks", label: "fire trucks", baseRate: 0.12 }
];

const achievementsCatalog = [
  { id: "first_win", name: "First Win", description: "Win your first round." },
  { id: "hot_streak", name: "Hot Streak", description: "Reach a 3-round streak." },
  { id: "big_risk", name: "Big Risk", description: "Play at least $1,000 in one round." },
  { id: "high_roller", name: "High Roller", description: "Reach $10,000 game cash." },
  { id: "daily_done", name: "Daily Driver", description: "Play the daily challenge." }
];

const state = {
  balance: Number(storage.get(STORAGE_KEYS.balance, STARTING_BALANCE)) || STARTING_BALANCE,
  selectedCamera: null,
  currentPrediction: null,
  selectedChoice: null,
  timer: null,
  snapshotTimer: null,
  liveCount: 0,
  roundSeconds: 0,
  elapsed: 0,
  finalCount: 0,
  streak: Number(storage.get(STORAGE_KEYS.streak, 0)) || 0,
  achievements: readJSON(STORAGE_KEYS.achievements, [])
};

// ---------- Helpers ----------
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function escapeHTML(text) {
  return String(text ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

function saveState() {
  storage.set(STORAGE_KEYS.balance, String(state.balance));
  storage.set(STORAGE_KEYS.streak, String(state.streak));
  writeJSON(STORAGE_KEYS.achievements, state.achievements);
}

function showScreen(id) {
  $$(".screen").forEach((screen) => screen.classList.remove("active"));
  const screen = $("#" + id);
  if (screen) screen.classList.add("active");
  renderSharedUI();
}

function renderSharedUI() {
  const balanceTop = $("#balanceTop");
  if (balanceTop) balanceTop.textContent = money(state.balance);
  renderLeaderboard();
  renderAchievements();
}

function normalizeText(value) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function getField(object, names) {
  const entries = Object.entries(object || {});
  for (const name of names) {
    const found = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim() !== "") return found[1];
  }
  for (const name of names) {
    const found = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, "").includes(name.toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (found && found[1] !== null && found[1] !== undefined && String(found[1]).trim() !== "") return found[1];
  }
  return "";
}

function difficultyFromIndex(index) { return ["Easy", "Medium", "Hard", "Wild"][index % 4]; }
function cacheBust(url) { return url ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : ""; }
function isHls(url) { return /\.m3u8(\?|$)/i.test(url || ""); }
function isImage(url) { return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url || "") || /image|jpg|jpeg|snapshot/i.test(url || ""); }

// ---------- Public camera API loading ----------
async function loadPublicCameraApi() {
  const status = $("#cameraApiStatus");
  if (status) status.textContent = "Loading Maryland public camera API...";

  const sourcesTried = [];

  try {
    const maryland = await loadMarylandCameras();
    if (maryland.length) {
      cameras = maryland.slice(0, 24);
      finishCameraLoad(`${cameras.length} cameras loaded from the Maryland ArcGIS REST API. Live HLS streams are used when available.`);
      return;
    }
    sourcesTried.push("Maryland API returned no playable camera URLs");
  } catch (error) {
    sourcesTried.push(`Maryland API failed: ${error.message}`);
  }

  try {
    if (status) status.textContent = "Maryland API failed, trying Iowa open-data camera API...";
    const iowa = await loadIowaCameras();
    if (iowa.length) {
      cameras = iowa.slice(0, 24);
      finishCameraLoad(`${cameras.length} cameras loaded from Iowa open data. Snapshot feeds refresh during each round.`);
      return;
    }
    sourcesTried.push("Iowa API returned no playable camera URLs");
  } catch (error) {
    sourcesTried.push(`Iowa API failed: ${error.message}`);
  }

  cameras = VERIFIED_PUBLIC_STREAMS;
  finishCameraLoad(`Live API fetch was blocked in this preview, so loaded verified public HLS streams from official 511LA API documentation samples. ${sourcesTried.join(" | ")}`);
}

async function loadMarylandCameras() {
  const response = await fetch(MARYLAND_CAMERA_API, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const features = Array.isArray(payload.features) ? payload.features : [];

  return features.map((feature, index) => {
    const a = feature.attributes || {};
    const hls = String(getField(a, ["hlsurl", "hls_url", "HLSURL"]));
    const url = String(getField(a, ["CCTVPublicURL", "url", "URL", "public_url", "PublicURL"]));
    const name = normalizeText(getField(a, ["location", "Location", "description", "Description", "name", "Name"])) || `Maryland Traffic Camera ${index + 1}`;
    const id = normalizeText(getField(a, ["ID", "OBJECTID", "ObjectId", "id"])) || `md-${index}`;
    const imageUrl = isImage(url) ? url : "";
    const videoUrl = hls && isHls(hls) ? hls : (isHls(url) ? url : "");

    if (!videoUrl && !imageUrl) return null;
    return {
      id: `md-${String(id).replace(/[^a-z0-9_-]/gi, "-")}`,
      name,
      location: "Maryland CHART public camera",
      difficulty: difficultyFromIndex(index),
      videoUrl,
      imageUrl,
      sourceLabel: videoUrl ? "Maryland ArcGIS API HLS stream" : "Maryland ArcGIS API snapshot",
      apiSource: MARYLAND_CAMERA_API
    };
  }).filter(Boolean);
}

async function loadIowaCameras() {
  const response = await fetch(IOWA_CAMERA_API, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const rows = normalizeSocrataRows(payload);
  return rows.map((row, index) => {
    const imageUrl = String(getField(row, ["static image url", "image url", "image", "snapshot", "url"]));
    const videoUrl = String(getField(row, ["motion video url", "video url", "hlsurl", "stream"]));
    const name = normalizeText(getField(row, ["camera name", "name", "description", "location"])) || `Iowa Traffic Camera ${index + 1}`;
    if (!imageUrl && !videoUrl) return null;
    return {
      id: `ia-${index}`,
      name,
      location: "Iowa DOT public camera",
      difficulty: difficultyFromIndex(index),
      videoUrl: isHls(videoUrl) ? videoUrl : "",
      imageUrl: imageUrl && isImage(imageUrl) ? imageUrl : "",
      sourceLabel: videoUrl ? "Iowa open-data API video" : "Iowa open-data API snapshot",
      apiSource: IOWA_CAMERA_API
    };
  }).filter((camera) => camera.videoUrl || camera.imageUrl);
}

function normalizeSocrataRows(payload) {
  if (!payload?.meta?.view?.columns || !Array.isArray(payload.data)) return [];
  const columns = payload.meta.view.columns.map((column, index) => ({
    index,
    name: column.name || column.fieldName || `field_${index}`,
    fieldName: column.fieldName || column.name || `field_${index}`
  }));
  return payload.data.map((row) => {
    const object = {};
    for (const column of columns) {
      object[column.name] = row[column.index];
      object[column.fieldName] = row[column.index];
    }
    return object;
  });
}

function finishCameraLoad(message) {
  if (!state.selectedCamera || !cameras.some((camera) => camera.id === state.selectedCamera.id)) {
    state.selectedCamera = cameras[0] || null;
  }
  const continueButton = $("#continueToBet");
  if (continueButton) continueButton.disabled = !state.selectedCamera;
  const status = $("#cameraApiStatus");
  if (status) status.textContent = message;
  renderCameras();
}

// ---------- Camera selection ----------
function renderCameras() {
  const grid = $("#cameraGrid");
  if (!grid) return;

  if (!cameras.length) {
    grid.innerHTML = `<div class="api-placeholder large">Loading public traffic cameras...</div>`;
    return;
  }

  grid.innerHTML = cameras.map((camera) => {
    const selected = state.selectedCamera?.id === camera.id ? "selected" : "";
    const badge = camera.videoUrl ? "LIVE HLS" : "LIVE SNAPSHOT";
    const preview = camera.imageUrl
      ? `<img src="${escapeHTML(cacheBust(camera.imageUrl))}" alt="${escapeHTML(camera.name)} live traffic snapshot" loading="lazy" />`
      : `<div class="api-placeholder"><span>LIVE</span><small>API stream</small></div>`;

    return `
      <button class="camera-card ${selected}" data-camera="${escapeHTML(camera.id)}">
        <div class="camera-preview">
          ${preview}
          <span class="live-badge">${badge}</span>
        </div>
        <h3>${escapeHTML(camera.name)}</h3>
        <div class="camera-meta"><span>${escapeHTML(camera.location)}</span><span>${escapeHTML(camera.difficulty)}</span></div>
      </button>
    `;
  }).join("");

  $$('[data-camera]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCamera = cameras.find((camera) => camera.id === button.dataset.camera) || cameras[0];
      const continueButton = $("#continueToBet");
      if (continueButton) continueButton.disabled = false;
      renderCameras();
    });
  });
}

// ---------- Prediction cards ----------
function createPrediction(isDaily = false) {
  const category = isDaily ? categories[new Date().getDate() % categories.length] : categories[Math.floor(Math.random() * categories.length)];
  const durations = [180, 300, 600];
  const duration = isDaily ? 300 : durations[Math.floor(Math.random() * durations.length)];
  const expected = category.baseRate * (duration / 60);
  const target = Math.max(1, Math.round(expected * (0.75 + Math.random() * 0.7)));
  state.currentPrediction = { category, duration, target, isDaily };
  state.selectedChoice = null;
  renderPrediction();
}

function renderPrediction() {
  const p = state.currentPrediction;
  if (!p) return;
  $("#predictionText").textContent = `Over or under ${p.target} ${p.category.label} in the next ${Math.round(p.duration / 60)} minutes?`;
  $("#predictionMeta").textContent = `${state.selectedCamera?.name || "Selected camera"} · ${p.isDaily ? "Daily challenge" : "Random challenge"} · Simulation mode counts`;
  $$(".choice-btn").forEach((button) => button.classList.remove("selected"));
}

// ---------- Live media ----------
function stopLiveMedia() {
  if (state.snapshotTimer) clearInterval(state.snapshotTimer);
  state.snapshotTimer = null;
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
}

function renderCameraFeed(container) {
  if (!container) return;
  stopLiveMedia();
  const camera = state.selectedCamera || cameras[0];
  const mediaId = "liveMedia";

  const mediaMarkup = camera.videoUrl
    ? `<video id="${mediaId}" class="traffic-video" autoplay muted playsinline controls></video>`
    : camera.imageUrl
      ? `<img id="${mediaId}" class="traffic-video" src="${escapeHTML(cacheBust(camera.imageUrl))}" alt="${escapeHTML(camera.name)} live traffic snapshot" />`
      : `<div class="api-placeholder large">No playable public feed came back from the API.</div>`;

  container.innerHTML = `
    <div class="camera-preview live-frame-wrap">
      ${mediaMarkup}
      <span class="live-badge">${camera.videoUrl ? "PUBLIC API LIVE VIDEO" : "PUBLIC API SNAPSHOT"}</span>
      <div class="scanline"></div>
    </div>
    <div class="feed-actions">
      <span id="feedStatus">${escapeHTML(camera.sourceLabel || "Public camera API")}</span>
      <a href="${escapeHTML(camera.apiSource || MARYLAND_CAMERA_API)}" target="_blank" rel="noopener noreferrer">API source</a>
    </div>
  `;

  const media = document.getElementById(mediaId);
  const feedStatus = document.getElementById("feedStatus");

  if (camera.videoUrl && media?.tagName === "VIDEO") {
    loadHlsVideo(media, camera.videoUrl, feedStatus);
  }

  if (camera.imageUrl && media?.tagName === "IMG") {
    media.onerror = () => {
      if (feedStatus) feedStatus.textContent = "Snapshot did not load from this camera. Try another camera.";
    };
    state.snapshotTimer = setInterval(() => {
      const img = document.getElementById(mediaId);
      if (img) img.src = cacheBust(camera.imageUrl);
    }, 5000);
  }
}

function loadHlsVideo(video, url, statusElement) {
  const setStatus = (text) => { if (statusElement) statusElement.textContent = text; };

  video.onerror = () => setStatus("Video stream could not play in this browser. Try another API camera.");

  // Safari can play HLS natively. Chrome/Edge/Firefox need hls.js.
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    video.play().catch(() => setStatus("Click play to start the public API stream."));
    setStatus("Live HLS stream loaded from public camera API.");
    return;
  }

  if (window.Hls && window.Hls.isSupported()) {
    hlsPlayer = new window.Hls({ enableWorker: true, lowLatencyMode: true });
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(video);
    hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
      setStatus("Live HLS stream loaded from public camera API.");
      video.play().catch(() => setStatus("Click play to start the public API stream."));
    });
    hlsPlayer.on(window.Hls.Events.ERROR, (_, data) => {
      if (data.fatal) setStatus("This HLS stream failed. Pick another API camera.");
    });
    return;
  }

  setStatus("This browser needs hls.js to play HLS streams. Check the CDN script or try another browser.");
}

// ---------- Round logic ----------
function getRiskMultiplier() {
  return { safe: 1.2, normal: 1.8, wild: 2.8 }[$("#riskLevel")?.value || "normal"] || 1.8;
}

function startRound() {
  const risk = Math.floor(Number($("#riskAmount")?.value || 250));
  if (!state.currentPrediction) createPrediction();
  if (!state.selectedChoice) return alert("Pick Over or Under first.");
  if (!Number.isFinite(risk) || risk < 10) return alert("Play at least $10 game cash.");
  if (risk > state.balance) return alert("You cannot play more game cash than your balance.");
  if (!state.selectedCamera) return alert("Choose a camera first.");

  state.liveCount = 0;
  state.elapsed = 0;
  state.roundSeconds = Math.max(5, Math.ceil(state.currentPrediction.duration / ROUND_SPEED_MULTIPLIER));
  state.finalCount = getRoundResultFromSimulation(state.currentPrediction);

  renderCameraFeed($("#liveCameraShell"));
  $("#roundTitle").textContent = state.currentPrediction.category.label;
  $("#targetCount").textContent = state.currentPrediction.target;
  $("#yourPick").textContent = state.selectedChoice.toUpperCase();
  $("#riskLive").textContent = money(risk);
  showScreen("round");

  if (state.timer) clearInterval(state.timer);
  updateTimerUI();
  state.timer = setInterval(() => {
    state.elapsed += 1;
    const progress = Math.min(1, state.elapsed / state.roundSeconds);
    state.liveCount = Math.min(state.finalCount, Math.round(state.finalCount * progress + Math.random() * 0.7));
    updateTimerUI();
    if (state.elapsed >= state.roundSeconds) finishRound(risk);
  }, 1000);
}

function updateTimerUI() {
  const remaining = Math.max(0, state.roundSeconds - state.elapsed);
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  $("#timerText").textContent = `${minutes}:${seconds}`;
  $("#timerProgress").style.width = `${Math.min(100, (state.elapsed / state.roundSeconds) * 100)}%`;
  $("#liveCount").textContent = state.liveCount;
}

function getRoundResultFromSimulation(prediction) {
  const cameraBoost = { Easy: 0.85, Medium: 1, Hard: 1.18, Wild: 1.35 }[state.selectedCamera?.difficulty] || 1;
  const expected = prediction.category.baseRate * (prediction.duration / 60) * cameraBoost;
  const variance = Math.max(1, expected * 0.45);
  return Math.max(0, Math.round(expected + randomNormal() * variance));
}

function randomNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function finishRound(risk) {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  stopLiveMedia();
  state.liveCount = state.finalCount;

  const p = state.currentPrediction;
  const actualOver = state.finalCount > p.target;
  const playerWon = (state.selectedChoice === "over" && actualOver) || (state.selectedChoice === "under" && !actualOver);
  const change = playerWon ? Math.round(risk * getRiskMultiplier()) : -risk;
  state.balance = Math.max(0, state.balance + change);
  state.streak = playerWon ? state.streak + 1 : 0;

  const earned = [];
  if (playerWon) earned.push(unlockAchievement("first_win"));
  if (state.streak >= 3) earned.push(unlockAchievement("hot_streak"));
  if (risk >= 1000) earned.push(unlockAchievement("big_risk"));
  if (state.balance >= 10000) earned.push(unlockAchievement("high_roller"));
  if (p.isDaily) earned.push(unlockAchievement("daily_done"));

  updateLeaderboard();
  saveState();

  $("#resultHeadline").textContent = playerWon ? "you called it" : "traffic said nope";
  $("#resultHeadline").style.color = playerWon ? "var(--success)" : "var(--danger)";
  $("#resultSummary").textContent = `You picked ${state.selectedChoice.toUpperCase()} ${p.target} ${p.category.label}. The final simulated count was ${state.finalCount}.`;
  $("#finalCount").textContent = state.finalCount;
  $("#cashChange").textContent = `${change >= 0 ? "+" : ""}${money(change)}`;
  $("#streakValue").textContent = state.streak;
  $("#balanceResult").textContent = money(state.balance);
  $("#badgeRow").innerHTML = earned.filter(Boolean).map((badge) => `<span class="badge">${escapeHTML(badge.name)}</span>`).join("");

  createPrediction(p.isDaily);
  showScreen("results");
  playSound(playerWon ? "win" : "lose");
}

function unlockAchievement(id) {
  if (state.achievements.includes(id)) return null;
  state.achievements.push(id);
  return achievementsCatalog.find((achievement) => achievement.id === id) || null;
}

// ---------- Leaderboard and achievements ----------
function updateLeaderboard() {
  const name = storage.get(STORAGE_KEYS.player, "Player") || "Player";
  const leaderboard = readJSON(STORAGE_KEYS.leaderboard, []);
  leaderboard.push({ name, balance: state.balance, date: new Date().toLocaleDateString() });
  leaderboard.sort((a, b) => b.balance - a.balance);
  writeJSON(STORAGE_KEYS.leaderboard, leaderboard.slice(0, 8));
}

function renderLeaderboard() {
  const list = $("#leaderboardList");
  if (!list) return;
  const leaderboard = readJSON(STORAGE_KEYS.leaderboard, []);
  list.innerHTML = leaderboard.length
    ? leaderboard.map((entry, index) => `<div class="leader-item"><strong>#${index + 1} ${escapeHTML(entry.name)}</strong><span>${money(entry.balance)}</span></div>`).join("")
    : `<p class="fine-print">No scores yet. Be the first legend on the board.</p>`;
}

function renderAchievements() {
  const list = $("#achievements");
  if (!list) return;
  list.innerHTML = achievementsCatalog.map((achievement) => {
    const unlocked = state.achievements.includes(achievement.id);
    return `<div class="leader-item"><strong>${unlocked ? "✓" : "○"} ${escapeHTML(achievement.name)}</strong><span>${escapeHTML(achievement.description)}</span></div>`;
  }).join("");
}

// ---------- Settings ----------
function loadSettings() {
  const player = $("#playerName");
  if (player) player.value = storage.get(STORAGE_KEYS.player, "Player") || "Player";
  const settings = readJSON(STORAGE_KEYS.settings, { sound: "on" });
  const sound = $("#soundToggle");
  if (sound) sound.value = settings.sound || "on";
}

function saveSettings() {
  const playerName = ($("#playerName")?.value || "Player").trim() || "Player";
  storage.set(STORAGE_KEYS.player, playerName);
  writeJSON(STORAGE_KEYS.settings, { sound: $("#soundToggle")?.value || "on" });
  renderSharedUI();
  alert("Settings saved.");
}

function resetGame() {
  if (!confirm("Reset your cash, streak, achievements, and leaderboard?")) return;
  Object.values(STORAGE_KEYS).forEach((key) => storage.remove(key));
  state.balance = STARTING_BALANCE;
  state.streak = 0;
  state.achievements = [];
  loadSettings();
  renderSharedUI();
  showScreen("home");
}

function playSound(type) {
  const settings = readJSON(STORAGE_KEYS.settings, { sound: "on" });
  if (settings.sound !== "on") return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.frequency.value = type === "win" ? 740 : 180;
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.18);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.2);
}

// ---------- Events ----------
function bindEvents() {
  $$('[data-screen]').forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.screen)));
  $("#continueToBet")?.addEventListener("click", () => { createPrediction(false); showScreen("betting"); });
  $("#newPredictionBtn")?.addEventListener("click", () => createPrediction(false));
  $("#startRoundBtn")?.addEventListener("click", startRound);
  $("#saveSettingsBtn")?.addEventListener("click", saveSettings);
  $("#resetGameBtn")?.addEventListener("click", resetGame);
  $("#playAgainBtn")?.addEventListener("click", () => createPrediction(state.currentPrediction?.isDaily));
  $("#dailyChallengeBtn")?.addEventListener("click", () => {
    if (!cameras.length) return alert("Cameras are still loading. Try again in a second.");
    state.selectedCamera = cameras[new Date().getDate() % cameras.length];
    createPrediction(true);
    renderCameras();
    showScreen("betting");
  });
  $$(".choice-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChoice = button.dataset.choice;
      $$(".choice-btn").forEach((btn) => btn.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
  $("#closeTutorial")?.addEventListener("click", () => {
    storage.set(STORAGE_KEYS.tutorialSeen, "yes");
    $("#tutorial")?.classList.remove("show");
  });
}

function init() {
  bindEvents();
  loadSettings();
  renderSharedUI();
  renderCameras();
  loadPublicCameraApi();
  if (!storage.get(STORAGE_KEYS.tutorialSeen)) {
    setTimeout(() => $("#tutorial")?.classList.add("show"), 600);
  }
}

document.addEventListener("DOMContentLoaded", init);
