import React from 'react';

interface InfoPanelProps {
  show: boolean;
  fps: number;
  quality: number;
  ping: number | string;
  cpu: number | string;
  mem: number | string;
  memDetail: string;
  onFpsChange: (fps: number) => void;
}

const InfoPanel: React.FC<InfoPanelProps> = ({
  show,
  fps,
  quality,
  ping,
  cpu,
  mem,
  memDetail,
  onFpsChange,
}) => {
  const [sliderVal, setSliderVal] = React.useState(15);

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    setSliderVal(v);
    onFpsChange(v);
  };

  return (
    <div id="info-panel" className={show ? 'show' : ''}>
      <div>
        <span className="label">FPS </span>
        <span className="val">{fps}</span>
        <span className="label" style={{ marginLeft: 12 }}>품질 </span>
        <span className="val">{quality}</span>
        <span className="label" style={{ marginLeft: 12 }}>지연 </span>
        <span className="val">{ping}</span>
        <span className="label">ms</span>
      </div>
      <div>
        <span className="label">CPU </span>
        <span className="val">{cpu}</span>%
        <span className="label" style={{ marginLeft: 12 }}>MEM </span>
        <span className="val">{mem}</span>%
        <span style={{ color: 'var(--text-dim)' }}>{memDetail}</span>
      </div>
      <div>
        <span className="label">FPS 조절 </span>
        <input
          type="range"
          min={1}
          max={30}
          value={sliderVal}
          onChange={handleSlider}
        />
        <span className="val"> {sliderVal}</span>
      </div>
    </div>
  );
};

export default InfoPanel;
