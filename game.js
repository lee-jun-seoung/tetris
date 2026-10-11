(() => {
  "use strict";

  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;
  const MOVE_EASE_MS = 55;
  const ROTATE_ANIMATION_MS = 135;
  const LINE_FLASH_MS = 220;
  const COLORS = { I: "#5de3e0", O: "#f5cf69", T: "#b68cff", S: "#83e28f", Z: "#ff7588", J: "#69a8ff", L: "#ffad69" };
  const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1],[1,1]],
    T: [[0,1,0],[1,1,1],[0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    L: [[0,0,1],[1,1,1],[0,0,0]],
  };
  const boardCanvas = document.querySelector("#board");
  const ctx = boardCanvas.getContext("2d");
  const nextCtx = document.querySelector("#next").getContext("2d");
  const holdCtx = document.querySelector("#hold").getContext("2d");
  const overlay = document.querySelector("#overlay");
  const startButton = document.querySelector("#start-button");
  const pauseButton = document.querySelector("#pause-button");
  const touchPauseButton = document.querySelector("#touch-pause-button");
  const touchControls = document.querySelector(".touch-controls");
  let board, active, queue, held, canHold, score, lines, level, running, paused, dropCounter, lastTime, animation;
  let bag = [];
  let pieceSerial = 0;
  let visualPiece = null;
  let rotationAnimation = null;
  let lineFlash = null;
  let best = Number(localStorage.getItem("stack-best") || 0);

  const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  function refillBag() {
    bag = Object.keys(SHAPES);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  function takeType() { if (!bag.length) refillBag(); return bag.pop(); }
  function makePiece(type = takeType()) {
    const shape = SHAPES[type].map(row => [...row]);
    return { id: ++pieceSerial, type, shape, x: Math.floor((COLS - shape[0].length) / 2), y: type === "I" ? -1 : 0 };
  }
  function ensureQueue() { while (queue.length < 5) queue.push(makePiece()); }
  function collides(piece, dx = 0, dy = 0, shape = piece.shape) {
    for (let y = 0; y < shape.length; y++) for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue;
      const bx = piece.x + x + dx, by = piece.y + y + dy;
      if (bx < 0 || bx >= COLS || by >= ROWS || (by >= 0 && board[by][bx])) return true;
    }
    return false;
  }
  function rotate(shape, dir) {
    const n = shape.length;
    return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => dir > 0 ? shape[n - 1 - x][y] : shape[x][n - 1 - y]));
  }
  function tryRotate(dir) {
    const rotated = rotate(active.shape, dir);
    for (const kick of [0, -1, 1, -2, 2]) if (!collides(active, kick, 0, rotated)) {
      active.x += kick; active.shape = rotated;
      rotationAnimation = { id: active.id, fromAngle: dir > 0 ? -Math.PI / 2 : Math.PI / 2, started: performance.now() };
      draw(); return;
    }
  }
  function merge() {
    const toppedOut = active.shape.some((row, y) => row.some((cell, x) => cell && active.y + y < 0));
    if (toppedOut) { endGame(); return; }
    active.shape.forEach((row, y) => row.forEach((cell, x) => {
      if (cell && active.y + y >= 0) board[active.y + y][active.x + x] = active.type;
    }));
    clearLines();
    spawn();
  }
  function clearLines() {
    let cleared = 0;
    const clearedRows = [];
    outer: for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every(Boolean)) {
        board.splice(y, 1);
        board.unshift(Array(COLS).fill(null));
        clearedRows.push(y); cleared++; y++; continue outer;
      }
    }
    if (cleared) {
      lineFlash = { rows: clearedRows, started: performance.now() };
      const points = [0, 100, 300, 500, 800][cleared] * level;
      score += points; lines += cleared; level = Math.floor(lines / 10) + 1;
      updateBest();
      updateStats();
    }
  }
  function updateBest() {
    if (score > best) { best = score; localStorage.setItem("stack-best", String(best)); }
  }
  function spawn() {
    active = queue.shift(); ensureQueue(); canHold = true;
    if (collides(active)) endGame();
    draw();
  }
  function holdPiece() {
    if (!running || paused || !canHold) return;
    const current = active.type;
    if (held) { active = makePiece(held); held = current; }
    else { held = current; spawn(); }
    if (collides(active)) endGame();
    canHold = false; draw(); drawPreviews();
  }
  function lock() { merge(); }
  function stepDown() {
    const moved = !collides(active, 0, 1);
    if (moved) active.y++;
    else lock();
    dropCounter = 0;
    return moved;
  }
  function hardDrop() {
    let distance = 0;
    while (!collides(active, 0, 1)) { active.y++; distance++; }
    score += distance * 2; updateBest(); updateStats(); lock();
  }
  function drawCell(target, x, y, size, color, ghost = false) {
    const pad = Math.max(1, Math.round(size * .07));
    target.globalAlpha = ghost ? .22 : 1;
    target.fillStyle = color;
    target.fillRect(x * size + pad, y * size + pad, size - pad * 2, size - pad * 2);
    if (!ghost) {
      target.fillStyle = "#ffffff30";
      target.fillRect(x * size + pad, y * size + pad, size - pad * 2, Math.max(2, size * .07));
      target.fillStyle = "#00000020";
      target.fillRect(x * size + pad, y * size + size - pad * 2, size - pad * 2, Math.max(2, size * .06));
    }
    target.globalAlpha = 1;
  }
  function drawPiece(target, piece, size, offsetX = 0, offsetY = 0, ghost = false) {
    piece.shape.forEach((row, y) => row.forEach((cell, x) => { if (cell) drawCell(target, piece.x + x + offsetX, piece.y + y + offsetY, size, COLORS[piece.type], ghost); }));
  }
  function draw() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    board.forEach((row, y) => row.forEach((type, x) => { if (type) drawCell(ctx, x, y, CELL, COLORS[type]); }));
    const now = performance.now();
    if (active) {
      let ghostY = active.y;
      while (!collides({ ...active, y: ghostY }, 0, 1)) ghostY++;
      drawPiece(ctx, { ...active, y: ghostY }, CELL, 0, 0, true);
      if (!visualPiece || visualPiece.id !== active.id) visualPiece = { id: active.id, x: active.x, y: active.y };
      else {
        const elapsed = Math.max(0, now - (visualPiece.updatedAt || now - 16));
        const blend = 1 - Math.exp(-elapsed / MOVE_EASE_MS);
        visualPiece.x += (active.x - visualPiece.x) * blend;
        visualPiece.y += (active.y - visualPiece.y) * blend;
      }
      visualPiece.updatedAt = now;
      const displayed = { ...active, x: visualPiece.x, y: visualPiece.y };
      const rotation = rotationAnimation && rotationAnimation.id === active.id ? rotationAnimation : null;
      if (rotation) {
        const progress = Math.min(1, Math.max(0, (now - rotation.started) / ROTATE_ANIMATION_MS));
        const eased = 1 - Math.pow(1 - progress, 3);
        if (progress < 1) {
          const size = active.shape.length;
          ctx.save();
          ctx.translate((displayed.x + size / 2) * CELL, (displayed.y + size / 2) * CELL);
          ctx.rotate(rotation.fromAngle * (1 - eased));
          drawPiece(ctx, { ...displayed, x: -size / 2, y: -size / 2 }, CELL);
          ctx.restore();
        } else rotationAnimation = null;
      } else drawPiece(ctx, displayed, CELL);
    }
    if (lineFlash) {
      const progress = (now - lineFlash.started) / LINE_FLASH_MS;
      if (progress >= 1) lineFlash = null;
      else {
        const opacity = Math.sin(progress * Math.PI) * .42;
        ctx.fillStyle = `rgba(102, 240, 193, ${opacity})`;
        lineFlash.rows.forEach(y => ctx.fillRect(0, y * CELL, boardCanvas.width, CELL));
      }
    }
    drawPreviews();
  }
  function drawMini(target, piece) {
    target.clearRect(0, 0, 120, 100);
    if (!piece) return;
    const size = 20, width = piece.shape[0].length * size, height = piece.shape.length * size;
    const ox = Math.floor((120 - width) / 2 / size), oy = Math.floor((100 - height) / 2 / size);
    piece.shape.forEach((row, y) => row.forEach((cell, x) => { if (cell) drawCell(target, ox + x, oy + y, size, COLORS[piece.type]); }));
  }
  function drawPreviews() { if (!queue) return; drawMini(nextCtx, queue[0]); drawMini(holdCtx, held ? makePiece(held) : null); }
  function updateStats() {
    document.querySelector("#score").textContent = String(score).padStart(6, "0");
    document.querySelector("#best").textContent = String(best).padStart(6, "0");
    document.querySelector("#lines").textContent = String(lines).padStart(2, "0");
    document.querySelector("#level").textContent = String(level).padStart(2, "0");
    document.querySelector("#level-meter").style.width = `${(lines % 10) * 10}%`;
  }
  function showOverlay(title, copy, buttonText, showButton = true) {
    document.querySelector("#overlay-title").textContent = title;
    document.querySelector("#overlay-copy").textContent = copy;
    startButton.innerHTML = `${buttonText} <span>↗</span>`;
    startButton.hidden = !showButton;
    overlay.classList.remove("hidden");
  }
  function start() {
    cancelAnimationFrame(animation);
    board = emptyBoard(); queue = []; held = null; canHold = true; bag = [];
    visualPiece = null; rotationAnimation = null; lineFlash = null;
    score = 0; lines = 0; level = 1; dropCounter = 0; lastTime = 0; running = true; paused = false;
    ensureQueue(); spawn(); updateStats();
    overlay.classList.add("hidden"); pauseButton.disabled = false; touchPauseButton.disabled = false;
    pauseButton.innerHTML = "Ⅱ <span>일시정지</span>"; touchPauseButton.innerHTML = "<span>Ⅱ</span>";
    animation = requestAnimationFrame(loop);
  }
  function endGame() {
    running = false; paused = false; pauseButton.disabled = true; touchPauseButton.disabled = true;
    showOverlay("GAME OVER", `점수 ${String(score).padStart(6, "0")} · ${lines}줄을 지웠어요.`, "다시 시작");
  }
  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      cancelAnimationFrame(animation); showOverlay("PAUSED", "잠시 쉬어가도 괜찮아요.", "계속하기");
      pauseButton.innerHTML = "▶ <span>계속하기</span>"; touchPauseButton.innerHTML = "<span>▶</span>";
      touchPauseButton.setAttribute("aria-label", "게임 계속하기");
    } else {
      overlay.classList.add("hidden"); lastTime = 0; pauseButton.innerHTML = "Ⅱ <span>일시정지</span>";
      touchPauseButton.innerHTML = "<span>Ⅱ</span>"; touchPauseButton.setAttribute("aria-label", "일시 정지");
      animation = requestAnimationFrame(loop);
    }
  }
  function loop(time = 0) {
    if (!running || paused) return;
    const delta = lastTime ? time - lastTime : 0;
    lastTime = time; dropCounter += delta;
    if (dropCounter > Math.max(90, 800 - (level - 1) * 65)) stepDown();
    draw();
    if (running) animation = requestAnimationFrame(loop);
  }
  function move(dx) { if (!running || paused || collides(active, dx, 0)) return; active.x += dx; draw(); }
  function runControl(action) {
    if (action === "pause") { togglePause(); return; }
    if (!running || paused) return;
    switch (action) {
      case "left": move(-1); break;
      case "right": move(1); break;
      case "down": if (stepDown()) { score += 1; updateBest(); updateStats(); } draw(); break;
      case "rotate": tryRotate(1); break;
      case "drop": hardDrop(); break;
      case "hold": holdPiece(); break;
    }
  }
  function handleKey(event) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " ", "Space"];
    if (keys.includes(event.key)) event.preventDefault();
    if (event.repeat && ["ArrowUp", " ", "Space", "c", "C", "p", "P"].includes(event.key)) return;
    if (event.key === "p" || event.key === "P" || event.key === "Escape") { togglePause(); return; }
    if (!running || paused) return;
    switch (event.key) {
      case "ArrowLeft": move(-1); break;
      case "ArrowRight": move(1); break;
      case "ArrowDown": if (stepDown()) { score += 1; updateBest(); updateStats(); } draw(); break;
      case "ArrowUp": case "x": case "X": tryRotate(1); break;
      case "z": case "Z": tryRotate(-1); break;
      case " ": case "Space": hardDrop(); break;
      case "c": case "C": holdPiece(); break;
    }
  }

  startButton.addEventListener("click", () => { if (paused) togglePause(); else start(); });
  pauseButton.addEventListener("click", togglePause);
  let repeatDelay = null, repeatInterval = null;
  function stopTouchRepeat() {
    clearTimeout(repeatDelay); clearInterval(repeatInterval);
    repeatDelay = null; repeatInterval = null;
  }
  const repeatableControls = new Set(["left", "right", "down"]);
  touchControls.querySelectorAll("[data-action]").forEach(button => {
    const action = button.dataset.action;
    if (repeatableControls.has(action)) {
      button.addEventListener("pointerdown", event => {
        if (button.disabled) return;
        event.preventDefault(); stopTouchRepeat(); runControl(action);
        button.setPointerCapture(event.pointerId);
        repeatDelay = setTimeout(() => { repeatInterval = setInterval(() => runControl(action), 85); }, 210);
      });
      button.addEventListener("pointerup", stopTouchRepeat);
      button.addEventListener("pointercancel", stopTouchRepeat);
      button.addEventListener("lostpointercapture", stopTouchRepeat);
      button.addEventListener("click", event => { if (event.detail === 0) runControl(action); });
    } else button.addEventListener("click", () => runControl(action));
  });
  window.addEventListener("blur", stopTouchRepeat);
  document.addEventListener("keydown", handleKey);
  let touchX = null, touchY = null;
  boardCanvas.addEventListener("touchstart", e => { const t = e.changedTouches[0]; touchX = t.clientX; touchY = t.clientY; }, { passive: true });
  boardCanvas.addEventListener("touchend", e => {
    if (!running || paused || touchX === null) return;
    const t = e.changedTouches[0], dx = t.clientX - touchX, dy = t.clientY - touchY;
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) tryRotate(1);
    else if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
    else if (dy > 20) hardDrop();
    touchX = null; touchY = null;
  }, { passive: true });
  board = emptyBoard(); queue = []; active = null; held = null; running = false; paused = false;
  document.querySelector("#best").textContent = String(best).padStart(6, "0");
  draw(); drawPreviews();
})();
