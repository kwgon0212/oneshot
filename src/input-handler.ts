import { execSync, execFileSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

let screenWidth = 1920;
let screenHeight = 1080;
let screenOffsetX = 0;
let screenOffsetY = 0;

export function setScreenSize(width: number, height: number): void {
  screenWidth = width;
  screenHeight = height;
}

export function setScreenOffset(x: number, y: number): void {
  screenOffsetX = x;
  screenOffsetY = y;
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
    x: Math.round(xRatio * width) + screenOffsetX,
    y: Math.round(yRatio * height) + screenOffsetY,
  };
}

// --- macOS: CGEvent helper binary ---

const HELPER_DIR = join(homedir(), '.remote-desktop-ts');
const HELPER_PATH = join(HELPER_DIR, 'mouse_helper');

const HELPER_SOURCE = `
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Private API for Spaces
typedef int CGSConnectionID;
extern CGSConnectionID _CGSDefaultConnection(void);
extern CFArrayRef CGSCopyManagedDisplaySpaces(CGSConnectionID cid);

int main(int argc, char *argv[]) {
    if (argc < 2) return 1;

    if (strcmp(argv[1], "display-bounds") == 0 && argc >= 3) {
        int target = atoi(argv[2]);
        uint32_t totalCount = 0;
        CGGetActiveDisplayList(0, NULL, &totalCount);
        if ((uint32_t)target >= totalCount) { printf("0 0 1920 1080\\n"); return 0; }
        CGDirectDisplayID *allDisplays = (CGDirectDisplayID *)malloc(totalCount * sizeof(CGDirectDisplayID));
        CGGetActiveDisplayList(totalCount, allDisplays, &totalCount);
        CGRect bounds = CGDisplayBounds(allDisplays[target]);
        printf("%d %d %d %d\\n", (int)bounds.origin.x, (int)bounds.origin.y, (int)bounds.size.width, (int)bounds.size.height);
        free(allDisplays);
        return 0;
    }

    if (strcmp(argv[1], "display-for-point") == 0 && argc >= 4) {
        double x = atof(argv[2]), y = atof(argv[3]);
        uint32_t totalCount = 0;
        CGGetActiveDisplayList(0, NULL, &totalCount);
        if (totalCount == 0) { printf("-1\\n"); return 0; }
        CGDirectDisplayID *allDisplays = (CGDirectDisplayID *)malloc(totalCount * sizeof(CGDirectDisplayID));
        CGGetActiveDisplayList(totalCount, allDisplays, &totalCount);
        for (uint32_t i = 0; i < totalCount; i++) {
            CGRect bounds = CGDisplayBounds(allDisplays[i]);
            if (x >= bounds.origin.x && x < bounds.origin.x + bounds.size.width &&
                y >= bounds.origin.y && y < bounds.origin.y + bounds.size.height) {
                printf("%d\\n", (int)i);
                free(allDisplays);
                return 0;
            }
        }
        free(allDisplays);
        printf("-1\\n");
        return 0;
    }

    if (strcmp(argv[1], "info") == 0) {
        CGDirectDisplayID mainDisplay = CGMainDisplayID();
        size_t pw = CGDisplayPixelsWide(mainDisplay);
        size_t ph = CGDisplayPixelsHigh(mainDisplay);
        CGRect bounds = CGDisplayBounds(mainDisplay);
        printf("%d %d %d %d\\n", (int)bounds.size.width, (int)bounds.size.height, (int)pw, (int)ph);
        return 0;
    }

    if (strcmp(argv[1], "spaces") == 0) {
        CGSConnectionID cid = _CGSDefaultConnection();
        CFArrayRef displays = CGSCopyManagedDisplaySpaces(cid);
        if (!displays) { printf("0\\n"); return 0; }
        int total = 0;
        for (CFIndex i = 0; i < CFArrayGetCount(displays); i++) {
            CFDictionaryRef disp = (CFDictionaryRef)CFArrayGetValueAtIndex(displays, i);
            CFArrayRef spaces = (CFArrayRef)CFDictionaryGetValue(disp, CFSTR("Spaces"));
            if (spaces) {
                for (CFIndex j = 0; j < CFArrayGetCount(spaces); j++) {
                    CFDictionaryRef space = (CFDictionaryRef)CFArrayGetValueAtIndex(spaces, j);
                    CFNumberRef typeRef = (CFNumberRef)CFDictionaryGetValue(space, CFSTR("type"));
                    int type = 0;
                    if (typeRef) CFNumberGetValue(typeRef, kCFNumberIntType, &type);
                    // type 0 = normal desktop, type 4 = fullscreen app
                    if (type == 0) total++;
                }
            }
        }
        CFRelease(displays);
        printf("%d\\n", total);
        return 0;
    }

    if (strcmp(argv[1], "current-space") == 0) {
        CGSConnectionID cid = _CGSDefaultConnection();
        CFArrayRef displays = CGSCopyManagedDisplaySpaces(cid);
        if (!displays) { printf("0\\n"); return 0; }

        CFDictionaryRef disp = (CFDictionaryRef)CFArrayGetValueAtIndex(displays, 0);
        CFArrayRef spaces = (CFArrayRef)CFDictionaryGetValue(disp, CFSTR("Spaces"));
        CFDictionaryRef curSpace = (CFDictionaryRef)CFDictionaryGetValue(disp, CFSTR("Current Space"));
        if (!spaces || !curSpace) { CFRelease(displays); printf("0\\n"); return 0; }

        CFNumberRef curIdRef = (CFNumberRef)CFDictionaryGetValue(curSpace, CFSTR("ManagedSpaceID"));
        int64_t curId = 0;
        if (curIdRef) CFNumberGetValue(curIdRef, kCFNumberSInt64Type, &curId);

        int idx = 0;
        for (CFIndex j = 0; j < CFArrayGetCount(spaces); j++) {
            CFDictionaryRef space = (CFDictionaryRef)CFArrayGetValueAtIndex(spaces, j);
            CFNumberRef typeRef = (CFNumberRef)CFDictionaryGetValue(space, CFSTR("type"));
            int type = 0;
            if (typeRef) CFNumberGetValue(typeRef, kCFNumberIntType, &type);
            if (type == 0) {
                CFNumberRef idRef = (CFNumberRef)CFDictionaryGetValue(space, CFSTR("ManagedSpaceID"));
                int64_t sid = 0;
                if (idRef) CFNumberGetValue(idRef, kCFNumberSInt64Type, &sid);
                if (sid == curId) { printf("%d\\n", idx + 1); CFRelease(displays); return 0; }
                idx++;
            }
        }
        CFRelease(displays);
        printf("0\\n");
        return 0;
    }

    if (strcmp(argv[1], "move") == 0 && argc >= 4) {
        CGEventRef e = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved,
            CGPointMake(atof(argv[2]), atof(argv[3])), kCGMouseButtonLeft);
        CGEventPost(kCGHIDEventTap, e); CFRelease(e);
    }
    else if (strcmp(argv[1], "click") == 0 && argc >= 5) {
        double x = atof(argv[2]), y = atof(argv[3]);
        int right = atoi(argv[4]);
        CGEventType down = right ? kCGEventRightMouseDown : kCGEventLeftMouseDown;
        CGEventType up = right ? kCGEventRightMouseUp : kCGEventLeftMouseUp;
        CGMouseButton mb = right ? kCGMouseButtonRight : kCGMouseButtonLeft;
        CGEventRef e = CGEventCreateMouseEvent(NULL, down, CGPointMake(x, y), mb);
        CGEventPost(kCGHIDEventTap, e); CFRelease(e);
        usleep(10000);
        e = CGEventCreateMouseEvent(NULL, up, CGPointMake(x, y), mb);
        CGEventPost(kCGHIDEventTap, e); CFRelease(e);
    }
    else if (strcmp(argv[1], "down") == 0 && argc >= 5) {
        double x = atof(argv[2]), y = atof(argv[3]);
        int right = atoi(argv[4]);
        CGEventType t = right ? kCGEventRightMouseDown : kCGEventLeftMouseDown;
        CGMouseButton mb = right ? kCGMouseButtonRight : kCGMouseButtonLeft;
        CGEventRef e = CGEventCreateMouseEvent(NULL, t, CGPointMake(x, y), mb);
        CGEventPost(kCGHIDEventTap, e); CFRelease(e);
    }
    else if (strcmp(argv[1], "up") == 0 && argc >= 5) {
        double x = atof(argv[2]), y = atof(argv[3]);
        int right = atoi(argv[4]);
        CGEventType t = right ? kCGEventRightMouseUp : kCGEventLeftMouseUp;
        CGMouseButton mb = right ? kCGMouseButtonRight : kCGMouseButtonLeft;
        CGEventRef e = CGEventCreateMouseEvent(NULL, t, CGPointMake(x, y), mb);
        CGEventPost(kCGHIDEventTap, e); CFRelease(e);
    }
    else if (strcmp(argv[1], "scroll") == 0 && argc >= 3) {
        CGEventRef e = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, atoi(argv[2]));
        CGEventPost(kCGHIDEventTap, e); CFRelease(e);
    }
    else if (strcmp(argv[1], "type") == 0 && argc >= 3) {
        // Type unicode string (supports Korean, Japanese, emoji, etc.)
        CFStringRef str = CFStringCreateWithCString(NULL, argv[2], kCFStringEncodingUTF8);
        if (str) {
            CFIndex len = CFStringGetLength(str);
            UniChar *chars = (UniChar *)malloc(len * sizeof(UniChar));
            CFStringGetCharacters(str, CFRangeMake(0, len), chars);
            for (CFIndex i = 0; i < len; i++) {
                CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
                CGEventKeyboardSetUnicodeString(down, 1, &chars[i]);
                CGEventPost(kCGHIDEventTap, down);
                CFRelease(down);
                CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
                CGEventPost(kCGHIDEventTap, up);
                CFRelease(up);
                usleep(5000);
            }
            free(chars);
            CFRelease(str);
        }
    }
    return 0;
}
`;

let helperReady = false;

export function ensureMacHelper(): void {
  if (helperReady) return;
  if (existsSync(HELPER_PATH)) {
    helperReady = true;
    return;
  }

  if (!existsSync(HELPER_DIR)) {
    mkdirSync(HELPER_DIR, { recursive: true });
  }

  const srcPath = join(HELPER_DIR, 'mouse_helper.c');
  writeFileSync(srcPath, HELPER_SOURCE);

  try {
    execSync(`cc -framework ApplicationServices -o "${HELPER_PATH}" "${srcPath}"`, {
      stdio: 'ignore',
      timeout: 30000,
    });
    chmodSync(HELPER_PATH, 0o755);
    helperReady = true;
    console.log('✅ macOS 마우스 헬퍼 컴파일 완료');
  } catch {
    console.error('⚠️  마우스 헬퍼 컴파일 실패 (Xcode CLT 필요: xcode-select --install)');
  }
}

function macHelper(args: string[]): void {
  if (!helperReady) return;
  try {
    execFileSync(HELPER_PATH, args, { stdio: 'ignore', timeout: 2000 });
  } catch {
    // best effort
  }
}


export function getDisplayBounds(index: number): { x: number; y: number; w: number; h: number } | null {
  if (!helperReady) return null;
  try {
    const out = execFileSync(HELPER_PATH, ['display-bounds', String(index)], { encoding: 'utf-8', timeout: 2000 }).trim();
    const parts = out.split(' ').map(Number);
    if (parts.length >= 4) return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  } catch { /* ignore */ }
  return null;
}

export function getDisplayForPoint(x: number, y: number): number {
  if (!helperReady) return -1;
  try {
    const out = execFileSync(HELPER_PATH, ['display-for-point', String(x), String(y)], { encoding: 'utf-8', timeout: 2000 }).trim();
    return parseInt(out, 10);
  } catch { return -1; }
}

// Returns main display size in POINTS (not pixels) for correct coordinate mapping
export function getMainDisplayPoints(): { width: number; height: number } | null {
  if (!helperReady) return null;
  try {
    const out = execFileSync(HELPER_PATH, ['info'], { encoding: 'utf-8', timeout: 2000 }).trim();
    const parts = out.split(' ');
    if (parts.length >= 2) {
      return { width: parseInt(parts[0], 10), height: parseInt(parts[1], 10) };
    }
  } catch { /* ignore */ }
  return null;
}

function exec(cmd: string): void {
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 2000 });
  } catch {
    // best effort
  }
}

// --- macOS ---

function macMouseMove(x: number, y: number): void {
  macHelper(['move', String(x), String(y)]);
}

function macMouseClick(x: number, y: number, button: string): void {
  macHelper(['click', String(x), String(y), button === 'right' ? '1' : '0']);
}

function macMouseDown(x: number, y: number, button: string): void {
  macHelper(['down', String(x), String(y), button === 'right' ? '1' : '0']);
}

function macMouseUp(x: number, y: number, button: string): void {
  macHelper(['up', String(x), String(y), button === 'right' ? '1' : '0']);
}

function macScroll(deltaY: number): void {
  macHelper(['scroll', String(Math.round(deltaY))]);
}

function macTypeString(str: string): void {
  macHelper(['type', str]);
}

function macKeyTap(key: string, modifiers: string[]): void {
  // For single characters without modifiers, use CGEvent unicode typing (supports Korean etc.)
  if (key.length === 1 && modifiers.length === 0) {
    macTypeString(key);
    return;
  }

  let modStr = '';
  if (modifiers.includes('shift')) modStr += ' using shift down';
  if (modifiers.includes('ctrl') || modifiers.includes('control')) modStr += ' using control down';
  if (modifiers.includes('alt')) modStr += ' using option down';
  if (modifiers.includes('meta') || modifiers.includes('command')) modStr += ' using command down';

  if (key.length === 1) {
    // Single char with modifiers — use osascript keystroke
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
