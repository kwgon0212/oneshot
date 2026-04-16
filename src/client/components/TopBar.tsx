import React from 'react';

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
  return (
    <div id="top-ctrl">
      <button className="chip chip-danger" onClick={onShutdown}>종료</button>
      <button className={`chip${infoOpen ? ' on' : ''}`} onClick={onToggleInfo}>상태</button>
      <div className="spacer" />
      {hasTouch && (
        <button className={`chip${tbOpen ? ' on' : ''}`} onClick={onToggleToolbar}>도구</button>
      )}
    </div>
  );
};

export default TopBar;
