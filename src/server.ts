import express from 'express';
import http from 'http';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { verifyPassword, createSessionToken } from './auth.js';
import {
  handleMouseMove, handleMouseClick, handleMouseDown, handleMouseUp,
  handleMouseScroll, handleKeyDown, handleKeyUp, setScreenSize, setScreenOffset,
  ensureMacHelper, getMainDisplayPoints, getDisplayForPoint, getDisplayBounds,
  dimDisplay, restoreDisplay,
} from './input-handler.js';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { startCapture, getScreenSize, listDisplays, CaptureOptions, CaptureSession } from './capture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ServerOptions {
  port: number;
  username: string;
  password: string;
  captureOptions: CaptureOptions;
}

const SESSION_TTL = 30 * 60 * 1000; // 30분 세션 만료
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 30 * 1000; // 30초 잠금

export interface ServerInstance {
  httpServer: http.Server;
  wss: WebSocketServer;
  close: () => void;
}

function getSystemStats() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  const cpuPercent = Math.round((1 - totalIdle / totalTick) * 100);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const memUsedGB = ((totalMem - freeMem) / 1073741824).toFixed(1);
  const memTotalGB = (totalMem / 1073741824).toFixed(1);

  return { cpuPercent, memPercent, memUsedGB, memTotalGB };
}

function getWindowDisplayIndex(appName: string): number | null {
  try {
    const safe = appName.replace(/[^a-zA-Z0-9 \-_.가-힣]/g, '');
    const posOut = execSync(
      `osascript -e 'tell application "System Events" to get position of window 1 of process "${safe}"'`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    const [wx, wy] = posOut.split(',').map((s: string) => parseInt(s.trim(), 10));
    if (isNaN(wx) || isNaN(wy)) return null;
    const idx = getDisplayForPoint(wx, wy);
    return idx >= 0 ? idx : null;
  } catch { return null; }
}

export async function createServer(options: ServerOptions): Promise<ServerInstance> {
  const { port, username, password, captureOptions } = options;
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // Session management with expiry
  const sessionTokens = new Map<string, number>(); // token → lastActive timestamp
  let activeClient: WebSocket | null = null;
  let captureSession: CaptureSession | null = null;

  // Login attempt tracking per IP
  const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

  // Session cleanup interval
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, lastActive] of sessionTokens) {
      if (now - lastActive > SESSION_TTL) {
        sessionTokens.delete(token);
      }
    }
  }, 60000);

  function isTokenValid(token: string): boolean {
    const lastActive = sessionTokens.get(token);
    if (!lastActive) return false;
    if (Date.now() - lastActive > SESSION_TTL) {
      sessionTokens.delete(token);
      return false;
    }
    sessionTokens.set(token, Date.now()); // refresh
    return true;
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth endpoint with rate limiting
  app.post('/auth', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip);
    const now = Date.now();

    // Check lockout
    if (attempt && attempt.lockedUntil > now) {
      const remaining = Math.ceil((attempt.lockedUntil - now) / 1000);
      res.status(429).json({ type: 'auth-locked', remaining });
      return;
    }

    const { username: inputUser, password: inputPassword } = req.body;

    if (inputUser === username && verifyPassword(inputPassword, password)) {
      // Success — reset attempts
      loginAttempts.delete(ip);
      const token = createSessionToken();
      sessionTokens.set(token, Date.now());
      console.log(`🔓 로그인 성공 [${ip}]`);
      res.json({ type: 'auth-ok', token });
    } else {
      // Fail — increment attempts
      const current = attempt?.count || 0;
      const newCount = current + 1;
      if (newCount >= MAX_LOGIN_ATTEMPTS) {
        loginAttempts.set(ip, { count: newCount, lockedUntil: now + LOCKOUT_DURATION });
        console.log(`🔒 로그인 잠금 [${ip}] — ${MAX_LOGIN_ATTEMPTS}회 실패`);
        res.status(429).json({ type: 'auth-locked', remaining: LOCKOUT_DURATION / 1000 });
      } else {
        loginAttempts.set(ip, { count: newCount, lockedUntil: 0 });
        res.status(401).json({ type: 'auth-fail', attemptsLeft: MAX_LOGIN_ATTEMPTS - newCount });
      }
    }
  });

  // Brightness endpoint (macOS)
  let isDimmed = false;
  app.post('/brightness', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !isTokenValid(token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (process.platform !== 'darwin') {
      res.status(400).json({ error: 'macOS only' });
      return;
    }
    const { action } = req.body; // 'dim' | 'restore' | 'toggle'
    if (action === 'dim' || (action === 'toggle' && !isDimmed)) {
      dimDisplay();
      isDimmed = true;
      console.log('🌑 웹에서 디스플레이 끔');
    } else {
      restoreDisplay();
      isDimmed = false;
      console.log('💡 웹에서 디스플레이 켬');
    }
    res.json({ dimmed: isDimmed });
  });

  // Caffeinate endpoint (macOS) — prevent system/display sleep
  let caffeinateProc: ChildProcess | null = null;
  app.post('/caffeinate', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !isTokenValid(token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (process.platform !== 'darwin') {
      res.status(400).json({ error: 'macOS only' });
      return;
    }
    const { action } = req.body; // 'toggle'
    if (caffeinateProc) {
      caffeinateProc.kill();
      caffeinateProc = null;
      console.log('☕ caffeinate 종료');
      res.json({ active: false });
    } else {
      caffeinateProc = spawn('caffeinate', ['-d', '-i', '-s'], { stdio: 'ignore' });
      caffeinateProc.on('exit', () => { caffeinateProc = null; });
      console.log('☕ caffeinate 시작');
      res.json({ active: true });
    }
  });

  // Shutdown endpoint
  app.post('/shutdown', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !isTokenValid(token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ ok: true });
    setTimeout(() => {
      console.log('\n🛑 웹에서 종료 요청됨. 종료 중...');
      process.exit(0);
    }, 500);
  });

  // Compile macOS mouse helper
  if (process.platform === 'darwin') {
    ensureMacHelper();
  }

  // Screen size
  const screenshotSize = await getScreenSize();
  let displayWidth = screenshotSize.width;
  let displayHeight = screenshotSize.height;

  if (process.platform === 'darwin') {
    const displayPoints = getMainDisplayPoints();
    if (displayPoints) {
      console.log(`📐 디스플레이: ${displayPoints.width}x${displayPoints.height} 포인트 (캡처: ${screenshotSize.width}x${screenshotSize.height} 픽셀)`);
      displayWidth = displayPoints.width;
      displayHeight = displayPoints.height;
    }
  }

  setScreenSize(displayWidth, displayHeight);

  // Displays endpoint
  app.get('/displays', async (req, res) => {
    const authHeader = req.headers.authorization;
    const tk = authHeader?.replace('Bearer ', '');
    if (!tk || !isTokenValid(tk)) { res.status(401).json({ error: 'unauthorized' }); return; }
    const displays = await listDisplays();
    res.json({ displays });
  });

  // Apps endpoint — returns apps with window titles
  app.get('/apps', (req, res) => {
    const authHeader = req.headers.authorization;
    const tk = authHeader?.replace('Bearer ', '');
    if (!tk || !isTokenValid(tk)) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const script = `tell application "System Events"
  set o to ""
  set pList to every process whose background only is false
  repeat with p in pList
    set pName to name of p as text
    set wNames to ""
    try
      set wList to name of every window of p
      repeat with w in wList
        set wNames to wNames & "||" & (w as text)
      end repeat
    end try
    set o to o & pName & wNames & linefeed
  end repeat
  return o
end tell`;
      const lines = execSync(`osascript -e '${script}'`, {
        encoding: 'utf-8', timeout: 5000,
      }).trim().split('\n').filter(Boolean);

      const apps = lines.map((line: string) => {
        const parts = line.split('||');
        return { name: parts[0], windows: parts.slice(1).filter(Boolean) };
      });
      res.json({ apps });
    } catch (e: any) {
      console.error('앱 목록 조회 실패:', e.message);
      res.json({ apps: [] });
    }
  });

  // Adaptive quality
  let currentQuality = captureOptions.quality;
  let currentScale = captureOptions.scale;
  const targetFrameTime = 1000 / captureOptions.fps;
  let statsInterval: ReturnType<typeof setInterval> | null = null;

  function broadcastFrame(jpeg: Buffer): void {
    if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return;
    const start = Date.now();
    // Send raw binary JPEG — no base64 encoding, 33% smaller, faster
    activeClient.send(jpeg, { binary: true }, () => {
      const elapsed = Date.now() - start;
      if (elapsed > targetFrameTime * 1.5) {
        currentQuality = Math.max(20, currentQuality - 5);
        currentScale = Math.max(0.3, currentScale - 0.05);
        captureSession?.updateQuality(currentQuality, currentScale);
        activeClient?.send(JSON.stringify({ type: 'quality-adjust', quality: currentQuality, scale: currentScale }));
      } else if (elapsed < targetFrameTime * 0.5) {
        currentQuality = Math.min(captureOptions.quality, currentQuality + 2);
        currentScale = Math.min(captureOptions.scale, currentScale + 0.02);
        captureSession?.updateQuality(currentQuality, currentScale);
      }
    });
  }

  function startStreaming(): void {
    if (captureSession) return;
    captureSession = startCapture(captureOptions, broadcastFrame);
    if (!statsInterval) {
      statsInterval = setInterval(() => {
        if (activeClient && activeClient.readyState === WebSocket.OPEN) {
          activeClient.send(JSON.stringify({ type: 'system-stats', ...getSystemStats() }));
        }
      }, 2000);
    }
  }

  function stopStreaming(): void {
    if (captureSession) { captureSession.stop(); captureSession = null; }
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  }

  // Switch capture to a display by index and update coordinate mapping
  function switchDisplay(displayIdx: number) {
    if (captureSession) {
      captureSession.setDisplay(String(displayIdx));
      // Update mouse coordinate mapping to target display
      if (process.platform === 'darwin') {
        const bounds = getDisplayBounds(displayIdx);
        if (bounds) {
          setScreenSize(bounds.w, bounds.h);
          setScreenOffset(bounds.x, bounds.y);
        }
      }
      activeClient?.send(JSON.stringify({ type: 'display-changed', id: displayIdx }));
    }
  }

  // Activate app, optionally a specific window, and auto-switch display
  function activateApp(appName: string, windowIndex?: number) {
    const safe = appName.replace(/[^a-zA-Z0-9 \-_.가-힣]/g, '');
    try {
      if (windowIndex !== undefined && windowIndex >= 1) {
        const script = `tell application "System Events"
  tell process "${safe}"
    set frontmost to true
    try
      perform action "AXRaise" of window ${windowIndex}
    end try
  end tell
end tell`;
        execSync(`osascript -e '${script}'`, { stdio: 'ignore', timeout: 3000 });
      } else {
        execSync(`osascript -e 'tell application "${safe}" to activate'`, { stdio: 'ignore', timeout: 3000 });
      }

      // Auto-switch capture to the display where this app's window is
      setTimeout(() => {
        const idx = getWindowDisplayIndex(safe);
        if (idx !== null) {
          switchDisplay(idx);
        }
      }, 300); // Small delay for window to finish moving
    } catch { /* ignore */ }
  }

  // WebSocket handling
  wss.on('connection', (ws) => {
    let authenticated = false;

    ws.on('message', (rawData) => {
      let msg: any;
      try { msg = JSON.parse(rawData.toString()); } catch { return; }

      if (msg.type === 'auth') {
        if (isTokenValid(msg.token)) {
          authenticated = true;
          if (activeClient && activeClient !== ws && activeClient.readyState === WebSocket.OPEN) {
            activeClient.close(1000, 'New client connected');
          }
          activeClient = ws;
          ws.send(JSON.stringify({ type: 'screen-info', width: screenshotSize.width, height: screenshotSize.height }));
          startStreaming();
        } else {
          ws.send(JSON.stringify({ type: 'auth-fail' }));
          ws.close();
        }
        return;
      }

      if (!authenticated) { ws.send(JSON.stringify({ type: 'auth-fail' })); return; }

      switch (msg.type) {
        case 'mouse-move': handleMouseMove(msg.x, msg.y); break;
        case 'mouse-click': handleMouseClick(msg.x, msg.y, msg.button || 'left'); break;
        case 'mouse-down': handleMouseDown(msg.x, msg.y, msg.button || 'left'); break;
        case 'mouse-up': handleMouseUp(msg.x, msg.y, msg.button || 'left'); break;
        case 'mouse-scroll': handleMouseScroll(msg.x, msg.y, msg.deltaY || 0); break;
        case 'key-down': handleKeyDown(msg.key, msg.modifiers || []); break;
        case 'key-up': handleKeyUp(msg.key); break;
        case 'ping': ws.send(JSON.stringify({ type: 'pong', t: msg.t })); break;
        case 'type-text':
          if (msg.text && typeof msg.text === 'string') {
            // Direct unicode text input (Korean, etc.)
            for (const ch of msg.text) {
              handleKeyDown(ch, []);
            }
          }
          break;
        case 'set-fps':
          if (msg.fps && captureSession) captureSession.updateFps(msg.fps);
          break;
        case 'switch-display':
          switchDisplay(parseInt(msg.id, 10));
          break;
        case 'activate-app':
          if (msg.name && typeof msg.name === 'string') {
            activateApp(msg.name, msg.window ? parseInt(msg.window, 10) : undefined);
          }
          break;
      }
    });

    ws.on('close', () => {
      if (ws === activeClient) {
        activeClient = null;
        stopStreaming();
        currentQuality = captureOptions.quality;
        currentScale = captureOptions.scale;
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        httpServer: server,
        wss,
        close: () => { stopStreaming(); clearInterval(cleanupInterval); wss.close(); server.close(); },
      });
    });
  });
}
