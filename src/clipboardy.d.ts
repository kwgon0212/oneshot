declare module 'clipboardy' {
  const clipboardy: {
    write(text: string): Promise<void>;
    read(): Promise<string>;
  };
  export default clipboardy;
}
