import { getCloudflaredDownloadUrl, parseCloudflareUrl } from './tunnel.js';

describe('getCloudflaredDownloadUrl', () => {
  it('returns correct URL for darwin arm64', () => {
    const url = getCloudflaredDownloadUrl('darwin', 'arm64');
    expect(url).toBe(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
    );
  });

  it('returns correct URL for linux x64', () => {
    const url = getCloudflaredDownloadUrl('linux', 'x64');
    expect(url).toBe(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
    );
  });

  it('returns correct URL for win32 x64', () => {
    const url = getCloudflaredDownloadUrl('win32', 'x64');
    expect(url).toBe(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    );
  });
});

describe('parseCloudflareUrl', () => {
  it('parses URL from cloudflared stderr output', () => {
    const line = 'Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://fancy-horse-abc123.trycloudflare.com';
    expect(parseCloudflareUrl(line)).toBe('https://fancy-horse-abc123.trycloudflare.com');
  });

  it('returns null for non-matching output', () => {
    expect(parseCloudflareUrl('Starting tunnel...')).toBeNull();
  });
});
