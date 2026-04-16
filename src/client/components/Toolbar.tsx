import React, { useState, useCallback } from 'react';
import { ws } from '../ws';

interface ToolbarProps {
  show: boolean;
  onKeyboard: () => void;
  onApps: () => void;
  onDisplay: () => void;
  onRightClick: () => void;
  onMissionControl: () => void;
  onZoomReset: () => void;
  rightClickMode: boolean;
  showZoomReset: boolean;
}

type ModKey = 'ctrl' | 'alt' | 'meta' | 'shift';

const Toolbar: React.FC<ToolbarProps> = ({
  show,
  onKeyboard,
  onApps,
  onDisplay,
  onRightClick,
  onMissionControl,
  onZoomReset,
  rightClickMode,
  showZoomReset,
}) => {
  const [mods, setMods] = useState<Record<ModKey, boolean>>({
    ctrl: false,
    alt: false,
    meta: false,
    shift: false,
  });

  const getMods = useCallback((): string[] => {
    const out: string[] = [];
    if (mods.ctrl) out.push('ctrl');
    if (mods.alt) out.push('alt');
    if (mods.meta) out.push('meta');
    if (mods.shift) out.push('shift');
    return out;
  }, [mods]);

  const clearMods = useCallback(() => {
    setMods({ ctrl: false, alt: false, meta: false, shift: false });
  }, []);

  const sendKey = useCallback(
    (key: string, extra?: string[]) => {
      const m = getMods().concat(extra || []);
      ws.send({ type: 'key-down', key, modifiers: m });
      ws.send({ type: 'key-up', key });
      clearMods();
    },
    [getMods, clearMods]
  );

  const pressAnim = (e: React.MouseEvent | React.TouchEvent) => {
    const btn = e.currentTarget as HTMLElement;
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 150);
  };

  const makeTbHandler = (fn: () => void) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pressAnim(e);
    fn();
  };

  const toggleMod = (mod: ModKey) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMods(prev => ({ ...prev, [mod]: !prev[mod] }));
  };

  const handleEsc = makeTbHandler(() => sendKey('Escape'));

  return (
    <div id="toolbar" className={show ? 'show' : ''}>
      <div className="tb-row">
        <button
          className="tbtn"
          onClick={makeTbHandler(onKeyboard)}
          onTouchStart={makeTbHandler(onKeyboard)}
        >
          키보드
        </button>
        <button
          className="tbtn"
          onClick={makeTbHandler(onApps)}
          onTouchStart={makeTbHandler(onApps)}
        >
          앱 전환
        </button>
        <button
          className="tbtn"
          onClick={makeTbHandler(onDisplay)}
          onTouchStart={makeTbHandler(onDisplay)}
        >
          모니터
        </button>
        <button
          className={`tbtn${rightClickMode ? ' on' : ''}`}
          onClick={makeTbHandler(onRightClick)}
          onTouchStart={makeTbHandler(onRightClick)}
        >
          우클릭
        </button>
        <button
          className="tbtn"
          onClick={makeTbHandler(onMissionControl)}
          onTouchStart={makeTbHandler(onMissionControl)}
        >
          앱 보기
        </button>
        {showZoomReset && (
          <button
            className="tbtn"
            onClick={makeTbHandler(onZoomReset)}
            onTouchStart={makeTbHandler(onZoomReset)}
          >
            줌 리셋
          </button>
        )}
      </div>
      <div className="tb-row">
        <button
          className="tbtn tbtn-sm"
          onClick={handleEsc}
          onTouchStart={handleEsc}
        >
          ESC
        </button>
        <div className="tb-sep" />
        {(['ctrl', 'alt', 'meta', 'shift'] as ModKey[]).map(mod => (
          <button
            key={mod}
            className={`tbtn tbtn-sm mod${mods[mod] ? ' on' : ''}`}
            onClick={toggleMod(mod)}
            onTouchStart={toggleMod(mod)}
          >
            {mod === 'meta' ? 'Cmd' : mod === 'ctrl' ? 'Ctrl' : mod === 'alt' ? 'Alt' : 'Shift'}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Toolbar;
