/*
  Over or Under: Traffic Cam Challenge
  Version 1: GitHub Pages frontend-only build

  Safety notes:
  - Game cash only.
  - No real gambling, payments, crypto, prizes, or wagering.
  - Camera visuals are not analyzed or stored in this version.
  - Do not identify people or license plates if adding real computer vision later.

  Developer note:
  The simulation logic is intentionally separated in simulateFinalCount().
  Later, you can replace it with a real detection function that returns counts
  from a public traffic camera API or an on-device computer vision model.
*/

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

// Rounds are sped up for the game demo. A 5-minute challenge plays in 25 seconds.
const ROUND_SPEED_MULTIPLIER = 12;

// Live sources are public traffic-camera/map pages. Some agencies block iframe embedding, so the game always shows an "Open live source" fallback link.
const cameras = [
  {
    id: "nyc511",
    name: "NYC 511 Camera Map",
    location: "New York City Area",
    difficulty: "Medium",
    preview: "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?auto=format&fit=crop&w=900&q=80",
    liveUrl: "https://511ny.org/cctv",
    sourceLabel: "511NY live cameras",
    feedType: "iframe"
  },
  {
    id: "nyctmc",
    name: "NYC Traffic Camera Map",
    location: "NYC DOT / TMC",
    difficulty: "Hard",
    preview: "https://images.unsplash.com/photo-1494522855154-9297ac14b55f?auto=format&fit=crop&w=900&q=80",
    liveUrl: "https://webcams.nyctmc.org/map",
    sourceLabel: "NYC TMC public map",
    feedType: "iframe"
  },
  {
    id: "njta",
    name: "NJ Turnpike Cameras",
    location: "New Jersey",
    difficulty: "Medium",
    preview: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80",
    liveUrl: "https://www.njta.gov/travel-resources/camera-list/",
    sourceLabel: "NJTA camera list",
    feedType: "iframe"
  },
  {
    id: "nysthruway87",
    name: "I-87 Thruway Cameras",
    location: "Lower Hudson Valley, NY",
    difficulty: "Easy",
    preview: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    liveUrl: "https://www.thruway.ny.gov/travelers/map/traveler-info/traffic-cameras/ny-i87n",
    sourceLabel: "NY Thruway cameras",
    feedType: "iframe"
  },
  {
    id: "iowa511",
    name: "Iowa DOT Cameras",
    location: "Iowa Statewide",
    difficulty: "Wild",
    preview: "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80",
    liveUrl: "https://www.511ia.org/list/cameras",
    sourceLabel: "Iowa 511 camera list",
    feedType: "iframe"
  },
  {
    id: "georgia511",
    name: "Georgia 511 Cameras",
    location: "Georgia Statewide",
    difficulty: "Easy",
    preview: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80",
    liveUrl: "https://511ga.org/cctv",
    sourceLabel: "Georgia 511 cameras",
    feedType: "iframe"
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

let state = {
  balance: Number(localStorage.getItem(STORAGE_KEYS.balance)) || STARTING_BALANCE,
  selectedCamera: null,
  currentPrediction: null,
  selectedChoice: null,
  timer: null,
  liveCount: 0,
  roundSeconds: 0,
  elapsed: 0,
  finalCount: 0,
  streak: Number(localStorage.getItem(STORAGE_KEYS.streak)) || 0,
  achievements: JSON.parse(localStorage.getItem(STORAGE_KEYS.achievements) || "[]")
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.balance, String(state.balance));
  localStorage.setItem(STORAGE_KEYS.streak, String(state.streak));
  localStorage.setItem(STORAGE_KEYS.achievements, JSON.stringify(state.achievements));
}

function showScreen(id) {
  $$(".screen").forEach((screen) => screen.classList.remove("active"));
  $("#" + id).classList.add("active");
  renderSharedUI();
}

function renderSharedUI() {
  $("#balanceTop").textContent = money(state.balance);
  renderLeaderboard();
  renderAchievements();
}

function renderCameras() {
  const grid = $("#cameraGrid");

  grid.innerHTML = cameras.map((camera) => `
    <button class="camera-card ${state.selectedCamera?.id === camera.id ? "selected" : ""}" data-camera="${camera.id}">
      <div class="camera-preview">
        <img src="${camera.preview}" alt="${camera.name} traffic camera preview" />
        <span class="live-badge">LIVE SOURCE</span>
      </div>
      <h3>${camera.name}</h3>
      <div class="camera-meta"><span>${camera.location}</span><span>${camera.difficulty}</span></div>
    </button>
  `).join("");

  $$('[data-camera]').forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCamera = cameras.find((camera) => camera.id === button.dataset.camera);
      $("#continueToBet").disabled = false;
      renderCameras();
    });
  });
}

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
  $("#predictionMeta").textContent = `${state.selectedCamera?.name || "Selected camera"} · ${prediction.isDaily ? "Daily challenge" : "Random challenge"} · Simulation mode`;
  $$(".choice-btn").forEach((button) => button.classList.remove("selected"));
}

function renderCameraFeed(container) {
  const camera = state.selectedCamera || cameras[0];
  const safeUrl = camera.liveUrl || camera.preview;

  if (camera.feedType === "iframe" && camera.liveUrl) {
    container.innerHTML = `
      <div class="camera-preview live-frame-wrap">
        <iframe
          src="${safeUrl}"
          title="${camera.name} public live traffic source"
          loading="lazy"
          referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        ></iframe>
        <span class="live-badge">LIVE FEED</span>
        <div class="scanline"></div>
      </div>
      <div class="feed-actions">
        <span>${camera.sourceLabel || "Public traffic source"}</span>
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open live source</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="camera-preview">
      <img src="${camera.preview}" alt="${camera.name} public traffic camera visual" />
      <span class="live-badge">LIVE SOURCE</span>
      <div class="scanline"></div>
    </div>
    <div class="feed-actions">
      <span>${camera.sourceLabel || "Public traffic source"}</span>
      ${camera.liveUrl ? `<a href="${camera.liveUrl}" target="_blank" rel="noopener noreferrer">Open live source</a>` : ""}
    </div>
  `;
}

function getRiskMultiplier() {
  return {
    safe: 1.2,
    normal: 1.8,
    wild: 2.8
  }[$("#riskLevel").value] || 1.8;
}

function startRound() {
  const risk = Math.floor(Number($("#riskAmount").value));

  if (!state.currentPrediction) createPrediction();
  if (!state.selectedChoice) return alert("Pick Over or Under first.");
  if (!Number.isFinite(risk) || risk < 10) return alert("Play at least $10 game cash.");
  if (risk > state.balance) return alert("You cannot play more game cash than your balance.");

  state.liveCount = 0;
  state.elapsed = 0;
  state.roundSeconds = Math.ceil(state.currentPrediction.duration / ROUND_SPEED_MULTIPLIER);
  state.finalCount = simulateFinalCount(state.currentPrediction);

  renderCameraFeed($("#liveCameraShell"));
  $("#roundTitle").textContent = state.currentPrediction.category.label;
  $("#targetCount").textContent = state.currentPrediction.target;
  $("#yourPick").textContent = state.selectedChoice.toUpperCase();
  $("#riskLive").textContent = money(risk);
  showScreen("round");

  if (state.timer) clearInterval(state.timer);
  updateTimerUI();

  state.timer = setInterval(() => {
    state.elapsed++;
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

  $("#timerText").textContent = `${minutes}:${seconds}`;
  $("#timerProgress").style.width = `${Math.min(100, (state.elapsed / state.roundSeconds) * 100)}%`;
  $("#liveCount").textContent = state.liveCount;
}

// Main simulation hook. Replace this function later with a real detection result.
function simulateFinalCount(prediction) {
  const cameraDifficultyBoost = {
    Easy: 0.85,
    Medium: 1,
    Hard: 1.18,
    Wild: 1.35
  }[state.selectedCamera?.difficulty] || 1;

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
  clearInterval(state.timer);
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

  $("#resultHeadline").textContent = playerWon ? "You called it!" : "Oof, traffic said nope.";
  $("#resultHeadline").style.color = playerWon ? "var(--success)" : "var(--danger)";
  $("#resultSummary").textContent = `You picked ${state.selectedChoice.toUpperCase()} ${prediction.target} ${prediction.category.label}. The final count was ${state.finalCount}.`;
  $("#finalCount").textContent = state.finalCount;
  $("#cashChange").textContent = `${winnings >= 0 ? "+" : ""}${money(winnings)}`;
  $("#streakValue").textContent = state.streak;
  $("#balanceResult").textContent = money(state.balance);
  $("#badgeRow").innerHTML = earnedBadges
    .filter(Boolean)
    .map((badge) => `<span class="badge">🏅 ${badge.name}</span>`)
    .join("");

  createPrediction(prediction.isDaily);
  showScreen("results");
  playSound(playerWon ? "win" : "lose");
}

function unlockAchievement(id) {
  if (state.achievements.includes(id)) return null;

  state.achievements.push(id);
  return achievementsCatalog.find((achievement) => achievement.id === id);
}

function updateLeaderboard() {
  const name = localStorage.getItem(STORAGE_KEYS.player) || "Player";
  const leaderboard = JSON.parse(localStorage.getItem(STORAGE_KEYS.leaderboard) || "[]");

  leaderboard.push({
    name,
    balance: state.balance,
    date: new Date().toLocaleDateString()
  });

  leaderboard.sort((a, b) => b.balance - a.balance);
  localStorage.setItem(STORAGE_KEYS.leaderboard, JSON.stringify(leaderboard.slice(0, 8)));
}

function renderLeaderboard() {
  const leaderboard = JSON.parse(localStorage.getItem(STORAGE_KEYS.leaderboard) || "[]");

  $("#leaderboardList").innerHTML = leaderboard.length
    ? leaderboard.map((entry, index) => `
      <div class="leader-item"><strong>#${index + 1} ${entry.name}</strong><span>${money(entry.balance)}</span></div>
    `).join("")
    : `<p class="fine-print">No scores yet. Be the first menace of the intersection.</p>`;
}

function renderAchievements() {
  $("#achievements").innerHTML = achievementsCatalog.map((achievement) => {
    const unlocked = state.achievements.includes(achievement.id);
    return `<div class="leader-item"><strong>${unlocked ? "✅" : "🔒"} ${achievement.name}</strong><span>${achievement.description}</span></div>`;
  }).join("");
}

function saveSettings() {
  const playerName = $("#playerName").value.trim() || "Player";

  localStorage.setItem(STORAGE_KEYS.player, playerName);
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
    sound: $("#soundToggle").value
  }));

  renderSharedUI();
  alert("Settings saved.");
}

function loadSettings() {
  $("#playerName").value = localStorage.getItem(STORAGE_KEYS.player) || "Player";

  const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{"sound":"on"}');
  $("#soundToggle").value = settings.sound || "on";
}

function resetGame() {
  if (!confirm("Reset your game cash, streak, achievements, and leaderboard?")) return;

  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  state.balance = STARTING_BALANCE;
  state.streak = 0;
  state.achievements = [];

  loadSettings();
  renderSharedUI();
  showScreen("home");
}

function playSound(type) {
  const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{"sound":"on"}');
  if (settings.sound !== "on") return;

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
  $$('[data-screen]').forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.screen));
  });

  $("#continueToBet").addEventListener("click", () => {
    createPrediction(false);
    showScreen("betting");
  });

  $("#newPredictionBtn").addEventListener("click", () => createPrediction(false));
  $("#startRoundBtn").addEventListener("click", startRound);
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#resetGameBtn").addEventListener("click", resetGame);
  $("#playAgainBtn").addEventListener("click", () => createPrediction(state.currentPrediction?.isDaily));

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

  $("#closeTutorial").addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEYS.tutorialSeen, "yes");
    $("#tutorial").classList.remove("show");
  });
}

function init() {
  bindEvents();
  loadSettings();
  renderCameras();
  renderSharedUI();

  if (!localStorage.getItem(STORAGE_KEYS.tutorialSeen)) {
    setTimeout(() => $("#tutorial").classList.add("show"), 600);
  }
}

init();
