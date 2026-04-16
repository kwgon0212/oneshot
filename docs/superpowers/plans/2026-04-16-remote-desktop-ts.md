# remote-desktop-ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-config remote desktop service that exposes the host screen via Cloudflare Tunnel, viewable and controllable from any browser with `npx remote-desktop-ts --password <pw>`.

**Architecture:** Express + WebSocket server captures the screen as JPEG frames and streams them over WebSocket to a single-file browser client. Input events (mouse/keyboard/touch) flow back over the same WebSocket and are translated to OS-native commands. Cloudflare Tunnel provides HTTPS access without port forwarding or domain purchase.

**Tech Stack:** TypeScript, Express, ws, screenshot-desktop, sharp, cloudflared (auto-downloaded binary), OS-native input (osascript/xdotool/PowerShell), commander, clipboardy, qrcode-terminal.

---

## File Structure

```
remote-desktop-ts/
├── src/
│   ├── index.ts              # CLI entry, orchestration
│   ├── server.ts             # Express + WebSocket server
│   ├── capture.ts            # Screen capture loop
│   ├── tunnel.ts             # cloudflared binary management
│   ├── input-handler.ts      # OS-native mouse/keyboard control
│   ├── auth.ts               # Password verification, session tokens
│   └── permission-check.ts   # OS permission checks + guidance
├── public/
│   └── index.html            # Browser client (single file, no deps)
├── package.json
├── tsconfig.json
└── SPEC.md
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create package.json**

```bash
cd /Users/u_goni/Desktop/oneshot
```

Create `package.json`:

```json
{
  "name": "remote-desktop-ts",
  "version": "1.0.0",
  "description": "Zero-config remote desktop via browser. One command, no setup.",
  "main": "dist/index.js",
  "bin": {
    "remote-desktop-ts": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "jest --forceExit"
  },
  "keywords": ["remote-desktop", "screen-sharing", "cloudflare-tunnel"],
  "license": "MIT",
  "dependencies": {
    "clipboardy": "^4.0.0",
    "commander": "^12.0.0",
    "express": "^4.21.0",
    "qrcode-terminal": "^0.12.0",
    "screenshot-desktop": "^1.15.0",
    "sharp": "^0.33.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.12",
    "@types/node": "^20.0.0",
    "@types/jest": "^29.5.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create jest.config.js**

Create `jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
};
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: All packages install without native compilation errors. `sharp` downloads prebuilt binaries.

- [ ] **Step 5: Create directory structure**

```bash
mkdir -p src public
```

- [ ] **Step 6: Verify TypeScript compiles**

Create a minimal `src/index.ts`:

```typescript
console.log('remote-desktop-ts');
```

Run:
```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git init
echo "node_modules/\ndist/\n*.js.map" > .gitignore
git add package.json tsconfig.json jest.config.js src/index.ts .gitignore
git commit -m "chore: scaffold project with dependencies"
```

---

### Task 2: Auth Module

**Files:**
- Create: `src/auth.ts`
- Create: `src/auth.test.ts`

- [ ] **Step 1: Write failing tests for auth**

Create `src/auth.test.ts`:

```typescript
import { verifyPassword, createSessionToken, isValidToken } from './auth';

describe('verifyPassword', () => {
  it('returns true for matching password', () => {
    expect(verifyPassword('mypass', 'mypass')).toBe(true);
  });

  it('returns false for wrong password', () => {
    expect(verifyPassword('wrong', 'mypass')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(verifyPassword('', 'mypass')).toBe(false);
  });

  it('handles different length passwords safely', () => {
    expect(verifyPassword('short', 'muchlongerpassword')).toBe(false);
  });
});

describe('createSessionToken', () => {
  it('returns a 64-char hex string', () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns unique tokens each call', () => {
    const t1 = createSessionToken();
    const t2 = createSessionToken();
    expect(t1).not.toBe(t2);
  });
});

describe('isValidToken', () => {
  it('returns true for token in set', () => {
    const tokens = new Set(['abc123']);
    expect(isValidToken('abc123', tokens)).toBe(true);
  });

  it('returns false for token not in set', () => {
    const tokens = new Set(['abc123']);
    expect(isValidToken('wrong', tokens)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/auth.test.ts --verbose
```

Expected: FAIL — cannot find module `./auth`.

- [ ] **Step 3: Implement auth module**

Create `src/auth.ts`:

```typescript
import crypto from 'crypto';

export function verifyPassword(input: string, correct: string): boolean {
  if (!input || !correct) return false;
  const inputBuf = Buffer.from(input);
  const correctBuf = Buffer.from(correct);
  if (inputBuf.length !== correctBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, correctBuf);
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isValidToken(token: string, tokens: Set<string>): boolean {
  return tokens.has(token);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/auth.test.ts --verbose
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts
git commit -m "feat: add auth module with password verification and session tokens"
```

---

### Task 3: Capture Module

**Files:**
- Create: `src/capture.ts`

- [ ] **Step 1: Implement capture module**

Create `src/capture.ts`:

```typescript
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

export interface CaptureOptions {
  fps: number;
  quality: number;
  scale: number;
}

export interface CaptureSession {
  stop: () => void;
  updateQuality: (quality: number, scale: number) => void;
}

export async function captureFrame(quality: number, scale: number): Promise<Buffer> {
  const imgBuffer = await screenshot({ format: 'png' }) as Buffer;
  const metadata = await sharp(imgBuffer).metadata();
  const width = Math.round((metadata.width || 1920) * scale);
  const height = Math.round((metadata.height || 1080) * scale);

  return sharp(imgBuffer)
    .resize(width, height)
    .jpeg({ quality })
    .toBuffer();
}

export async function getScreenSize(): Promise<{ width: number; height: number }> {
  const imgBuffer = await screenshot({ format: 'png' }) as Buffer;
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
  const interval = 1000 / options.fps;

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
      const wait = Math.max(0, interval - elapsed);
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
  };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/capture.ts
git commit -m "feat: add screen capture module with adaptive quality support"
```

---

### Task 4: Input Handler Module

**Files:**
- Create: `src/input-handler.ts`
- Create: `src/input-handler.test.ts`

- [ ] **Step 1: Write failing tests for coordinate conversion**

Create `src/input-handler.test.ts`:

```typescript
import { ratioToAbsolute, isValidRatio } from './input-handler';

describe('isValidRatio', () => {
  it('returns true for valid ratios', () => {
    expect(isValidRatio(0, 0)).toBe(true);
    expect(isValidRatio(0.5, 0.5)).toBe(true);
    expect(isValidRatio(1, 1)).toBe(true);
  });

  it('returns false for out-of-range ratios', () => {
    expect(isValidRatio(-0.1, 0.5)).toBe(false);
    expect(isValidRatio(0.5, 1.1)).toBe(false);
    expect(isValidRatio(NaN, 0.5)).toBe(false);
  });
});

describe('ratioToAbsolute', () => {
  it('converts ratio to absolute coordinates', () => {
    const result = ratioToAbsolute(0.5, 0.5, 1920, 1080);
    expect(result).toEqual({ x: 960, y: 540 });
  });

  it('handles 0,0', () => {
    const result = ratioToAbsolute(0, 0, 1920, 1080);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('handles 1,1', () => {
    const result = ratioToAbsolute(1, 1, 1920, 1080);
    expect(result).toEqual({ x: 1920, y: 1080 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/input-handler.test.ts --verbose
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement input handler**

Create `src/input-handler.ts`:

```typescript
import { execSync } from 'child_process';
import { platform } from 'os';

let screenWidth = 1920;
let screenHeight = 1080;

export function setScreenSize(width: number, height: number): void {
  screenWidth = width;
  screenHeight = height;
}

export function isValidRatio(x: number, y: number): boolean {
  return (
    typeof x === 'number' && typeof y === 'number' &&
    !isNaN(x) && !isNaN(y) &&
    x >= 0 && x <= 1 && y >= 0 && y <= 1
  );
}

export function ratioToAbsolute(
  xRatio: number, yRatio: number,
  width: number, height: number
): { x: number; y: number } {
  return {
    x: Math.round(xRatio * width),
    y: Math.round(yRatio * height),
  };
}

function exec(cmd: string): void {
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 2000 });
  } catch {
    // Ignore errors — best effort input
  }
}

// --- macOS ---

function macMouseMove(x: number, y: number): void {
  exec(`osascript -e 'tell application "System Events" to do shell script "python3 -c \\"import Quartz; Quartz.CGEventPost(0, Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (${x}, ${y}), 0))\\""'`);
}

function macMouseClick(x: number, y: number, button: string): void {
  if (button === 'right') {
    exec(`osascript -e 'tell application "System Events" to do shell script "python3 -c \\"import Quartz; e=Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventRightMouseDown, (${x}, ${y}), 1); Quartz.CGEventPost(0, e); e=Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventRightMouseUp, (${x}, ${y}), 1); Quartz.CGEventPost(0, e)\\""'`);
  } else {
    exec(`osascript -e 'tell application "System Events" to do shell script "python3 -c \\"import Quartz; e=Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, (${x}, ${y}), 0); Quartz.CGEventPost(0, e); e=Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, (${x}, ${y}), 0); Quartz.CGEventPost(0, e)\\""'`);
  }
}

function macMouseDown(x: number, y: number, button: string): void {
  const eventType = button === 'right' ? 'kCGEventRightMouseDown' : 'kCGEventLeftMouseDown';
  const btn = button === 'right' ? 1 : 0;
  exec(`osascript -e 'tell application "System Events" to do shell script "python3 -c \\"import Quartz; Quartz.CGEventPost(0, Quartz.CGEventCreateMouseEvent(None, Quartz.${eventType}, (${x}, ${y}), ${btn}))\\""'`);
}

function macMouseUp(x: number, y: number, button: string): void {
  const eventType = button === 'right' ? 'kCGEventRightMouseUp' : 'kCGEventLeftMouseUp';
  const btn = button === 'right' ? 1 : 0;
  exec(`osascript -e 'tell application "System Events" to do shell script "python3 -c \\"import Quartz; Quartz.CGEventPost(0, Quartz.CGEventCreateMouseEvent(None, Quartz.${eventType}, (${x}, ${y}), ${btn}))\\""'`);
}

function macScroll(deltaY: number): void {
  exec(`osascript -e 'tell application "System Events" to do shell script "python3 -c \\"import Quartz; e=Quartz.CGEventCreateScrollWheelEvent(None, 0, 1, ${Math.round(deltaY)}); Quartz.CGEventPost(0, e)\\""'`);
}

function macKeyTap(key: string, modifiers: string[]): void {
  let modStr = '';
  if (modifiers.includes('shift')) modStr += ' using shift down';
  if (modifiers.includes('ctrl') || modifiers.includes('control')) modStr += ' using control down';
  if (modifiers.includes('alt')) modStr += ' using option down';
  if (modifiers.includes('meta') || modifiers.includes('command')) modStr += ' using command down';

  // For single characters, use keystroke
  if (key.length === 1) {
    exec(`osascript -e 'tell application "System Events" to keystroke "${key}"${modStr}'`);
  } else {
    // Map special keys to key codes
    const keyCodeMap: Record<string, number> = {
      'Enter': 36, 'Return': 36, 'Tab': 48, 'Escape': 53,
      'Backspace': 51, 'Delete': 117, 'Space': 49,
      'ArrowUp': 126, 'ArrowDown': 125, 'ArrowLeft': 123, 'ArrowRight': 124,
      'Home': 115, 'End': 119, 'PageUp': 116, 'PageDown': 121,
      'F1': 122, 'F2': 120, 'F3': 99, 'F4': 118, 'F5': 96,
      'F6': 97, 'F7': 98, 'F8': 100, 'F9': 101, 'F10': 109,
      'F11': 103, 'F12': 111,
    };
    const code = keyCodeMap[key];
    if (code !== undefined) {
      exec(`osascript -e 'tell application "System Events" to key code ${code}${modStr}'`);
    }
  }
}

// --- Linux ---

function linuxMouseMove(x: number, y: number): void {
  exec(`xdotool mousemove ${x} ${y}`);
}

function linuxMouseClick(x: number, y: number, button: string): void {
  const btn = button === 'right' ? 3 : button === 'middle' ? 2 : 1;
  exec(`xdotool mousemove ${x} ${y} click ${btn}`);
}

function linuxMouseDown(x: number, y: number, button: string): void {
  const btn = button === 'right' ? 3 : button === 'middle' ? 2 : 1;
  exec(`xdotool mousemove ${x} ${y} mousedown ${btn}`);
}

function linuxMouseUp(x: number, y: number, button: string): void {
  const btn = button === 'right' ? 3 : button === 'middle' ? 2 : 1;
  exec(`xdotool mousemove ${x} ${y} mouseup ${btn}`);
}

function linuxScroll(deltaY: number): void {
  const btn = deltaY < 0 ? 4 : 5;
  const clicks = Math.abs(Math.round(deltaY));
  for (let i = 0; i < clicks; i++) {
    exec(`xdotool click ${btn}`);
  }
}

function linuxKeyTap(key: string, modifiers: string[]): void {
  const keyMap: Record<string, string> = {
    'Enter': 'Return', 'Backspace': 'BackSpace', 'Delete': 'Delete',
    'Escape': 'Escape', 'Tab': 'Tab', 'Space': 'space',
    'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
    'Home': 'Home', 'End': 'End', 'PageUp': 'Prior', 'PageDown': 'Next',
  };
  const xKey = keyMap[key] || key;
  const modParts = modifiers.map((m) => {
    if (m === 'ctrl' || m === 'control') return 'ctrl';
    if (m === 'alt') return 'alt';
    if (m === 'shift') return 'shift';
    if (m === 'meta' || m === 'command') return 'super';
    return m;
  });
  const prefix = modParts.length > 0 ? modParts.join('+') + '+' : '';
  exec(`xdotool key ${prefix}${xKey}`);
}

// --- Windows ---

function winMouseMove(x: number, y: number): void {
  exec(`powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); }'; [M]::SetCursorPos(${x}, ${y})"`);
}

function winMouseClick(x: number, y: number, button: string): void {
  const downFlag = button === 'right' ? '0x0008' : '0x0002';
  const upFlag = button === 'right' ? '0x0010' : '0x0004';
  exec(`powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f,int x,int y,int d,int e); }'; [M]::SetCursorPos(${x}, ${y}); [M]::mouse_event(${downFlag},0,0,0,0); [M]::mouse_event(${upFlag},0,0,0,0)"`);
}

function winMouseDown(x: number, y: number, button: string): void {
  const downFlag = button === 'right' ? '0x0008' : '0x0002';
  exec(`powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f,int x,int y,int d,int e); }'; [M]::SetCursorPos(${x}, ${y}); [M]::mouse_event(${downFlag},0,0,0,0)"`);
}

function winMouseUp(x: number, y: number, button: string): void {
  const upFlag = button === 'right' ? '0x0010' : '0x0004';
  exec(`powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f,int x,int y,int d,int e); }'; [M]::SetCursorPos(${x}, ${y}); [M]::mouse_event(${upFlag},0,0,0,0)"`);
}

function winScroll(deltaY: number): void {
  const amount = Math.round(deltaY * 120);
  exec(`powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f,int x,int y,int d,int e); }'; [M]::mouse_event(0x0800,0,0,${amount},0)"`);
}

function winKeyTap(key: string, modifiers: string[]): void {
  const keyMap: Record<string, string> = {
    'Enter': '{ENTER}', 'Backspace': '{BACKSPACE}', 'Delete': '{DELETE}',
    'Escape': '{ESC}', 'Tab': '{TAB}', 'Space': ' ',
    'ArrowUp': '{UP}', 'ArrowDown': '{DOWN}', 'ArrowLeft': '{LEFT}', 'ArrowRight': '{RIGHT}',
    'Home': '{HOME}', 'End': '{END}', 'PageUp': '{PGUP}', 'PageDown': '{PGDN}',
    'F1': '{F1}', 'F2': '{F2}', 'F3': '{F3}', 'F4': '{F4}', 'F5': '{F5}',
    'F6': '{F6}', 'F7': '{F7}', 'F8': '{F8}', 'F9': '{F9}', 'F10': '{F10}',
    'F11': '{F11}', 'F12': '{F12}',
  };
  let sendKey = keyMap[key] || key;
  if (modifiers.includes('ctrl') || modifiers.includes('control')) sendKey = '^' + sendKey;
  if (modifiers.includes('alt')) sendKey = '%' + sendKey;
  if (modifiers.includes('shift')) sendKey = '+' + sendKey;
  exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')"`);
}

// --- Dispatch ---

const os = platform();

export function handleMouseMove(xRatio: number, yRatio: number): void {
  if (!isValidRatio(xRatio, yRatio)) return;
  const { x, y } = ratioToAbsolute(xRatio, yRatio, screenWidth, screenHeight);
  if (os === 'darwin') macMouseMove(x, y);
  else if (os === 'linux') linuxMouseMove(x, y);
  else if (os === 'win32') winMouseMove(x, y);
}

export function handleMouseClick(xRatio: number, yRatio: number, button: string = 'left'): void {
  if (!isValidRatio(xRatio, yRatio)) return;
  const { x, y } = ratioToAbsolute(xRatio, yRatio, screenWidth, screenHeight);
  if (os === 'darwin') macMouseClick(x, y, button);
  else if (os === 'linux') linuxMouseClick(x, y, button);
  else if (os === 'win32') winMouseClick(x, y, button);
}

export function handleMouseDown(xRatio: number, yRatio: number, button: string = 'left'): void {
  if (!isValidRatio(xRatio, yRatio)) return;
  const { x, y } = ratioToAbsolute(xRatio, yRatio, screenWidth, screenHeight);
  if (os === 'darwin') macMouseDown(x, y, button);
  else if (os === 'linux') linuxMouseDown(x, y, button);
  else if (os === 'win32') winMouseDown(x, y, button);
}

export function handleMouseUp(xRatio: number, yRatio: number, button: string = 'left'): void {
  if (!isValidRatio(xRatio, yRatio)) return;
  const { x, y } = ratioToAbsolute(xRatio, yRatio, screenWidth, screenHeight);
  if (os === 'darwin') macMouseUp(x, y, button);
  else if (os === 'linux') linuxMouseUp(x, y, button);
  else if (os === 'win32') winMouseUp(x, y, button);
}

export function handleMouseScroll(xRatio: number, yRatio: number, deltaY: number): void {
  if (!isValidRatio(xRatio, yRatio)) return;
  // Move mouse to position first, then scroll
  handleMouseMove(xRatio, yRatio);
  if (os === 'darwin') macScroll(deltaY);
  else if (os === 'linux') linuxScroll(deltaY);
  else if (os === 'win32') winScroll(deltaY);
}

export function handleKeyDown(key: string, modifiers: string[] = []): void {
  if (os === 'darwin') macKeyTap(key, modifiers);
  else if (os === 'linux') linuxKeyTap(key, modifiers);
  else if (os === 'win32') winKeyTap(key, modifiers);
}

export function handleKeyUp(_key: string): void {
  // OS-native commands handle key press as atomic tap, no separate key-up needed
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/input-handler.test.ts --verbose
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/input-handler.ts src/input-handler.test.ts
git commit -m "feat: add OS-native input handler with coordinate conversion"
```

---

### Task 5: Permission Check Module

**Files:**
- Create: `src/permission-check.ts`

- [ ] **Step 1: Implement permission check**

Create `src/permission-check.ts`:

```typescript
import { execSync } from 'child_process';
import { platform } from 'os';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

async function checkScreenCapturePermission(): Promise<boolean> {
  try {
    const img = await screenshot({ format: 'png' }) as Buffer;
    const metadata = await sharp(img).metadata();
    // If we got a valid image with real dimensions, permission is granted
    return (metadata.width || 0) > 1 && (metadata.height || 0) > 1;
  } catch {
    return false;
  }
}

function checkAccessibilityPermission(): boolean {
  try {
    execSync('osascript -e \'tell application "System Events" to keystroke ""\'', {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function checkXdotool(): boolean {
  try {
    execSync('which xdotool', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function checkPermissions(): Promise<void> {
  const os = platform();

  if (os === 'darwin') {
    // Check screen capture
    const hasScreenCapture = await checkScreenCapturePermission();
    if (!hasScreenCapture) {
      console.error(`
⚠️  화면 캡처 권한이 필요합니다!

  1. 시스템 설정 → 개인정보 보호 및 보안 → 화면 녹화
  2. 터미널(또는 사용 중인 터미널 앱) 체크 ✅
  3. 터미널을 완전히 종료 후 다시 열기
  4. 다시 실행

  시스템 설정을 열려면:
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
`);
      try {
        execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
      } catch { /* ignore */ }
      process.exit(1);
    }

    // Check accessibility
    const hasAccessibility = checkAccessibilityPermission();
    if (!hasAccessibility) {
      console.error(`
⚠️  접근성 권한이 필요합니다! (키보드/마우스 제어용)

  1. 시스템 설정 → 개인정보 보호 및 보안 → 접근성
  2. 터미널(또는 사용 중인 터미널 앱) 체크 ✅
  3. 터미널을 완전히 종료 후 다시 열기
  4. 다시 실행

  시스템 설정을 열려면:
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
`);
      try {
        execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
      } catch { /* ignore */ }
      process.exit(1);
    }

    console.log('✅ macOS 권한 확인 완료');
  } else if (os === 'linux') {
    if (!checkXdotool()) {
      console.error(`
⚠️  xdotool이 설치되어 있지 않습니다! (키보드/마우스 제어용)

  설치 방법:
    Ubuntu/Debian: sudo apt install xdotool
    Fedora:        sudo dnf install xdotool
    Arch:          sudo pacman -S xdotool

  설치 후 다시 실행해주세요.
`);
      process.exit(1);
    }
    console.log('✅ Linux 환경 확인 완료');
  } else if (os === 'win32') {
    console.log('✅ Windows 환경 확인 완료');
  } else {
    console.error(`❌ 지원하지 않는 OS입니다: ${os}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/permission-check.ts
git commit -m "feat: add OS permission check with user-friendly guidance"
```

---

### Task 6: Tunnel Module

**Files:**
- Create: `src/tunnel.ts`
- Create: `src/tunnel.test.ts`

- [ ] **Step 1: Write failing test for URL parsing and download URL generation**

Create `src/tunnel.test.ts`:

```typescript
import { getCloudflaredDownloadUrl, parseCloudflareUrl } from './tunnel';

describe('getCloudflaredDownloadUrl', () => {
  it('returns correct URL for darwin arm64', () => {
    const url = getCloudflaredDownloadUrl('darwin', 'arm64');
    expect(url).toBe(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
    );
  });

  it('returns correct URL for linux x64', () => {
    const url = getCloudflaredDownloadUrl('linux', 'x64');
    expect(url).toBe(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
    );
  });

  it('returns correct URL for win32 x64', () => {
    const url = getCloudflaredDownloadUrl('win32', 'x64');
    expect(url).toBe(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    );
  });
});

describe('parseCloudflareUrl', () => {
  it('parses URL from cloudflared stderr output', () => {
    const line = 'Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://fancy-horse-abc123.trycloudflare.com';
    expect(parseCloudflareUrl(line)).toBe('https://fancy-horse-abc123.trycloudflare.com');
  });

  it('returns null for non-matching output', () => {
    expect(parseCloudflareUrl('Starting tunnel...')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/tunnel.test.ts --verbose
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement tunnel module**

Create `src/tunnel.ts`:

```typescript
import { spawn, ChildProcess, execSync } from 'child_process';
import { createWriteStream, existsSync, chmodSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform, arch } from 'os';
import https from 'https';
import http from 'http';

export interface TunnelResult {
  url: string;
  process: ChildProcess;
  kill: () => void;
}

const CLOUDFLARED_DIR = join(homedir(), '.remote-desktop-ts');

function getBinaryName(): string {
  const os = platform();
  if (os === 'win32') return 'cloudflared.exe';
  return 'cloudflared';
}

export function getCloudflaredDownloadUrl(os?: string, archName?: string): string {
  const currentOs = os || platform();
  const currentArch = archName || arch();

  const archMap: Record<string, string> = {
    x64: 'amd64',
    arm64: 'arm64',
  };
  const mappedArch = archMap[currentArch] || currentArch;

  if (currentOs === 'darwin') {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${mappedArch}.tgz`;
  } else if (currentOs === 'win32') {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${mappedArch}.exe`;
  } else {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${mappedArch}`;
  }
}

export function parseCloudflareUrl(data: string): string | null {
  const match = data.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
  return match ? match[0] : null;
}

function followRedirects(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (response: http.IncomingMessage) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        followRedirects(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const file = createWriteStream(dest);
      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write(`\r  다운로드 중... ${pct}%`);
        }
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        process.stdout.write('\r  다운로드 완료!        \n');
        resolve();
      });
      file.on('error', reject);
    };

    if (url.startsWith('https')) {
      https.get(url, handler).on('error', reject);
    } else {
      http.get(url, handler).on('error', reject);
    }
  });
}

async function downloadCloudflared(destPath: string): Promise<void> {
  const url = getCloudflaredDownloadUrl();
  const os = platform();

  console.log('📦 cloudflared 다운로드 중...');

  if (os === 'darwin') {
    // macOS: download .tgz and extract
    const tgzPath = destPath + '.tgz';
    await followRedirects(url, tgzPath);
    execSync(`tar -xzf "${tgzPath}" -C "${CLOUDFLARED_DIR}"`, { stdio: 'ignore' });
    try {
      const { unlinkSync } = require('fs');
      unlinkSync(tgzPath);
    } catch { /* ignore */ }
  } else {
    await followRedirects(url, destPath);
  }

  if (os !== 'win32') {
    chmodSync(destPath, 0o755);
  }
}

export async function ensureCloudflared(): Promise<string> {
  // Check PATH first
  try {
    const pathResult = execSync('which cloudflared 2>/dev/null || where cloudflared 2>nul', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (pathResult) {
      console.log('✅ cloudflared 발견 (시스템 설치)');
      return pathResult;
    }
  } catch { /* not in PATH */ }

  // Check local install
  const binaryPath = join(CLOUDFLARED_DIR, getBinaryName());
  if (existsSync(binaryPath)) {
    console.log('✅ cloudflared 발견 (로컬 설치)');
    return binaryPath;
  }

  // Download
  if (!existsSync(CLOUDFLARED_DIR)) {
    mkdirSync(CLOUDFLARED_DIR, { recursive: true });
  }
  await downloadCloudflared(binaryPath);
  console.log('✅ cloudflared 설치 완료');
  return binaryPath;
}

export async function startTunnel(localPort: number): Promise<TunnelResult> {
  const binaryPath = await ensureCloudflared();

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ['tunnel', '--url', `http://localhost:${localPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        child.kill();
        reject(new Error('cloudflared URL 파싱 타임아웃 (30초)'));
      }
    }, 30000);

    const handleData = (data: Buffer) => {
      const text = data.toString();
      const url = parseCloudflareUrl(text);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          url,
          process: child,
          kill: () => child.kill(),
        });
      }
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared 실행 실패: ${err.message}`));
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared 프로세스 종료 (코드: ${code})`));
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/tunnel.test.ts --verbose
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tunnel.ts src/tunnel.test.ts
git commit -m "feat: add cloudflared tunnel management with auto-download"
```

---

### Task 7: Server Module

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Implement server module**

Create `src/server.ts`:

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add Express + WebSocket server with JPEG streaming and input relay"
```

---

### Task 8: Browser Client

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create the browser client**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Remote Desktop</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; height: 100vh; width: 100vw; }

  /* Login Screen */
  #login-screen { display: flex; align-items: center; justify-content: center; height: 100vh; }
  .login-box { background: #16213e; padding: 40px; border-radius: 12px; text-align: center; min-width: 320px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  .login-box h1 { font-size: 24px; margin-bottom: 8px; }
  .login-box p { color: #888; margin-bottom: 24px; font-size: 14px; }
  .login-box input { width: 100%; padding: 12px 16px; border: 2px solid #333; border-radius: 8px; background: #0f1629; color: #eee; font-size: 16px; outline: none; margin-bottom: 16px; }
  .login-box input:focus { border-color: #4a9eff; }
  .login-box button { width: 100%; padding: 12px; border: none; border-radius: 8px; background: #4a9eff; color: #fff; font-size: 16px; cursor: pointer; font-weight: 600; }
  .login-box button:hover { background: #3a8eef; }
  .login-box button:disabled { background: #555; cursor: not-allowed; }
  .login-error { color: #ff6b6b; margin-top: 12px; font-size: 14px; display: none; }

  /* Stream Screen */
  #stream-screen { display: none; width: 100vw; height: 100vh; position: relative; }
  #canvas { width: 100%; height: 100%; object-fit: contain; cursor: default; display: block; background: #000; }

  /* Status Bar */
  #status-bar { position: fixed; top: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #aaa; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-family: monospace; z-index: 100; display: none; }

  /* Reconnect Overlay */
  #reconnect-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 200; align-items: center; justify-content: center; flex-direction: column; }
  .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #4a9eff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #reconnect-msg { font-size: 16px; color: #ccc; }
</style>
</head>
<body>

<!-- Login -->
<div id="login-screen">
  <div class="login-box">
    <h1>Remote Desktop</h1>
    <p>비밀번호를 입력하세요</p>
    <input type="password" id="password-input" placeholder="비밀번호" autofocus>
    <button id="connect-btn">연결</button>
    <div class="login-error" id="login-error">비밀번호가 틀렸습니다</div>
  </div>
</div>

<!-- Stream -->
<div id="stream-screen">
  <canvas id="canvas"></canvas>
  <div id="status-bar">
    <span id="fps-display">0 FPS</span> |
    <span id="quality-display">Q:75</span>
  </div>
</div>

<!-- Reconnect Overlay -->
<div id="reconnect-overlay">
  <div class="spinner"></div>
  <div id="reconnect-msg">재연결 중...</div>
</div>

<script>
(function() {
  'use strict';

  // --- State ---
  let ws = null;
  let token = null;
  let screenWidth = 1920;
  let screenHeight = 1080;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;
  let frameCount = 0;
  let lastFpsTime = Date.now();
  let showStatus = false;

  // --- Elements ---
  const loginScreen = document.getElementById('login-screen');
  const streamScreen = document.getElementById('stream-screen');
  const passwordInput = document.getElementById('password-input');
  const connectBtn = document.getElementById('connect-btn');
  const loginError = document.getElementById('login-error');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const statusBar = document.getElementById('status-bar');
  const fpsDisplay = document.getElementById('fps-display');
  const qualityDisplay = document.getElementById('quality-display');
  const reconnectOverlay = document.getElementById('reconnect-overlay');
  const reconnectMsg = document.getElementById('reconnect-msg');

  // --- Auth ---
  async function authenticate() {
    const pw = passwordInput.value;
    if (!pw) return;
    connectBtn.disabled = true;
    loginError.style.display = 'none';

    try {
      const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (data.type === 'auth-ok') {
        token = data.token;
        loginScreen.style.display = 'none';
        streamScreen.style.display = 'block';
        connectWebSocket();
      } else {
        loginError.style.display = 'block';
        connectBtn.disabled = false;
      }
    } catch (err) {
      loginError.textContent = '연결 실패. 다시 시도해주세요.';
      loginError.style.display = 'block';
      connectBtn.disabled = false;
    }
  }

  connectBtn.addEventListener('click', authenticate);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') authenticate();
  });

  // --- WebSocket ---
  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function connectWebSocket() {
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      reconnectAttempts = 0;
      reconnectOverlay.style.display = 'none';
      ws.send(JSON.stringify({ type: 'auth', token: token }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case 'auth-fail':
          token = null;
          loginScreen.style.display = 'flex';
          streamScreen.style.display = 'none';
          loginError.textContent = '세션 만료. 다시 로그인해주세요.';
          loginError.style.display = 'block';
          connectBtn.disabled = false;
          break;

        case 'screen-info':
          screenWidth = msg.width;
          screenHeight = msg.height;
          canvas.width = msg.width;
          canvas.height = msg.height;
          break;

        case 'frame':
          renderFrame(msg.data);
          break;

        case 'quality-adjust':
          qualityDisplay.textContent = 'Q:' + msg.quality;
          break;
      }
    };

    ws.onclose = () => {
      if (!token) return; // Don't reconnect if logged out
      attemptReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT) {
      reconnectMsg.textContent = '연결 실패. 페이지를 새로고침 해주세요.';
      reconnectOverlay.style.display = 'flex';
      return;
    }
    reconnectAttempts++;
    reconnectMsg.textContent = '재연결 중... (' + reconnectAttempts + '/' + MAX_RECONNECT + ')';
    reconnectOverlay.style.display = 'flex';
    setTimeout(connectWebSocket, 3000);
  }

  // --- Rendering ---
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
      fpsDisplay.textContent = frameCount + ' FPS';
      frameCount = 0;
      lastFpsTime = now;
    }
  };

  function renderFrame(base64Data) {
    img.src = 'data:image/jpeg;base64,' + base64Data;
  }

  // --- Input: Mouse ---
  function getCanvasRatio(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function getButton(e) {
    if (e.button === 2) return 'right';
    if (e.button === 1) return 'middle';
    return 'left';
  }

  function sendInput(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // Throttle mouse move
  let lastMoveTime = 0;
  canvas.addEventListener('mousemove', (e) => {
    const now = Date.now();
    if (now - lastMoveTime < 30) return;
    lastMoveTime = now;
    const r = getCanvasRatio(e);
    sendInput({ type: 'mouse-move', x: r.x, y: r.y });
  });

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const r = getCanvasRatio(e);
    sendInput({ type: 'mouse-down', x: r.x, y: r.y, button: getButton(e) });
  });

  canvas.addEventListener('mouseup', (e) => {
    e.preventDefault();
    const r = getCanvasRatio(e);
    sendInput({ type: 'mouse-up', x: r.x, y: r.y, button: getButton(e) });
  });

  canvas.addEventListener('click', (e) => {
    e.preventDefault();
    const r = getCanvasRatio(e);
    sendInput({ type: 'mouse-click', x: r.x, y: r.y, button: getButton(e) });
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = getCanvasRatio(e);
    const deltaY = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 10);
    sendInput({ type: 'mouse-scroll', x: r.x, y: r.y, deltaY: deltaY });
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- Input: Keyboard ---
  function getModifiers(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.shiftKey) mods.push('shift');
    if (e.altKey) mods.push('alt');
    if (e.metaKey) mods.push('meta');
    return mods;
  }

  document.addEventListener('keydown', (e) => {
    if (streamScreen.style.display === 'none') return;
    // Prevent browser shortcuts
    if (['F5', 'F11', 'F12'].includes(e.key) || (e.ctrlKey && ['r', 'w', 't', 'n', 'l'].includes(e.key.toLowerCase()))) {
      e.preventDefault();
    }
    sendInput({ type: 'key-down', key: e.key, modifiers: getModifiers(e) });
  });

  document.addEventListener('keyup', (e) => {
    if (streamScreen.style.display === 'none') return;
    sendInput({ type: 'key-up', key: e.key });
  });

  // --- Input: Touch (Mobile) ---
  let touchStartPos = null;
  let lastTouchMoveTime = 0;

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const r = getCanvasRatio(touch);
      touchStartPos = r;
      sendInput({ type: 'mouse-move', x: r.x, y: r.y });
      sendInput({ type: 'mouse-down', x: r.x, y: r.y, button: 'left' });
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastTouchMoveTime < 30) return;
    lastTouchMoveTime = now;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const r = getCanvasRatio(touch);
      sendInput({ type: 'mouse-move', x: r.x, y: r.y });
    } else if (e.touches.length === 2) {
      // Pinch → scroll
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (!canvas._lastPinchDist) {
        canvas._lastPinchDist = dist;
        return;
      }
      const delta = canvas._lastPinchDist - dist;
      canvas._lastPinchDist = dist;
      if (Math.abs(delta) > 2) {
        const midR = getCanvasRatio({
          clientX: (t1.clientX + t2.clientX) / 2,
          clientY: (t1.clientY + t2.clientY) / 2,
        });
        sendInput({ type: 'mouse-scroll', x: midR.x, y: midR.y, deltaY: delta > 0 ? 3 : -3 });
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    canvas._lastPinchDist = null;
    if (touchStartPos) {
      sendInput({ type: 'mouse-up', x: touchStartPos.x, y: touchStartPos.y, button: 'left' });
      touchStartPos = null;
    }
  }, { passive: false });

  // --- Status Toggle (press 'i' to toggle) ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'i' && !e.ctrlKey && !e.altKey && !e.metaKey && streamScreen.style.display !== 'none') {
      showStatus = !showStatus;
      statusBar.style.display = showStatus ? 'block' : 'none';
    }
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the HTML is valid by opening in browser**

Open the file manually or check syntax:
```bash
cat public/index.html | head -5
```

Expected: Valid HTML file.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add browser client with streaming, input capture, touch and auto-reconnect"
```

---

### Task 9: CLI Entry Point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement CLI entry point**

Replace `src/index.ts` with:

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { checkPermissions } from './permission-check';
import { createServer } from './server';
import { startTunnel, TunnelResult } from './tunnel';

const program = new Command();

program
  .name('remote-desktop-ts')
  .description('Zero-config remote desktop via browser')
  .requiredOption('--password <password>', 'Access password (required)')
  .option('--port <number>', 'Local server port', '3000')
  .option('--fps <number>', 'Capture frame rate', '15')
  .option('--quality <number>', 'JPEG quality (1-100)', '75')
  .option('--scale <number>', 'Screen scale (0.1-1.0)', '0.8')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const fps = parseInt(opts.fps, 10);
    const quality = parseInt(opts.quality, 10);
    const scale = parseFloat(opts.scale);

    // Permission check
    await checkPermissions();

    // Start server
    const server = await createServer({
      port,
      password: opts.password,
      captureOptions: { fps, quality, scale },
    });
    console.log(`✅ 서버 시작됨 (포트 ${port})`);

    // Start tunnel
    console.log('🚇 Cloudflare Tunnel 연결 중...');
    let tunnel: TunnelResult;
    try {
      tunnel = await startTunnel(port);
    } catch (err: any) {
      console.error(`❌ 터널 연결 실패: ${err.message}`);
      server.close();
      process.exit(1);
    }

    // Copy to clipboard
    try {
      const clipboardy = await import('clipboardy');
      await clipboardy.default.write(tunnel.url);
    } catch {
      // clipboardy may fail in some environments, ignore
    }

    // Print QR code
    const qrcode = await import('qrcode-terminal');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🌐 접속 URL:`);
    console.log(`   ${tunnel.url}`);
    console.log('');
    console.log(`📋 클립보드에 복사됨!`);
    console.log(`🔑 비밀번호: ${opts.password}`);
    console.log('');
    console.log('📱 QR 코드:');
    qrcode.generate(tunnel.url, { small: true }, (qr: string) => {
      console.log(qr);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⌨️  Ctrl+C 로 종료');

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n🛑 종료 중...');
      tunnel.kill();
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parse();
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point with tunnel, QR code and clipboard support"
```

---

### Task 10: Build, Wire Up, and End-to-End Test

**Files:**
- Modify: `package.json` (add bin shebang handling)

- [ ] **Step 1: Build the project**

```bash
npx tsc
```

Expected: Compiles to `dist/` without errors.

- [ ] **Step 2: Test the full flow locally (without tunnel)**

Start the server locally to test basic functionality:

```bash
node dist/index.js --password testpass --port 3000
```

Expected:
- Permission check passes (or shows guidance)
- Server starts on port 3000
- cloudflared downloads (if not present) and starts
- URL prints with QR code

Open `http://localhost:3000` in browser:
- Login screen appears
- Enter "testpass" → stream starts
- Mouse/keyboard events work

- [ ] **Step 3: Verify npx-readiness**

Check that `package.json` bin field is correct and shebang is in place:

```bash
head -1 dist/index.js
```

Expected: `#!/usr/bin/env node`

If missing, TypeScript won't add it automatically. Add a `postbuild` script to package.json:

In `package.json`, add to scripts:
```json
"postbuild": "echo '#!/usr/bin/env node' | cat - dist/index.js > temp && mv temp dist/index.js"
```

Or adjust `src/index.ts` to already have the shebang (already done in Task 9).

- [ ] **Step 4: Run all tests**

```bash
npx jest --verbose --forceExit
```

Expected: All tests pass (auth: 6, input-handler: 5, tunnel: 5 = 16 total).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: build and verify end-to-end flow"
```
