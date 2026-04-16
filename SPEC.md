# remote-desktop-ts — Project Specification

## 개요

`npx remote-desktop-ts --password <비밀번호>` 한 줄로 실행하면,
노트북 화면을 **어디서든 브라우저로 보고 조작**할 수 있는 원격 데스크톱 서비스.

별도 서버, 도메인 구매, 포트포워딩 없이 동작해야 한다.

---

## 핵심 사용자 흐름

```
1. npx remote-desktop-ts --password mypass1234
2. 터미널에 URL 출력: https://xxxx.trycloudflare.com
3. 다른 기기 브라우저에서 해당 URL 접속
4. 비밀번호 입력 → 화면 스트리밍 시작
5. 마우스/키보드로 원격 조작 가능
```

---

## 기술 스택

| 역할 | 선택 | 이유 |
|------|------|------|
| 언어 | TypeScript | 타입 안전성, npm 생태계 |
| 서버 프레임워크 | Express + ws | 가볍고 WebSocket 지원 |
| 화면 스트리밍 | WebRTC (Video Track) | P2P 저지연, 브라우저 네이티브 지원 |
| Signaling | WebSocket (서버 중계) | WebRTC 연결 협상용 |
| 외부 노출 | Cloudflare Tunnel (`cloudflared`) | 무료, 무계정, 임시 도메인 자동 발급 |
| 화면 캡처 | `screenshot-desktop` + `sharp` | 크로스플랫폼 PNG → JPEG 변환 |
| 입력 제어 | `robotjs` 또는 `@nut-tree/nut-js` | 마우스/키보드 시뮬레이션 |
| 인증 | 사용자 지정 비밀번호 (CLI 인수) | 심플한 패스워드 게이트 |
| QR코드 출력 | `qrcode-terminal` | 모바일 접속 편의성 |

---

## Cloudflare Tunnel 동작 원리 (중요)

이 프로젝트의 핵심. **유저가 도메인을 사거나 포트포워딩을 할 필요가 없다.**

### 작동 방식

```
[노트북 로컬 서버 :3000]
        │
   cloudflared 프로세스 (노트북에서 실행)
        │  (아웃바운드 HTTPS 연결만 사용 — 방화벽 무관)
        ▼
   Cloudflare Edge 서버
        │
        ▼
https://random-adjective-noun-xxxx.trycloudflare.com
        │
        ▼
   [브라우저 — 어디서든 접속 가능]
```

### 핵심 특성
- **무료**: Cloudflare 계정 불필요, 비용 없음
- **임시 도메인**: 실행할 때마다 `*.trycloudflare.com` 서브도메인이 랜덤 발급됨
- **아웃바운드만 사용**: 인바운드 포트 오픈 불필요. 공유기/방화벽 설정 불필요
- **HTTPS 자동**: Cloudflare가 TLS 인증서 자동 처리
- **URL 고정 불가**: 매 실행마다 URL 변경됨 (고정 URL은 Cloudflare 계정 필요 — 이 프로젝트 범위 밖)

### cloudflared 설치 전략

유저가 `cloudflared`를 사전 설치하지 않아도 되도록, **앱 실행 시 자동으로 다운로드**한다.

```
실행 시 흐름:
1. PATH에 cloudflared 있는지 확인
2. 없으면 → GitHub Releases에서 OS/아키텍처에 맞는 바이너리 자동 다운로드
   - 다운로드 위치: ~/.remote-desktop-ts/cloudflared
3. cloudflared tunnel --url http://localhost:{PORT} 실행 (child_process.spawn)
4. stdout/stderr에서 trycloudflare.com URL 파싱
5. 파싱된 URL을 터미널에 출력
```

### cloudflared 다운로드 URL 패턴

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

### URL 파싱 방법

`cloudflared`는 터널 URL을 stderr에 출력한다.

```typescript
// cloudflared stderr 출력 예시:
// "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://fancy-horse-abc123.trycloudflare.com"

const urlMatch = data.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
```

---

## 프로젝트 구조

```
remote-desktop-ts/
├── src/
│   ├── index.ts           # CLI 진입점, 전체 오케스트레이션
│   ├── server.ts          # Express + WebSocket Signaling 서버
│   ├── capture.ts         # 화면 캡처 루프 (screenshot-desktop + sharp)
│   ├── webrtc.ts          # WebRTC peer 연결 관리 (node-webrtc or wrtc)
│   ├── tunnel.ts          # cloudflared 바이너리 관리 + 프로세스 실행
│   ├── input-handler.ts   # 마우스/키보드 이벤트 처리 (robotjs)
│   └── auth.ts            # 비밀번호 검증, 세션 토큰 관리
├── public/
│   └── index.html         # 브라우저 클라이언트 (단일 파일, 외부 의존성 없음)
├── package.json
├── tsconfig.json
└── SPEC.md                # 이 파일
```

---

## 각 모듈 상세 스펙

### `src/tunnel.ts`

책임: `cloudflared` 바이너리 존재 확인 → 없으면 다운로드 → 프로세스 실행 → URL 추출

```typescript
interface TunnelResult {
  url: string;       // "https://xxxx.trycloudflare.com"
  process: ChildProcess;
  kill: () => void;
}

async function startTunnel(localPort: number): Promise<TunnelResult>
async function ensureCloudflared(): Promise<string>  // 바이너리 경로 반환
function getCloudflaredDownloadUrl(): string          // OS/arch 기반 URL 결정
```

- 바이너리 저장 위치: `~/.remote-desktop-ts/cloudflared` (또는 `.exe`)
- 다운로드 후 `chmod +x` 필요 (Windows 제외)
- URL 파싱 타임아웃: 30초 (초과 시 에러)
- 프로세스 종료 시 tunnel도 함께 종료 (`process.on('exit', ...)`)

---

### `src/server.ts`

책임: Express HTTP 서버 + WebSocket Signaling

**HTTP 엔드포인트**

| Method | Path | 설명 |
|--------|------|------|
| GET | `/` | `public/index.html` 제공 |
| POST | `/auth` | 비밀번호 검증 → 세션 토큰 발급 |

**WebSocket 메시지 프로토콜** (JSON)

클라이언트 → 서버:
```jsonc
{ "type": "auth", "password": "..." }
{ "type": "offer", "sdp": "..." }          // WebRTC SDP offer
{ "type": "ice-candidate", "candidate": {} }
{ "type": "mouse-move", "x": 100, "y": 200 }           // 비율 0~1
{ "type": "mouse-click", "x": 0.5, "y": 0.5, "button": "left" }
{ "type": "mouse-scroll", "x": 0.5, "y": 0.5, "delta": -3 }
{ "type": "key-down", "key": "a", "modifiers": ["ctrl"] }
{ "type": "key-up", "key": "a" }
```

서버 → 클라이언트:
```jsonc
{ "type": "auth-ok", "token": "..." }
{ "type": "auth-fail" }
{ "type": "answer", "sdp": "..." }         // WebRTC SDP answer
{ "type": "ice-candidate", "candidate": {} }
{ "type": "screen-info", "width": 1920, "height": 1080 }
```

---

### `src/capture.ts`

책임: 화면을 주기적으로 캡처해 WebRTC Video Track에 프레임 공급

- `screenshot-desktop`으로 PNG 캡처
- `sharp`로 리사이즈 + JPEG 변환 (기본 품질 75, 스케일 0.8)
- 캡처한 프레임을 WebRTC의 `VideoSource`에 push
- 기본 15fps, `--fps` 옵션으로 조정 가능

> **참고**: Node.js에서 WebRTC Video Track에 커스텀 프레임을 공급하려면
> `wrtc` 패키지의 `nonstandard.RTCVideoSource`를 사용한다.
> `wrtc`는 네이티브 바이너리 포함 패키지이므로 `npm install` 시 빌드가 필요할 수 있음.

---

### `src/input-handler.ts`

책임: 브라우저에서 수신한 입력 이벤트를 실제 OS 입력으로 변환

```typescript
function handleMouseMove(xRatio: number, yRatio: number): void
function handleMouseClick(xRatio: number, yRatio: number, button: 'left'|'right'|'middle'): void
function handleMouseScroll(xRatio: number, yRatio: number, delta: number): void
function handleKeyDown(key: string, modifiers: string[]): void
function handleKeyUp(key: string): void
```

- 마우스 좌표는 **비율(0~1)**로 수신 → 실제 해상도 곱해서 절대 좌표 계산
- `robotjs`의 `robot.moveMouse`, `robot.mouseClick`, `robot.keyTap` 사용
- `robotjs` 빌드 실패 시 fallback으로 `@nut-tree/nut-js` 사용

---

### `src/auth.ts`

책임: 비밀번호 검증 + 세션 토큰 관리

```typescript
function verifyPassword(input: string, correct: string): boolean
function createSessionToken(): string   // crypto.randomBytes(32).toString('hex')
function isValidToken(token: string, tokens: Set<string>): boolean
```

- 세션 토큰은 메모리에만 저장 (프로세스 재시작 시 초기화)
- WebSocket 연결마다 토큰 검증 필요

---

### `src/index.ts` (CLI 진입점)

```
실행 순서:
1. CLI 인수 파싱 (--password, --port, --fps, --quality, --scale)
2. --password 없으면 에러 출력 후 종료
3. Express + WS 서버 시작 (기본 포트 3000)
4. 화면 캡처 루프 시작
5. cloudflared 터널 시작 (URL 파싱 대기)
6. 터미널에 URL + QR 코드 출력
7. SIGINT/SIGTERM 시 graceful shutdown (tunnel kill → 서버 close)
```

**터미널 출력 예시**:
```
✅ 서버 시작됨 (포트 3000)
🚇 Cloudflare Tunnel 연결 중...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 접속 URL:
   https://fancy-horse-abc123.trycloudflare.com

🔑 비밀번호: mypass1234

📱 QR 코드:
   [QR코드 아스키 아트]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⌨️  Ctrl+C 로 종료
```

---

### `public/index.html` (브라우저 클라이언트)

단일 HTML 파일. CDN이나 번들러 없이 동작해야 함.

**UI 구성**:
1. **로그인 화면**: 비밀번호 입력 필드 + 연결 버튼
2. **스트리밍 화면**: 전체 화면 `<video>` 태그 (WebRTC stream)

**클라이언트 로직**:
1. WebSocket 연결 (`ws://` → `wss://` 자동 감지)
2. 비밀번호 전송 → `auth-ok` 수신 시 화면 전환
3. WebRTC `RTCPeerConnection` 생성
4. `offer` 생성 → 서버로 전송
5. 서버에서 `answer` 수신 → remote description 설정
6. ICE candidate 교환
7. `ontrack` 이벤트로 video stream 수신 → `<video>` 에 연결
8. 마우스/키보드 이벤트 캡처 → 비율 좌표로 변환 → WebSocket 전송

**입력 이벤트 처리**:
- `mousemove`: throttle 50ms
- `mousedown` / `mouseup`: 좌/우/중간 버튼 구분
- `wheel`: scroll delta 전송
- `keydown` / `keyup`: 수식키(Ctrl, Shift, Alt, Meta) 포함
- 브라우저 기본 단축키 방지: `event.preventDefault()` (F5, Ctrl+R 등)
- 우클릭 컨텍스트 메뉴 방지: `contextmenu` 이벤트 차단

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

## 플랫폼 지원

| OS | 화면 캡처 | 입력 제어 | 비고 |
|----|-----------|-----------|------|
| macOS | ✅ | ✅ | 접근성 권한 필요 (robotjs) |
| Windows | ✅ | ✅ | 관리자 권한 불필요 |
| Linux | ✅ | ✅ | X11 필요, Wayland 미지원 |

---

## 보안 고려사항

- **반드시 HTTPS로만 서빙**: Cloudflare Tunnel이 자동 처리
- **비밀번호는 평문 비교 금지**: `crypto.timingSafeEqual` 사용
- **세션 토큰 만료**: 구현 선택사항 (기본: 프로세스 종료까지 유효)
- **동시 접속 제한**: 기본 1명 (옵션으로 조정 가능)
- **입력 이벤트 검증**: 좌표 범위(0~1) 초과 시 무시

---

## 주요 의존성 및 이슈

### `wrtc` (WebRTC Native Bindings)
- Node.js에서 WebRTC를 사용하기 위한 핵심 패키지
- 네이티브 바이너리 포함 → 설치 시 컴파일 필요할 수 있음
- `RTCVideoSource` (nonstandard API)로 커스텀 프레임 주입 가능
- 대안: `node-webrtc`, `@roamhq/wrtc` (wrtc fork, 더 활발히 유지됨)

### `robotjs`
- 네이티브 바이너리 포함 → Node.js 버전에 민감
- 빌드 실패 시: `npm rebuild robotjs --build-from-source`
- 대안: `@nut-tree/nut-js` (순수 TS, 더 현대적)

### `screenshot-desktop`
- 크로스플랫폼 화면 캡처
- macOS에서 스크린 레코딩 권한 필요

---

## 확장 아이디어 (구현 범위 밖)

- 고정 URL (Cloudflare 계정 연동)
- 클립보드 동기화
- 파일 전송
- 멀티 모니터 선택
- 모바일 터치 제스처 → 마우스 이벤트 변환
- 영상 녹화
