export type ApiError = {
  status?: number;
  message: string;
  details?: unknown;
};

export type AdminAuthStatus = {
  enabled: boolean;
};

export function createApi(getToken: () => string, onUnauthorized: () => void) {
  function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function requestJson(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ) {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    Object.assign(headers, authHeaders());

    const res = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
        data &&
        typeof data === "object" &&
        "error" in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : typeof data === "string"
            ? data
            : res.statusText;
      throw { status: res.status, message, details: data } as ApiError;
    }

    return data;
  }

  async function requestText(
    path: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    const headers: Record<string, string> = {
      Accept: "text/plain",
      ...(options.headers ?? {}),
    };
    if (options.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "text/plain";
    }
    Object.assign(headers, authHeaders());

    const res = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
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
        data &&
        typeof data === "object" &&
        "error" in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : typeof data === "string"
            ? data
            : res.statusText;
      throw { status: res.status, message, details: data } as ApiError;
    }

    return typeof data === "string" ? data : "";
  }

  return {
    getAuthHeaders: authHeaders,
    getAdminAuth: () => requestJson("/v0/admin/auth") as Promise<AdminAuthStatus>,
    getStatus: () => requestJson("/v0/status"),
    reload: () => requestJson("/v0/reload", { method: "POST" }),
    getConfig: () => requestJson("/v0/config"),
    putConfig: (payload: unknown) =>
      requestJson("/v0/config", { method: "PUT", body: payload }),
    getModelsBundle: () => requestJson("/v0/models"),
    putModelsBundle: (payload: unknown) =>
      requestJson("/v0/models", { method: "PUT", body: payload }),
    getModelsYaml: () =>
      requestText("/v0/models", { headers: { Accept: "text/yaml" } }),
    putModelsYaml: (payload: string) =>
      requestText("/v0/models", {
        method: "PUT",
        headers: { "Content-Type": "text/yaml", Accept: "text/yaml" },
        body: payload,
      }),
    listScripts: () => requestJson("/v0/scripts"),
    getScript: (name: string) =>
      requestJson(`/v0/scripts/${encodeURIComponent(name)}`),
    putScript: (name: string, content: string) =>
      requestJson(`/v0/scripts/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: { content },
      }),
    deleteScript: (name: string) =>
      requestJson(`/v0/scripts/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    listInteractiveRequests: () => requestJson("/v0/interactive/requests"),
    replyInteractiveRequest: (id: string, payload: unknown) =>
      requestJson(`/v0/interactive/requests/${encodeURIComponent(id)}/reply`, {
        method: "POST",
        body: payload,
      }),
  };
}
