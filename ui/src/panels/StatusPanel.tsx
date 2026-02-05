import { useEffect, useState } from "react";
import { createApi } from "../api";
import type { Lang } from "../i18n";

export default function StatusPanel({
  api,
  lang,
  t,
  onError,
  onNotify,
}: {
  api: ReturnType<typeof createApi>;
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onError: (err: unknown, fallback: string) => void;
  onNotify: (type: "success" | "error", text: string) => void;
}) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const busy = loading || reloading;

  async function load() {
    setLoading(true);
    try {
      const data = await api.getStatus();
      setStatus(data);
    } catch (err) {
      onError(err, t("error.load.status"));
    } finally {
      setLoading(false);
    }
  }

  async function reload() {
    setReloading(true);
    try {
      const data = await api.reload();
      setStatus(data);
      onNotify(
        "success",
        data?.reloaded ? t("notice.reloaded") : t("notice.debounced"),
      );
    } catch (err) {
      onError(err, t("error.reload"));
    } finally {
      setReloading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("status.title")}</h2>
          <p className="text-sm text-slate-400">{t("status.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={load}
            disabled={busy}
          >
            {t("status.refresh")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={reload}
            disabled={busy}
          >
            {reloading ? t("status.reloading") : t("status.reload")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label={t("status.card.version")}
          value={status?.version ?? "-"}
        />
        <MetricCard
          label={t("status.card.uptime")}
          value={String(status?.uptime_sec ?? "-")}
        />
        <MetricCard
          label={t("status.card.loaded")}
          value={formatDateTime(status?.loaded_at, lang)}
        />
        <MetricCard
          label={t("status.card.mtime")}
          value={formatDateTime(status?.config?.mtime, lang)}
        />
        <MetricCard
          label={t("status.card.models")}
          value={String(status?.models?.count ?? "-")}
        />
        <MetricCard
          label={t("status.card.aliases")}
          value={String(status?.aliases?.count ?? "-")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("status.models")}
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            {(status?.models?.ids ?? []).map((id: string) => (
              <li key={id} className="rounded-lg bg-slate-900/60 px-3 py-2">
                {id}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("status.aliases")}
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            {(status?.aliases?.names ?? []).map((name: string) => (
              <li key={name} className="rounded-lg bg-slate-900/60 px-3 py-2">
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/40 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function formatDateTime(value: string | number | null | undefined, lang: Lang) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
