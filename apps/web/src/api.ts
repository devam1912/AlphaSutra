export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = 'GET',
  key?: string,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({ message: 'Service unavailable' }))) as {
      message?: string;
    };
    throw new ApiError(result.message ?? 'Request failed', response.status);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
export function toPaise(text: string) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text.trim()))
    throw new Error('Enter a positive rupee amount with at most two decimals');
  const [whole, fraction = ''] = text.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export const rupees = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2,
      }).format(value / 100);
export const percent = (value: number | null | undefined) =>
  value == null ? 'Not measured' : `${(value * 100).toFixed(1)}%`;
export const when = (value: string) =>
  new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
