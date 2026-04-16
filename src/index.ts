#!/usr/bin/env node

import { Command } from 'commander';
import { checkPermissions } from './permission-check';
import { createServer } from './server';
import { startTunnel, TunnelResult } from './tunnel';

const program = new Command();

program
  .name('remote-desktop-ts')
  .description('Zero-config remote desktop via browser')
  .requiredOption('--password <password>', 'Access password (required)')
  .option('--port <number>', 'Local server port', '3000')
  .option('--fps <number>', 'Capture frame rate', '15')
  .option('--quality <number>', 'JPEG quality (1-100)', '75')
  .option('--scale <number>', 'Screen scale (0.1-1.0)', '0.8')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const fps = parseInt(opts.fps, 10);
    const quality = parseInt(opts.quality, 10);
    const scale = parseFloat(opts.scale);

    // Permission check
    await checkPermissions();

    // Start server
    const server = await createServer({
      port,
      password: opts.password,
      captureOptions: { fps, quality, scale },
    });
    console.log(`✅ 서버 시작됨 (포트 ${port})`);

    // Start tunnel
    console.log('🚇 Cloudflare Tunnel 연결 중...');
    let tunnel: TunnelResult;
    try {
      tunnel = await startTunnel(port);
    } catch (err: any) {
      console.error(`❌ 터널 연결 실패: ${err.message}`);
      server.close();
      process.exit(1);
    }

    // Copy to clipboard
    try {
      const clipboardy = await import('clipboardy');
      await clipboardy.default.write(tunnel.url);
    } catch {
      // clipboardy may fail in some environments, ignore
    }

    // Print QR code
    const qrcode = await import('qrcode-terminal');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🌐 접속 URL:`);
    console.log(`   ${tunnel.url}`);
    console.log('');
    console.log(`📋 클립보드에 복사됨!`);
    console.log(`🔑 비밀번호: ${opts.password}`);
    console.log('');
    console.log('📱 QR 코드:');
    qrcode.generate(tunnel.url, { small: true }, (qr: string) => {
      console.log(qr);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⌨️  Ctrl+C 로 종료');

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n🛑 종료 중...');
      tunnel.kill();
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parse();
