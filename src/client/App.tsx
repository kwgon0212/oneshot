import React, { useState, useCallback } from 'react';
import { ws } from './ws';
import Login from './components/Login';
import StreamView from './components/StreamView';

export default function App() {
  const [screen, setScreen] = useState<'login' | 'stream'>('login');
  const [error, setError] = useState('');

  const handleLogin = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.type === 'auth-ok') {
        ws.connect(data.token);
        setScreen('stream');
        setError('');
        return data.token as string;
      } else if (data.type === 'auth-locked') {
        setError(`로그인 잠금 — ${data.remaining}초 후 다시 시도`);
        return null;
      } else {
        const left = data.attemptsLeft;
        setError(left ? `아이디 또는 비밀번호 오류 (${left}회 남음)` : '아이디 또는 비밀번호 오류');
        return null;
      }
    } catch {
      setError('연결 실패');
      return null;
    }
  }, []);

  if (screen === 'login') {
    return <Login onLogin={handleLogin} error={error} />;
  }

  return <StreamView onLogout={() => { setScreen('login'); setError('세션 만료'); }} />;
}
