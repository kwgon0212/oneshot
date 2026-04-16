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

const MOD_LABELS: Record<ModKey, string> = {
  ctrl: 'Ctrl', alt: 'Alt', meta: 'Cmd', shift: 'Shift',
};

const Toolbar: React.FC<ToolbarProps> = ({
  show, onKeyboard, onApps, onDisplay, onRightClick,
  onMissionControl, onZoomReset, rightClickMode, showZoomReset,
}) => {
  const [mods, setMods] = useState<Record<ModKey, boolean>>({
    ctrl: false, alt: false, meta: false, shift: false,
  });
  const [mcActive, setMcActive] = useState(false);

  const getMods = useCallback((): string[] => {
    return (Object.keys(mods) as ModKey[]).filter(k => mods[k]);
  }, [mods]);

  const clearMods = useCallback(() => {
    setMods({ ctrl: false, alt: false, meta: false, shift: false });
  }, []);

  const sendKey = useCallback((key: string) => {
    const m = getMods();
    ws.send({ type: 'key-down', key, modifiers: m });
    ws.send({ type: 'key-up', key });
    clearMods();
  }, [getMods, clearMods]);

  const press = (el: HTMLElement) => {
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 150);
  };

  // 일반 버튼 (누르면 실행, 토글 아님)
  const action = (fn: () => void) => (e: React.MouseEvent) => {
    press(e.currentTarget as HTMLElement);
    fn();
  };

  // 토글 버튼 (상태 유지)
  const toggleMod = (mod: ModKey) => (e: React.MouseEvent) => {
    press(e.currentTarget as HTMLElement);
    setMods(prev => ({ ...prev, [mod]: !prev[mod] }));
  };

  const handleMC = (e: React.MouseEvent) => {
    press(e.currentTarget as HTMLElement);
    setMcActive(v => !v);
    onMissionControl();
  };

  return (
    <div id="toolbar" className={show ? 'show' : ''}>
      <div className="tb-row">
        <button className="tbtn" onClick={action(onKeyboard)}>키보드</button>
        <button className="tbtn" onClick={action(onApps)}>앱 전환</button>
        <button className="tbtn" onClick={action(onDisplay)}>모니터</button>
        <button className={`tbtn${rightClickMode ? ' on' : ''}`} onClick={action(onRightClick)}>우클릭</button>
        <button className={`tbtn${mcActive ? ' on' : ''}`} onClick={handleMC}>앱 보기</button>
        {showZoomReset && (
          <button className="tbtn" onClick={action(onZoomReset)}>줌 리셋</button>
        )}
      </div>
      <div className="tb-row">
        <button className="tbtn tbtn-sm" onClick={action(() => sendKey('Escape'))}>ESC</button>
        <div className="tb-sep" />
        {(Object.keys(MOD_LABELS) as ModKey[]).map(mod => (
          <button
            key={mod}
            className={`tbtn tbtn-sm mod${mods[mod] ? ' on' : ''}`}
            onClick={toggleMod(mod)}
          >
            {MOD_LABELS[mod]}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Toolbar;
