import crypto from 'crypto';

export function verifyPassword(input: string, correct: string): boolean {
  if (!input || !correct) return false;
  const inputBuf = Buffer.from(input);
  const correctBuf = Buffer.from(correct);
  if (inputBuf.length !== correctBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, correctBuf);
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isValidToken(token: string, tokens: Set<string>): boolean {
  return tokens.has(token);
}
