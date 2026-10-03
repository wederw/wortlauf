// Thin wrapper around fetch for the JSON API.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (handler) => (onUnauthorized = handler);

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Der Server ist nicht erreichbar.', 0);
  }
  if (response.status === 401 && !path.endsWith('/login')) onUnauthorized();
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!response.ok) {
    const detail = data?.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? 'Die Eingabe ist ungültig.' : `Fehler ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};
