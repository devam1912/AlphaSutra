import { providerCircuit } from './circuit.js';
import { DomainError } from '../errors.js';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function requestText(
  url: string,
  init: RequestInit = {},
  maxBytes = 2_000_000,
  timeout = 15000,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        if (attempt === 2)
          throw new DomainError('PROVIDER_UNAVAILABLE', 'Provider temporarily unavailable', 503);
        const retry = Number(response.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 10000) : 250 * 2 ** attempt,
        );
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new DomainError('PROVIDER_REJECTED', 'Provider rejected the request', 502);
      }
      if (!response.body) throw new DomainError('EMPTY_RESPONSE', 'Empty provider response', 502);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new DomainError('RESPONSE_LIMIT', 'Provider response too large', 502);
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      if (error instanceof DomainError || attempt === 2) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw new DomainError('PROVIDER_UNAVAILABLE', 'Provider unavailable', 503);
}
export async function requestJson(
  url: string,
  init?: RequestInit,
  maxBytes?: number,
  timeout?: number,
): Promise<unknown> {
  return providerCircuit(new URL(url).origin).run(
    async () => JSON.parse(await requestText(url, init, maxBytes, timeout)) as unknown,
  );
}
