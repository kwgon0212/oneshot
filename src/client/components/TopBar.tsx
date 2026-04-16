import React, { useState, useCallback } from 'react';
import { ws } from '../ws';

interface TopBarProps {
  onToggleInfo: () => void;
  onToggleToolbar: () => void;
  onShutdown: () => void;
  infoOpen: boolean;
  tbOpen: boolean;
  hasTouch: boolean;
}

const TopBar: React.FC<TopBarProps> = ({
  onToggleInfo,
  onToggleToolbar,
  onShutdown,
  infoOpen,
  tbOpen,
  hasTouch,
}) => {
  const [dimmed, setDimmed] = useState(false);
  const [caffeinated, setCaffeinated] = useState(false);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ws.getToken()}`,
  }), []);

  const toggleBrightness = useCallback(async () => {
    try {
      const res = await fetch('/brightness', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ action: 'toggle' }),
      });
      const data = await res.json();
      setDimmed(data.dimmed);
    } catch {}
  }, [authHeaders]);

  const toggleCaffeinate = useCallback(async () => {
    try {
      const res = await fetch('/caffeinate', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ action: 'toggle' }),
      });
      const data = await res.json();
      setCaffeinated(data.active);
    } catch {}
  }, [authHeaders]);

  return (
    <div id="top-ctrl">
      <button className="chip chip-danger" onClick={onShutdown}>종료</button>
      <button className={`chip${dimmed ? ' on' : ''}`} onClick={toggleBrightness} title="화면 밝기">
        {dimmed ? '🌑' : '💡'}
      </button>
      <button className={`chip${caffeinated ? ' on' : ''}`} onClick={toggleCaffeinate} title="시스템 켜짐 유지">
        {caffeinated ? '☕' : '😴'}
      </button>
      <button className={`chip${infoOpen ? ' on' : ''}`} onClick={onToggleInfo}>상태</button>
      <div className="spacer" />
      {hasTouch && (
        <button className={`chip${tbOpen ? ' on' : ''}`} onClick={onToggleToolbar}>도구</button>
      )}
    </div>
  );
};

export default TopBar;
