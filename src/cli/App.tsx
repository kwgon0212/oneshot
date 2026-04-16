import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { PasswordInput } from '@inkjs/ui';

export type Config = {
  password: string;
  port: number;
  fps: number;
  quality: number;
  scale: number;
};

type Props = {
  onStart: (config: Config) => void;
};

type Field = 'password' | 'port' | 'fps' | 'quality' | 'scale' | 'start';
const FIELDS: Field[] = ['password', 'port', 'fps', 'quality', 'scale', 'start'];

const DEFAULTS = {
  port: 3000,
  fps: 15,
  quality: 75,
  scale: 0.8,
};

const LIMITS: Record<string, { min: number; max: number; step: number }> = {
  port:    { min: 1024, max: 65535, step: 1 },
  fps:     { min: 1,    max: 60,    step: 1 },
  quality: { min: 1,    max: 100,   step: 1 },
  scale:   { min: 0.1,  max: 1.0,   step: 0.1 },
};

export function App({ onStart }: Props) {
  const [password, setPassword] = useState('');
  const [port, setPort] = useState(DEFAULTS.port);
  const [fps, setFps] = useState(DEFAULTS.fps);
  const [quality, setQuality] = useState(DEFAULTS.quality);
  const [scale, setScale] = useState(DEFAULTS.scale);
  const [focused, setFocused] = useState<Field>('password');
  const [passwordDone, setPasswordDone] = useState(false);

  const adjust = useCallback((field: Field, dir: 1 | -1) => {
    const lim = LIMITS[field as string];
    if (!lim) return;
    if (field === 'port')    setPort(v => Math.min(lim.max, Math.max(lim.min, v + dir * lim.step)));
    if (field === 'fps')     setFps(v => Math.min(lim.max, Math.max(lim.min, v + dir * lim.step)));
    if (field === 'quality') setQuality(v => Math.min(lim.max, Math.max(lim.min, v + dir * lim.step)));
    if (field === 'scale')   setScale(v => parseFloat(Math.min(lim.max, Math.max(lim.min, v + dir * lim.step)).toFixed(1)));
  }, []);

  useInput((_, key) => {
    if (focused === 'password') return; // PasswordInput handles its own input

    if (key.tab || key.downArrow) {
      const idx = FIELDS.indexOf(focused);
      setFocused(FIELDS[(idx + 1) % FIELDS.length]);
      return;
    }
    if (key.upArrow) {
      const idx = FIELDS.indexOf(focused);
      setFocused(FIELDS[(idx - 1 + FIELDS.length) % FIELDS.length]);
      return;
    }
    if (key.leftArrow)  adjust(focused, -1);
    if (key.rightArrow) adjust(focused, 1);

    if (key.return && focused === 'start') {
      onStart({ password, port, fps, quality, scale });
    }
  });

  const handlePasswordSubmit = (val: string) => {
    setPassword(val);
    setPasswordDone(true);
    setFocused('port');
  };

  const cursor = (field: Field) => focused === field ? '▶ ' : '  ';
  const highlight = (field: Field) => focused === field;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <Box marginBottom={1}>
        <Text bold>Remote Desktop</Text>
      </Box>

      {/* Password */}
      <Box>
        <Text color={highlight('password') ? 'cyan' : undefined}>
          {cursor('password')}{'비밀번호: '}
        </Text>
        {!passwordDone ? (
          <PasswordInput
            placeholder="비밀번호 입력 후 Enter"
            onSubmit={handlePasswordSubmit}
          />
        ) : (
          <Text>{'*'.repeat(password.length)}</Text>
        )}
      </Box>

      {/* Port */}
      <Box>
        <Text color={highlight('port') ? 'cyan' : undefined}>
          {cursor('port')}{'포트:     '}
        </Text>
        <Text>{port}</Text>
        {highlight('port') && <Text dimColor>  ← →</Text>}
      </Box>

      {/* FPS */}
      <Box>
        <Text color={highlight('fps') ? 'cyan' : undefined}>
          {cursor('fps')}{'FPS:      '}
        </Text>
        <Text>{fps}</Text>
        {highlight('fps') && <Text dimColor>  ← →</Text>}
      </Box>

      {/* Quality */}
      <Box>
        <Text color={highlight('quality') ? 'cyan' : undefined}>
          {cursor('quality')}{'품질:     '}
        </Text>
        <Text>{quality}</Text>
        {highlight('quality') && <Text dimColor>  ← →</Text>}
      </Box>

      {/* Scale */}
      <Box>
        <Text color={highlight('scale') ? 'cyan' : undefined}>
          {cursor('scale')}{'스케일:   '}
        </Text>
        <Text>{scale.toFixed(1)}</Text>
        {highlight('scale') && <Text dimColor>  ← →</Text>}
      </Box>

      <Box marginTop={1}>
        <Text
          color={highlight('start') ? 'green' : undefined}
          bold={highlight('start')}
        >
          {cursor('start')}시작
        </Text>
        {highlight('start') && <Text dimColor>  Enter</Text>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Tab / ↑↓ 로 이동</Text>
      </Box>
    </Box>
  );
}
