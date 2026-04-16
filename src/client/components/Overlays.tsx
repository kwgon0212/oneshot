import React from 'react';

// ── Reconnect Overlay ──────────────────────────────────────────────────────
interface ReconnectOverlayProps {
  show: boolean;
  attempt: number;
  max: number;
}

export const ReconnectOverlay: React.FC<ReconnectOverlayProps> = ({ show, attempt, max }) => {
  const failed = attempt > max;

  return (
    <div className={`overlay${show ? ' show' : ''}`} id="ov-recon">
      {!failed && <div className="spin" />}
      <div id="recon-msg" style={{ color: 'var(--text-mid)', fontSize: 14 }}>
        {failed
          ? '연결 실패. 새로고침 해주세요.'
          : `재연결 중... (${attempt}/${max})`}
      </div>
    </div>
  );
};

// ── Confirm Dialog ─────────────────────────────────────────────────────────
interface ConfirmDialogProps {
  show: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ show, onConfirm, onCancel }) => {
  return (
    <div className={`overlay${show ? ' show' : ''}`} id="ov-confirm">
      <div className="dialog">
        <p>서버를 종료할까요?</p>
        <p className="sub">종료 후 재접속 불가</p>
        <div className="btns">
          <button className="btn-cancel" onClick={onCancel}>
            취소
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            종료
          </button>
        </div>
      </div>
    </div>
  );
};
