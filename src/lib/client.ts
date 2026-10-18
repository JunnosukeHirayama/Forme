export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: Record<string, string>,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  const data = await response.json();
  if (
    response.status === 401 &&
    typeof window !== 'undefined' &&
    !location.pathname.startsWith('/f/')
  )
    location.href = '/login';
  if (!response.ok)
    throw new ApiError(data.error || '処理に失敗しました', response.status, data.details);
  return data as T;
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}
export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.click();
}
