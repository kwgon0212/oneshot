import React from 'react';

interface ZoomBadgeProps {
  zoom: number;
}

const ZoomBadge: React.FC<ZoomBadgeProps> = ({ zoom }) => (
  <div id="zoom-badge" className={`badge${zoom > 1 ? ' show' : ''}`}>
    {zoom.toFixed(1)}x
  </div>
);

export default ZoomBadge;
