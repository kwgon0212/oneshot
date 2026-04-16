#!/usr/bin/env node

import https from 'https';
import http from 'http';
import { spawn, type ChildProcess } from 'child_process';
import { platform } from 'os';
import React from 'react';
import { render } from 'ink';
import { App, type Config } from './cli/App.js';
import { checkPermissions } from './permission-check.js';
import { createServer } from './server.js';
import { startTunnel, type TunnelResult } from './tunnel.js';
import { ensureMacHelper, getBrightness, setBrightness } from './input-handler.js';

function waitForUrl(url: string, maxRetries = 15): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 3000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (attempts >= maxRetries) resolve();
        else setTimeout(check, 1000);
      });
      req.on('timeout', () => {
        req.destroy();
        if (attempts >= maxRetries) resolve();
        else setTimeout(check, 1000);
      });
    };
    check();
  });
}

async function startServer(config: Config): Promise<void> {
  const { username, password, port, fps, quality, scale, headless } = config;
  const isMac = platform() === 'darwin';

  await checkPermissions();

  // Headless mode: caffeinate + brightness 0
  let caffeinateProc: ChildProcess | null = null;
  let originalBrightness = -1;

  if (isMac && headless) {
    ensureMacHelper();

    originalBrightness = getBrightness();
    console.log(`💡 현재 밝기: ${Math.round(originalBrightness * 100)}%`);

    caffeinateProc = spawn('caffeinate', ['-d', '-i', '-s'], { stdio: 'ignore', detached: false });
    console.log('☕ caffeinate 시작 (디스플레이 sleep 방지)');

    setBrightness(0);
    console.log('🌑 디스플레이 밝기 → 0 (화면 꺼짐 효과)');
  }

  const server = await createServer({
    port,
    username,
    password,
    captureOptions: { fps, quality, scale },
  });
  console.log(`✅ 서버 시작됨 (포트 ${port})`);

  console.log('🚇 Cloudflare Tunnel 연결 중...');
  let tunnel: TunnelResult;
  try {
    tunnel = await startTunnel(port);
  } catch (err: any) {
    console.error(`❌ 터널 연결 실패: ${err.message}`);
    // Restore brightness on failure
    if (isMac && originalBrightness >= 0) setBrightness(originalBrightness);
    if (caffeinateProc) caffeinateProc.kill();
    server.close();
    process.exit(1);
  }

  console.log('⏳ 도메인 준비 대기 중...');
  await waitForUrl(tunnel.url);

  try {
    const clipboardy = await import('clipboardy');
    await clipboardy.default.write(tunnel.url);
  } catch {}

  const qrcode = (await import('qrcode-terminal')).default;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🌐 접속 URL:`);
  console.log(`   ${tunnel.url}`);
  console.log('');
  console.log(`📋 클립보드에 복사됨!`);
  console.log(`👤 아이디: ${username}`);
  console.log(`🔑 비밀번호: ${password}`);
  console.log('');
  console.log('📱 QR 코드:');
  qrcode.generate(tunnel.url, { small: true }, (qr: string) => {
    console.log(qr);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⌨️  Ctrl+C 로 종료');

  const shutdown = () => {
    console.log('\n🛑 종료 중...');
    // Restore brightness
    if (isMac && originalBrightness >= 0) {
      setBrightness(originalBrightness);
      console.log(`💡 밝기 복원: ${Math.round(originalBrightness * 100)}%`);
    }
    if (caffeinateProc) {
      caffeinateProc.kill();
      console.log('☕ caffeinate 종료');
    }
    tunnel.kill();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Parse flags from argv
const args = process.argv.slice(2);
function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}
const usernameFlag = getFlag('username');
const passwordFlag = getFlag('password');
const headlessFlag = args.includes('--headless');

if (usernameFlag && passwordFlag) {
  // Non-interactive: skip menu and start directly with defaults
  await startServer({
    username: usernameFlag,
    password: passwordFlag,
    port: 3000,
    fps: 15,
    quality: 75,
    scale: 0.8,
    headless: headlessFlag,
  });
} else {
  // Interactive: render ink UI
  const { unmount, waitUntilExit } = render(
    React.createElement(App, {
      onStart: async (config: Config) => {
        unmount();
        await startServer(config);
      },
    })
  );

  await waitUntilExit();
}
