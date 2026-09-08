import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../apps/api/src/data/circuit.js';

describe('provider circuit breaker', () => {
  it('bounds repeated failed requests and recovers through one probe', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker(2, 100, () => now);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(breaker.run(failing)).rejects.toThrow('offline');
    await expect(breaker.run(failing)).rejects.toThrow('offline');
    await expect(breaker.run(failing)).rejects.toThrow('cooling down');
    expect(failing).toHaveBeenCalledTimes(2);
    now = 1101;
    expect(await breaker.run(async () => 'recovered')).toBe('recovered');
    expect(await breaker.run(async () => 'still available')).toBe('still available');
  });
  it('does not launch simultaneous half-open probes', async () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 10, () => now);
    await expect(
      breaker.run(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow();
    now = 11;
    let finish: (value: string) => void = () => {};
    const probe = breaker.run(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await expect(breaker.run(async () => 'duplicate')).rejects.toThrow('cooling down');
    finish('ok');
    expect(await probe).toBe('ok');
  });
});
