import { execSync } from 'child_process';
import { platform } from 'os';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

async function checkScreenCapturePermission(): Promise<boolean> {
  try {
    const img = await screenshot({ format: 'png' }) as Buffer;
    const metadata = await sharp(img).metadata();
    return (metadata.width || 0) > 1 && (metadata.height || 0) > 1;
  } catch {
    return false;
  }
}

function checkAccessibilityPermission(): boolean {
  try {
    execSync('osascript -e \'tell application "System Events" to keystroke ""\'', {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function checkXdotool(): boolean {
  try {
    execSync('which xdotool', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function checkPermissions(): Promise<void> {
  const os = platform();

  if (os === 'darwin') {
    const hasScreenCapture = await checkScreenCapturePermission();
    if (!hasScreenCapture) {
      console.error(`
⚠️  화면 캡처 권한이 필요합니다!

  1. 시스템 설정 → 개인정보 보호 및 보안 → 화면 녹화
  2. 터미널(또는 사용 중인 터미널 앱) 체크 ✅
  3. 터미널을 완전히 종료 후 다시 열기
  4. 다시 실행

  시스템 설정을 열려면:
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
`);
      try {
        execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
      } catch { /* ignore */ }
      process.exit(1);
    }

    const hasAccessibility = checkAccessibilityPermission();
    if (!hasAccessibility) {
      console.error(`
⚠️  접근성 권한이 필요합니다! (키보드/마우스 제어용)

  1. 시스템 설정 → 개인정보 보호 및 보안 → 접근성
  2. 터미널(또는 사용 중인 터미널 앱) 체크 ✅
  3. 터미널을 완전히 종료 후 다시 열기
  4. 다시 실행

  시스템 설정을 열려면:
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
`);
      try {
        execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
      } catch { /* ignore */ }
      process.exit(1);
    }

    console.log('✅ macOS 권한 확인 완료');
  } else if (os === 'linux') {
    if (!checkXdotool()) {
      console.error(`
⚠️  xdotool이 설치되어 있지 않습니다! (키보드/마우스 제어용)

  설치 방법:
    Ubuntu/Debian: sudo apt install xdotool
    Fedora:        sudo dnf install xdotool
    Arch:          sudo pacman -S xdotool

  설치 후 다시 실행해주세요.
`);
      process.exit(1);
    }
    console.log('✅ Linux 환경 확인 완료');
  } else if (os === 'win32') {
    console.log('✅ Windows 환경 확인 완료');
  } else {
    console.error(`❌ 지원하지 않는 OS입니다: ${os}`);
    process.exit(1);
  }
}
