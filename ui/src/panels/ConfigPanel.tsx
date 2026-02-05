import { useEffect, useState } from "react";
import { createApi } from "../api";
import {
  type ConfigForm,
  type ReasoningMode,
  DEFAULT_CONFIG,
  configToForm,
  configToPayload,
} from "../forms/config";

export default function ConfigPanel({
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
  const [form, setForm] = useState<ConfigForm>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = loading || saving;

  async function load() {
    setLoading(true);
    try {
      const configData = await api.getConfig();
      setForm(configToForm(configData));
    } catch (err) {
      onError(err, t("error.load.config"));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const payload = configToPayload(form);
    setSaving(true);
    try {
      const data = await api.putConfig(payload);
      setForm(configToForm(data));
      onNotify("success", t("notice.config.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("config.title")}</h2>
          <p className="text-sm text-slate-400">{t("config.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={load}
            disabled={busy}
          >
            {t("config.refresh")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={save}
            disabled={busy}
          >
            {saving ? "..." : t("config.save")}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            Response
          </h3>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("config.reasoning")}
              <select
                value={form.response.reasoning_mode}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    response: {
                      ...prev.response,
                      reasoning_mode: e.target.value as ReasoningMode,
                    },
                  }))
                }
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              >
                <option value="none">{t("config.reasoning.none")}</option>
                <option value="prefix">{t("config.reasoning.prefix")}</option>
                <option value="field">{t("config.reasoning.field")}</option>
              </select>
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("config.stream_first_delay")}
              <input
                value={form.response.stream_first_delay_ms}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    response: {
                      ...prev.response,
                      stream_first_delay_ms: e.target.value,
                    },
                  }))
                }
                placeholder="200"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-900/60 px-3 py-2.5 text-sm">
              <span className="text-sm text-slate-200">
                {t("config.include_usage")}
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-400"
                checked={form.response.include_usage}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    response: {
                      ...prev.response,
                      include_usage: e.target.checked,
                    },
                  }))
                }
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-900/60 px-3 py-2.5 text-sm">
              <span className="text-sm text-slate-200">
                {t("config.schema_strict")}
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-400"
                checked={form.response.schema_strict}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    response: {
                      ...prev.response,
                      schema_strict: e.target.checked,
                    },
                  }))
                }
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
