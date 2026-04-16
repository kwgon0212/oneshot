import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import { spawn, ChildProcess } from 'child_process';
import { platform } from 'os';
import { HELPER_PATH } from './input-handler.js';

export interface CaptureOptions {
  fps: number;
  quality: number;
  scale: number;
}

export interface DisplayInfo {
  id: string;
  name: string;
}

export interface CaptureSession {
  stop: () => void;
  updateQuality: (quality: number, scale: number) => void;
  updateFps: (fps: number) => void;
  setDisplay: (id: string) => void;
}

let currentDisplayId: number | undefined;

export async function listDisplays(): Promise<DisplayInfo[]> {
  try {
    const displays = await screenshot.listDisplays();
    return displays.map((d: any, i: number) => ({
      id: String(d.id),
      name: d.name || `Display ${i + 1}`,
    }));
  } catch {
    return [];
  }
}

export async function getScreenSize(displayId?: string): Promise<{ width: number; height: number }> {
  const opts: any = { format: 'png' };
  if (displayId) opts.screen = parseInt(displayId, 10);
  const imgBuffer = await screenshot(opts) as Buffer;
  const metadata = await sharp(imgBuffer).metadata();
  return {
    width: metadata.width || 1920,
    height: metadata.height || 1080,
  };
}

// --- macOS Daemon Capture ---

class DaemonCapture {
  private proc: ChildProcess;
  private pending: ((buf: Buffer) => void) | null = null;
  private readBuf = Buffer.alloc(0);
  private readState: 'header' | 'body' = 'header';
  private bodyLen = 0;

  constructor(helperPath: string) {
    this.proc = spawn(helperPath, ['daemon'], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.on('exit', () => { this.proc = null as any; });
  }

  private onData(chunk: Buffer) {
    this.readBuf = Buffer.concat([this.readBuf, chunk]);
    while (true) {
      if (this.readState === 'header') {
        if (this.readBuf.length < 4) return;
        this.bodyLen = this.readBuf.readUInt32BE(0);
        this.readBuf = this.readBuf.subarray(4);
        if (this.bodyLen === 0) {
          if (this.pending) { this.pending(Buffer.alloc(0)); this.pending = null; }
          continue;
        }
        this.readState = 'body';
      }
      if (this.readState === 'body') {
        if (this.readBuf.length < this.bodyLen) return;
        const frame = this.readBuf.subarray(0, this.bodyLen);
        this.readBuf = this.readBuf.subarray(this.bodyLen);
        this.readState = 'header';
        if (this.pending) { this.pending(frame); this.pending = null; }
      }
    }
  }

  capture(displayIdx: number, quality: number, scale: number): Promise<Buffer> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.proc.stdin!.write(`cap ${displayIdx} ${quality} ${scale}\n`);
    });
  }

  kill() {
    if (this.proc) { this.proc.kill(); }
  }
}

let daemon: DaemonCapture | null = null;

function getDaemon(): DaemonCapture | null {
  if (platform() !== 'darwin') return null;
  if (!daemon) {
    try {
      daemon = new DaemonCapture(HELPER_PATH);
    } catch { return null; }
  }
  return daemon;
}

// --- Fallback capture (non-macOS) ---

async function fallbackCapture(quality: number, scale: number): Promise<Buffer> {
  const opts: any = { format: 'png' };
  if (currentDisplayId !== undefined) opts.screen = currentDisplayId;
  const imgBuffer = await screenshot(opts) as Buffer;
  const pipe = sharp(imgBuffer);
  if (scale < 0.99) {
    const metadata = await sharp(imgBuffer).metadata();
    const width = Math.round((metadata.width || 1920) * scale);
    const height = Math.round((metadata.height || 1080) * scale);
    pipe.resize(width, height);
  }
  return pipe.jpeg({ quality, chromaSubsampling: '4:2:0' }).toBuffer();
}

// --- Public API ---

export function startCapture(
  options: CaptureOptions,
  onFrame: (jpeg: Buffer) => void
): CaptureSession {
  let running = true;
  let currentQuality = options.quality;
  let currentScale = options.scale;
  let currentInterval = 1000 / options.fps;

  const loop = async () => {
    const d = getDaemon();
    while (running) {
      const start = Date.now();
      try {
        let frame: Buffer;
        if (d) {
          // macOS daemon — fast path
          frame = await d.capture(currentDisplayId || 0, currentQuality, currentScale);
        } else {
          // Fallback
          frame = await fallbackCapture(currentQuality, currentScale);
        }
        if (running && frame.length > 0) onFrame(frame);
      } catch {
        // Skip frame
      }
      const elapsed = Date.now() - start;
      const wait = Math.max(0, currentInterval - elapsed);
      if (wait > 0 && running) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };

  loop();

  return {
    stop: () => { running = false; if (daemon) { daemon.kill(); daemon = null; } },
    updateQuality: (quality: number, scale: number) => { currentQuality = quality; currentScale = scale; },
    updateFps: (fps: number) => { currentInterval = 1000 / Math.max(1, Math.min(30, fps)); },
    setDisplay: (id: string) => { currentDisplayId = parseInt(id, 10); },
  };
}
