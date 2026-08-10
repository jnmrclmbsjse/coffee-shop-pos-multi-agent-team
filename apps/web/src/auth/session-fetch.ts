const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): void {
  unauthorizedHandler = handler;
}

export async function sessionFetch(
  path: string,
  init?: RequestInit,
  options: { handleUnauthorized?: boolean } = {},
): Promise<Response> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
  });

  if (response.status === 401 && options.handleUnauthorized !== false) {
    unauthorizedHandler?.();
  }

  return response;
}
