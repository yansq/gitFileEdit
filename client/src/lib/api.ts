export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload: unknown,
  ) {
    super(message);
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    const fallbackText = await response.text();
    let payload: unknown = null;
    try {
      payload = fallbackText ? JSON.parse(fallbackText) : null;
    } catch {
      payload = null;
    }

    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : fallbackText || "请求失败";
    throw new ApiRequestError(message, response.status, payload);
  }

  return (await response.json()) as T;
}
