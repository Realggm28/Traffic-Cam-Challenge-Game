// Over or Under: Traffic Cam Challenge
// Static GitHub Pages version. Recorded clips + transparent review simulation.
// Important: this is NOT real computer vision yet. The green/red boxes are simulated review events.

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
const MAX_LOG_ITEMS = 16;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 16;
let hoursInterval = null;

const storage = {
  get(key, fallback = "") {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }
};

function readJSON(key, fallback) {
  try { return JSON.parse(storage.get(key, JSON.stringify(fallback))); } catch { return fallback; }
}

function writeJSON(key, value) {
  storage.set(key, JSON.stringify(value));
}

const recordedClips = [
  {
    id: "street-traffic",
    name: "Street Traffic",
    location: "Wikimedia Commons recorded clip",
    difficulty: "Medium",
    videoUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Street_traffic.webm",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Street_traffic.webm",
    sourceLabel: "Recorded road traffic clip"
  },
  {
    id: "cars-night",
    name: "Cars Passing by at Night",
    location: "Cologne, Germany recorded clip",
    difficulty: "Easy",
    videoUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cars_Passing_by_at_Night.webm",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Cars_Passing_by_at_Night.webm",
    sourceLabel: "Recorded night traffic clip"
  },
  {
    id: "bridge-night",
    name: "Traffic on Bridge at Night",
    location: "Golden Gate Bridge recorded clip",
    difficulty: "Hard",
    videoUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Traffic_on_bridge_at_night.webm",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Traffic_on_bridge_at_night.webm",
    sourceLabel: "Recorded bridge traffic clip"
  },
  {
    id: "motorway-a40",
    name: "Motorway A40",
    location: "Bridge view recorded clip",
    difficulty: "Medium",
    videoUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Motorway_A40_-_on_bridge_above_the_traffic.webm",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Motorway_A40_-_on_bridge_above_the_traffic.webm",
    sourceLabel: "Recorded motorway traffic clip"
  },
  {
    id: "chicago-corner",
    name: "Madison and State Streets",
    location: "Chicago recorded clip",
    difficulty: "Wild",
    videoUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Corner_Madison_and_State_streets,_Chicago_-.webm",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Corner_Madison_and_State_streets,_Chicago_-.webm",
    sourceLabel: "Recorded city intersection clip"
  },
  {
    id: "traffic-flow-ui",
    name: "Traffic Flow in Front of UI",
    location: "Recorded traffic flow clip",
    difficulty: "Hard",
    videoUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Traffic_flow_in_front_of_UI_.webm",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Traffic_flow_in_front_of_UI_.webm",
    sourceLabel: "Recorded traffic flow clip"
  }
];

const categories = [
  { key: "red cars", label: "red cars", baseRate: 2.9, matchTypes: ["red car"] },
  { key: "blue cars", label: "blue cars", baseRate: 2.4, matchTypes: ["blue car"] },
  { key: "white cars", label: "white cars", baseRate: 4.3, matchTypes: ["white car"] },
  { key: "black cars", label: "black cars", baseRate: 3.6, matchTypes: ["black car"] },
  { key: "SUVs", label: "SUVs", baseRate: 3.2, matchTypes: ["SUV"] },
  { key: "trucks", label: "trucks", baseRate: 1.8, matchTypes: ["truck"] },
  { key: "buses", label: "buses", baseRate: 0.9, matchTypes: ["bus"] },
  { key: "police cars", label: "police cars", baseRate: 0.25, matchTypes: ["police car"] },
  { key: "ambulances", label: "ambulances", baseRate: 0.18, matchTypes: ["ambulance"] },
  { key: "fire trucks", label: "fire trucks", baseRate: 0.12, matchTypes: ["fire truck"] }
];

const objectTypes = [
  "red car", "blue car", "white car", "black car", "silver car", "SUV", "truck", "bus", "police car", "ambulance", "fire truck"
];

const achievementsCatalog = [
  { id: "first_win", name: "First Win", description: "Win your first round." },
  { id: "hot_streak", name: "Hot Streak", description: "Reach a 3-round streak." },
  { id: "big_risk", name: "Big Risk", description: "Play at least $1,000 in one round." },
  { id: "high_roller", name: "High Roller", description: "Reach $10,000 game cash." },
  { id: "daily_done", name: "Daily Driver", description: "Play the daily challenge." },
  { id: "reviewer", name: "Reviewer", description: "Use the emergency override once." }
];

const state = {
  balance: Number(storage.get(STORAGE_KEYS.balance, STARTING_BALANCE)) || STARTING_BALANCE,
  selectedCamera: recordedClips[0],
  currentPrediction: null,
  selectedChoice: null,
  timer: null,
  liveCount: 0,
  roundSeconds: 0,
  elapsed: 0,
  finalCount: 0,
  rawFinalCount: 0,
  overrideDelta: 0,
  overrideUsed: false,
  eventSchedule: [],
  eventCursor: 0,
  streak: Number(storage.get(STORAGE_KEYS.streak, 0)) || 0,
  achievements: readJSON(STORAGE_KEYS.achievements, [])
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function isWithinPlayableHours(date = new Date()) {
  const hour = date.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getNextOpenDate(now = new Date()) {
  const next = new Date(now);
  next.setHours(OPEN_HOUR, 0, 0, 0);
  if (now.getHours() >= CLOSE_HOUR) next.setDate(next.getDate() + 1);
  return next;
}

function enforcePlayableHours() {
  const now = new Date();
  const open = isWithinPlayableHours(now);
  document.body.classList.toggle("closed-hours", !open);

  const hoursCard = $("#hoursCard");
  if (hoursCard) {
    hoursCard.classList.toggle("closed", !open);
    hoursCard.textContent = open ? "Open until 4:00 PM" : "Closed until 8:00 AM";
  }

  const currentTimeLabel = $("#currentTimeLabel");
  if (currentTimeLabel) currentTimeLabel.textContent = formatTime(now);

  const opensAtLabel = $("#opensAtLabel");
  if (opensAtLabel) opensAtLabel.textContent = formatTime(getNextOpenDate(now));

  const closedMessage = $("#closedMessage");
  if (closedMessage) closedMessage.textContent = "This game is playable from 8:00 AM to 4:00 PM local time.";

  if (!open) {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    const video = $("#trafficVideo");
    if (video) video.pause();

    const activeScreen = $(".screen.active");
    if (activeScreen && !["home", "settings"].includes(activeScreen.id)) {
      $$(".screen").forEach((screen) => screen.classList.remove("active"));
      $("#home")?.classList.add("active");
    }
  }

  return open;
}

function requirePlayableHours() {
  return enforcePlayableHours();
}

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

function renderSharedUI() {
  const balanceTop = $("#balanceTop");
  if (balanceTop) balanceTop.textContent = money(state.balance);
  renderLeaderboard();
  renderAchievements();
}

function showScreen(id) {
  enforcePlayableHours();
  if (!isWithinPlayableHours() && id !== "home" && id !== "settings") return;
  $$(".screen").forEach((screen) => screen.classList.remove("active"));
  const screen = $("#" + id);
  if (screen) screen.classList.add("active");
  renderSharedUI();
}

function renderCameras() {
  const grid = $("#cameraGrid");
  if (!grid) return;

  grid.innerHTML = recordedClips.map((clip) => {
    const selected = state.selectedCamera?.id === clip.id ? "selected" : "";
    return `
      <button class="camera-card ${selected}" data-camera="${escapeHTML(clip.id)}">
        <div class="camera-preview">
          <video muted playsinline preload="metadata" src="${escapeHTML(clip.videoUrl)}"></video>
          <span class="live-badge">RECORDED</span>
        </div>
        <h3>${escapeHTML(clip.name)}</h3>
        <div class="camera-meta"><span>${escapeHTML(clip.location)}</span><span>${escapeHTML(clip.difficulty)}</span></div>
      </button>
    `;
  }).join("");

  $$('[data-camera]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCamera = recordedClips.find((clip) => clip.id === button.dataset.camera) || recordedClips[0];
      const continueButton = $("#continueToBet");
      if (continueButton) continueButton.disabled = false;
      renderCameras();
    });
  });

  const continueButton = $("#continueToBet");
  if (continueButton) continueButton.disabled = !state.selectedCamera;
}

function createPrediction(isDaily = false) {
  const category = isDaily ? categories[new Date().getDate() % categories.length] : categories[Math.floor(Math.random() * categories.length)];
  const durations = [180, 300, 600];
  const duration = isDaily ? 300 : durations[Math.floor(Math.random() * durations.length)];
  const expected = category.baseRate * (duration / 60);
  const target = Math.max(1, Math.round(expected * (0.78 + Math.random() * 0.62)));
  state.currentPrediction = { category, duration, target, isDaily };
  state.selectedChoice = null;
  renderPrediction();
}

function renderPrediction() {
  const p = state.currentPrediction;
  if (!p) return;
  $("#predictionText").textContent = `Over or under ${p.target} ${p.category.label} in the next ${Math.round(p.duration / 60)} minutes?`;
  $("#predictionMeta").textContent = `${state.selectedCamera?.name || "Selected clip"} · ${p.isDaily ? "Daily challenge" : "Random challenge"} · Review simulation`;
  $$(".choice-btn").forEach((button) => button.classList.remove("selected"));
}

function getRiskMultiplier() {
  return { safe: 1.2, normal: 1.8, wild: 2.8 }[$("#riskLevel")?.value || "normal"] || 1.8;
}

function startRound() {
  if (!requirePlayableHours()) return;
  const risk = Math.floor(Number($("#riskAmount")?.value || 250));
  if (!state.currentPrediction) createPrediction();
  if (!state.selectedChoice) return alert("Pick Over or Under first.");
  if (!Number.isFinite(risk) || risk < 10) return alert("Play at least $10 game cash.");
  if (risk > state.balance) return alert("You cannot play more game cash than your balance.");

  state.liveCount = 0;
  state.elapsed = 0;
  state.overrideDelta = 0;
  state.overrideUsed = false;
  state.eventCursor = 0;
  state.roundSeconds = Math.max(8, Math.ceil(state.currentPrediction.duration / ROUND_SPEED_MULTIPLIER));
  state.rawFinalCount = getRoundResultFromSimulation(state.currentPrediction);
  state.finalCount = state.rawFinalCount;
  state.eventSchedule = buildEventSchedule(state.currentPrediction, state.rawFinalCount, state.roundSeconds);

  renderCameraFeed($("#liveCameraShell"));
  clearEventLog();
  updateOverrideUI();
  $("#roundTitle").textContent = state.currentPrediction.category.label;
  $("#targetCount").textContent = state.currentPrediction.target;
  $("#yourPick").textContent = state.selectedChoice.toUpperCase();
  $("#riskLive").textContent = money(risk);
  showScreen("round");

  if (state.timer) clearInterval(state.timer);
  updateTimerUI();
  state.timer = setInterval(() => {
    state.elapsed += 1;
    revealEventsForSecond(state.elapsed);
    updateTimerUI();
    if (state.elapsed >= state.roundSeconds) finishRound(risk);
  }, 1000);
}

function renderCameraFeed(container) {
  if (!container) return;
  const clip = state.selectedCamera || recordedClips[0];
  container.innerHTML = `
    <div class="camera-preview live-frame-wrap">
      <video id="trafficVideo" class="traffic-video" autoplay muted playsinline controls loop src="${escapeHTML(clip.videoUrl)}"></video>
      <div id="detectionLayer" class="detection-layer"></div>
      <span class="live-badge">RECORDED CLIP</span>
      <div class="scanline"></div>
    </div>
    <div class="feed-actions">
      <span>${escapeHTML(clip.sourceLabel)}</span>
      <a href="${escapeHTML(clip.sourceUrl)}" target="_blank" rel="noopener noreferrer">clip source</a>
    </div>
  `;
  const video = $("#trafficVideo");
  if (video) {
    video.currentTime = 0;
    video.play().catch(() => {});
  }
}

function getRoundResultFromSimulation(prediction) {
  const difficultyBoost = { Easy: 0.82, Medium: 1, Hard: 1.2, Wild: 1.38 }[state.selectedCamera?.difficulty] || 1;
  const expected = prediction.category.baseRate * (prediction.duration / 60) * difficultyBoost;
  const variance = Math.max(1, expected * 0.38);
  return Math.max(0, Math.round(expected + randomNormal() * variance));
}

function buildEventSchedule(prediction, targetObjectCount, roundSeconds) {
  const schedule = [];
  const targetTypes = prediction.category.matchTypes;
  const distractorCount = Math.max(5, Math.round(targetObjectCount * 1.45 + 8));

  for (let i = 0; i < targetObjectCount; i++) {
    schedule.push(makeDetectionEvent(targetTypes[i % targetTypes.length], true, randomSecond(roundSeconds)));
  }

  for (let i = 0; i < distractorCount; i++) {
    schedule.push(makeDetectionEvent(getDistractorType(targetTypes), false, randomSecond(roundSeconds)));
  }

  return schedule.sort((a, b) => a.second - b.second || Number(b.isTarget) - Number(a.isTarget));
}

function makeDetectionEvent(type, isTarget, second) {
  return {
    type,
    isTarget,
    second,
    x: Math.floor(7 + Math.random() * 68),
    y: Math.floor(18 + Math.random() * 55),
    w: Math.floor(12 + Math.random() * 16),
    h: Math.floor(10 + Math.random() * 15)
  };
}

function getDistractorType(targetTypes) {
  const choices = objectTypes.filter((type) => !targetTypes.includes(type));
  return choices[Math.floor(Math.random() * choices.length)] || "silver car";
}

function randomSecond(roundSeconds) {
  return Math.max(1, Math.min(roundSeconds - 1, Math.floor(1 + Math.random() * (roundSeconds - 2))));
}

function revealEventsForSecond(second) {
  const due = [];
  while (state.eventCursor < state.eventSchedule.length && state.eventSchedule[state.eventCursor].second <= second) {
    due.push(state.eventSchedule[state.eventCursor]);
    state.eventCursor += 1;
  }

  for (const event of due) {
    showDetectionBox(event);
    addEventLog(event);
    if (event.isTarget) state.liveCount += 1;
  }
  state.finalCount = Math.max(0, state.rawFinalCount + state.overrideDelta);
}

function showDetectionBox(event) {
  const layer = $("#detectionLayer");
  if (!layer) return;
  const box = document.createElement("div");
  box.className = `detection-box ${event.isTarget ? "target" : "non-target"}`;
  box.style.left = `${event.x}%`;
  box.style.top = `${event.y}%`;
  box.style.width = `${event.w}%`;
  box.style.height = `${event.h}%`;
  box.innerHTML = `<span class="label">${escapeHTML(event.isTarget ? "counted " + event.type : "ignored " + event.type)}</span>`;
  layer.appendChild(box);
  setTimeout(() => box.remove(), 1350);
}

function addEventLog(event) {
  const log = $("#eventLog");
  if (!log) return;
  const row = document.createElement("div");
  row.className = `event-item ${event.isTarget ? "target" : "non-target"}`;
  row.innerHTML = `<span>${event.isTarget ? "COUNTED" : "IGNORED"}</span><strong>${escapeHTML(event.type)}</strong>`;
  log.prepend(row);
  while (log.children.length > MAX_LOG_ITEMS) log.lastElementChild.remove();
}

function clearEventLog() {
  const log = $("#eventLog");
  if (log) log.innerHTML = `<div class="event-item"><span>READY</span><strong>waiting for objects</strong></div>`;
}

function applyOverride(delta) {
  if (!state.timer) return;
  state.overrideUsed = true;
  state.overrideDelta += delta;
  state.finalCount = Math.max(0, state.rawFinalCount + state.overrideDelta);
  state.liveCount = Math.max(0, state.liveCount + delta);
  unlockAchievement("reviewer");
  updateOverrideUI();
  updateTimerUI();
  const log = $("#eventLog");
  if (log) {
    const row = document.createElement("div");
    row.className = "event-item";
    row.innerHTML = `<span>OVERRIDE</span><strong>${delta > 0 ? "+1" : "-1"} target</strong>`;
    log.prepend(row);
  }
}

function updateOverrideUI() {
  const status = $("#overrideStatus");
  if (!status) return;
  if (state.overrideUsed) {
    status.classList.add("used");
    status.textContent = `Override used. Manual adjustment: ${state.overrideDelta >= 0 ? "+" : ""}${state.overrideDelta}.`;
  } else {
    status.classList.remove("used");
    status.textContent = "No override used.";
  }
}

function updateTimerUI() {
  const remaining = Math.max(0, state.roundSeconds - state.elapsed);
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  $("#timerText").textContent = `${minutes}:${seconds}`;
  $("#timerProgress").style.width = `${Math.min(100, (state.elapsed / state.roundSeconds) * 100)}%`;
  $("#liveCount").textContent = Math.max(0, state.liveCount);
}

function finishRound(risk) {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.finalCount = Math.max(0, state.rawFinalCount + state.overrideDelta);

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
  if (state.overrideUsed) earned.push(unlockAchievement("reviewer"));

  updateLeaderboard(state.overrideUsed);
  saveState();

  $("#resultHeadline").textContent = playerWon ? "you called it" : "traffic said nope";
  $("#resultHeadline").style.color = playerWon ? "var(--success)" : "var(--danger)";
  $("#resultSummary").textContent = `You picked ${state.selectedChoice.toUpperCase()} ${p.target} ${p.category.label}. The final review count was ${state.finalCount}${state.overrideUsed ? " after an override adjustment" : ""}.`;
  $("#finalCount").textContent = state.finalCount;
  $("#cashChange").textContent = `${change >= 0 ? "+" : ""}${money(change)}`;
  $("#streakValue").textContent = state.streak;
  $("#balanceResult").textContent = money(state.balance);

  const badgeHTML = earned.filter(Boolean).map((badge) => `<span class="badge">${escapeHTML(badge.name)}</span>`).join("");
  const overrideHTML = state.overrideUsed ? `<span class="badge warning">override used</span>` : "";
  $("#badgeRow").innerHTML = badgeHTML + overrideHTML;

  createPrediction(p.isDaily);
  showScreen("results");
  playSound(playerWon ? "win" : "lose");
}

function randomNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function unlockAchievement(id) {
  if (state.achievements.includes(id)) return null;
  state.achievements.push(id);
  return achievementsCatalog.find((achievement) => achievement.id === id) || null;
}

function updateLeaderboard(assisted = false) {
  const name = storage.get(STORAGE_KEYS.player, "Player") || "Player";
  const leaderboard = readJSON(STORAGE_KEYS.leaderboard, []);
  leaderboard.push({ name, balance: state.balance, date: new Date().toLocaleDateString(), assisted });
  leaderboard.sort((a, b) => b.balance - a.balance);
  writeJSON(STORAGE_KEYS.leaderboard, leaderboard.slice(0, 8));
}

function renderLeaderboard() {
  const list = $("#leaderboardList");
  if (!list) return;
  const leaderboard = readJSON(STORAGE_KEYS.leaderboard, []);
  list.innerHTML = leaderboard.length
    ? leaderboard.map((entry, index) => `<div class="leader-item"><strong>#${index + 1} ${escapeHTML(entry.name)}${entry.assisted ? " ⚠" : ""}</strong><span>${money(entry.balance)}${entry.assisted ? " · override" : ""}</span></div>`).join("")
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

function bindEvents() {
  $$('[data-screen]').forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.screen)));
  $("#continueToBet")?.addEventListener("click", () => { createPrediction(false); showScreen("betting"); });
  $("#newPredictionBtn")?.addEventListener("click", () => createPrediction(false));
  $("#startRoundBtn")?.addEventListener("click", startRound);
  $("#saveSettingsBtn")?.addEventListener("click", saveSettings);
  $("#resetGameBtn")?.addEventListener("click", resetGame);
  $("#playAgainBtn")?.addEventListener("click", () => createPrediction(state.currentPrediction?.isDaily));
  $("#overrideAddBtn")?.addEventListener("click", () => applyOverride(1));
  $("#overrideRemoveBtn")?.addEventListener("click", () => applyOverride(-1));
  $("#dailyChallengeBtn")?.addEventListener("click", () => {
    state.selectedCamera = recordedClips[new Date().getDate() % recordedClips.length];
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
  renderCameras();
  renderSharedUI();
  enforcePlayableHours();
  if (hoursInterval) clearInterval(hoursInterval);
  hoursInterval = setInterval(enforcePlayableHours, 30000);
  if (!storage.get(STORAGE_KEYS.tutorialSeen)) {
    setTimeout(() => $("#tutorial")?.classList.add("show"), 600);
  }
}

document.addEventListener("DOMContentLoaded", init);
