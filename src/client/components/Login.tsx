import React, { useState, useRef, KeyboardEvent } from 'react';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<string | null>;
  error: string;
}

const Login: React.FC<LoginProps> = ({ onLogin, error }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!username || !password || loading) return;
    setLoading(true);
    await onLogin(username, password);
    setLoading(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (e.currentTarget.type === 'text' && password === '') {
        pwRef.current?.focus();
      } else {
        handleSubmit();
      }
    }
  };

  return (
    <div id="login">
      <div className="login-card">
        <h1>Oneshot</h1>
        <p className="sub">원격 데스크톱에 연결</p>
        <input
          type="text"
          placeholder="아이디"
          autoFocus
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        <input
          ref={pwRef}
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          style={{ marginTop: 8 }}
        />
        <button className="btn" onClick={handleSubmit} disabled={loading || !username || !password}>
          {loading ? '연결 중...' : '연결'}
        </button>
        {error && <div className="login-err" style={{ display: 'block' }}>{error}</div>}
      </div>
    </div>
  );
};

export default Login;
