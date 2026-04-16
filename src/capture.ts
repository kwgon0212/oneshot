import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

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

let currentDisplayId: string | undefined;

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

export async function captureFrame(quality: number, scale: number): Promise<Buffer> {
  const opts: any = { format: 'png' };
  if (currentDisplayId) opts.screen = currentDisplayId;
  const imgBuffer = await screenshot(opts) as Buffer;
  const metadata = await sharp(imgBuffer).metadata();
  const width = Math.round((metadata.width || 1920) * scale);
  const height = Math.round((metadata.height || 1080) * scale);

  return sharp(imgBuffer)
    .resize(width, height)
    .jpeg({ quality })
    .toBuffer();
}

export async function getScreenSize(displayId?: string): Promise<{ width: number; height: number }> {
  const opts: any = { format: 'png' };
  if (displayId) opts.screen = displayId;
  const imgBuffer = await screenshot(opts) as Buffer;
  const metadata = await sharp(imgBuffer).metadata();
  return {
    width: metadata.width || 1920,
    height: metadata.height || 1080,
  };
}

export function startCapture(
  options: CaptureOptions,
  onFrame: (jpeg: Buffer) => void
): CaptureSession {
  let running = true;
  let currentQuality = options.quality;
  let currentScale = options.scale;
  let currentInterval = 1000 / options.fps;

  const loop = async () => {
    while (running) {
      const start = Date.now();
      try {
        const frame = await captureFrame(currentQuality, currentScale);
        if (running) onFrame(frame);
      } catch (err) {
        // Skip frame on capture error
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
    stop: () => { running = false; },
    updateQuality: (quality: number, scale: number) => {
      currentQuality = quality;
      currentScale = scale;
    },
    updateFps: (fps: number) => {
      currentInterval = 1000 / Math.max(1, Math.min(30, fps));
    },
    setDisplay: (id: string) => {
      currentDisplayId = id;
    },
  };
}
