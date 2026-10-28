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
  let body: { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('NETWORK', 'Unexpected response from the server', res.status);
  }
  if (body.ok) return body.data as T;
  throw new ApiError(body.error!.code, body.error!.message, res.status, body.error!.details);
}
