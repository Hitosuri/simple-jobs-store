export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('NETWORK', 'Cannot reach the server', 0);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('NETWORK', 'Unexpected response from the server', res.status);
  }
  if (typeof body !== 'object' || body === null || typeof (body as { ok?: unknown }).ok !== 'boolean') {
    throw new ApiError('NETWORK', 'Unexpected response', res.status);
  }
  const envelope = body as { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } };
  if (envelope.ok) return envelope.data as T;
  const { error } = envelope;
  if (typeof error !== 'object' || error === null) {
    throw new ApiError('INTERNAL_ERROR', 'Unexpected error response', res.status);
  }
  throw new ApiError(error.code, error.message, res.status, error.details);
}

export function retryNetworkErrors(count: number, err: Error): boolean {
  return err instanceof ApiError && err.code === 'NETWORK' && count < 3;
}
