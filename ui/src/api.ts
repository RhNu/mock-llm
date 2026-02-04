export type ApiError = {
  status?: number;
  message: string;
  details?: unknown;
};

export function createApi(getToken: () => string, onUnauthorized: () => void) {
  async function requestJson(path: string, options: { method?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    const data = text
      ? contentType.includes("application/json")
        ? JSON.parse(text)
        : text
      : null;

    if (res.status === 401) {
      onUnauthorized();
      throw { status: 401, message: "Unauthorized", details: data } as ApiError;
    }

    if (!res.ok) {
      const message =
        data && typeof data === "object" && "error" in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : typeof data === "string"
            ? data
            : res.statusText;
      throw { status: res.status, message, details: data } as ApiError;
    }

    return data;
  }

  return {
    getStatus: () => requestJson("/v0/status"),
    reload: () => requestJson("/v0/reload", { method: "POST" }),
    getConfig: () => requestJson("/v0/config"),
    putConfig: (payload: unknown) => requestJson("/v0/config", { method: "PUT", body: payload }),
    listModels: () => requestJson("/v0/models"),
    getModel: (id: string) => requestJson(`/v0/models/${encodeURIComponent(id)}`),
    putModel: (id: string, payload: unknown) =>
      requestJson(`/v0/models/${encodeURIComponent(id)}`, { method: "PUT", body: payload }),
    deleteModel: (id: string) => requestJson(`/v0/models/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listScripts: () => requestJson("/v0/scripts"),
    getScript: (name: string) => requestJson(`/v0/scripts/${encodeURIComponent(name)}`),
    putScript: (name: string, content: string) =>
      requestJson(`/v0/scripts/${encodeURIComponent(name)}`, { method: "PUT", body: { content } }),
    deleteScript: (name: string) =>
      requestJson(`/v0/scripts/${encodeURIComponent(name)}`, { method: "DELETE" })
  };
}
