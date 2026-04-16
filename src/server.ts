import express from 'express';
import http from 'http';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { verifyPassword, createSessionToken, isValidToken } from './auth';
import {
  handleMouseMove, handleMouseClick, handleMouseDown, handleMouseUp,
  handleMouseScroll, handleKeyDown, handleKeyUp, setScreenSize,
  ensureMacHelper, getMainDisplayPoints,
} from './input-handler';
import { startCapture, getScreenSize, CaptureOptions, CaptureSession } from './capture';

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

export async function createServer(options: ServerOptions): Promise<ServerInstance> {
  const { port, password, captureOptions } = options;
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const sessionTokens = new Set<string>();
  let activeClient: WebSocket | null = null;
  let captureSession: CaptureSession | null = null;

  // Serve static files
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

  // Compile macOS mouse helper if needed
  if (process.platform === 'darwin') {
    ensureMacHelper();
  }

  // Get screen size — use POINT dimensions for coordinate mapping (not pixels)
  // On Retina displays, screenshot pixels != mouse coordinate points
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

  // Adaptive quality state
  let currentQuality = captureOptions.quality;
  let currentScale = captureOptions.scale;
  const targetFrameTime = 1000 / captureOptions.fps;

  // System stats interval
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
        activeClient?.send(JSON.stringify({
          type: 'quality-adjust', quality: currentQuality, scale: currentScale,
        }));
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

    // Start sending system stats every 2 seconds
    if (!statsInterval) {
      statsInterval = setInterval(() => {
        if (activeClient && activeClient.readyState === WebSocket.OPEN) {
          activeClient.send(JSON.stringify({ type: 'system-stats', ...getSystemStats() }));
        }
      }, 2000);
    }
  }

  function stopStreaming(): void {
    if (captureSession) {
      captureSession.stop();
      captureSession = null;
    }
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
  }

  // WebSocket handling
  wss.on('connection', (ws) => {
    let authenticated = false;

    ws.on('message', (rawData) => {
      let msg: any;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      // Auth message
      if (msg.type === 'auth') {
        if (isValidToken(msg.token, sessionTokens)) {
          authenticated = true;

          // Disconnect previous client (single viewer)
          if (activeClient && activeClient !== ws && activeClient.readyState === WebSocket.OPEN) {
            activeClient.close(1000, 'New client connected');
          }
          activeClient = ws;

          // Send screen info (send screenshot pixel dimensions for canvas sizing)
          ws.send(JSON.stringify({
            type: 'screen-info',
            width: screenshotSize.width,
            height: screenshotSize.height,
          }));

          // Start streaming
          startStreaming();
        } else {
          ws.send(JSON.stringify({ type: 'auth-fail' }));
          ws.close();
        }
        return;
      }

      // All other messages require auth
      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'auth-fail' }));
        return;
      }

      // Input events
      switch (msg.type) {
        case 'mouse-move':
          handleMouseMove(msg.x, msg.y);
          break;
        case 'mouse-click':
          handleMouseClick(msg.x, msg.y, msg.button || 'left');
          break;
        case 'mouse-down':
          handleMouseDown(msg.x, msg.y, msg.button || 'left');
          break;
        case 'mouse-up':
          handleMouseUp(msg.x, msg.y, msg.button || 'left');
          break;
        case 'mouse-scroll':
          handleMouseScroll(msg.x, msg.y, msg.deltaY || 0);
          break;
        case 'key-down':
          handleKeyDown(msg.key, msg.modifiers || []);
          break;
        case 'key-up':
          handleKeyUp(msg.key);
          break;
        case 'set-fps':
          if (msg.fps && captureSession) {
            captureSession.updateFps(msg.fps);
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
        close: () => {
          stopStreaming();
          wss.close();
          server.close();
        },
      });
    });
  });
}
