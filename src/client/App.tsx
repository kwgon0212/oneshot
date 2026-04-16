import React, { useState, useCallback } from 'react';
import { ws } from './ws';
import Login from './components/Login';
import StreamView from './components/StreamView';

export default function App() {
  const [screen, setScreen] = useState<'login' | 'stream'>('login');
  const [error, setError] = useState('');

  const handleLogin = useCallback(async (password: string) => {
    try {
      const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.type === 'auth-ok') {
        ws.connect(data.token);
        setScreen('stream');
        setError('');
        return data.token as string;
      } else {
        setError('비밀번호가 틀렸습니다');
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
