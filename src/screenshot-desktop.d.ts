declare module 'screenshot-desktop' {
  interface ScreenshotOptions {
    format?: 'png' | 'jpg';
    screen?: string | number;
    filename?: string;
  }
  interface DisplayInfo {
    id: string;
    name?: string;
  }
  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  namespace screenshot {
    function listDisplays(): Promise<DisplayInfo[]>;
  }
  export = screenshot;
}
