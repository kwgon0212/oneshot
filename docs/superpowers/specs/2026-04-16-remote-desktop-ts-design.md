# remote-desktop-ts Design Spec

## Overview

`npx remote-desktop-ts --password <pw>` 한 줄로 실행하면, 노트북 화면을 어디서든 브라우저로 보고 조작할 수 있는 원격 데스크톱 서비스.

별도 서버, 도메인 구매, 포트포워딩, 네이티브 빌드 없이 동작해야 한다.

### 핵심 원칙

- **유저는 멍청하다**: 설치 실패, 권한 문제, 연결 끊김 등 모든 상황에서 유저가 뭘 해야 하는지 명확히 안내
- **npx 원클릭 실행**: 네이티브 컴파일이 필요한 패키지 사용 금지
- **제로 설정**: 도메인, 포트포워딩, 계정 등 사전 설정 없음

---

## 핵심 사용자 흐름

```
1. npx remote-desktop-ts --password mypass1234
2. 권한 체크 → 없으면 단계별 가이드 출력 후 종료
3. 터미널에 URL 출력 + 클립보드 자동 복사 + QR 코드
4. 다른 기기 브라우저에서 해당 URL 접속
5. 비밀번호 입력 → 화면 스트리밍 시작
6. 마우스/키보드/터치로 원격 조작
```

---

## 기술 스택

| 역할 | 선택 | 이유 |
|------|------|------|
| 언어 | TypeScript | 타입 안전성, npm 생태계 |
| 서버 | Express + ws | 가볍고 WebSocket 지원 |
| 화면 스트리밍 | WebSocket JPEG 스트리밍 | 네이티브 빌드 불필요, 안정적 |
| 외부 노출 | Cloudflare Tunnel (`cloudflared`) | 무료, 무계정, 임시 도메인 자동 발급 |
| 화면 캡처 | `screenshot-desktop` + `sharp` | 크로스플랫폼, sharp는 prebuilt 제공 |
| 입력 제어 | OS 네이티브 명령어 | 네이티브 빌드 불필요 |
| 인증 | CLI 비밀번호 인수 | 심플한 패스워드 게이트 |
| QR코드 | `qrcode-terminal` | 모바일 접속 편의성 |
| 클립보드 | `clipboardy` | URL 자동 복사 |

---

## 아키텍처

```
┌─────────────────────────────────────────────┐
│ 노트북 (Host)                                │
│                                             │
│  index.ts (CLI 오케스트레이터)                │
│    ├── permission-check.ts (권한 검사)        │
│    ├── server.ts (Express + WebSocket)       │
│    │     ├── /           → index.html        │
│    │     ├── /auth       → 비밀번호 검증       │
│    │     └── ws://       → 프레임+입력 중계    │
│    ├── capture.ts (화면 캡처 루프)             │
│    │     └── screenshot-desktop → sharp       │
│    ├── input-handler.ts (OS 입력 제어)        │
│    │     └── osascript / xdotool / PS        │
│    ├── tunnel.ts (cloudflared 관리)           │
│    └── auth.ts (세션 토큰)                    │
│                                             │
│  [localhost:3000] ──── cloudflared ────→     │
└─────────────────────────────────────────────┘
          │
    Cloudflare Edge
          │
    https://xxx.trycloudflare.com
          │
┌─────────────────────────────────────────────┐
│ 브라우저 (Viewer)                             │
│                                             │
│  index.html (단일 파일, 외부 의존성 없음)       │
│    ├── 로그인 화면 → 비밀번호 입력              │
│    ├── 스트리밍 화면 → JPEG 프레임 표시         │
│    ├── 입력 캡처 → 마우스/키보드/터치            │
│    ├── 자동 재연결 → 끊김 시 자동 복구          │
│    └── 적응형 품질 → 네트워크 기반 자동 조절     │
└─────────────────────────────────────────────┘
```

---

## 프로젝트 구조

```
remote-desktop-ts/
├── src/
│   ├── index.ts              # CLI 진입점, 전체 오케스트레이션
│   ├── server.ts             # Express + WebSocket 서버
│   ├── capture.ts            # 화면 캡처 루프 (screenshot-desktop + sharp)
│   ├── tunnel.ts             # cloudflared 바이너리 관리 + 프로세스 실행
│   ├── input-handler.ts      # OS 네이티브 입력 제어
│   ├── auth.ts               # 비밀번호 검증, 세션 토큰 관리
│   └── permission-check.ts   # OS별 권한 검사 + 안내
├── public/
│   └── index.html            # 브라우저 클라이언트 (단일 파일)
├── package.json
├── tsconfig.json
└── SPEC.md
```

---

## 모듈 상세 스펙

### `src/permission-check.ts`

시작 시 OS별 필수 권한 확인. 없으면 친절한 안내 출력 후 종료.

```typescript
async function checkPermissions(): Promise<void>
// macOS: 화면 녹화 권한 + 접근성 권한 체크
// Linux: xdotool 설치 여부 체크
// Windows: 추가 권한 불필요
```

**macOS 권한 체크 방법:**
- 화면 녹화: 테스트 캡처 실행 → 1x1 검은 이미지면 권한 없음
- 접근성: `osascript -e 'tell application "System Events" to keystroke ""'` → 에러면 권한 없음

**안내 메시지 예시 (macOS):**
```
⚠️  화면 캡처 권한이 필요합니다!

  1. 시스템 설정 열기 (아래 명령어 자동 실행됨)
  2. 개인정보 보호 및 보안 → 화면 녹화
  3. 터미널(또는 iTerm) 체크 ✅
  4. 터미널 재시작 후 다시 실행

  지금 시스템 설정을 열까요? (Y/n)
```

시스템 설정 자동 오픈: `open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"`

---

### `src/tunnel.ts`

cloudflared 바이너리 존재 확인 → 없으면 다운로드 → 프로세스 실행 → URL 추출.

```typescript
interface TunnelResult {
  url: string;          // "https://xxxx.trycloudflare.com"
  process: ChildProcess;
  kill: () => void;
}

async function startTunnel(localPort: number): Promise<TunnelResult>
async function ensureCloudflared(): Promise<string>   // 바이너리 경로 반환
function getCloudflaredDownloadUrl(): string           // OS/arch 기반 URL 결정
```

- 바이너리 저장 위치: `~/.remote-desktop-ts/cloudflared` (또는 `.exe`)
- 다운로드 시 프로그레스 바 표시
- 다운로드 후 `chmod +x` (Windows 제외)
- URL 파싱 타임아웃: 30초 (초과 시 에러)
- `process.on('exit', ...)` 에서 tunnel 종료

**다운로드 URL 패턴:**
```
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-{os}-{arch}
```

| OS | arch | 파일명 |
|----|------|--------|
| linux | x64 | `cloudflared-linux-amd64` |
| linux | arm64 | `cloudflared-linux-arm64` |
| darwin | x64 | `cloudflared-darwin-amd64` |
| darwin | arm64 | `cloudflared-darwin-arm64` |
| win32 | x64 | `cloudflared-windows-amd64.exe` |

**URL 파싱:**
```typescript
const urlMatch = data.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
```

---

### `src/server.ts`

Express HTTP + WebSocket 서버.

**HTTP 엔드포인트:**

| Method | Path | 설명 |
|--------|------|------|
| GET | `/` | `public/index.html` 제공 |
| POST | `/auth` | 비밀번호 검증 → 세션 토큰 발급 |

**WebSocket 메시지 프로토콜 (JSON):**

클라이언트 → 서버:
```jsonc
{ "type": "auth", "token": "..." }
{ "type": "mouse-move", "x": 0.5, "y": 0.5 }
{ "type": "mouse-click", "x": 0.5, "y": 0.5, "button": "left" }
{ "type": "mouse-down", "x": 0.5, "y": 0.5, "button": "left" }
{ "type": "mouse-up", "x": 0.5, "y": 0.5, "button": "left" }
{ "type": "mouse-scroll", "x": 0.5, "y": 0.5, "deltaY": -3 }
{ "type": "key-down", "key": "a", "modifiers": ["ctrl"] }
{ "type": "key-up", "key": "a" }
```

서버 → 클라이언트:
```jsonc
{ "type": "auth-ok", "token": "..." }
{ "type": "auth-fail" }
{ "type": "screen-info", "width": 1920, "height": 1080 }
{ "type": "frame", "data": "<base64 JPEG>" }
{ "type": "quality-adjust", "quality": 50, "scale": 0.6 }
```

---

### `src/capture.ts`

화면을 주기적으로 캡처해 WebSocket으로 JPEG 전송.

```typescript
interface CaptureOptions {
  fps: number;       // 기본 15
  quality: number;   // JPEG 품질 1-100, 기본 75
  scale: number;     // 축소 비율 0.1-1.0, 기본 0.8
}

function startCapture(options: CaptureOptions, onFrame: (jpeg: Buffer) => void): { stop: () => void }
```

- `screenshot-desktop`로 PNG 캡처
- `sharp`로 리사이즈 + JPEG 변환
- 프레임을 base64로 인코딩하여 WebSocket 전송
- 연결된 클라이언트 없으면 캡처 일시 중지 (CPU 절약)

**적응형 품질 조절:**
- 프레임 전송 완료까지 걸리는 시간 측정
- 목표 FPS 대비 느리면 → quality/scale 단계적 감소
- 여유 있으면 → 원래 설정으로 단계적 복원
- 클라이언트에 `quality-adjust` 메시지로 현재 상태 알림

---

### `src/input-handler.ts`

브라우저에서 수신한 입력 이벤트를 OS 네이티브 명령어로 변환.

```typescript
function handleMouseMove(xRatio: number, yRatio: number): void
function handleMouseClick(xRatio: number, yRatio: number, button: 'left'|'right'|'middle'): void
function handleMouseDown(xRatio: number, yRatio: number, button: 'left'|'right'|'middle'): void
function handleMouseUp(xRatio: number, yRatio: number, button: 'left'|'right'|'middle'): void
function handleMouseScroll(xRatio: number, yRatio: number, deltaY: number): void
function handleKeyDown(key: string, modifiers: string[]): void
function handleKeyUp(key: string): void
function getScreenSize(): { width: number, height: number }
```

**좌표 변환:** 비율(0~1) × 실제 해상도 = 절대 좌표. 범위 벗어나면 무시.

**OS별 구현:**

| 기능 | macOS | Linux | Windows |
|------|-------|-------|---------|
| 마우스 이동 | `cliclick` 또는 `osascript` | `xdotool mousemove` | PowerShell `SetCursorPos` |
| 마우스 클릭 | `cliclick` 또는 `osascript` | `xdotool click` | PowerShell `mouse_event` |
| 키 입력 | `osascript` | `xdotool key` | PowerShell `SendKeys` |
| 스크롤 | `osascript` | `xdotool click 4/5` | PowerShell `mouse_event` |
| 화면 크기 | `system_profiler` | `xdpyinfo` | PowerShell `Screen` |

**성능 최적화:**
- `child_process.exec`는 느리므로 마우스 이동은 throttle 적용 (최소 16ms 간격)
- macOS에서 `cliclick` 사용 시 바이너리를 프로젝트에 번들하거나 첫 실행 시 Homebrew 없이 다운로드

---

### `src/auth.ts`

비밀번호 검증 + 세션 토큰 관리.

```typescript
function verifyPassword(input: string, correct: string): boolean
function createSessionToken(): string    // crypto.randomBytes(32).toString('hex')
function isValidToken(token: string, tokens: Set<string>): boolean
```

- `crypto.timingSafeEqual`로 타이밍 공격 방지
- 세션 토큰은 메모리에만 저장
- 동시 접속 제한: 기본 1명 (새 접속 시 기존 연결 종료)

---

### `src/index.ts` (CLI 진입점)

```
실행 순서:
1. CLI 인수 파싱 (--password, --port, --fps, --quality, --scale)
2. --password 없으면 에러 + 사용법 출력 후 종료
3. 권한 체크 (permission-check.ts)
4. Express + WS 서버 시작
5. cloudflared 터널 시작 (URL 파싱 대기)
6. URL 클립보드 복사
7. 터미널에 URL + QR 코드 출력
8. 화면 캡처 루프 시작 (클라이언트 연결 시)
9. SIGINT/SIGTERM 시 graceful shutdown
```

**터미널 출력:**
```
✅ 서버 시작됨 (포트 3000)
🚇 Cloudflare Tunnel 연결 중...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 접속 URL:
   https://fancy-horse-abc123.trycloudflare.com

📋 클립보드에 복사됨!
🔑 비밀번호: mypass1234

📱 QR 코드:
   [QR코드 아스키 아트]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⌨️  Ctrl+C 로 종료
```

---

### `public/index.html` (브라우저 클라이언트)

단일 HTML 파일. CDN/번들러 없이 동작.

**UI 구성:**

1. **로그인 화면**: 비밀번호 입력 + 연결 버튼 (Enter 키 지원)
2. **스트리밍 화면**: 전체 화면 `<canvas>` (JPEG 프레임 렌더링)
3. **상태 표시**: 연결 상태, FPS, 품질 표시 (토글 가능)
4. **재연결 오버레이**: 연결 끊김 시 자동 표시

**스트리밍 렌더링:**
- WebSocket에서 base64 JPEG 수신
- `Image` 객체로 디코딩 → `<canvas>`에 drawImage
- canvas 사용 이유: `<img>` src 교체보다 메모리 효율적

**입력 이벤트 처리:**

| 이벤트 | 처리 | 비고 |
|--------|------|------|
| `mousemove` | throttle 30ms | 비율 좌표 변환 |
| `mousedown/mouseup` | 즉시 전송 | 좌/우/중간 구분 |
| `wheel` | 즉시 전송 | deltaY 전송 |
| `keydown/keyup` | 즉시 전송 | 수식키 포함 |
| `touchstart` | → mousedown | 모바일 지원 |
| `touchmove` | → mousemove, throttle 30ms | 모바일 드래그 |
| `touchend` | → mouseup | 모바일 지원 |
| 2-finger pinch | → scroll | 모바일 줌 |
| `contextmenu` | preventDefault | 우클릭 메뉴 방지 |
| F5, Ctrl+R 등 | preventDefault | 새로고침 방지 |

**자동 재연결:**
- WebSocket `onclose` → 3초 후 자동 재연결 시도
- 최대 10회 시도, 실패 시 "새로고침 해주세요" 메시지
- 재연결 중 화면에 반투명 오버레이 + 스피너

**적응형 품질 표시:**
- 서버에서 `quality-adjust` 메시지 수신 시 상태바에 표시
- 네트워크 느림 → "📶 낮은 품질" / 정상 → 표시 없음

---

## CLI 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--password` | (필수) | 접속 비밀번호 |
| `--port` | `3000` | 로컬 서버 포트 |
| `--fps` | `15` | 캡처 프레임레이트 |
| `--quality` | `75` | JPEG 품질 (1-100) |
| `--scale` | `0.8` | 화면 축소 비율 (0.1-1.0) |

---

## 보안

- HTTPS: Cloudflare Tunnel이 자동 처리
- 비밀번호 비교: `crypto.timingSafeEqual` (타이밍 공격 방지)
- 세션 토큰: `crypto.randomBytes(32)`, 메모리 저장
- 동시 접속: 기본 1명
- 입력 검증: 좌표 범위(0~1) 초과 시 무시

---

## 의존성 (네이티브 빌드 없는 것만)

| 패키지 | 용도 | 네이티브? |
|--------|------|-----------|
| `express` | HTTP 서버 | No |
| `ws` | WebSocket | No |
| `screenshot-desktop` | 화면 캡처 | No (OS 명령어 래퍼) |
| `sharp` | 이미지 변환 | Prebuilt 제공 |
| `clipboardy` | 클립보드 복사 | No (OS 명령어 래퍼) |
| `qrcode-terminal` | QR 코드 출력 | No |
| `commander` | CLI 인수 파싱 | No |

---

## 플랫폼 지원

| OS | 화면 캡처 | 입력 제어 | 비고 |
|----|-----------|-----------|------|
| macOS | ✅ | ✅ | 화면 녹화 + 접근성 권한 필요 (자동 안내) |
| Windows | ✅ | ✅ | 추가 권한 불필요 |
| Linux | ✅ | ✅ | X11 필요, xdotool 필요 (자동 안내) |
