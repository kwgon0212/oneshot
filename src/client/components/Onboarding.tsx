import React, { useEffect, useState } from 'react';

interface OnboardingProps {
  show: boolean;
  onDismiss: () => void;
}

const GESTURES = [
  { icon: '👆', label: '탭', desc: '클릭' },
  { icon: '👆💨', label: '길게 누르기', desc: '우클릭' },
  { icon: '👆↕', label: '터치 후 드래그', desc: '끌기' },
  { icon: '✌️↕', label: '두 손가락 스와이프', desc: '스크롤' },
  { icon: '🤏', label: '핀치', desc: '줌 (세 손가락 탭으로 리셋)' },
];

const Onboarding: React.FC<OnboardingProps> = ({ show, onDismiss }) => {
  const handleDismiss = () => {
    localStorage.setItem('rd-onboarded', '1');
    onDismiss();
  };

  return (
    <div id="onboard" className={show ? 'show' : ''}>
      <div className="onboard-card">
        <h2>조작 방법</h2>
        <div className="gesture-list">
          {GESTURES.map((g, i) => (
            <div className="gesture" key={i}>
              <div className="g-icon">{g.icon}</div>
              <div className="g-text">
                <strong>{g.label}</strong> — {g.desc}
              </div>
            </div>
          ))}
        </div>
        <button className="btn" onClick={handleDismiss}>
          확인
        </button>
      </div>
    </div>
  );
};

export default Onboarding;
