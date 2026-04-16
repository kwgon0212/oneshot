import express from 'express';
import http from 'http';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { verifyPassword, createSessionToken, isValidToken } from './auth';
import {
  handleMouseMove, handleMouseClick, handleMouseDown, handleMouseUp,
  handleMouseScroll, handleKeyDown, handleKeyUp, setScreenSize, setScreenOffset,
  ensureMacHelper, getMainDisplayPoints, getDisplayForPoint, getDisplayBounds,
} from './input-handler';
import { execSync } from 'child_process';
import { startCapture, getScreenSize, listDisplays, CaptureOptions, CaptureSession } from './capture';

interface ServerOptions {
  port: number;
  password: string;
  captureOptions: CaptureOptions;
}

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
  const { port, password, captureOptions } = options;
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const sessionTokens = new Set<string>();
  let activeClient: WebSocket | null = null;
  let captureSession: CaptureSession | null = null;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Auth endpoint
  app.post('/auth', (req, res) => {
    const { password: inputPassword } = req.body;
    if (verifyPassword(inputPassword, password)) {
      const token = createSessionToken();
      sessionTokens.add(token);
      res.json({ type: 'auth-ok', token });
    } else {
      res.status(401).json({ type: 'auth-fail' });
    }
  });

  // Shutdown endpoint
  app.post('/shutdown', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !isValidToken(token, sessionTokens)) {
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
    if (!tk || !isValidToken(tk, sessionTokens)) { res.status(401).json({ error: 'unauthorized' }); return; }
    const displays = await listDisplays();
    res.json({ displays });
  });

  // Apps endpoint — returns apps with window titles
  app.get('/apps', (req, res) => {
    const authHeader = req.headers.authorization;
    const tk = authHeader?.replace('Bearer ', '');
    if (!tk || !isValidToken(tk, sessionTokens)) { res.status(401).json({ error: 'unauthorized' }); return; }
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
    const base64 = jpeg.toString('base64');
    activeClient.send(JSON.stringify({ type: 'frame', data: base64 }), () => {
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
        if (isValidToken(msg.token, sessionTokens)) {
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
        close: () => { stopStreaming(); wss.close(); server.close(); },
      });
    });
  });
}
