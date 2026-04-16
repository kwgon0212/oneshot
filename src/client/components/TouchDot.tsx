import React from 'react';

interface TouchDotProps {
  x: number;
  y: number;
  visible: boolean;
  fading: boolean;
}

const TouchDot: React.FC<TouchDotProps> = ({ x, y, visible, fading }) => {
  if (!visible) return null;
  return (
    <div
      id="touch-dot"
      className={`show${fading ? ' fade' : ''}`}
      style={{ left: x, top: y }}
    />
  );
};

export default TouchDot;
