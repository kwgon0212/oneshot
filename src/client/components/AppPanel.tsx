import React from 'react';

interface AppPanelProps {
  show: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const AppPanel: React.FC<AppPanelProps> = ({ show, title, onClose, children }) => {
  return (
    <div id="panel" className={show ? 'show' : ''}>
      <div className="panel-head">
        <span>{title}</span>
        <button onClick={onClose}>닫기</button>
      </div>
      <div id="panel-items">{children}</div>
    </div>
  );
};

export default AppPanel;
