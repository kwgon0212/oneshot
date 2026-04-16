import { spawn, ChildProcess, execSync } from 'child_process';
import { createWriteStream, existsSync, chmodSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform, arch } from 'os';
import https from 'https';
import http from 'http';

export interface TunnelResult {
  url: string;
  process: ChildProcess;
  kill: () => void;
}

const CLOUDFLARED_DIR = join(homedir(), '.remote-desktop-ts');

function getBinaryName(): string {
  const os = platform();
  if (os === 'win32') return 'cloudflared.exe';
  return 'cloudflared';
}

export function getCloudflaredDownloadUrl(os?: string, archName?: string): string {
  const currentOs = os || platform();
  const currentArch = archName || arch();

  const archMap: Record<string, string> = {
    x64: 'amd64',
    arm64: 'arm64',
  };
  const mappedArch = archMap[currentArch] || currentArch;

  if (currentOs === 'darwin') {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${mappedArch}.tgz`;
  } else if (currentOs === 'win32') {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${mappedArch}.exe`;
  } else {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${mappedArch}`;
  }
}

export function parseCloudflareUrl(data: string): string | null {
  const match = data.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
  return match ? match[0] : null;
}

function followRedirects(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (response: http.IncomingMessage) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        followRedirects(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const file = createWriteStream(dest);
      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write(`\r  다운로드 중... ${pct}%`);
        }
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        process.stdout.write('\r  다운로드 완료!        \n');
        resolve();
      });
      file.on('error', reject);
    };

    if (url.startsWith('https')) {
      https.get(url, handler).on('error', reject);
    } else {
      http.get(url, handler).on('error', reject);
    }
  });
}

async function downloadCloudflared(destPath: string): Promise<void> {
  const url = getCloudflaredDownloadUrl();
  const os = platform();

  console.log('📦 cloudflared 다운로드 중...');

  if (os === 'darwin') {
    const tgzPath = destPath + '.tgz';
    await followRedirects(url, tgzPath);
    execSync(`tar -xzf "${tgzPath}" -C "${CLOUDFLARED_DIR}"`, { stdio: 'ignore' });
    try {
      const { unlinkSync } = await import('fs');
      unlinkSync(tgzPath);
    } catch { /* ignore */ }
  } else {
    await followRedirects(url, destPath);
  }

  if (os !== 'win32') {
    chmodSync(destPath, 0o755);
  }
}

export async function ensureCloudflared(): Promise<string> {
  try {
    const pathResult = execSync('which cloudflared 2>/dev/null || where cloudflared 2>nul', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (pathResult) {
      console.log('✅ cloudflared 발견 (시스템 설치)');
      return pathResult;
    }
  } catch { /* not in PATH */ }

  const binaryPath = join(CLOUDFLARED_DIR, getBinaryName());
  if (existsSync(binaryPath)) {
    console.log('✅ cloudflared 발견 (로컬 설치)');
    return binaryPath;
  }

  if (!existsSync(CLOUDFLARED_DIR)) {
    mkdirSync(CLOUDFLARED_DIR, { recursive: true });
  }
  await downloadCloudflared(binaryPath);
  console.log('✅ cloudflared 설치 완료');
  return binaryPath;
}

export async function startTunnel(localPort: number): Promise<TunnelResult> {
  const binaryPath = await ensureCloudflared();

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ['tunnel', '--url', `http://localhost:${localPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        child.kill();
        reject(new Error('cloudflared URL 파싱 타임아웃 (30초)'));
      }
    }, 30000);

    const handleData = (data: Buffer) => {
      const text = data.toString();
      const url = parseCloudflareUrl(text);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          url,
          process: child,
          kill: () => child.kill(),
        });
      }
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared 실행 실패: ${err.message}`));
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared 프로세스 종료 (코드: ${code})`));
      }
    });
  });
}
