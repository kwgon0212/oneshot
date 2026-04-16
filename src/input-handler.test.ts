import { ratioToAbsolute, isValidRatio } from './input-handler.js';

describe('isValidRatio', () => {
  it('returns true for valid ratios', () => {
    expect(isValidRatio(0, 0)).toBe(true);
    expect(isValidRatio(0.5, 0.5)).toBe(true);
    expect(isValidRatio(1, 1)).toBe(true);
  });

  it('returns false for out-of-range ratios', () => {
    expect(isValidRatio(-0.1, 0.5)).toBe(false);
    expect(isValidRatio(0.5, 1.1)).toBe(false);
    expect(isValidRatio(NaN, 0.5)).toBe(false);
  });
});

describe('ratioToAbsolute', () => {
  it('converts ratio to absolute coordinates', () => {
    const result = ratioToAbsolute(0.5, 0.5, 1920, 1080);
    expect(result).toEqual({ x: 960, y: 540 });
  });

  it('handles 0,0', () => {
    const result = ratioToAbsolute(0, 0, 1920, 1080);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('handles 1,1', () => {
    const result = ratioToAbsolute(1, 1, 1920, 1080);
    expect(result).toEqual({ x: 1920, y: 1080 });
  });
});
