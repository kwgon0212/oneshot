import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { verifyPassword, createSessionToken, isValidToken } from './auth';
import {
  handleMouseMove, handleMouseClick, handleMouseDown, handleMouseUp,
  handleMouseScroll, handleKeyDown, handleKeyUp, setScreenSize,
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

  // Get screen size for coordinate mapping
  const screenSize = await getScreenSize();
  setScreenSize(screenSize.width, screenSize.height);

  // Adaptive quality state
  let currentQuality = captureOptions.quality;
  let currentScale = captureOptions.scale;
  const targetFrameTime = 1000 / captureOptions.fps;

  function broadcastFrame(jpeg: Buffer): void {
    if (!activeClient || activeClient.readyState !== WebSocket.OPEN) return;

    const start = Date.now();
    const base64 = jpeg.toString('base64');
    activeClient.send(JSON.stringify({ type: 'frame', data: base64 }), () => {
      const elapsed = Date.now() - start;

      // Adaptive quality: if sending takes too long, reduce quality
      if (elapsed > targetFrameTime * 1.5) {
        currentQuality = Math.max(20, currentQuality - 5);
        currentScale = Math.max(0.3, currentScale - 0.05);
        captureSession?.updateQuality(currentQuality, currentScale);
        activeClient?.send(JSON.stringify({
          type: 'quality-adjust', quality: currentQuality, scale: currentScale,
        }));
      } else if (elapsed < targetFrameTime * 0.5) {
        // Room to improve quality
        currentQuality = Math.min(captureOptions.quality, currentQuality + 2);
        currentScale = Math.min(captureOptions.scale, currentScale + 0.02);
        captureSession?.updateQuality(currentQuality, currentScale);
      }
    });
  }

  function startStreaming(): void {
    if (captureSession) return;
    captureSession = startCapture(captureOptions, broadcastFrame);
  }

  function stopStreaming(): void {
    if (captureSession) {
      captureSession.stop();
      captureSession = null;
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

          // Send screen info
          ws.send(JSON.stringify({
            type: 'screen-info',
            width: screenSize.width,
            height: screenSize.height,
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
      }
    });

    ws.on('close', () => {
      if (ws === activeClient) {
        activeClient = null;
        stopStreaming();
        // Reset quality for next connection
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
