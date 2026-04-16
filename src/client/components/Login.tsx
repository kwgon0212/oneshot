import React, { useState, useRef, KeyboardEvent } from 'react';

interface LoginProps {
  onLogin: (password: string) => Promise<string | null>;
  error: string;
}

const Login: React.FC<LoginProps> = ({ onLogin, error }) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!password || loading) return;
    setLoading(true);
    await onLogin(password);
    setLoading(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div id="login">
      <div className="login-card">
        <h1>Remote Desktop</h1>
        <p className="sub">비밀번호를 입력하고 연결하세요</p>
        <input
          ref={inputRef}
          type="password"
          placeholder="비밀번호"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn"
          onClick={handleSubmit}
          disabled={loading}
        >
          연결
        </button>
        <div
          className="login-err"
          style={{ display: error ? 'block' : 'none' }}
        >
          {error}
        </div>
      </div>
    </div>
  );
};

export default Login;
