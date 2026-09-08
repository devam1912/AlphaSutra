import { DomainError } from '../errors.js';

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private probeRunning = false;
  constructor(
    private threshold = 3,
    private cooldownMs = 60000,
    private now: () => number = Date.now,
  ) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.openUntil > this.now() || this.probeRunning) {
      throw new DomainError('CIRCUIT_OPEN', 'Provider cooling down after repeated failures', 503);
    }
    const probe = this.openUntil !== 0;
    if (probe) this.probeRunning = true;
    try {
      const result = await operation();
      this.failures = 0;
      this.openUntil = 0;
      return result;
    } catch (error) {
      this.failures++;
      if (this.failures >= this.threshold) this.openUntil = this.now() + this.cooldownMs;
      throw error;
    } finally {
      if (probe) this.probeRunning = false;
    }
  }
}
const breakers = new Map<string, CircuitBreaker>();
export function providerCircuit(origin: string) {
  let breaker = breakers.get(origin);
  if (!breaker) {
    if (breakers.size >= 32) breakers.delete(breakers.keys().next().value!);
    breaker = new CircuitBreaker();
    breakers.set(origin, breaker);
  }
  return breaker;
}
