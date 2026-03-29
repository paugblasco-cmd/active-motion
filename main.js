// main.js
// Nota: Para que la cámara funcione en móviles, sirve en localhost o sobre HTTPS.

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const startScreen = document.getElementById("start-screen");
const cameraScreen = document.getElementById("camera-screen");
const calibrationScreen = document.getElementById("calibration-screen");
const menuScreen = document.getElementById("menu-screen");
const gameHud = document.getElementById("game-hud");

const startBtn = document.getElementById("start-btn");
const cameraBtn = document.getElementById("camera-btn");
const calibrateBtn = document.getElementById("calibrate-btn");
const recalibrateBtn = document.getElementById("recalibrate-btn");
const backMenuBtn = document.getElementById("back-menu-btn");
const muteBtn = document.getElementById("mute-btn");

const cameraError = document.getElementById("camera-error");
const calibrationStatus = document.getElementById("calibration-status");

const scoreEl = document.getElementById("score");
const timerEl = document.getElementById("timer");
const gameNameEl = document.getElementById("game-name");
const feedbackEl = document.getElementById("feedback");

const sfxHit = document.getElementById("sfx-hit");
const sfxGood = document.getElementById("sfx-good");
const sfxCountdown = document.getElementById("sfx-countdown");
const sfxEnd = document.getElementById("sfx-end");

let detector = null;
let running = false;
let currentGame = null;
let score = 0;
let timeLeft = 30;
let timerInterval = null;
let animationFrameId = null;
let muted = false;

// Calibración
let calibrationPose = null;
let calibrated = false;

// Juegos
let targets = [];
let pathPoints = [];
let reactionCue = null;
let reactionActive = false;
let lastReactionTime = 0;

// Configuración de detección
const DETECTOR_CONFIG = {
  modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
};

// Utilidades de UI
function showScreen(screen) {
  [startScreen, cameraScreen, calibrationScreen, menuScreen].forEach(s => {
    s.classList.remove("active");
  });
  if (screen) screen.classList.add("active");
}

function showHud(show) {
  gameHud.classList.toggle("hidden", !show);
}

function playSfx(audio) {
  if (muted) return;
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function showFeedback(text, color = "#22d3ee") {
  feedbackEl.textContent = text;
  feedbackEl.style.color = color;
  feedbackEl.classList.remove("show");
  void feedbackEl.offsetWidth;
  feedbackEl.classList.add("show");
}

// Inicialización de cámara
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });
    video.srcObject = stream;
    await new Promise(resolve => {
      video.onloadedmetadata = () => resolve();
    });
    resizeCanvas();
    return true;
  } catch (err) {
    cameraError.textContent = "No se pudo acceder a la cámara. Revisa los permisos del navegador.";
    console.error(err);
    return false;
  }
}

function resizeCanvas() {
  const rect = video.getBoundingClientRect();
  overlay.width = rect.width * window.devicePixelRatio;
  overlay.height = rect.height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

window.addEventListener("resize", resizeCanvas);

// Inicialización del detector
async function initDetector() {
  if (detector) return;
  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: DETECTOR_CONFIG.modelType }
  );
}

// Calibración
async function startCalibration() {
  calibrationStatus.textContent = "Calibrando... Mantente quieto.";
  calibrated = false;
  calibrationPose = null;

  let samples = [];
  const sampleCount = 20;
  let collected = 0;

  const collect = async () => {
    if (!detector) return;
    const poses = await detector.estimatePoses(video, { flipHorizontal: true });
    if (poses && poses[0]) {
      samples.push(poses[0]);
      collected++;
    }
    if (collected < sampleCount) {
      setTimeout(collect, 80);
    } else {
      calibrationPose = averagePose(samples);
      calibrated = true;
      calibrationStatus.textContent = "Calibración completada. ¡Listo!";
      showScreen(menuScreen);
    }
  };

  collect();
}

function averagePose(poses) {
  if (!poses.length) return null;
  const keypointsCount = poses[0].keypoints.length;
  const avgKeypoints = [];
  for (let i = 0; i < keypointsCount; i++) {
    let x = 0, y = 0, score = 0;
    poses.forEach(p => {
      x += p.keypoints[i].x;
      y += p.keypoints[i].y;
      score += p.keypoints[i].score || 0;
    });
    avgKeypoints.push({
      name: poses[0].keypoints[i].name,
      x: x / poses.length,
      y: y / poses.length,
      score: score / poses.length
    });
  }
  return { keypoints: avgKeypoints };
}

// Dibujo de esqueleto
function drawSkeleton(pose) {
  if (!pose || !pose.keypoints) return;
  const kp = pose.keypoints;

  ctx.lineWidth = 4;
  ctx.lineCap = "round";

  const find = name => kp.find(k => k.name === name);

  const connections = [
    ["left_shoulder", "right_shoulder"],
    ["left_shoulder", "left_elbow"],
    ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"],
    ["right_elbow", "right_wrist"],
    ["left_shoulder", "left_hip"],
    ["right_shoulder", "right_hip"],
    ["left_hip", "right_hip"]
  ];

  ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
  ctx.shadowColor = "rgba(56, 189, 248, 0.9)";
  ctx.shadowBlur = 12;

  connections.forEach(([a, b]) => {
    const pa = find(a);
    const pb = find(b);
    if (pa && pb && pa.score > 0.3 && pb.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  });

  ctx.shadowBlur = 0;

  kp.forEach(p => {
    if (p.score > 0.3) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(244, 63, 94, 0.95)";
      ctx.fill();
    }
  });
}

// Utilidades de gestos
function getArmsPositions(pose) {
  if (!pose || !pose.keypoints) return null;
  const kp = pose.keypoints;
  const get = name => kp.find(k => k.name === name);

  const leftWrist = get("left_wrist");
  const rightWrist = get("right_wrist");
  const leftShoulder = get("left_shoulder");
  const rightShoulder = get("right_shoulder");

  if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder) return null;

  return {
    leftWrist,
    rightWrist,
    leftShoulder,
    rightShoulder
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Juegos

// 1. Golpea los objetivos
function initTargetsGame() {
  currentGame = "targets";
  gameNameEl.textContent = "Golpea los objetivos";
  score = 0;
  timeLeft = 30;
  scoreEl.textContent = score;
  timerEl.textContent = timeLeft;
  targets = [];
  for (let i = 0; i < 5; i++) {
    targets.push(createTarget());
  }
  startTimer();
}

// 2. Sigue el camino
function initPathGame() {
  currentGame = "path";
  gameNameEl.textContent = "Sigue el camino";
  score = 0;
  timeLeft = 30;
  scoreEl.textContent = score;
  timerEl.textContent = timeLeft;
  pathPoints = createPathPoints();
  startTimer();
}

// 3. Juego de reacción
function initReactionGame() {
  currentGame = "reaction";
  gameNameEl.textContent = "Juego de reacción";
  score = 0;
  timeLeft = 30;
  scoreEl.textContent = score;
  timerEl.textContent = timeLeft;
  reactionCue = null;
  reactionActive = false;
  lastReactionTime = performance.now();
  scheduleNextReaction();
  startTimer();
}

// Creación de objetivos
function createTarget() {
  const w = overlay.width / window.devicePixelRatio;
  const h = overlay.height / window.devicePixelRatio;
  const margin = 60;
  return {
    x: margin + Math.random() * (w - margin * 2),
    y: margin + Math.random() * (h - margin * 2),
    radius: 30 + Math.random() * 20,
    vx: (Math.random() * 2 - 1) * 1.2,
    vy: (Math.random() * 2 - 1) * 1.2
  };
}

function updateTargets() {
  const w = overlay.width / window.devicePixelRatio;
  const h = overlay.height / window.devicePixelRatio;
  targets.forEach(t => {
    t.x += t.vx;
    t.y += t.vy;
    if (t.x < t.radius || t.x > w - t.radius) t.vx *= -1;
    if (t.y < t.radius || t.y > h - t.radius) t.vy *= -1;
  });
}

function drawTargets() {
  targets.forEach(t => {
    const gradient = ctx.createRadialGradient(t.x, t.y, 5, t.x, t.y, t.radius);
    gradient.addColorStop(0, "rgba(56, 189, 248, 0.9)");
    gradient.addColorStop(1, "rgba(56, 189, 248, 0.1)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(15, 23, 42, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function handleTargetsHit(arms) {
  if (!arms) return;
  const wrists = [arms.leftWrist, arms.rightWrist];
  wrists.forEach(wrist => {
    targets.forEach((t, idx) => {
      if (distance(wrist, t) < t.radius) {
        score += 10;
        scoreEl.textContent = score;
        playSfx(sfxHit);
        showFeedback("¡Genial!", "#22c55e");
        targets[idx] = createTarget();
      }
    });
  });
}

// Path game
function createPathPoints() {
  const w = overlay.width / window.devicePixelRatio;
  const h = overlay.height / window.devicePixelRatio;
  const margin = 80;
  const points = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const x = margin + (w - margin * 2) * (i / (count - 1));
    const y = margin + (i % 2 === 0 ? 0.2 : 0.8) * (h - margin * 2);
    points.push({
      x,
      y,
      radius: 22,
      hit: false
    });
  }
  return points;
}

function drawPath() {
  if (!pathPoints.length) return;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(129, 140, 248, 0.9)";
  ctx.beginPath();
  pathPoints.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  pathPoints.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.hit ? "rgba(34, 197, 94, 0.9)" : "rgba(129, 140, 248, 0.9)";
    ctx.fill();
  });
}

function handlePathHit(arms) {
  if (!arms) return;
  const wrist = arms.rightWrist.score > arms.leftWrist.score ? arms.rightWrist : arms.leftWrist;
  pathPoints.forEach(p => {
    if (!p.hit && distance(wrist, p) < p.radius + 10) {
      p.hit = true;
      score += 5;
      scoreEl.textContent = score;
      playSfx(sfxGood);
      showFeedback("¡Bien!", "#38bdf8");
    }
  });
}

// Reaction game
function scheduleNextReaction() {
  const delay = 800 + Math.random() * 1500;
  setTimeout(() => {
    reactionActive = true;
    const w = overlay.width / window.devicePixelRatio;
    const h = overlay.height / window.devicePixelRatio;
    const margin = 80;
    reactionCue = {
      x: margin + Math.random() * (w - margin * 2),
      y: margin + Math.random() * (h - margin * 2),
      radius: 40
    };
    lastReactionTime = performance.now();
    playSfx(sfxCountdown);
  }, delay);
}

function drawReactionCue() {
  if (!reactionCue) return;
  const t = (performance.now() - lastReactionTime) / 1000;
  const pulse = 1 + 0.1 * Math.sin(t * 6);
  const r = reactionCue.radius * pulse;

  const gradient = ctx.createRadialGradient(reactionCue.x, reactionCue.y, 5, reactionCue.x, reactionCue.y, r);
  gradient.addColorStop(0, "rgba(244, 63, 94, 0.95)");
  gradient.addColorStop(1, "rgba(244, 63, 94, 0.1)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(reactionCue.x, reactionCue.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function handleReactionHit(arms) {
  if (!reactionActive || !reactionCue || !arms) return;
  const wrists = [arms.leftWrist, arms.rightWrist];
  wrists.forEach(wrist => {
    if (distance(wrist, reactionCue) < reactionCue.radius + 10) {
      const reactionTime = (performance.now() - lastReactionTime) / 1000;
      const bonus = Math.max(0, 3 - reactionTime);
      const points = 10 + Math.round(bonus * 5);
      score += points;
      scoreEl.textContent = score;
      playSfx(sfxGood);
      showFeedback(reactionTime < 0.6 ? "¡Súper rápido!" : "¡Bien!", "#f97316");
      reactionActive = false;
      reactionCue = null;
      scheduleNextReaction();
    }
  });
}

// Temporizador
function startTimer() {
  clearInterval(timerInterval);
  timeLeft = 30;
  timerEl.textContent = timeLeft;
  timerInterval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      endGame();
    }
  }, 1000);
}

function endGame() {
  running = false;
  cancelAnimationFrame(animationFrameId);
  playSfx(sfxEnd);
  showFeedback(`Fin. Puntuación: ${score}`, "#e5e7eb");
  setTimeout(() => {
    showScreen(menuScreen);
    showHud(false);
  }, 2000);
}

// Bucle principal
async function gameLoop() {
  if (!running || !detector) return;

  const poses = await detector.estimatePoses(video, { flipHorizontal: true });
  const pose = poses && poses[0] ? poses[0] : null;

  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (pose) {
    drawSkeleton(pose);
    const arms = getArmsPositions(pose);

    if (currentGame === "targets") {
      updateTargets();
      drawTargets();
      handleTargetsHit(arms);
    } else if (currentGame === "path") {
      drawPath();
      handlePathHit(arms);
    } else if (currentGame === "reaction") {
      drawReactionCue();
      handleReactionHit(arms);
    }
  }

  animationFrameId = requestAnimationFrame(gameLoop);
}

// Eventos UI
startBtn.addEventListener("click", () => {
  showScreen(cameraScreen);
});

cameraBtn.addEventListener("click", async () => {
  cameraError.textContent = "";
  const ok = await initCamera();
  if (ok) {
    await initDetector();
    showScreen(calibrationScreen);
  }
});

calibrateBtn.addEventListener("click", () => {
  startCalibration();
});

recalibrateBtn.addEventListener("click", () => {
  showScreen(calibrationScreen);
});

document.querySelectorAll(".game-card").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!calibrated) {
      showScreen(calibrationScreen);
      return;
    }
    const game = btn.dataset.game;
    showScreen(null);
    showHud(true);
    running = true;
    if (game === "targets") {
      initTargetsGame();
    } else if (game === "path") {
      initPathGame();
    } else if (game === "reaction") {
      initReactionGame();
    }
    gameLoop();
  });
});

backMenuBtn.addEventListener("click", () => {
  running = false;
  cancelAnimationFrame(animationFrameId);
  clearInterval(timerInterval);
  showHud(false);
  showScreen(menuScreen);
});

muteBtn.addEventListener("click", () => {
  muted = !muted;
  muteBtn.textContent = `Sonido: ${muted ? "OFF" : "ON"}`;
});

// Accesibilidad básica con teclado
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (running) {
      backMenuBtn.click();
    }
  }
});

// Inicio
showScreen(startScreen);
