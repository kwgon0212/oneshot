import { verifyPassword, createSessionToken, isValidToken } from './auth.js';

describe('verifyPassword', () => {
  it('returns true for matching password', () => {
    expect(verifyPassword('mypass', 'mypass')).toBe(true);
  });

  it('returns false for wrong password', () => {
    expect(verifyPassword('wrong', 'mypass')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(verifyPassword('', 'mypass')).toBe(false);
  });

  it('handles different length passwords safely', () => {
    expect(verifyPassword('short', 'muchlongerpassword')).toBe(false);
  });
});

describe('createSessionToken', () => {
  it('returns a 64-char hex string', () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns unique tokens each call', () => {
    const t1 = createSessionToken();
    const t2 = createSessionToken();
    expect(t1).not.toBe(t2);
  });
});

describe('isValidToken', () => {
  it('returns true for token in set', () => {
    const tokens = new Set(['abc123']);
    expect(isValidToken('abc123', tokens)).toBe(true);
  });

  it('returns false for token not in set', () => {
    const tokens = new Set(['abc123']);
    expect(isValidToken('wrong', tokens)).toBe(false);
  });
});
