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

  if (key.length === 1) {
    exec(`osascript -e 'tell application "System Events" to keystroke "${key}"${modStr}'`);
  } else {
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
