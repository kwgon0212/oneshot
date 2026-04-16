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
  const prevent = (fn: () => void) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <div id="top-ctrl">
      <button
        className="chip chip-danger"
        onClick={prevent(onShutdown)}
        onTouchStart={prevent(onShutdown)}
      >
        종료
      </button>
      <button
        className={`chip${infoOpen ? ' on' : ''}`}
        onClick={prevent(onToggleInfo)}
        onTouchStart={prevent(onToggleInfo)}
      >
        상태
      </button>
      <div className="spacer" />
      {hasTouch && (
        <button
          className={`chip${tbOpen ? ' on' : ''}`}
          onClick={prevent(onToggleToolbar)}
          onTouchStart={prevent(onToggleToolbar)}
        >
          도구
        </button>
      )}
    </div>
  );
};

export default TopBar;
