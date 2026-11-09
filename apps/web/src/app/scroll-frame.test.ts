import { describe, expect, it } from 'vitest';
import { SCROLL_KEYS, shouldFocusContent } from './scroll-frame';

const body = {};
const key = (k: string, over: Partial<Parameters<typeof shouldFocusContent>[0]> = {}) => ({
  key: k,
  target: body,
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});
const tall = { scrollHeight: 1200, clientHeight: 700 };

describe('shouldFocusContent (spec §32 AC-SB-08)', () => {
  it('takes every scroll key sent to the body while the frame has more to show', () => {
    for (const k of SCROLL_KEYS) expect(shouldFocusContent(key(k), body, tall, true)).toBe(true);
  });

  it('keeps Shift + Space (scrolls up)', () => {
    const e = { ...key(' '), shiftKey: true };
    expect(shouldFocusContent(e, body, tall, true)).toBe(true);
  });

  it('leaves keys aimed at a control, other keys and shortcuts alone', () => {
    expect(shouldFocusContent(key(' ', { target: {} }), body, tall, true)).toBe(false);
    expect(shouldFocusContent(key('a'), body, tall, true)).toBe(false);
    expect(shouldFocusContent(key('Tab'), body, tall, true)).toBe(false);
    expect(shouldFocusContent(key('End', { ctrlKey: true }), body, tall, true)).toBe(false);
    expect(shouldFocusContent(key('End', { metaKey: true }), body, tall, true)).toBe(false);
    expect(shouldFocusContent(key('End', { altKey: true }), body, tall, true)).toBe(false);
    expect(shouldFocusContent(key('End', { defaultPrevented: true }), body, tall, true)).toBe(
      false,
    );
  });

  it('does nothing below 768px (the page scrolls), without a frame or when all fits', () => {
    expect(shouldFocusContent(key('End'), body, tall, false)).toBe(false);
    expect(shouldFocusContent(key('End'), body, null, true)).toBe(false);
    expect(
      shouldFocusContent(key('End'), body, { scrollHeight: 700, clientHeight: 700 }, true),
    ).toBe(false);
  });
});
