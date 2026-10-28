import { chromium } from 'playwright';

// ─── Configuration ───────────────────────────────────────────────────────────
const COLS = 17;
const ROWS = 10;
const TARGET_SUM = 10;
const MOVE_DELAY_MS = 80;
const COMPUTE_TIME_MS = 10000;
const EXEC_MODE = process.argv.includes('--drag') ? 'drag' : 'ws';
const STRATEGY = process.argv.includes('--fast') ? 'instant' : 'optimal';

function consumeFlags(argv) {
  const positional = [];
  let roomPassword = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pass' || a === '--password') {
      roomPassword = argv[i + 1] ?? '';
      i++;
      continue;
    }
    if (a.startsWith('--pass=')) {
      roomPassword = a.slice('--pass='.length);
      continue;
    }
    if (a.startsWith('--password=')) {
      roomPassword = a.slice('--password='.length);
      continue;
    }
    if (a.startsWith('--')) continue;
    positional.push(a);
  }
  return { positional, roomPassword };
}

const { positional: positionalArgs, roomPassword: ROOM_PASSWORD_FLAG } = consumeFlags(process.argv.slice(2));

/** CMD에서 `방코드 1103 닉네임` 처럼 쓰면 1103이 닉으로만 들어가던 문제 완화 (숫자만 4~8자리면 비밀번호로 간주) */
function parseRoomModeArgs(args, flagPassword) {
  const roomCode = args[0].toUpperCase();
  let roomPassword = flagPassword || '';
  let nickStart = 1;
  if (!flagPassword && args[1] && /^[0-9]{4,8}$/.test(args[1])) {
    roomPassword = args[1];
    nickStart = 2;
  }
  const nickname = args.slice(nickStart).join(' ');
  return {
    mode: 'room',
    roomCode,
    nickname,
    roomPassword: roomPassword || undefined,
  };
}

function parseArgs() {
  const args = positionalArgs;
  if (args.length >= 2 && !args[0].startsWith('http')) {
    return parseRoomModeArgs(args, ROOM_PASSWORD_FLAG);
  }
  if (args.length === 1 && !args[0].startsWith('http') && args[0].length <= 10) {
    return {
      mode: 'room',
      roomCode: args[0].toUpperCase(),
      nickname: '',
      roomPassword: ROOM_PASSWORD_FLAG || undefined,
    };
  }
  if (args.length === 1 && args[0].startsWith('http')) {
    return { mode: 'url', url: args[0], roomPassword: ROOM_PASSWORD_FLAG || undefined };
  }
  return { mode: 'solo' };
}

const config = parseArgs();
const isRoomMode = config.mode === 'room' || config.mode === 'url';

// ─── Solver: find rectangles summing to TARGET_SUM ──────────────────────────

function buildPrefixSum(grid) {
  const ps = Array.from({ length: ROWS + 1 }, () => new Array(COLS + 1).fill(0));
  for (let r = 1; r <= ROWS; r++) {
    for (let c = 1; c <= COLS; c++) {
      ps[r][c] = grid[r - 1][c - 1] + ps[r - 1][c] + ps[r][c - 1] - ps[r - 1][c - 1];
    }
  }
  return ps;
}

function rectSum(ps, r1, c1, r2, c2) {
  return ps[r2 + 1][c2 + 1] - ps[r1][c2 + 1] - ps[r2 + 1][c1] + ps[r1][c1];
}

function buildAppleCountPS(grid) {
  const ps = Array.from({ length: ROWS + 1 }, () => new Array(COLS + 1).fill(0));
  for (let r = 1; r <= ROWS; r++)
    for (let c = 1; c <= COLS; c++)
      ps[r][c] = (grid[r - 1][c - 1] !== 0 ? 1 : 0) + ps[r - 1][c] + ps[r][c - 1] - ps[r - 1][c - 1];
  return ps;
}

function rectAppleCount(aps, r1, c1, r2, c2) {
  return aps[r2 + 1][c2 + 1] - aps[r1][c2 + 1] - aps[r2 + 1][c1] + aps[r1][c1];
}

function findAllMoves(grid) {
  const ps = buildPrefixSum(grid);
  const aps = buildAppleCountPS(grid);
  const moves = [];

  for (let r1 = 0; r1 < ROWS; r1++) {
    for (let c1 = 0; c1 < COLS; c1++) {
      for (let r2 = r1; r2 < ROWS; r2++) {
        for (let c2 = c1; c2 < COLS; c2++) {
          const sum = rectSum(ps, r1, c1, r2, c2);
          if (sum > TARGET_SUM) break;
          if (sum === TARGET_SUM) {
            const count = rectAppleCount(aps, r1, c1, r2, c2);
            if (count > 0) moves.push({ r1, c1, r2, c2, count });
          }
        }
      }
    }
  }

  moves.sort((a, b) => a.count - b.count);
  return moves;
}

// ─── Look-ahead search: pick moves that maximize total removable apples ──────

function simulateMove(boardStr, move) {
  const chars = boardStr.split('');
  for (let r = move.r1; r <= move.r2; r++)
    for (let c = move.c1; c <= move.c2; c++)
      chars[r * COLS + c] = '0';
  return chars.join('');
}

function searchBest(boardStr, depth, maxDepth, deadline) {
  if (depth >= maxDepth || Date.now() > deadline) return 0;
  const grid = parseGrid(boardStr);
  const moves = findAllMoves(grid);
  if (moves.length === 0) return 0;

  const beam = depth === 0 ? Math.min(moves.length, 15) : Math.min(moves.length, 6);
  let best = 0;
  for (let i = 0; i < beam; i++) {
    if (Date.now() > deadline) break;
    const newBoard = simulateMove(boardStr, moves[i]);
    const total = moves[i].count + searchBest(newBoard, depth + 1, maxDepth, deadline);
    if (total > best) best = total;
  }
  return best;
}

function findBestMove(boardStr) {
  const grid = parseGrid(boardStr);
  const moves = findAllMoves(grid);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  let maxDepth = 3;
  if (moves.length <= 5) maxDepth = 5;
  else if (moves.length <= 10) maxDepth = 4;
  else if (moves.length > 25) maxDepth = 2;

  const deadline = Date.now() + 400;
  let bestScore = -1;
  let bestMove = moves[0];

  const rootBeam = Math.min(moves.length, 15);
  for (let i = 0; i < rootBeam; i++) {
    if (Date.now() > deadline) break;
    const newBoard = simulateMove(boardStr, moves[i]);
    const score = moves[i].count + searchBest(newBoard, 1, maxDepth, deadline);
    if (score > bestScore) {
      bestScore = score;
      bestMove = moves[i];
    }
  }
  return bestMove;
}

// ─── Monte Carlo: pre-compute optimal full sequence ──────────────────────────

function weightedRandomPick(moves) {
  if (moves.length === 1) return moves[0];
  let totalWeight = 0;
  for (const m of moves) totalWeight += 1 / m.count;
  let r = Math.random() * totalWeight;
  for (const m of moves) {
    r -= 1 / m.count;
    if (r <= 0) return m;
  }
  return moves[moves.length - 1];
}

function findOptimalSequence(boardStr, timeBudgetMs) {
  const deadline = Date.now() + timeBudgetMs;
  let bestSequence = [];
  let bestTotal = 0;
  let simulations = 0;
  let lastLog = Date.now();

  while (Date.now() < deadline) {
    let board = boardStr;
    const sequence = [];
    let total = 0;

    while (true) {
      const grid = parseGrid(board);
      const moves = findAllMoves(grid);
      if (moves.length === 0) break;
      const move = weightedRandomPick(moves);
      sequence.push(move);
      total += move.count;
      board = simulateMove(board, move);
    }

    if (total > bestTotal) {
      bestTotal = total;
      bestSequence = sequence.map(m => ({ r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2, count: m.count }));
    }
    simulations++;

    if (Date.now() - lastLog >= 1000) {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      console.log(`  [MC] ${simulations} sims | best: ${bestTotal} apples in ${bestSequence.length} moves | ${remaining}s left`);
      lastLog = Date.now();
    }
  }

  console.log(`  [MC] Done: ${simulations} sims | best: ${bestTotal} apples in ${bestSequence.length} moves`);
  return bestSequence;
}

function parseGrid(boardStr) {
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      row.push(parseInt(boardStr[r * COLS + c], 10));
    }
    grid.push(row);
  }
  return grid;
}

// ─── Board reading (works in both solo and room mode) ────────────────────────

async function injectBoardReader(page) {
  const BOARD_LEN = COLS * ROWS;
  await page.evaluate((BOARD_LEN) => {
    function deepSearchProp(obj, propName, depth = 0) {
      if (!obj || depth > 8) return null;
      if (obj.props?.[propName]) return obj.props[propName];
      const children = obj.props?.children;
      if (children) {
        const arr = Array.isArray(children) ? children : [children];
        for (const child of arr) {
          if (child && typeof child === 'object') {
            const found = deepSearchProp(child, propName, depth + 1);
            if (found) return found;
          }
        }
      }
      return null;
    }

    window.__appleSolver = {
      getBoard: () => {
        const allCanvas = document.querySelectorAll('canvas');
        for (const canvas of allCanvas) {
          let el = canvas;
          for (let i = 0; i < 5 && el; i++) {
            const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
            if (pk) {
              const board = deepSearchProp({ props: el[pk] }, 'board');
              if (board && typeof board === 'string' && board.length === BOARD_LEN) return board;
            }
            el = el.parentElement;
          }
        }
        return null;
      },

    };
  }, BOARD_LEN);
}

async function readBoard(page) {
  return page.evaluate(() => window.__appleSolver?.getBoard?.());
}

// ─── Move execution via mouse drag ──────────────────────────────────────────

async function getCanvasInfo(page) {
  return page.evaluate(() => {
    const allCanvas = document.querySelectorAll('canvas');
    let best = null, bestArea = 0;
    for (const canvas of allCanvas) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) {
        const area = rect.width * rect.height;
        if (area > bestArea) {
          bestArea = area;
          best = {
            pageX: rect.x, pageY: rect.y,
            displayW: rect.width, displayH: rect.height,
            internalW: canvas.width, internalH: canvas.height
          };
        }
      }
    }
    return best;
  });
}

async function executeMoveViaDrag(page, move, canvasInfo) {
  if (!canvasInfo) canvasInfo = await getCanvasInfo(page);
  if (!canvasInfo) return { success: false, error: 'No canvas found' };

  const { internalW, internalH, displayW, displayH, pageX, pageY } = canvasInfo;

  const cellSize = (internalW >= 17 * 33 && internalH >= 10 * 33) ? 33
    : Math.floor(Math.min(internalW / 17, internalH / 10));
  const padX = (internalW - 17 * cellSize) / 2;
  const padY = (internalH - 10 * cellSize) / 2;
  const scaleX = displayW / internalW;
  const scaleY = displayH / internalH;

  const inset = cellSize * 0.15;
  const x1 = pageX + (padX + move.c1 * cellSize + inset) * scaleX;
  const y1 = pageY + (padY + move.r1 * cellSize + inset) * scaleY;
  const x2 = pageX + (padX + (move.c2 + 1) * cellSize - inset) * scaleX;
  const y2 = pageY + (padY + (move.r2 + 1) * cellSize - inset) * scaleY;

  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();

  return { success: true, removed: (move.r2 - move.r1 + 1) * (move.c2 - move.c1 + 1) };
}

// ─── Room mode: WebSocket direct messaging ──────────────────────────────────

async function setupWsInterceptor(page) {
  await page.addInitScript(() => {
    const origWS = window.WebSocket;
    window.__wsInstances = [];
    window.__wsAckId = 0;
    window.__wsGameStartTime = null;
    window.__wsLastResponse = null;

    window.WebSocket = function(url, protocols) {
      const ws = protocols ? new origWS(url, protocols) : new origWS(url);
      window.__wsInstances.push(ws);

      ws.addEventListener('message', (e) => {
        if (typeof e.data === 'string') {
          if (e.data.includes('"game:started"')) {
            window.__wsGameStartTime = Date.now();
            try {
              const match = e.data.match(/\["game:started",(.+)\]$/);
              if (match) {
                const data = JSON.parse(match[1]);
                if (data.board) window.__wsGameStartBoard = data.board;
              }
            } catch {}
          }
          // Track ack responses for our game:action calls
          const ackMatch = e.data.match(/^43(\d+)\[(.+)\]$/);
          if (ackMatch) {
            try { window.__wsLastResponse = JSON.parse(ackMatch[2]); } catch {}
          }
        }
      });

      // Track outgoing ack IDs
      const origSend = ws.send.bind(ws);
      ws.send = function(data) {
        if (typeof data === 'string') {
          const m = data.match(/^42(\d+)/);
          if (m) window.__wsAckId = Math.max(window.__wsAckId, parseInt(m[1]) + 1);
        }
        return origSend(data);
      };

      return ws;
    };
    window.WebSocket.prototype = origWS.prototype;
    Object.assign(window.WebSocket, origWS);
  });
}

async function executeMoveViaWs(page, move) {
  return page.evaluate(({ move }) => {
    const ws = window.__wsInstances?.[0];
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'No open WebSocket' };
    }

    const timestampMs = window.__wsGameStartTime
      ? Date.now() - window.__wsGameStartTime
      : 0;

    const ackId = window.__wsAckId++;
    const msg = `42${ackId}${JSON.stringify(["game:action", {
      selection: { r1: move.r1, c1: move.c1, r2: move.r2, c2: move.c2 },
      timestampMs
    }])}`;

    window.__wsLastResponse = null;
    ws.send(msg);

    return { success: true, ackId };
  }, { move });
}

async function waitForWsResponse(page, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await page.evaluate(() => {
      const r = window.__wsLastResponse;
      window.__wsLastResponse = null;
      return r;
    });
    if (resp) return resp;
    await page.waitForTimeout(20);
  }
  return null;
}

async function getGameState(page) {
  return page.evaluate(() => {
    const allCanvas = document.querySelectorAll('canvas');
    for (const canvas of allCanvas) {
      const fiberKey = Object.keys(canvas).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) continue;

      let fiber = canvas[fiberKey];
      for (let d = 0; d <= 15; d++) {
        if (!fiber) break;
        let hs = fiber.memoizedState;
        let hi = 0;
        while (hs && hi < 40) {
          const val = hs.memoizedState;
          if (typeof val === 'string' && ['playing', 'waiting', 'finished', 'idle', 'ready'].includes(val)) {
            return val;
          }
          hs = hs.next;
          hi++;
        }
        fiber = fiber.return;
      }
    }
    return 'unknown';
  });
}

// ─── UI helpers (site layout changes often) ──────────────────────────────────

/** 첫 방문 공지: 한국어는 "확인", 영어는 "Got it" — 이전엔 Got it만 찾아서 /ko 등에서 영구 대기됨 */
async function dismissNoticeModal(page) {
  const dismissName = /got it|확인|知道了|了解|わかりました|^ok$/i;
  const overlayPrimary = page.locator('div.fixed.inset-0.z-50 button.w-full').first();

  for (let i = 0; i < 60; i++) {
    const byRole = page.getByRole('button', { name: dismissName });
    if (await byRole.isVisible().catch(() => false)) {
      await byRole.scrollIntoViewIfNeeded();
      await byRole.click({ timeout: 10000 });
      await page.waitForTimeout(400);
      return;
    }
    if (await overlayPrimary.isVisible().catch(() => false)) {
      await overlayPrimary.scrollIntoViewIfNeeded();
      await overlayPrimary.click({ timeout: 10000 });
      await page.waitForTimeout(400);
      return;
    }
    await page.waitForTimeout(250);
  }
}

/** Modal or intermediate screen after home “Join” when the room has a password */
async function submitRoomPasswordModalIfAny(page, roomPassword) {
  for (let i = 0; i < 50; i++) {
    if (/\/room\/[^/]+\/(invite|lobby)/.test(page.url())) return;

    const field = page.locator('input[type="password"]:visible').first();
    if (await field.isVisible().catch(() => false)) {
      if (!roomPassword) {
        throw new Error('This room requires a password. Add: --pass YOUR_PASSWORD');
      }
      await field.fill(roomPassword);
      const btn = page.getByRole('button', { name: /^(Join|Confirm|Continue|OK|Submit|확인|참여|참가하기)$/i }).first();
      if (await btn.isVisible().catch(() => false)) await btn.click();
      else await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      return;
    }
    await page.waitForTimeout(200);
  }
}

/** After landing on /room/.../invite or /lobby: optional password + nickname + Ready */
async function finishRoomLobby(page, { nickname, roomPassword } = {}) {
  const pwdField = page.locator('input[type="password"]:visible').first();
  if (await pwdField.isVisible().catch(() => false)) {
    if (!roomPassword) {
      throw new Error('This room requires a password. Add: --pass YOUR_PASSWORD');
    }
    await pwdField.fill(roomPassword);
  }

  const nickInput = page.locator('input[placeholder="random"], #nickname').first();

  if (page.url().includes('/invite') || (await nickInput.isVisible().catch(() => false))) {
    await nickInput.waitFor({ state: 'visible', timeout: 20000 });
    if (nickname) await nickInput.fill(nickname);
    const enterLobby = page.getByRole('button', {
      name: /^(Join|참여|참여하기|참가하기)$/,
    }).first();
    await enterLobby.waitFor({ state: 'visible', timeout: 20000 });
    await enterLobby.scrollIntoViewIfNeeded();
    await enterLobby.click();
    await page.waitForURL(/\/lobby/, { timeout: 30000 });
  }

  const okBtn = await page.$('button:has-text("OK"), button:has-text("확인")');
  if (okBtn) { await okBtn.click(); await page.waitForTimeout(500); }

  const readyBtn = await page.$('button:has-text("Ready"), button:has-text("준비")');
  if (readyBtn) { console.log('Clicking Ready...'); await readyBtn.click(); await page.waitForTimeout(500); }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Apple Game Solver ===');
  console.log(`Exec: ${EXEC_MODE === 'ws' ? 'WebSocket' : 'Mouse drag'} | Strategy: ${STRATEGY === 'optimal' ? `Optimal (${COMPUTE_TIME_MS / 1000}s pre-compute)` : 'Instant (greedy)'}  [--ws/--drag, --fast/--optimal, --pass / 숫자비번]`);

  if (config.mode === 'room') {
    console.log(`Mode: Room join`);
    console.log(`Room code: ${config.roomCode}`);
    console.log(`Nickname: ${config.nickname || '(random)'}`);
    console.log(`Room password: ${config.roomPassword ? '(set)' : '(none)'}`);
    console.log(`  Tip: 비밀번호 방이면  "node solver.js CODE 1103 닉네임" 또는 "node solver.js CODE --pass 1103 닉네임"\n`);
  } else if (config.mode === 'url') {
    console.log(`Mode: URL join`);
    console.log(`URL: ${config.url}`);
    console.log(`Room password: ${config.roomPassword ? '(set)' : '(none)'}\n`);
  } else {
    console.log(`Mode: Solo play  (always mouse drag)\n`);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Intercept WebSocket for room mode
  if (isRoomMode) await setupWsInterceptor(page);

  // ─── Navigate & join ─────────────────────────────────────────────────

  if (config.mode === 'room') {
    console.log('Opening site…');
    await page.goto('https://apple.oshizi.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#room-code', { state: 'visible', timeout: 30000 });
    await dismissNoticeModal(page);
    await page.waitForTimeout(400);
    console.log('Entering room code…');
    await page.fill('#room-code', config.roomCode);
    await page.getByRole('button', { name: /^(Join|참여)$/ }).first().click();
    console.log('Clicked room enter, waiting for room page…');
    await submitRoomPasswordModalIfAny(page, config.roomPassword);
    await page.waitForURL(/\/room\/[^/]+\/(invite|lobby)/, { timeout: 45000 });
    await page.waitForTimeout(600);
    if (config.nickname) console.log(`Setting nickname: ${config.nickname}`);
    await finishRoomLobby(page, {
      nickname: config.nickname,
      roomPassword: config.roomPassword,
    });
    console.log('Joined room! Waiting for host to start…');
    await page.waitForTimeout(500);

  } else if (config.mode === 'url') {
    await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    await dismissNoticeModal(page);
    await submitRoomPasswordModalIfAny(page, config.roomPassword);
    await finishRoomLobby(page, {
      nickname: '',
      roomPassword: config.roomPassword,
    });
  } else {
    await page.goto('https://apple.oshizi.com/', { waitUntil: 'domcontentloaded' });
    await dismissNoticeModal(page);
    console.log('Clicking Play Solo...');
    await page.locator('button:has-text("Play Solo"), button:has-text("혼자 하기")').first().click();
    await page.waitForTimeout(2000);
  }

  // ─── Wait for game to be playable ────────────────────────────────────

  await page.waitForSelector('canvas', { timeout: 300000 });
  console.log('Canvas detected.');

  await injectBoardReader(page);

  if (isRoomMode) {
    // Room mode: wait for game:started via WebSocket, then use WS to submit moves
    console.log('Waiting for game to start (WebSocket)...');

    // Wait for game:started WebSocket message
    let currentBoard = null;
    for (let i = 0; i < 600; i++) {
      const gameBoard = await page.evaluate(() => {
        const ws = window.__wsInstances?.[0];
        return window.__wsGameStartBoard || null;
      });
      if (gameBoard && gameBoard.length === COLS * ROWS) {
        currentBoard = gameBoard;
        break;
      }
      // Fallback: check if board is readable AND game is actually in progress
      await injectBoardReader(page);
      const wsReady = await page.evaluate(() => !!window.__wsGameStartTime);
      if (wsReady) {
        currentBoard = await readBoard(page);
        if (currentBoard && currentBoard.length === COLS * ROWS) break;
      }
      currentBoard = null;
      await page.waitForTimeout(500);
      if (i > 0 && i % 20 === 0) console.log(`  Waiting... [${i / 2}s]`);
    }

    if (!currentBoard) {
      console.error('Could not read board. Exiting.');
      await browser.close();
      return;
    }

    console.log(`Board read OK (${currentBoard.length} chars)`);
    const grid = parseGrid(currentBoard);
    console.log('First row:', grid[0].join(' '));
    const testMoves = findAllMoves(grid);
    console.log(`Available moves: ${testMoves.length}\n`);

    // ─── Room solving loop ───
    const useWs = EXEC_MODE === 'ws';
    const instant = STRATEGY === 'instant';
    let canvasInfo = null;
    if (!useWs) {
      canvasInfo = await getCanvasInfo(page);
      if (!canvasInfo) { console.error('No canvas found for drag. Exiting.'); await browser.close(); return; }
      console.log(`Canvas: ${canvasInfo.internalW}×${canvasInfo.internalH} displayed at (${Math.round(canvasInfo.pageX)},${Math.round(canvasInfo.pageY)})`);
    }

    let sequence = [];
    if (!instant) {
      console.log(`\nComputing optimal sequence (${COMPUTE_TIME_MS / 1000}s)...`);
      sequence = findOptimalSequence(currentBoard, COMPUTE_TIME_MS);
    }
    let simBoard = currentBoard;

    let totalRemoved = 0;
    let moveCount = 0;
    const startTime = Date.now();
    let si = 0;

    while (true) {
      let move;
      if (instant) {
        const grid = parseGrid(simBoard);
        const moves = findAllMoves(grid);
        if (!moves.length) { console.log('No more moves.'); break; }
        move = moves[0];
      } else {
        if (si >= sequence.length) break;
        move = sequence[si];
        si++;
      }

      const g = parseGrid(simBoard);
      const vals = [];
      for (let r = move.r1; r <= move.r2; r++)
        for (let c = move.c1; c <= move.c2; c++)
          if (g[r][c] !== 0) vals.push(g[r][c]);

      await page.evaluate(() => { window.__wsLastResponse = null; });
      const result = useWs
        ? await executeMoveViaWs(page, move)
        : await executeMoveViaDrag(page, move, canvasInfo);
      if (!result.success) {
        console.log(`Move failed: ${result.error}. Retrying...`);
        await injectBoardReader(page);
        await page.waitForTimeout(300);
        const freshBoard = await readBoard(page);
        if (freshBoard) {
          simBoard = freshBoard;
          if (!instant) { sequence = findOptimalSequence(freshBoard, Math.min(COMPUTE_TIME_MS, 5000)); si = 0; }
          continue;
        }
        break;
      }

      const resp = await waitForWsResponse(page, 3000);
      if (resp && resp.ok) {
        const expectedBoard = simulateMove(simBoard, move);
        simBoard = resp.board || expectedBoard;
        totalRemoved += move.count;
        moveCount++;
        const seqInfo = instant ? '' : `/${sequence.length}`;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `[${elapsed}s] #${moveCount}${seqInfo}: ` +
          `(${move.r1},${move.c1})→(${move.r2},${move.c2}) ` +
          `${move.count} apples [${vals.join('+')}=${vals.reduce((a, b) => a + b, 0)}] ` +
          `score=${resp.score}`
        );

        if (resp.board && resp.board !== expectedBoard) {
          console.log('Server board diverged. Re-computing...');
          simBoard = resp.board;
          if (!instant) { sequence = findOptimalSequence(resp.board, Math.min(COMPUTE_TIME_MS, 5000)); si = 0; }
        }
      } else if (resp && !resp.ok) {
        console.log(`Move rejected: ${resp.error || JSON.stringify(resp)}. Retrying...`);
        if (resp.error === 'Game is not in progress') { console.log('Game ended.'); break; }
        await injectBoardReader(page);
        const freshBoard = await readBoard(page);
        if (freshBoard) {
          simBoard = freshBoard;
          if (!instant) { sequence = findOptimalSequence(freshBoard, Math.min(COMPUTE_TIME_MS, 5000)); si = 0; }
          continue;
        }
        break;
      } else {
        await page.waitForTimeout(300);
        await injectBoardReader(page);
        const freshBoard = await readBoard(page);
        if (freshBoard && freshBoard !== simBoard) {
          simBoard = freshBoard;
          totalRemoved += move.count;
          moveCount++;
          const seqInfo = instant ? '' : `/${sequence.length}`;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `[${elapsed}s] #${moveCount}${seqInfo}: ` +
            `(${move.r1},${move.c1})→(${move.r2},${move.c2}) ` +
            `${move.count} apples (no WS ack) total=${totalRemoved}`
          );
        } else {
          console.log('No response. Retrying...');
          if (freshBoard) {
            simBoard = freshBoard;
            if (!instant) { sequence = findOptimalSequence(freshBoard, Math.min(COMPUTE_TIME_MS, 5000)); si = 0; }
            continue;
          }
          console.log('Game may have ended.');
          break;
        }
      }

      await page.waitForTimeout(MOVE_DELAY_MS);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  Time: ${elapsed}s | Moves: ${moveCount} | Removed: ${totalRemoved}`);
    console.log(`${'='.repeat(50)}`);

  } else {
    // ─── Solo mode (always mouse drag) ─────────────────────────────────
    const startBtn = await page.$('button:has-text("Start"), button:has-text("시작"), button:has-text("게임 시작")');
    if (startBtn) { console.log('Clicking Start...'); await startBtn.click(); await page.waitForTimeout(1500); }

    let state = await getGameState(page);
    if (state !== 'playing') {
      console.log(`Waiting for playing state (current: ${state})...`);
      for (let i = 0; i < 120; i++) {
        await page.waitForTimeout(500);
        state = await getGameState(page);
        if (state === 'playing') break;
      }
    }
    console.log(`Game state: ${state}\n`);

    const testBoard = await readBoard(page);
    if (!testBoard) { console.error('Failed to read board. Exiting.'); await browser.close(); return; }
    console.log(`Board read OK (${testBoard.length} chars)`);
    const testGrid = parseGrid(testBoard);
    console.log('First row:', testGrid[0].join(' '));
    console.log(`Available moves: ${findAllMoves(testGrid).length}\n`);

    const canvasInfo = await getCanvasInfo(page);
    if (!canvasInfo) { console.error('No canvas found for drag. Exiting.'); await browser.close(); return; }
    console.log(`Canvas: ${canvasInfo.internalW}×${canvasInfo.internalH} displayed at (${Math.round(canvasInfo.pageX)},${Math.round(canvasInfo.pageY)})`);

    const instant = STRATEGY === 'instant';
    let sequence = [];
    if (!instant) {
      console.log(`\nComputing optimal sequence (${COMPUTE_TIME_MS / 1000}s)...`);
      sequence = findOptimalSequence(testBoard, COMPUTE_TIME_MS);
    }
    let simBoard = testBoard;

    let totalRemoved = 0;
    let moveCount = 0;
    const startTime = Date.now();
    let si = 0;

    while (true) {
      state = await getGameState(page);
      if (state === 'finished') { console.log('\nGame ended.'); break; }

      let move;
      if (instant) {
        const grid = parseGrid(simBoard);
        const moves = findAllMoves(grid);
        if (!moves.length) { console.log('No more moves.'); break; }
        move = moves[0];
      } else {
        if (si >= sequence.length) break;
        move = sequence[si];
        si++;
      }

      const grid = parseGrid(simBoard);
      const vals = [];
      for (let r = move.r1; r <= move.r2; r++)
        for (let c = move.c1; c <= move.c2; c++)
          if (grid[r][c] !== 0) vals.push(grid[r][c]);

      const result = await executeMoveViaDrag(page, move, canvasInfo);
      if (!result.success) {
        console.log(`Move failed: ${result.error}. Retrying...`);
        await injectBoardReader(page);
        await page.waitForTimeout(300);
        const freshBoard = await readBoard(page);
        if (freshBoard) {
          simBoard = freshBoard;
          if (!instant) { sequence = findOptimalSequence(freshBoard, Math.min(COMPUTE_TIME_MS, 5000)); si = 0; }
          continue;
        }
        break;
      }

      simBoard = simulateMove(simBoard, move);
      totalRemoved += move.count;
      moveCount++;

      const seqInfo = instant ? '' : `/${sequence.length}`;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[${elapsed}s] #${moveCount}${seqInfo}: ` +
        `(${move.r1},${move.c1})→(${move.r2},${move.c2}) ` +
        `${move.count} apples [${vals.join('+')}=${vals.reduce((a, b) => a + b, 0)}] ` +
        `total=${totalRemoved}`
      );

      await page.waitForTimeout(MOVE_DELAY_MS);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  Time: ${elapsed}s | Moves: ${moveCount} | Removed: ${totalRemoved}`);
    console.log(`${'='.repeat(50)}`);
  }

  await page.screenshot({ path: 'result.png' });
  console.log('Screenshot saved to result.png');

  console.log('\nBrowser open. Press Ctrl+C to exit.');
  await new Promise(() => {});
}

main().catch(console.error);
