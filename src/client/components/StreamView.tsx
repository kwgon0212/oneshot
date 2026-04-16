import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ws } from '../ws';
import TopBar from './TopBar';
import Toolbar from './Toolbar';
import InfoPanel from './InfoPanel';
import AppPanel from './AppPanel';
import Onboarding from './Onboarding';
import { ReconnectOverlay, ConfirmDialog } from './Overlays';
import TouchDot from './TouchDot';
import InputToast from './InputToast';
import ZoomBadge from './ZoomBadge';

// ── Types ──────────────────────────────────────────────────────────────────

interface ScreenInfo {
  width: number;
  height: number;
}

interface Stats {
  fps: number;
  quality: number;
  ping: number | string;
  cpu: number | string;
  mem: number | string;
  memDetail: string;
}

interface TouchDotState {
  x: number;
  y: number;
  visible: boolean;
  fading: boolean;
}

interface ZoomState {
  zoom: number;
  panX: number;
  panY: number;
}

interface PanelContent {
  type: 'apps' | 'displays' | null;
  title: string;
  items: React.ReactNode;
}

interface StreamViewProps {
  onLogout: () => void;
}

const MAX_RECON = 10;
const hasTouch = navigator.maxTouchPoints > 0;

// ── Component ──────────────────────────────────────────────────────────────

const StreamView: React.FC<StreamViewProps> = ({ onLogout }) => {
  // Canvas
  const cvsRef = useRef<HTMLCanvasElement>(null);
  const cvsWrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(new Image());
  const prevUrlRef = useRef<string | null>(null);

  // Hidden input for mobile keyboard
  const hinputRef = useRef<HTMLInputElement>(null);

  // Screen info
  const [screenInfo, setScreenInfo] = useState<ScreenInfo>({ width: 1920, height: 1080 });

  // Stats
  const [stats, setStats] = useState<Stats>({
    fps: 0, quality: 75, ping: '-', cpu: '-', mem: '-', memDetail: '',
  });

  // FPS counter (uses refs to avoid closure staleness)
  const fCountRef = useRef(0);
  const fpsTRef = useRef(Date.now());

  // UI state
  const [infoOpen, setInfoOpen] = useState(false);
  const [tbOpen, setTbOpen] = useState(hasTouch);
  const [rcMode, setRcMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Onboarding
  const [showOnboard, setShowOnboard] = useState(
    hasTouch && !localStorage.getItem('rd-onboarded')
  );

  // Reconnect
  const [reconAttempt, setReconAttempt] = useState(0);
  const [reconShow, setReconShow] = useState(false);
  const reconNRef = useRef(0);

  // Zoom
  const zoomRef = useRef<ZoomState>({ zoom: 1, panX: 0, panY: 0 });
  const [zoomDisplay, setZoomDisplay] = useState(1);

  // Touch dot
  const [dotState, setDotState] = useState<TouchDotState>({ x: 0, y: 0, visible: false, fading: false });
  const dotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Input toast
  const toastBufRef = useRef('');
  const composingTextRef = useRef('');
  const composingRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastState, setToastState] = useState({ text: '', show: false });

  // Panel
  const [panel, setPanel] = useState<PanelContent>({ type: null, title: '', items: null });

  // Mouse throttle
  const lmtRef = useRef(0);

  // Touch state
  const tspRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const tmovedRef = useRef(false);
  const ltmtRef = useRef(0);
  const pinchSDRef = useRef(0);
  const pinchSZRef = useRef(1);
  const twoFingerRef = useRef<{ x: number; y: number } | null>(null);
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Token stored in ref to avoid stale closure
  const tokenRef = useRef<string | null>(ws.getToken?.() ?? null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const si = useCallback((msg: object) => {
    ws.send(msg);
  }, []);

  const applyZoom = useCallback(() => {
    const cvs = cvsRef.current;
    const wrap = cvsWrapRef.current;
    const z = zoomRef.current;
    if (!cvs || !wrap) return;

    if (z.zoom <= 1) {
      z.zoom = 1; z.panX = 0; z.panY = 0;
      cvs.style.transform = '';
      setZoomDisplay(1);
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const maxPX = wr.width * (z.zoom - 1);
    const maxPY = wr.height * (z.zoom - 1);
    z.panX = Math.max(-maxPX, Math.min(0, z.panX));
    z.panY = Math.max(-maxPY, Math.min(0, z.panY));
    cvs.style.transform = `translate(${z.panX}px,${z.panY}px) scale(${z.zoom})`;
    setZoomDisplay(z.zoom);
  }, []);

  const zoomAt = useCallback((nz: number, cx: number, cy: number) => {
    const wrap = cvsWrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const z = zoomRef.current;
    const px = cx - wr.left;
    const py = cy - wr.top;
    const cx2 = (px - z.panX) / z.zoom;
    const cy2 = (py - z.panY) / z.zoom;
    z.zoom = Math.max(1, Math.min(5, nz));
    z.panX = px - cx2 * z.zoom;
    z.panY = py - cy2 * z.zoom;
    applyZoom();
  }, [applyZoom]);

  /**
   * Converts screen (client) coordinates to 0-1 ratios accounting for
   * object-fit:contain letterboxing AND zoom/pan transform.
   */
  const ratio = useCallback((e: { clientX: number; clientY: number }) => {
    const wrap = cvsWrapRef.current;
    const cvs = cvsRef.current;
    if (!wrap || !cvs) return { x: 0, y: 0 };
    const wr = wrap.getBoundingClientRect();
    const z = zoomRef.current;
    const localX = (e.clientX - wr.left - z.panX) / z.zoom;
    const localY = (e.clientY - wr.top - z.panY) / z.zoom;
    const ca = cvs.width / cvs.height;
    const ra = wr.width / wr.height;
    let rw: number, rh: number, ox: number, oy: number;
    if (ca > ra) {
      rw = wr.width; rh = wr.width / ca; ox = 0; oy = (wr.height - rh) / 2;
    } else {
      rh = wr.height; rw = wr.height * ca; ox = (wr.width - rw) / 2; oy = 0;
    }
    return {
      x: Math.max(0, Math.min(1, (localX - ox) / rw)),
      y: Math.max(0, Math.min(1, (localY - oy) / rh)),
    };
  }, []);

  // ── Touch dot ─────────────────────────────────────────────────────────────

  const showDot = useCallback((x: number, y: number) => {
    if (dotTimerRef.current) clearTimeout(dotTimerRef.current);
    setDotState({ x, y, visible: true, fading: false });
    dotTimerRef.current = setTimeout(() => {
      setDotState(prev => ({ ...prev, fading: true }));
      setTimeout(() => setDotState(prev => ({ ...prev, visible: false, fading: false })), 250);
    }, 400);
  }, []);

  // ── Input toast ───────────────────────────────────────────────────────────

  const updateToast = useCallback(() => {
    const display = toastBufRef.current + (composingTextRef.current || '');
    if (!display) {
      setToastState({ text: '', show: false });
      return;
    }
    setToastState({ text: display, show: true });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastState({ text: '', show: false });
      toastBufRef.current = '';
      composingTextRef.current = '';
    }, 1500);
  }, []);

  const appendToast = useCallback((t: string) => {
    toastBufRef.current += t;
    updateToast();
  }, [updateToast]);

  const backspaceToast = useCallback(() => {
    if (toastBufRef.current.length > 0) {
      toastBufRef.current = toastBufRef.current.slice(0, -1);
      updateToast();
    }
  }, [updateToast]);

  const flushInput = useCallback(() => {
    const hi = hinputRef.current;
    if (!hi || !hi.value) return;
    si({ type: 'type-text', text: hi.value });
    toastBufRef.current += hi.value;
    hi.value = '';
    composingTextRef.current = '';
    composingRef.current = false;
    updateToast();
  }, [si, updateToast]);

  // ── Frame rendering ───────────────────────────────────────────────────────

  const renderFrame = useCallback((blob: Blob) => {
    const cvs = cvsRef.current;
    const ctx = cvs?.getContext('2d');
    if (!cvs || !ctx) return;
    const url = URL.createObjectURL(blob);
    const img = imgRef.current;
    img.onload = () => {
      ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = img.src;
      fCountRef.current++;
      const now = Date.now();
      if (now - fpsTRef.current >= 1000) {
        setStats(prev => ({ ...prev, fps: fCountRef.current }));
        fCountRef.current = 0;
        fpsTRef.current = now;
      }
    };
    img.src = url;
  }, []);

  // ── WebSocket handlers ────────────────────────────────────────────────────

  const handleMessage = useCallback((m: any) => {
    if (m.type === 'screen-info') {
      const cvs = cvsRef.current;
      if (cvs) { cvs.width = m.width; cvs.height = m.height; }
      setScreenInfo({ width: m.width, height: m.height });
    } else if (m.type === 'quality-adjust') {
      setStats(prev => ({ ...prev, quality: m.quality }));
    } else if (m.type === 'pong') {
      setStats(prev => ({ ...prev, ping: Date.now() - m.t }));
    } else if (m.type === 'system-stats') {
      setStats(prev => ({
        ...prev,
        cpu: m.cpuPercent,
        mem: m.memPercent,
        memDetail: `(${m.memUsedGB}/${m.memTotalGB}G)`,
      }));
    } else if (m.type === 'auth-fail') {
      tokenRef.current = null;
      onLogout();
    } else if (m.type === 'display-changed') {
      // no-op, handled server side
    }
  }, [onLogout]);

  const handleDisconnect = useCallback(() => {
    if (!tokenRef.current) return; // intentional logout
    reconNRef.current++;
    if (reconNRef.current > MAX_RECON) {
      setReconAttempt(reconNRef.current);
      setReconShow(true);
      return;
    }
    setReconAttempt(reconNRef.current);
    setReconShow(true);
    setTimeout(() => {
      ws.connect(tokenRef.current!);
    }, 3000);
  }, []);

  // ── Mouse event handlers ──────────────────────────────────────────────────

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lmtRef.current < 30) return;
    lmtRef.current = now;
    const p = ratio(e);
    si({ type: 'mouse-move', x: p.x, y: p.y });
  }, [ratio, si]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const p = ratio(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    si({ type: 'mouse-down', x: p.x, y: p.y, button });
  }, [ratio, si]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const p = ratio(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    si({ type: 'mouse-up', x: p.x, y: p.y, button });
  }, [ratio, si]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const p = ratio(e);
    si({ type: 'mouse-scroll', x: p.x, y: p.y, deltaY: Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 10) });
  }, [ratio, si]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // ── Touch event handlers ──────────────────────────────────────────────────

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    flushInput();
    hinputRef.current?.blur();

    if (e.touches.length === 1) {
      const t = e.touches[0];
      const p = ratio(t);
      tspRef.current = { x: p.x, y: p.y, px: t.clientX, py: t.clientY };
      tmovedRef.current = false;
      si({ type: 'mouse-move', x: p.x, y: p.y });
      showDot(t.clientX, t.clientY);
      // Long-press right-click
      if (lpTimerRef.current) clearTimeout(lpTimerRef.current);
      lpTimerRef.current = setTimeout(() => {
        const tsp = tspRef.current;
        if (tsp && !tmovedRef.current) {
          showDot(tsp.px, tsp.py);
          si({ type: 'mouse-click', x: tsp.x, y: tsp.y, button: 'right' });
          tspRef.current = null;
        }
      }, 600);
    } else if (e.touches.length === 2) {
      if (lpTimerRef.current) clearTimeout(lpTimerRef.current);
      tspRef.current = null;
      tmovedRef.current = false;
      const a = e.touches[0];
      const b = e.touches[1];
      pinchSDRef.current = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      pinchSZRef.current = zoomRef.current.zoom;
      twoFingerRef.current = {
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
    } else if (e.touches.length === 3) {
      if (lpTimerRef.current) clearTimeout(lpTimerRef.current);
      zoomRef.current = { zoom: 1, panX: 0, panY: 0 };
      applyZoom();
    }
  }, [flushInput, ratio, si, showDot, applyZoom]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - ltmtRef.current < 16) return;
    ltmtRef.current = now;

    if (e.touches.length === 1 && tspRef.current) {
      if (lpTimerRef.current) clearTimeout(lpTimerRef.current);
      const t = e.touches[0];
      showDot(t.clientX, t.clientY);
      const tsp = tspRef.current;
      if (Math.abs(t.clientX - tsp.px) > 10 || Math.abs(t.clientY - tsp.py) > 10) {
        if (!tmovedRef.current) {
          tmovedRef.current = true;
          si({ type: 'mouse-down', x: tsp.x, y: tsp.y, button: 'left' });
        }
        const p = ratio(t);
        si({ type: 'mouse-move', x: p.x, y: p.y });
      }
    } else if (e.touches.length === 2 && twoFingerRef.current) {
      const a = e.touches[0];
      const b = e.touches[1];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      if (pinchSDRef.current > 0) {
        zoomAt(pinchSZRef.current * (dist / pinchSDRef.current), midX, midY);
      }
      if (zoomRef.current.zoom <= 1) {
        const dy = midY - twoFingerRef.current.y;
        twoFingerRef.current.y = midY;
        if (Math.abs(dy) > 2) {
          const mid = ratio({ clientX: midX, clientY: midY });
          si({ type: 'mouse-scroll', x: mid.x, y: mid.y, deltaY: dy > 0 ? -2 : 2 });
        }
      } else {
        const dx = midX - twoFingerRef.current.x;
        const dy2 = midY - twoFingerRef.current.y;
        twoFingerRef.current.x = midX;
        twoFingerRef.current.y = midY;
        zoomRef.current.panX += dx;
        zoomRef.current.panY += dy2;
        applyZoom();
      }
    }
  }, [ratio, si, showDot, zoomAt, applyZoom]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (lpTimerRef.current) clearTimeout(lpTimerRef.current);
    twoFingerRef.current = null;
    pinchSDRef.current = 0;

    const tsp = tspRef.current;
    if (tsp) {
      if (tmovedRef.current) {
        const p = e.changedTouches.length ? ratio(e.changedTouches[0]) : tsp;
        si({ type: 'mouse-up', x: p.x, y: p.y, button: 'left' });
      } else {
        showDot(tsp.px, tsp.py);
        si({ type: 'mouse-click', x: tsp.x, y: tsp.y, button: rcMode ? 'right' : 'left' });
        if (rcMode) setRcMode(false);
      }
      tspRef.current = null;
      tmovedRef.current = false;
    }
  }, [ratio, si, showDot, rcMode]);

  // ── Keyboard handlers ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target === hinputRef.current) return;
      if (['F5', 'F11', 'F12'].includes(e.key) ||
          (e.ctrlKey && 'rwtnl'.includes(e.key.toLowerCase()))) {
        e.preventDefault();
      }
      si({
        type: 'key-down',
        key: e.key,
        modifiers: [
          e.ctrlKey && 'ctrl',
          e.shiftKey && 'shift',
          e.altKey && 'alt',
          e.metaKey && 'meta',
        ].filter(Boolean),
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.target === hinputRef.current) return;
      si({ type: 'key-up', key: e.key });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [si]);

  // ── Hidden input (Korean IME) ─────────────────────────────────────────────

  const onHinputCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onHinputCompositionUpdate = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    composingTextRef.current = e.data || '';
    updateToast();
  }, [updateToast]);

  const onHinputCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    const v = e.data || '';
    if (v.length > 0) {
      si({ type: 'type-text', text: v });
      toastBufRef.current += v;
      composingTextRef.current = '';
      updateToast();
    }
    if (hinputRef.current) hinputRef.current.value = '';
  }, [si, updateToast]);

  const onHinputInput = useCallback(() => {
    if (composingRef.current) return;
    const hi = hinputRef.current;
    if (!hi || !hi.value) return;
    si({ type: 'type-text', text: hi.value });
    appendToast(hi.value);
    hi.value = '';
  }, [si, appendToast]);

  const onHinputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      si({ type: 'key-down', key: 'Backspace', modifiers: [] });
      si({ type: 'key-up', key: 'Backspace' });
      backspaceToast();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      si({ type: 'key-down', key: 'Enter', modifiers: [] });
      si({ type: 'key-up', key: 'Enter' });
      setToastState({ text: '', show: false });
      toastBufRef.current = '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      si({ type: 'key-down', key: 'Tab', modifiers: [] });
      si({ type: 'key-up', key: 'Tab' });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      si({ type: 'key-down', key: 'Escape', modifiers: [] });
      si({ type: 'key-up', key: 'Escape' });
    }
  }, [si, backspaceToast]);

  const onHinputBlur = useCallback(() => {
    flushInput();
  }, [flushInput]);

  // ── Mount / Unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    const token = ws.getToken?.();
    tokenRef.current = token ?? null;
    if (token) {
      ws.connect(token);
    }

    ws.setHandlers({
      onMessage: handleMessage,
      onFrame: renderFrame,
      onDisconnect: handleDisconnect,
    });

    return () => {
      ws.close();
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Panel logic ───────────────────────────────────────────────────────────

  const closePanel = useCallback(() => {
    setPanel(prev => ({ ...prev, type: null }));
  }, []);

  const openApps = useCallback(async () => {
    if (panel.type === 'apps') { closePanel(); return; }
    setPanel({ type: 'apps', title: '실행 중인 앱', items: <div className="p-item" style={{ color: 'var(--text-dim)' }}>불러오는 중...</div> });
    try {
      const r = await fetch('/apps', { headers: { Authorization: `Bearer ${tokenRef.current}` } });
      const d = await r.json();
      const items = d.apps.map((app: { name: string; windows: string[] }) => {
        const wins = app.windows || [];
        if (wins.length > 1) {
          return (
            <AppExpandable
              key={app.name}
              name={app.name}
              windows={wins}
              onActivate={(wIdx?: number) => {
                si({ type: 'activate-app', name: app.name, ...(wIdx !== undefined ? { window: String(wIdx) } : {}) });
                closePanel();
              }}
            />
          );
        }
        return (
          <div
            key={app.name}
            className="p-item"
            onClick={() => { si({ type: 'activate-app', name: app.name }); closePanel(); }}
          >
            <span style={{ fontWeight: 500 }}>{app.name}</span>
            {wins[0] && <div className="p-sub">{wins[0]}</div>}
          </div>
        );
      });
      setPanel({ type: 'apps', title: '실행 중인 앱', items });
    } catch {
      setPanel({ type: 'apps', title: '실행 중인 앱', items: <div className="p-item" style={{ color: 'var(--danger)' }}>불러오기 실패</div> });
    }
  }, [panel.type, closePanel, si]);

  const openDisplays = useCallback(async () => {
    if (panel.type === 'displays') { closePanel(); return; }
    setPanel({ type: 'displays', title: '모니터 선택', items: <div className="p-item" style={{ color: 'var(--text-dim)' }}>불러오는 중...</div> });
    try {
      const r = await fetch('/displays', { headers: { Authorization: `Bearer ${tokenRef.current}` } });
      const d = await r.json();
      if (!d.displays.length) {
        setPanel({ type: 'displays', title: '모니터 선택', items: <div className="p-item" style={{ color: 'var(--text-dim)' }}>모니터 없음</div> });
        return;
      }
      const items = d.displays.map((disp: { id: number | string; name: string }) => (
        <div
          key={disp.id}
          className="p-item"
          onClick={() => { si({ type: 'switch-display', id: disp.id }); closePanel(); }}
        >
          {disp.name}
        </div>
      ));
      setPanel({ type: 'displays', title: '모니터 선택', items });
    } catch {
      setPanel({ type: 'displays', title: '모니터 선택', items: <div className="p-item" style={{ color: 'var(--danger)' }}>불러오기 실패</div> });
    }
  }, [panel.type, closePanel, si]);

  // ── Shutdown ──────────────────────────────────────────────────────────────

  const handleShutdownConfirm = useCallback(async () => {
    try {
      await fetch('/shutdown', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
    } catch { /* ignore */ }
    setShowConfirm(false);
    tokenRef.current = null;
    ws.close();
    onLogout();
  }, [onLogout]);

  // ── FPS slider ────────────────────────────────────────────────────────────

  const handleFpsChange = useCallback((fps: number) => {
    si({ type: 'set-fps', fps });
  }, [si]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div id="stream" style={{ display: 'flex' }}>
      {/* Canvas area */}
      <div id="cvs-wrap" ref={cvsWrapRef}>
        <canvas
          id="cvs"
          ref={cvsRef}
          width={screenInfo.width}
          height={screenInfo.height}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
      </div>

      {/* Hidden input for mobile IME */}
      <input
        id="hinput"
        ref={hinputRef}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onCompositionStart={onHinputCompositionStart}
        onCompositionUpdate={onHinputCompositionUpdate}
        onCompositionEnd={onHinputCompositionEnd}
        onInput={onHinputInput}
        onKeyDown={onHinputKeyDown}
        onBlur={onHinputBlur}
      />

      {/* Top controls */}
      <TopBar
        onToggleInfo={() => setInfoOpen(v => !v)}
        onToggleToolbar={() => setTbOpen(v => !v)}
        onShutdown={() => setShowConfirm(true)}
        infoOpen={infoOpen}
        tbOpen={tbOpen}
        hasTouch={hasTouch}
      />

      {/* Info panel */}
      <InfoPanel
        show={infoOpen}
        fps={stats.fps}
        quality={stats.quality}
        ping={stats.ping}
        cpu={stats.cpu}
        mem={stats.mem}
        memDetail={stats.memDetail}
        onFpsChange={handleFpsChange}
      />

      {/* Toolbar */}
      <Toolbar
        show={tbOpen}
        onKeyboard={() => {
          if (hinputRef.current) { hinputRef.current.value = ''; hinputRef.current.focus(); }
        }}
        onApps={openApps}
        onDisplay={openDisplays}
        onRightClick={() => setRcMode(v => !v)}
        onMissionControl={() => {
          si({ type: 'key-down', key: 'F3', modifiers: [] });
          si({ type: 'key-up', key: 'F3' });
        }}
        onZoomReset={() => {
          zoomRef.current = { zoom: 1, panX: 0, panY: 0 };
          applyZoom();
        }}
        rightClickMode={rcMode}
        showZoomReset={zoomDisplay > 1}
      />

      {/* Shared panel (apps / displays) */}
      <AppPanel
        show={panel.type !== null}
        title={panel.title}
        onClose={closePanel}
      >
        {panel.items}
      </AppPanel>

      {/* Onboarding */}
      <Onboarding
        show={showOnboard}
        onDismiss={() => setShowOnboard(false)}
      />

      {/* Touch dot */}
      <TouchDot
        x={dotState.x}
        y={dotState.y}
        visible={dotState.visible}
        fading={dotState.fading}
      />

      {/* Input toast */}
      <InputToast text={toastState.text} show={toastState.show} />

      {/* Zoom badge */}
      <ZoomBadge zoom={zoomDisplay} />

      {/* Overlays */}
      <ReconnectOverlay show={reconShow} attempt={reconAttempt} max={MAX_RECON} />
      <ConfirmDialog
        show={showConfirm}
        onConfirm={handleShutdownConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};

// ── AppExpandable (local helper component) ─────────────────────────────────

interface AppExpandableProps {
  name: string;
  windows: string[];
  onActivate: (windowIndex?: number) => void;
}

const AppExpandable: React.FC<AppExpandableProps> = ({ name, windows, onActivate }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div className="p-item" onClick={() => setExpanded(v => !v)}>
        <span style={{ fontWeight: 500 }}>{name}</span>
        <span className="p-count">({windows.length}개)</span>
      </div>
      <div className={`win-list${expanded ? ' show' : ''}`}>
        {windows.map((wn, idx) => (
          <div
            key={idx}
            className="p-win"
            onClick={e => { e.stopPropagation(); onActivate(idx + 1); }}
          >
            {wn}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StreamView;
