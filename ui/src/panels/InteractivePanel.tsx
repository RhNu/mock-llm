import { useEffect, useRef, useState } from "react";
import { createApi } from "../api";

type InteractiveRequest = {
  id: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  stream: boolean;
  created: number;
  timeout_ms: number;
};

type ReplyDraft = {
  content: string;
  reasoning: string;
  finish_reason: string;
};

export default function InteractivePanel({
  api,
  t,
  onError,
  onNotify,
}: {
  api: ReturnType<typeof createApi>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onError: (err: unknown, fallback: string) => void;
  onNotify: (type: "success" | "error", text: string) => void;
}) {
  const [requests, setRequests] = useState<InteractiveRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, ReplyDraft>>({});
  const connectingRef = useRef(false);

  async function loadRequests() {
    try {
      const data = await api.listInteractiveRequests();
      const next = Array.isArray(data?.requests) ? data.requests : [];
      setRequests(next);
      if (!selectedId && next.length) {
        setSelectedId(next[0].id);
      }
    } catch (err) {
      onError(err, t("error.interactive.load"));
    }
  }

  function updateDraft(id: string, patch: Partial<ReplyDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        content: "",
        reasoning: "",
        finish_reason: "",
        ...(prev[id] ?? {}),
        ...patch,
      },
    }));
  }

  async function sendReply() {
    const selected = requests.find((item) => item.id === selectedId);
    if (!selected) {
      return;
    }
    const draft = drafts[selected.id] ?? {
      content: "",
      reasoning: "",
      finish_reason: "",
    };
    if (!draft.content.trim()) {
      onNotify("error", t("error.interactive.empty"));
      return;
    }
    try {
      await api.replyInteractiveRequest(selected.id, {
        content: draft.content.trim(),
        ...(draft.reasoning.trim()
          ? { reasoning: draft.reasoning.trim() }
          : {}),
        ...(draft.finish_reason.trim()
          ? { finish_reason: draft.finish_reason.trim() }
          : {}),
      });
      onNotify("success", t("notice.interactive.sent"));
      setRequests((prev) => {
        const next = prev.filter((item) => item.id !== selected.id);
        if (selectedId === selected.id) {
          setSelectedId(next.length ? next[0].id : "");
        }
        return next;
      });
    } catch (err) {
      onError(err, t("error.interactive.reply"));
    }
  }

  function applyEvent(payload: any) {
    const kind = payload?.type;
    if (kind === "queued" && payload?.request) {
      setRequests((prev) => {
        if (prev.some((item) => item.id === payload.request.id)) {
          return prev;
        }
        const next = [...prev, payload.request as InteractiveRequest];
        if (!selectedId) {
          setSelectedId(payload.request.id);
        }
        return next;
      });
      return;
    }
    if (kind === "replied" || kind === "timeout") {
      const id = payload?.id;
      if (!id) {
        return;
      }
      setRequests((prev) => prev.filter((item) => item.id !== id));
      setSelectedId((prev) => (prev === id ? "" : prev));
    }
  }

  async function connectStream(signal: AbortSignal) {
    if (connectingRef.current) {
      return;
    }
    connectingRef.current = true;
    try {
      const res = await fetch("/v0/interactive/stream", {
        headers: {
          Accept: "text/event-stream",
          ...api.getAuthHeaders(),
        },
        signal,
      });
      if (!res.ok || !res.body) {
        throw new Error("stream failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n");
        while (idx >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload && payload !== "[DONE]") {
              try {
                applyEvent(JSON.parse(payload));
              } catch {
                // ignore malformed event
              }
            }
          }
          idx = buffer.indexOf("\n");
        }
      }
    } finally {
      connectingRef.current = false;
    }
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | null = null;

    const run = async () => {
      try {
        await connectStream(controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          retryTimer = window.setTimeout(run, 2000);
        }
      }
    };

    run();

    return () => {
      controller.abort();
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [api]);

  const selected = requests.find((item) => item.id === selectedId) ?? null;
  const draft = selected ? drafts[selected.id] ?? {
    content: "",
    reasoning: "",
    finish_reason: "",
  } : null;

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("interactive.title")}</h2>
          <p className="text-sm text-slate-400">{t("interactive.desc")}</p>
        </div>
        <button
          className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
          onClick={loadRequests}
        >
          {t("interactive.refresh")}
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("interactive.list")}
          </div>
          <div className="mt-3 max-h-[440px] space-y-2 overflow-auto">
            {requests.length ? (
              requests.map((item) => (
                <button
                  key={item.id}
                  className={[
                    "flex w-full flex-col gap-1 rounded-xl border px-3 py-2 text-left text-sm transition",
                    selectedId === item.id
                      ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                      : "border-transparent bg-slate-900/60 text-slate-100 hover:border-slate-600/60",
                  ].join(" ")}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {item.model}
                  </span>
                  <span className="text-sm">{item.id}</span>
                </button>
              ))
            ) : (
              <p className="text-xs text-slate-500">
                {t("interactive.empty")}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("interactive.request")}
          </div>
          {selected ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-xs text-slate-300">
                <div className="flex flex-wrap gap-3">
                  <span>id: {selected.id}</span>
                  <span>model: {selected.model}</span>
                  <span>stream: {String(selected.stream)}</span>
                  <span>timeout: {selected.timeout_ms}ms</span>
                </div>
              </div>
              <div className="space-y-2">
                {selected.messages.map((msg, idx) => (
                  <div
                    key={`${msg.role}-${idx}`}
                    className="rounded-xl border border-slate-700/50 bg-slate-950/60 p-3 text-sm text-slate-200"
                  >
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      {msg.role}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap text-sm">
                      {typeof msg.content === "string"
                        ? msg.content
                        : JSON.stringify(msg.content, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {t("interactive.reply")}
                </div>
                <textarea
                  value={draft?.content ?? ""}
                  onChange={(e) =>
                    selected && updateDraft(selected.id, { content: e.target.value })
                  }
                  rows={4}
                  placeholder={t("interactive.reply.placeholder")}
                  className="w-full rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {t("interactive.reasoning")}
                    <input
                      value={draft?.reasoning ?? ""}
                      onChange={(e) =>
                        selected && updateDraft(selected.id, { reasoning: e.target.value })
                      }
                      placeholder="optional"
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {t("interactive.finish_reason")}
                    <input
                      value={draft?.finish_reason ?? ""}
                      onChange={(e) =>
                        selected &&
                        updateDraft(selected.id, { finish_reason: e.target.value })
                      }
                      placeholder="stop"
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                    />
                  </label>
                </div>
                <button
                  className="rounded-full bg-sky-400/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
                  onClick={sendReply}
                >
                  {t("interactive.send")}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t("interactive.empty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
