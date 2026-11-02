import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  getSlowOperationThresholdMs,
  isSlowOperationDuration,
  measureOperation,
  recordOperationDuration
} from '../src/utils/perf-timing.js';

describe('slow operation timing helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the conservative threshold for non-verbose logging', () => {
    expect(getSlowOperationThresholdMs()).toBe(1000);
    expect(isSlowOperationDuration(999.9)).toBe(false);
    expect(isSlowOperationDuration(1000)).toBe(true);
  });

  it('passes through the measured operation result', () => {
    expect(measureOperation('test.scope', () => 42)).toBe(42);
  });

  it('logs slow work without sensitive values', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    recordOperationDuration('test.scope', 1500);

    expect(logSpy).toHaveBeenCalledOnce();
    const loggedLines = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(loggedLines).toContain('Slow request work: test.scope');
    expect(loggedLines).toContain('durationMs=1500');
    expect(loggedLines).not.toContain('/');

    logSpy.mockRestore();
  });

  it('stays silent for durations below the threshold', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    recordOperationDuration('test.fast_scope', 250);

    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
