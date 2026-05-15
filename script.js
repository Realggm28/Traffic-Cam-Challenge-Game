/*
  Over or Under: Traffic Cam Challenge
  GitHub Pages frontend-only build

  Important:
  - This is a game using game cash only.
  - No real money, payments, crypto, prizes, or wagering.
  - Camera visuals are not analyzed or stored in this version.
  - Vehicle counts use simulation mode so the game can run on GitHub Pages.
  - Replace getRoundResultFromSimulation() later with a real public-camera API or CV model.
*/

// ---------- Safe browser storage ----------
// Some preview tools run pages inside sandboxed iframes where localStorage is blocked.
// If localStorage throws, the game still works using memoryStorage.
const memoryStorage = new Map();

const storage = {
  get(key, fallback = null) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return memoryStorage.has(key) ? memoryStorage.get(key) : fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      memoryStorage.set(key, value);
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      memoryStorage.delete(key);
    }
  }
};

function readJSON(key, fallback) {
  try {
    return JSON.parse(storage.get(key, JSON.stringify(fallback)));
  } catch (error) {
    return fallback;
  }
}

function writeJSON(key, value) {
  storage.set(key, JSON.stringify(value));
}

// ---------- Game data ----------
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
const ROUND_SPEED_MULTIPLIER = 12; // 5 minutes becomes about 25 seconds in v1.

const IOWA_CAMERA_API = "https://data.iowa.gov/api/views/4bfg-n52x/rows.json?accessType=DOWNLOAD";

// Fallback data only appears if the public API cannot load. The actual camera list
// is loaded from Iowa DOT's public open-data API in loadPublicCameraApi().
let cameras = [
  {
    id: "loading",
    name: "Loading public cameras...",
    location: "Iowa DOT open data",
    difficulty: "Medium",
    preview: "",
    imageUrl: "",
    videoUrl: "",
    sourceLabel: "Public camera API",
    isPlaceholder: true
  }
];

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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function escapeHTML(text) {
  return String(text).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function saveState() {
  storage.set(STORAGE_KEYS.balance, String(state.balance));
  storage.set(STORAGE_KEYS.streak, String(state.streak));
  writeJSON(STORAGE_KEYS.achievements, state.achievements);
}

function showScreen(id) {
  $$(".screen").forEach((screen) => screen.classList.remove("active"));
  const target = $("#" + id);
  if (target) target.classList.add("active");
  renderSharedUI();
}

function renderSharedUI() {
  const balanceTop = $("#balanceTop");
  if (balanceTop) balanceTop.textContent = money(state.balance);
  renderLeaderboard();
  renderAchievements();
}


// ---------- Public traffic camera API ----------
async function loadPublicCameraApi() {
  const status = document.getElementById("cameraApiStatus");
  if (status) status.textContent = "Loading public camera API...";

  try {
    const response = await fetch(IOWA_CAMERA_API, { cache: "no-store" });
    if (!response.ok) throw new Error(`Camera API returned ${response.status}`);

    const payload = await response.json();
    const rows = normalizeSocrataRows(payload);
    const parsedCameras = rows
      .map(cameraFromApiRow)
      .filter((camera) => camera && (camera.imageUrl || camera.videoUrl))
      .slice(0, 18);

    if (!parsedCameras.length) throw new Error("No camera image/video URLs were found in the API data.");

    cameras = parsedCameras;
    state.selectedCamera = cameras[0];
    const continueButton = $("#continueToBet");
    if (continueButton) continueButton.disabled = false;
    renderCameras();
    if (status) status.textContent = `${cameras.length} public API cameras loaded. Video is used when the API provides it, otherwise live snapshots refresh automatically.`;
  } catch (error) {
    cameras = buildApiFallbackCameras(error.message);
    state.selectedCamera = cameras[0];
    const continueButton = $("#continueToBet");
    if (continueButton) continueButton.disabled = false;
    renderCameras();
    if (status) status.textContent = `Could not load the live camera API in this browser preview. ${error.message}`;
  }
}

function normalizeSocrataRows(payload) {
  if (!payload || !payload.meta || !payload.meta.view || !Array.isArray(payload.data)) return [];
  const columns = payload.meta.view.columns.map((column, index) => ({
    index,
    fieldName: column.fieldName || column.name || `field_${index}`,
    name: column.name || column.fieldName || `field_${index}`
  }));

  return payload.data.map((row) => {
    const object = {};
    columns.forEach((column) => {
      const value = row[column.index];
      object[column.fieldName] = value;
      object[column.name] = value;
    });
    return object;
  });
}

function cameraFromApiRow(row, index) {
  const imageUrl = findFieldValue(row, ["image url", "static image", "snapshot", "still image", "secure image"]);
  const videoUrl = findFieldValue(row, ["motion video", "video url", "stream", "m3u8", "mp4"]);
  const cameraName = findFieldValue(row, ["camera name", "name", "description", "location", "roadway", "route"]) || `Iowa DOT Camera ${index + 1}`;
  const location = findFieldValue(row, ["location", "roadway", "route", "city", "county"]) || "Iowa DOT public camera";
  const idValue = findFieldValue(row, ["id", "camera id", "objectid", "sid"]) || `iowa-camera-${index}`;

  if (!imageUrl && !videoUrl) return null;

  return {
    id: String(idValue).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || `iowa-camera-${index}`,
    name: cleanCameraText(cameraName),
    location: cleanCameraText(location),
    difficulty: difficultyFromIndex(index),
    preview: imageUrl || "",
    imageUrl: imageUrl || "",
    videoUrl: videoUrl || "",
    sourceLabel: videoUrl ? "Iowa DOT API video/snapshot" : "Iowa DOT API snapshot",
    apiSource: IOWA_CAMERA_API
  };
}

function coerceFieldValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    return value.url || value.href || value.description || value.name || value.value || "";
  }
  return String(value);
}

function findFieldValue(row, phrases) {
  const keys = Object.keys(row || {});
  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    const matched = phrases.some((phrase) => {
      const normalizedPhrase = normalizeKey(phrase);
      return normalizedKey.includes(normalizedPhrase) || normalizedPhrase.includes(normalizedKey);
    });
    const coerced = coerceFieldValue(row[key]);
    if (matched && isUsefulValue(coerced)) return coerced;
  }

  // Looser URL fallback: useful when a data portal has slightly different labels.
  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    const value = coerceFieldValue(row[key]);
    if (!isUsefulValue(value)) continue;
    if (String(value).startsWith("http") && phrases.some((phrase) => normalizeKey(phrase).includes("video")) && /(m3u8|mp4|video|motion)/i.test(key + " " + value)) return value;
    if (String(value).startsWith("http") && phrases.some((phrase) => normalizeKey(phrase).includes("image")) && /(jpg|jpeg|png|image|snapshot|camera)/i.test(key + " " + value)) return value;
  }

  return "";
}

function normalizeKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isUsefulValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function cleanCameraText(value) {
  return String(value || "Public Camera").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
}

function difficultyFromIndex(index) {
  return ["Easy", "Medium", "Hard", "Wild"][index % 4];
}

function buildApiFallbackCameras(reason) {
  // These are intentionally not pretending to be live feeds. They explain that the
  // preview environment blocked the public API and keep the rest of the game usable.
  return [
    {
      id: "api-fallback",
      name: "Public API unavailable in preview",
      location: reason || "Try from GitHub Pages or a normal browser tab",
      difficulty: "Medium",
      preview: "",
      imageUrl: "",
      videoUrl: "",
      sourceLabel: "API fallback",
      apiSource: IOWA_CAMERA_API,
      isFallback: true
    }
  ];
}

function cameraImageWithCacheBust(url) {
  if (!url) return "";
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}trafficGameRefresh=${Date.now()}`;
}

function canPlayAsNativeVideo(url) {
  return /\.(mp4|webm)(\?|$)/i.test(url || "") || /m3u8(\?|$)/i.test(url || "");
}

// ---------- Camera selection ----------
function renderCameras() {
  const grid = $("#cameraGrid");
  if (!grid) return;

  grid.innerHTML = cameras.map((camera) => {
    const previewMarkup = camera.preview
      ? `<img src="${escapeHTML(cameraImageWithCacheBust(camera.preview))}" alt="${escapeHTML(camera.name)} traffic camera preview" />`
      : `<div class="api-placeholder">API</div>`;
    const badgeText = camera.videoUrl ? "API VIDEO" : camera.imageUrl ? "API SNAPSHOT" : "API STATUS";

    return `
      <button class="camera-card ${state.selectedCamera && state.selectedCamera.id === camera.id ? "selected" : ""}" data-camera="${escapeHTML(camera.id)}">
        <div class="camera-preview">
          ${previewMarkup}
          <span class="live-badge">${badgeText}</span>
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

// ---------- Predictions ----------
function createPrediction(isDaily = false) {
  const category = isDaily
    ? categories[new Date().getDate() % categories.length]
    : categories[Math.floor(Math.random() * categories.length)];

  const durations = [180, 300, 600];
  const duration = isDaily ? 300 : durations[Math.floor(Math.random() * durations.length)];
  const expected = category.baseRate * (duration / 60);
  const target = Math.max(1, Math.round(expected * (0.75 + Math.random() * 0.7)));

  state.currentPrediction = { category, duration, target, isDaily };
  state.selectedChoice = null;
  renderPrediction();
}

function renderPrediction() {
  const prediction = state.currentPrediction;
  if (!prediction) return;

  $("#predictionText").textContent = `Over or under ${prediction.target} ${prediction.category.label} in the next ${Math.round(prediction.duration / 60)} minutes?`;
  $("#predictionMeta").textContent = `${state.selectedCamera ? state.selectedCamera.name : "Selected camera"} · ${prediction.isDaily ? "Daily challenge" : "Random challenge"} · Simulation mode`;
  $$(".choice-btn").forEach((button) => button.classList.remove("selected"));
}

// ---------- Live feed display ----------
function renderCameraFeed(container) {
  if (!container) return;
  const camera = state.selectedCamera || cameras[0];
  const hasVideo = camera.videoUrl && canPlayAsNativeVideo(camera.videoUrl);
  const hasSnapshot = Boolean(camera.imageUrl);

  let mediaMarkup = "";
  if (hasVideo) {
    mediaMarkup = `
      <video class="traffic-video" src="${escapeHTML(camera.videoUrl)}" autoplay muted playsinline controls></video>
    `;
  } else if (hasSnapshot) {
    mediaMarkup = `
      <img id="liveSnapshot" src="${escapeHTML(cameraImageWithCacheBust(camera.imageUrl))}" alt="${escapeHTML(camera.name)} live traffic camera snapshot" />
    `;
  } else {
    mediaMarkup = `
      <div class="api-placeholder large">Public camera API did not return a playable feed in this preview.</div>
    `;
  }

  container.innerHTML = `
    <div class="camera-preview live-frame-wrap">
      ${mediaMarkup}
      <span class="live-badge">${hasVideo ? "PUBLIC API VIDEO" : hasSnapshot ? "PUBLIC API SNAPSHOT" : "API FALLBACK"}</span>
      <div class="scanline"></div>
    </div>
    <div class="feed-actions">
      <span>${escapeHTML(camera.sourceLabel || "Public camera API")}</span>
      ${camera.apiSource ? `<a href="${escapeHTML(camera.apiSource)}" target="_blank" rel="noopener noreferrer">View API JSON</a>` : ""}
    </div>
  `;

  // Snapshot URLs are refreshed during the round. This gives a live-feed feeling
  // without storing or analyzing frames. Many public DOT APIs provide snapshots
  // rather than browser-playable HLS video.
  if (hasSnapshot && !hasVideo) {
    if (state.snapshotTimer) clearInterval(state.snapshotTimer);
    state.snapshotTimer = setInterval(() => {
      const image = document.getElementById("liveSnapshot");
      if (image) image.src = cameraImageWithCacheBust(camera.imageUrl);
    }, 5000);
  }
}

// ---------- Round logic ----------
function getRiskMultiplier() {
  const select = $("#riskLevel");
  const value = select ? select.value : "normal";
  return { safe: 1.2, normal: 1.8, wild: 2.8 }[value] || 1.8;
}

function startRound() {
  const riskInput = $("#riskAmount");
  const risk = Math.floor(Number(riskInput ? riskInput.value : 250));

  if (!state.currentPrediction) createPrediction();
  if (!state.selectedChoice) return alert("Pick Over or Under first.");
  if (!Number.isFinite(risk) || risk < 10) return alert("Play at least $10 game cash.");
  if (risk > state.balance) return alert("You cannot play more game cash than your balance.");

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
    state.liveCount = Math.min(
      state.finalCount,
      Math.round(state.finalCount * progress + Math.random() * 0.7)
    );
    updateTimerUI();

    if (state.elapsed >= state.roundSeconds) finishRound(risk);
  }, 1000);
}

function updateTimerUI() {
  const remaining = Math.max(0, state.roundSeconds - state.elapsed);
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  const percent = state.roundSeconds > 0 ? Math.min(100, (state.elapsed / state.roundSeconds) * 100) : 0;

  $("#timerText").textContent = `${minutes}:${seconds}`;
  $("#timerProgress").style.width = `${percent}%`;
  $("#liveCount").textContent = state.liveCount;
}

function getRoundResultFromSimulation(prediction) {
  const cameraDifficultyBoost = {
    Easy: 0.85,
    Medium: 1,
    Hard: 1.18,
    Wild: 1.35
  }[state.selectedCamera ? state.selectedCamera.difficulty : "Medium"] || 1;

  const expected = prediction.category.baseRate * (prediction.duration / 60) * cameraDifficultyBoost;
  const variance = Math.max(1, expected * 0.45);
  const value = Math.round(expected + randomNormal() * variance);
  return Math.max(0, value);
}

function randomNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function finishRound(risk) {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.liveCount = state.finalCount;

  const prediction = state.currentPrediction;
  const isOver = state.finalCount > prediction.target;
  const playerWon =
    (state.selectedChoice === "over" && isOver) ||
    (state.selectedChoice === "under" && !isOver);

  const winnings = playerWon ? Math.round(risk * getRiskMultiplier()) : -risk;
  state.balance = Math.max(0, state.balance + winnings);
  state.streak = playerWon ? state.streak + 1 : 0;

  const earnedBadges = [];
  if (playerWon) earnedBadges.push(unlockAchievement("first_win"));
  if (state.streak >= 3) earnedBadges.push(unlockAchievement("hot_streak"));
  if (risk >= 1000) earnedBadges.push(unlockAchievement("big_risk"));
  if (state.balance >= 10000) earnedBadges.push(unlockAchievement("high_roller"));
  if (prediction.isDaily) earnedBadges.push(unlockAchievement("daily_done"));

  updateLeaderboard();
  saveState();

  $("#resultHeadline").textContent = playerWon ? "You called it!" : "Traffic said nope.";
  $("#resultHeadline").style.color = playerWon ? "var(--success)" : "var(--danger)";
  $("#resultSummary").textContent = `You picked ${state.selectedChoice.toUpperCase()} ${prediction.target} ${prediction.category.label}. The final count was ${state.finalCount}.`;
  $("#finalCount").textContent = state.finalCount;
  $("#cashChange").textContent = `${winnings >= 0 ? "+" : ""}${money(winnings)}`;
  $("#streakValue").textContent = state.streak;
  $("#balanceResult").textContent = money(state.balance);
  $("#badgeRow").innerHTML = earnedBadges.filter(Boolean).map((badge) => `<span class="badge">${escapeHTML(badge.name)}</span>`).join("");

  createPrediction(prediction.isDaily);
  showScreen("results");
  playSound(playerWon ? "win" : "lose");
}

// ---------- Achievements and leaderboard ----------
function unlockAchievement(id) {
  if (state.achievements.includes(id)) return null;
  state.achievements.push(id);
  return achievementsCatalog.find((achievement) => achievement.id === id) || null;
}

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
    ? leaderboard.map((entry, index) => `
      <div class="leader-item"><strong>#${index + 1} ${escapeHTML(entry.name)}</strong><span>${money(entry.balance)}</span></div>
    `).join("")
    : `<p class="fine-print">No scores yet. Be the first menace of the intersection.</p>`;
}

function renderAchievements() {
  const achievements = $("#achievements");
  if (!achievements) return;

  achievements.innerHTML = achievementsCatalog.map((achievement) => {
    const unlocked = state.achievements.includes(achievement.id);
    return `<div class="leader-item"><strong>${unlocked ? "✓" : "○"} ${escapeHTML(achievement.name)}</strong><span>${escapeHTML(achievement.description)}</span></div>`;
  }).join("");
}

// ---------- Settings ----------
function saveSettings() {
  const playerName = ($("#playerName").value || "Player").trim() || "Player";
  storage.set(STORAGE_KEYS.player, playerName);
  writeJSON(STORAGE_KEYS.settings, { sound: $("#soundToggle").value });
  renderSharedUI();
  alert("Settings saved.");
}

function loadSettings() {
  const playerInput = $("#playerName");
  const soundToggle = $("#soundToggle");
  if (playerInput) playerInput.value = storage.get(STORAGE_KEYS.player, "Player") || "Player";

  const settings = readJSON(STORAGE_KEYS.settings, { sound: "on" });
  if (soundToggle) soundToggle.value = settings.sound || "on";
}

function resetGame() {
  if (!confirm("Reset your game cash, streak, achievements, and leaderboard?")) return;

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

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.frequency.value = type === "win" ? 740 : 180;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.18);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (error) {
    // Sound is optional, so ignore audio errors in strict browser previews.
  }
}

// ---------- Event wiring ----------
function bindEvents() {
  $$('[data-screen]').forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.screen));
  });

  const continueToBet = $("#continueToBet");
  if (continueToBet) {
    continueToBet.addEventListener("click", () => {
      if (!state.selectedCamera) state.selectedCamera = cameras[0];
      createPrediction(false);
      showScreen("betting");
    });
  }

  $("#newPredictionBtn").addEventListener("click", () => createPrediction(false));
  $("#startRoundBtn").addEventListener("click", startRound);
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#resetGameBtn").addEventListener("click", resetGame);
  $("#playAgainBtn").addEventListener("click", () => createPrediction(state.currentPrediction ? state.currentPrediction.isDaily : false));

  $("#dailyChallengeBtn").addEventListener("click", () => {
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

  const closeTutorial = $("#closeTutorial");
  if (closeTutorial) {
    closeTutorial.addEventListener("click", () => {
      storage.set(STORAGE_KEYS.tutorialSeen, "yes");
      $("#tutorial").classList.remove("show");
    });
  }
}

function init() {
  bindEvents();
  loadSettings();
  renderCameras();
  renderSharedUI();
  loadPublicCameraApi();

  if (!storage.get(STORAGE_KEYS.tutorialSeen)) {
    setTimeout(() => {
      const tutorial = $("#tutorial");
      if (tutorial) tutorial.classList.add("show");
    }, 600);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
