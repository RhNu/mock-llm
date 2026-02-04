import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import toast, { Toaster } from "react-hot-toast";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import { ApiError, createApi } from "./api";
import { createTranslator, getInitialLang, saveLang, Lang } from "./i18n";

type View = "status" | "config" | "models" | "scripts";

type MatchType = "none" | "plain" | "regex";

type ReasoningMode = "none" | "prefix" | "field" | "both";

type AliasStrategy = "round_robin" | "random";

type ReplyForm = {
  uid: string;
  content: string;
  reasoning: string;
  matchType: MatchType;
  matchValue: string;
};

type AliasForm = {
  id: string;
  name: string;
  strategy: AliasStrategy;
  providers: string[];
  newProvider: string;
};

type ConfigForm = {
  response: {
    reasoning_mode: ReasoningMode;
    include_usage: boolean;
    schema_strict: boolean;
  };
  models: {
    default: string;
    routing: {
      aliases: AliasForm[];
    };
  };
};

const SCRIPT_TEMPLATE = `// @ts-check
/** @param {import("./types").ScriptInput} input */
export function handle(input) {
  return { content: "Hello from script" };
}
`;

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createReply(): ReplyForm {
  return {
    uid: makeId(),
    content: "",
    reasoning: "",
    matchType: "none",
    matchValue: ""
  };
}

function createAlias(): AliasForm {
  return {
    id: makeId(),
    name: "",
    strategy: "round_robin",
    providers: [],
    newProvider: ""
  };
}

const DEFAULT_MODEL_FORM = () => ({
  id: "",
  owned_by: "llm-lab",
  created: "",
  type: "static" as "static" | "script",
  static: {
    strategy: "round_robin" as "round_robin" | "random" | "match",
    stream_chunk_chars: "",
    replies: [createReply()]
  },
  script: {
    file: "example.js",
    init_file: "",
    timeout_ms: "1500",
    stream_chunk_chars: ""
  }
});

const DEFAULT_CONFIG: ConfigForm = {
  response: {
    reasoning_mode: "both",
    include_usage: true,
    schema_strict: true
  },
  models: {
    default: "",
    routing: {
      aliases: []
    }
  }
};

export default function App() {
  const [view, setView] = useState<View>("status");

  const [token, setToken] = useState(() => localStorage.getItem("admin_token") ?? "");
  const [tokenDraft, setTokenDraft] = useState(token);
  const [needsToken, setNeedsToken] = useState(true);

  const [lang, setLang] = useState<Lang>(getInitialLang());
  const t = useMemo(() => createTranslator(lang), [lang]);

  useEffect(() => {
    saveLang(lang);
  }, [lang]);

  const api = useMemo(
    () =>
      createApi(
        () => token,
        () => setNeedsToken(true)
      ),
    [token]
  );

  useEffect(() => {
    setNeedsToken(true);
  }, []);

  function notify(type: "success" | "error", text: string) {
    if (type === "success") {
      toast.success(text);
    } else {
      toast.error(text);
    }
  }

  function handleApiError(error: unknown, fallback: string) {
    const err = error as ApiError;
    const msg = err?.message ? `${fallback}: ${err.message}` : fallback;
    notify("error", msg);
  }

  function saveToken(value: string) {
    setToken(value);
    setTokenDraft(value);
    if (value) {
      localStorage.setItem("admin_token", value);
    } else {
      localStorage.removeItem("admin_token");
    }
    setNeedsToken(false);
    notify("success", value ? t("notice.token.saved") : t("notice.token.cleared"));
  }

  const navItems = [
    { id: "status" as const, label: t("nav.status"), hint: t("nav.status.hint") },
    { id: "config" as const, label: t("nav.config"), hint: t("nav.config.hint") },
    { id: "models" as const, label: t("nav.models"), hint: t("nav.models.hint") },
    { id: "scripts" as const, label: t("nav.scripts"), hint: t("nav.scripts.hint") }
  ];
  return (
    <div className="min-h-screen px-5 py-6 text-slate-100 md:px-8">
      <Toaster position="top-right" toastOptions={{ duration: 4200 }} />
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-700/40 bg-[var(--panel)] px-6 py-5 shadow-[var(--shadow)] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-full bg-sky-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-sky-300">
            mock-llm
          </div>
          <div>
            <div className="text-xl font-semibold">{t("app.title")}</div>
            <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {t("app.subtitle")}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-slate-700/60 bg-slate-900/50 p-1">
            <button
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                lang === "zh" ? "bg-sky-500/15 text-sky-300" : "text-slate-300"
              }`}
              onClick={() => setLang("zh")}
            >
              中
            </button>
            <button
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                lang === "en" ? "bg-sky-500/15 text-sky-300" : "text-slate-300"
              }`}
              onClick={() => setLang("en")}
            >
              EN
            </button>
          </div>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={() => setNeedsToken(true)}
          >
            {t("app.token")}
          </button>
          <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs uppercase tracking-[0.3em]">
            /{view}
          </span>
        </div>
      </header>

      <main className="mt-6 grid gap-6 xl:grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-3 rounded-3xl border border-slate-700/40 bg-[var(--panel)] p-4 shadow-[var(--shadow)]">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`rounded-2xl px-4 py-3 text-left transition ${
                view === item.id
                  ? "border border-sky-400/40 bg-sky-500/10 text-sky-200"
                  : "border border-transparent bg-slate-900/40 text-slate-100 hover:border-slate-600/60"
              }`}
              onClick={() => setView(item.id)}
            >
              <div className="text-sm font-semibold">{item.label}</div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                {item.hint}
              </div>
            </button>
          ))}
          <div className="mt-auto flex items-center gap-2 text-xs text-slate-400">
            <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.6)]" />
            <span>{t("app.connected")}</span>
          </div>
        </aside>

        <section className="min-h-[620px] rounded-[28px] border border-slate-700/40 bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
          {view === "status" && (
            <StatusPanel
              api={api}
              lang={lang}
              t={t}
              onError={handleApiError}
              onNotify={notify}
            />
          )}
          {view === "config" && (
            <ConfigPanel api={api} t={t} onError={handleApiError} onNotify={notify} />
          )}
          {view === "models" && (
            <ModelsPanel api={api} t={t} onError={handleApiError} onNotify={notify} />
          )}
          {view === "scripts" && (
            <ScriptsPanel api={api} t={t} onError={handleApiError} onNotify={notify} />
          )}
        </section>
      </main>

      {needsToken && (
        <TokenModal
          token={tokenDraft}
          onChange={setTokenDraft}
          onSave={() => saveToken(tokenDraft.trim())}
          onSkip={() => {
            setNeedsToken(false);
            notify("success", t("notice.token.skip"));
          }}
          t={t}
        />
      )}
    </div>
  );
}

function StatusPanel({
  api,
  lang,
  t,
  onError,
  onNotify
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
      onNotify("success", data?.reloaded ? t("notice.reloaded") : t("notice.debounced"));
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
            disabled={loading}
          >
            {t("status.refresh")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={reload}
            disabled={reloading}
          >
            {reloading ? t("status.reloading") : t("status.reload")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label={t("status.card.version")} value={status?.version ?? "-"} />
        <MetricCard label={t("status.card.uptime")} value={String(status?.uptime_sec ?? "-")} />
        <MetricCard label={t("status.card.loaded")} value={formatDateTime(status?.loaded_at, lang)} />
        <MetricCard label={t("status.card.mtime")} value={formatDateTime(status?.config?.mtime, lang)} />
        <MetricCard label={t("status.card.models")} value={String(status?.models?.count ?? "-")} />
        <MetricCard label={t("status.card.aliases")} value={String(status?.aliases?.count ?? "-")} />
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
function ConfigPanel({
  api,
  t,
  onError,
  onNotify
}: {
  api: ReturnType<typeof createApi>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onError: (err: unknown, fallback: string) => void;
  onNotify: (type: "success" | "error", text: string) => void;
}) {
  const [form, setForm] = useState<ConfigForm>(DEFAULT_CONFIG);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [configData, modelsData] = await Promise.all([api.getConfig(), api.listModels()]);
      setForm(configToForm(configData));
      setModelIds((modelsData?.data ?? []).map((item: any) => item.id));
    } catch (err) {
      onError(err, t("error.load.config"));
    } finally {
      setLoading(false);
    }
  }

  function addAlias() {
    setForm((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        routing: {
          ...prev.models.routing,
          aliases: [...prev.models.routing.aliases, createAlias()]
        }
      }
    }));
  }

  function updateAlias(id: string, patch: Partial<AliasForm>) {
    setForm((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        routing: {
          ...prev.models.routing,
          aliases: prev.models.routing.aliases.map((alias) =>
            alias.id === id ? { ...alias, ...patch } : alias
          )
        }
      }
    }));
  }

  function removeAlias(id: string) {
    setForm((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        routing: {
          ...prev.models.routing,
          aliases: prev.models.routing.aliases.filter((alias) => alias.id !== id)
        }
      }
    }));
  }

  function addProvider(id: string) {
    setForm((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        routing: {
          ...prev.models.routing,
          aliases: prev.models.routing.aliases.map((alias) => {
            if (alias.id !== id) {
              return alias;
            }
            const next = alias.newProvider.trim();
            if (!next) {
              return alias;
            }
            if (alias.providers.includes(next)) {
              return { ...alias, newProvider: "" };
            }
            return {
              ...alias,
              providers: [...alias.providers, next],
              newProvider: ""
            };
          })
        }
      }
    }));
  }

  function removeProvider(id: string, provider: string) {
    setForm((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        routing: {
          ...prev.models.routing,
          aliases: prev.models.routing.aliases.map((alias) =>
            alias.id === id
              ? { ...alias, providers: alias.providers.filter((item) => item !== provider) }
              : alias
          )
        }
      }
    }));
  }

  async function save() {
    const payload = configToPayload(form);
    for (const alias of payload.models.routing.aliases) {
      if (!alias.name.trim()) {
        onNotify("error", t("error.routing.alias.name"));
        return;
      }
      if (!alias.providers.length) {
        onNotify("error", t("error.routing.alias.providers", { name: alias.name || "-" }));
        return;
      }
    }

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("config.title")}</h2>
          <p className="text-sm text-slate-400">{t("config.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={load}
            disabled={loading}
          >
            {t("config.refresh")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={save}
            disabled={saving}
          >
            {saving ? "..." : t("config.save")}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            Response
          </h3>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("config.reasoning")}
              <select
                value={form.response.reasoning_mode}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    response: {
                      ...prev.response,
                      reasoning_mode: e.target.value as ReasoningMode
                    }
                  }))
                }
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              >
                <option value="none">{t("config.reasoning.none")}</option>
                <option value="prefix">{t("config.reasoning.prefix")}</option>
                <option value="field">{t("config.reasoning.field")}</option>
                <option value="both">{t("config.reasoning.both")}</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-900/60 px-3 py-3 text-sm">
              <span className="text-sm text-slate-200">{t("config.include_usage")}</span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-400"
                checked={form.response.include_usage}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    response: {
                      ...prev.response,
                      include_usage: e.target.checked
                    }
                  }))
                }
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-900/60 px-3 py-3 text-sm">
              <span className="text-sm text-slate-200">{t("config.schema_strict")}</span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-400"
                checked={form.response.schema_strict}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    response: {
                      ...prev.response,
                      schema_strict: e.target.checked
                    }
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            Models
          </h3>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("config.default_model")}
              <input
                list="model-options"
                value={form.models.default}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    models: {
                      ...prev.models,
                      default: e.target.value
                    }
                  }))
                }
                placeholder="llm-flash"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <datalist id="model-options">
              {modelIds.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
              Routing
            </h3>
            <p className="text-sm text-slate-400">{t("config.routing.desc")}</p>
          </div>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={addAlias}
          >
            {t("config.routing.add")}
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          {form.models.routing.aliases.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-700/60 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-400">
              {t("config.routing.empty")}
            </div>
          )}
          {form.models.routing.aliases.map((alias) => (
            <div
              key={alias.id}
              className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-100">
                  {alias.name || t("config.routing.alias")}
                </div>
                <button
                  className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200"
                  onClick={() => removeAlias(alias.id)}
                >
                  {t("config.routing.remove")}
                </button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr]">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("config.routing.name")}
                  <input
                    value={alias.name}
                    onChange={(e) => updateAlias(alias.id, { name: e.target.value })}
                    placeholder="llm-pro"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("config.routing.strategy")}
                  <select
                    value={alias.strategy}
                    onChange={(e) =>
                      updateAlias(alias.id, { strategy: e.target.value as AliasStrategy })
                    }
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="round_robin">{t("config.routing.strategy.round_robin")}</option>
                    <option value="random">{t("config.routing.strategy.random")}</option>
                  </select>
                </label>
              </div>

              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("config.routing.providers")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {alias.providers.map((provider) => (
                    <span
                      key={provider}
                      className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/70 px-3 py-1 text-xs"
                    >
                      {provider}
                      <button
                        className="text-rose-200 hover:text-rose-100"
                        onClick={() => removeProvider(alias.id, provider)}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    list="model-options"
                    value={alias.newProvider}
                    onChange={(e) => updateAlias(alias.id, { newProvider: e.target.value })}
                    placeholder="llm-flash"
                    className="flex-1 rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                  <button
                    className="rounded-full bg-slate-200/90 px-4 py-2 text-xs font-semibold text-slate-900"
                    onClick={() => addProvider(alias.id)}
                  >
                    {t("config.routing.add_provider")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function ModelsPanel({
  api,
  t,
  onError,
  onNotify
}: {
  api: ReturnType<typeof createApi>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onError: (err: unknown, fallback: string) => void;
  onNotify: (type: "success" | "error", text: string) => void;
}) {
  const [models, setModels] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState(DEFAULT_MODEL_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  async function loadList() {
    setLoading(true);
    try {
      const data = await api.listModels();
      setModels(data?.data ?? []);
    } catch (err) {
      onError(err, t("error.load.models"));
    } finally {
      setLoading(false);
    }
  }

  async function select(id: string) {
    setSelectedId(id);
    try {
      const data = await api.getModel(id);
      setForm(modelToForm(data));
    } catch (err) {
      onError(err, t("error.load.model"));
    }
  }

  function newModel() {
    setSelectedId("");
    setForm(DEFAULT_MODEL_FORM());
  }

  async function save() {
    const id = form.id.trim();
    if (!id) {
      onNotify("error", t("error.model.id"));
      return;
    }

    if (form.type === "static" && form.static.strategy === "match") {
      const replies = form.static.replies;
      const last = replies[replies.length - 1];
      if (last && last.matchType !== "none") {
        onNotify("error", t("error.match.last"));
        return;
      }
      for (const reply of replies.slice(0, -1)) {
        if (reply.matchType === "none") {
          onNotify("error", t("error.match.before"));
          return;
        }
      }
    }

    setSaving(true);
    try {
      const payload = formToModel(form);
      await api.putModel(id, payload);
      await loadList();
      setSelectedId(id);
      setForm((prev) => ({ ...prev, id }));
      onNotify("success", t("notice.model.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const id = form.id.trim();
    if (!id) {
      onNotify("error", t("error.model.id"));
      return;
    }
    if (!window.confirm(t("confirm.delete.model", { id }))) {
      return;
    }
    try {
      await api.deleteModel(id);
      await loadList();
      newModel();
      onNotify("success", t("notice.model.deleted"));
    } catch (err) {
      onError(err, t("error.delete"));
    }
  }

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setForm((prev) => {
      const oldIndex = prev.static.replies.findIndex((reply) => reply.uid === active.id);
      const newIndex = prev.static.replies.findIndex((reply) => reply.uid === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        return prev;
      }
      return {
        ...prev,
        static: {
          ...prev.static,
          replies: arrayMove(prev.static.replies, oldIndex, newIndex)
        }
      };
    });
  }

  useEffect(() => {
    void loadList();
  }, []);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("models.title")}</h2>
          <p className="text-sm text-slate-400">{t("models.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={loadList}
            disabled={loading}
          >
            {t("models.refresh")}
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={newModel}
          >
            {t("models.new")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={save}
            disabled={saving}
          >
            {saving ? "..." : t("models.save")}
          </button>
          <button
            className="rounded-full border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200"
            onClick={remove}
          >
            {t("models.delete")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("models.list")}
          </div>
          <div className="mt-3 max-h-[440px] space-y-2 overflow-auto">
            {models.map((model) => (
              <button
                key={model.id}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                  selectedId === model.id
                    ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                    : "border-transparent bg-slate-900/60 text-slate-100 hover:border-slate-600/60"
                }`}
                onClick={() => select(model.id)}
              >
                <span>{model.id}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {model.type}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.id")}
              <input
                value={form.id}
                onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
                placeholder="llm-example"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.owned_by")}
              <input
                value={form.owned_by}
                onChange={(e) => setForm((prev) => ({ ...prev, owned_by: e.target.value }))}
                placeholder="llm-lab"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.created")}
              <input
                value={form.created}
                onChange={(e) => setForm((prev) => ({ ...prev, created: e.target.value }))}
                placeholder="1700000000"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.type")}
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    type: e.target.value as "static" | "script"
                  }))
                }
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              >
                <option value="static">{t("models.type.static")}</option>
                <option value="script">{t("models.type.script")}</option>
              </select>
            </label>
          </div>

          {form.type === "static" ? (
            <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                {t("models.static.section")}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.static.strategy")}
                  <select
                    value={form.static.strategy}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        static: { ...prev.static, strategy: e.target.value as any }
                      }))
                    }
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="round_robin">{t("models.static.strategy.round_robin")}</option>
                    <option value="random">{t("models.static.strategy.random")}</option>
                    <option value="match">{t("models.static.strategy.match")}</option>
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.static.stream")}
                  <input
                    value={form.static.stream_chunk_chars}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        static: { ...prev.static, stream_chunk_chars: e.target.value }
                      }))
                    }
                    placeholder="32"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {t("models.static.replies")}
                  </span>
                  <button
                    className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-100"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        static: {
                          ...prev.static,
                          replies: [...prev.static.replies, createReply()]
                        }
                      }))
                    }
                  >
                    {t("models.static.add")}
                  </button>
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={form.static.replies.map((reply) => reply.uid)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-3">
                      {form.static.replies.map((reply, idx) => (
                        <SortableReplyCard
                          key={reply.uid}
                          reply={reply}
                          index={idx}
                          onRemove={() =>
                            setForm((prev) => {
                              const remaining = prev.static.replies.filter(
                                (item) => item.uid !== reply.uid
                              );
                              return {
                                ...prev,
                                static: {
                                  ...prev.static,
                                  replies: remaining.length ? remaining : [createReply()]
                                }
                              };
                            })
                          }
                          onUpdate={(patch) => updateReply(setForm, reply.uid, patch)}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                {t("models.script.section")}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.script.file")}
                  <input
                    value={form.script.file}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        script: { ...prev.script, file: e.target.value }
                      }))
                    }
                    placeholder="example.js"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.script.init")}
                  <input
                    value={form.script.init_file}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        script: { ...prev.script, init_file: e.target.value }
                      }))
                    }
                    placeholder="init.js"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.script.timeout")}
                  <input
                    value={form.script.timeout_ms}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        script: { ...prev.script, timeout_ms: e.target.value }
                      }))
                    }
                    placeholder="1500"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.script.stream")}
                  <input
                    value={form.script.stream_chunk_chars}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        script: { ...prev.script, stream_chunk_chars: e.target.value }
                      }))
                    }
                    placeholder="32"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function ScriptsPanel({
  api,
  t,
  onError,
  onNotify
}: {
  api: ReturnType<typeof createApi>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onError: (err: unknown, fallback: string) => void;
  onNotify: (type: "success" | "error", text: string) => void;
}) {
  const [scripts, setScripts] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState(SCRIPT_TEMPLATE);
  const [loading, setLoading] = useState(false);

  async function loadList() {
    setLoading(true);
    try {
      const data = await api.listScripts();
      setScripts(data?.files ?? []);
    } catch (err) {
      onError(err, t("error.load.scripts"));
    } finally {
      setLoading(false);
    }
  }

  async function select(scriptName: string) {
    setName(scriptName);
    try {
      const data = await api.getScript(scriptName);
      setContent(data?.content ?? "");
    } catch (err) {
      onError(err, t("error.load.script"));
    }
  }

  function newScript() {
    setName("");
    setContent(SCRIPT_TEMPLATE);
  }

  async function save() {
    if (!name.trim()) {
      onNotify("error", t("error.script.name"));
      return;
    }
    try {
      await api.putScript(name.trim(), content);
      await loadList();
      onNotify("success", t("notice.script.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    }
  }

  async function remove() {
    if (!name.trim()) {
      onNotify("error", t("error.script.name"));
      return;
    }
    if (!window.confirm(t("confirm.delete.script", { name }))) {
      return;
    }
    try {
      await api.deleteScript(name.trim());
      await loadList();
      newScript();
      onNotify("success", t("notice.script.deleted"));
    } catch (err) {
      onError(err, t("error.delete"));
    }
  }

  useEffect(() => {
    void loadList();
  }, []);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("scripts.title")}</h2>
          <p className="text-sm text-slate-400">{t("scripts.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={loadList}
            disabled={loading}
          >
            {t("scripts.refresh")}
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={newScript}
          >
            {t("scripts.new")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={save}
          >
            {t("scripts.save")}
          </button>
          <button
            className="rounded-full border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200"
            onClick={remove}
          >
            {t("scripts.delete")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("scripts.list")}
          </div>
          <div className="mt-3 max-h-[440px] space-y-2 overflow-auto">
            {scripts.map((item) => (
              <button
                key={item}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                  name === item
                    ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                    : "border-transparent bg-slate-900/60 text-slate-100 hover:border-slate-600/60"
                }`}
                onClick={() => select(item)}
              >
                <span>{item}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">script</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("scripts.name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="example.js"
              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <div className="rounded-2xl border border-slate-700/40 bg-[#0b1220]">
            <Editor
              value={content}
              onValueChange={setContent}
              highlight={(code) => Prism.highlight(code, Prism.languages.javascript, "javascript")}
              padding={16}
              className="min-h-[360px] font-mono text-sm text-slate-100"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SortableReplyCard({
  reply,
  index,
  onRemove,
  onUpdate,
  t
}: {
  reply: ReplyForm;
  index: number;
  onRemove: () => void;
  onUpdate: (patch: Partial<ReplyForm>) => void;
  t: (key: string) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: reply.uid
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border border-slate-700/50 bg-slate-900/60 p-3 ${
        isDragging ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <button
            className="cursor-grab rounded-full border border-slate-700/60 bg-slate-900/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300"
            {...attributes}
            {...listeners}
            aria-label="Drag reply"
          >
            drag
          </button>
          <span>#{index + 1}</span>
        </div>
        <button className="text-rose-200 hover:text-rose-100" onClick={onRemove}>
          {t("models.reply.remove")}
        </button>
      </div>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {t("models.reply.content")}
          <textarea
            value={reply.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            spellCheck={false}
            rows={3}
            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {t("models.reply.reasoning")}
          <textarea
            value={reply.reasoning}
            onChange={(e) => onUpdate({ reasoning: e.target.value })}
            spellCheck={false}
            rows={3}
            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          />
        </label>
      </div>
      <div className="mt-2 grid gap-3 lg:grid-cols-[160px_1fr]">
        <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {t("models.reply.match")}
          <select
            value={reply.matchType}
            onChange={(e) => onUpdate({ matchType: e.target.value as MatchType })}
            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          >
            <option value="none">{t("models.reply.match.none")}</option>
            <option value="plain">{t("models.reply.match.plain")}</option>
            <option value="regex">{t("models.reply.match.regex")}</option>
          </select>
        </label>
        <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {t("models.reply.match.value")}
          <textarea
            value={reply.matchValue}
            onChange={(e) => onUpdate({ matchValue: e.target.value })}
            placeholder="/hello/i"
            spellCheck={false}
            rows={2}
            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          />
        </label>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/40 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-[0.3em] text-slate-400">{label}</div>
      <div className="mt-2 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function TokenModal({
  token,
  onChange,
  onSave,
  onSkip,
  t
}: {
  token: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onSkip: () => void;
  t: (key: string) => string;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
      <div className="w-full max-w-lg rounded-3xl border border-slate-700/50 bg-slate-900/90 p-6 shadow-[var(--shadow)]">
        <h3 className="text-lg font-semibold">{t("token.title")}</h3>
        <p className="mt-1 text-sm text-slate-400">{t("token.desc")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type={show ? "text" : "password"}
            value={token}
            onChange={(e) => onChange(e.target.value)}
            placeholder="sk-admin-xxx"
            className="flex-1 rounded-xl border border-slate-700/60 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
          />
          <button
            className="rounded-full border border-slate-700/60 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-100"
            onClick={() => setShow((prev) => !prev)}
          >
            {show ? t("token.hide") : t("token.show")}
          </button>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-100"
            onClick={onSkip}
          >
            {t("token.continue")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-4 py-2 text-xs font-semibold text-slate-900"
            onClick={onSave}
          >
            {t("token.save")}
          </button>
        </div>
      </div>
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
    hour12: false
  }).format(date);
}
function updateReply(
  setForm: Dispatch<SetStateAction<ReturnType<typeof DEFAULT_MODEL_FORM>>>,
  uid: string,
  patch: Partial<ReplyForm>
) {
  setForm((prev) => {
    const replies = prev.static.replies.map((reply) =>
      reply.uid === uid ? { ...reply, ...patch } : reply
    );
    return {
      ...prev,
      static: {
        ...prev.static,
        replies
      }
    };
  });
}

function modelToForm(model: any) {
  const base = DEFAULT_MODEL_FORM();
  const type = model?.type === "script" ? "script" : "static";
  const created = model?.created ? String(model.created) : "";
  const owned = model?.owned_by ?? base.owned_by;

  if (type === "script") {
    return {
      ...base,
      id: model?.id ?? "",
      owned_by: owned,
      created,
      type,
      script: {
        file: model?.script?.file ?? base.script.file,
        init_file: model?.script?.init_file ?? "",
        timeout_ms: model?.script?.timeout_ms ? String(model.script.timeout_ms) : "",
        stream_chunk_chars: model?.script?.stream_chunk_chars
          ? String(model.script.stream_chunk_chars)
          : ""
      }
    };
  }

  const replies = Array.isArray(model?.static?.replies)
    ? model.static.replies.map((reply: any) => {
        const match = parseMatch(reply?.match);
        return {
          uid: makeId(),
          content: reply?.content ?? "",
          reasoning: reply?.reasoning ?? "",
          matchType: match.matchType,
          matchValue: match.matchValue
        };
      })
    : base.static.replies;

  return {
    ...base,
    id: model?.id ?? "",
    owned_by: owned,
    created,
    type,
    static: {
      strategy: model?.static?.strategy ?? base.static.strategy,
      stream_chunk_chars: model?.static?.stream_chunk_chars
        ? String(model.static.stream_chunk_chars)
        : "",
      replies: replies.length ? replies : base.static.replies
    }
  };
}

function parseMatch(match: any): { matchType: MatchType; matchValue: string } {
  if (!match) {
    return { matchType: "none", matchValue: "" };
  }
  const rules = Array.isArray(match) ? match : [match];
  const parsed = rules.map((rule: any) => {
    if (typeof rule === "string") {
      return { type: "plain" as const, value: rule };
    }
    if (rule && typeof rule === "object" && "regex" in rule) {
      return { type: "regex" as const, value: String(rule.regex) };
    }
    return { type: "plain" as const, value: String(rule) };
  });
  const matchType = parsed.every((item) => item.type === "regex") ? "regex" : "plain";
  return {
    matchType,
    matchValue: parsed.map((item) => item.value).join("\n")
  };
}

function buildMatch(matchType: MatchType, matchValue: string) {
  if (matchType === "none") {
    return undefined;
  }
  const lines = matchValue
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return undefined;
  }
  if (matchType === "plain") {
    return lines.length === 1 ? lines[0] : lines;
  }
  const regexRules = lines.map((line) => ({ regex: line }));
  return regexRules.length === 1 ? regexRules[0] : regexRules;
}

function formToModel(form: ReturnType<typeof DEFAULT_MODEL_FORM>) {
  const base: any = {
    id: form.id.trim(),
    owned_by: form.owned_by.trim() || "llm-lab",
    type: form.type
  };
  const created = form.created.trim();
  if (created) {
    const parsed = Number(created);
    if (!Number.isNaN(parsed)) {
      base.created = parsed;
    }
  }

  if (form.type === "script") {
    base.script = {
      file: form.script.file.trim(),
      ...(form.script.init_file.trim() ? { init_file: form.script.init_file.trim() } : {}),
      ...(form.script.timeout_ms.trim()
        ? { timeout_ms: Number(form.script.timeout_ms.trim()) }
        : {}),
      ...(form.script.stream_chunk_chars.trim()
        ? { stream_chunk_chars: Number(form.script.stream_chunk_chars.trim()) }
        : {})
    };
    return base;
  }

  base.static = {
    strategy: form.static.strategy,
    ...(form.static.stream_chunk_chars.trim()
      ? { stream_chunk_chars: Number(form.static.stream_chunk_chars.trim()) }
      : {}),
    replies: form.static.replies.map((reply) => {
      const out: any = {
        content: reply.content
      };
      if (reply.reasoning.trim()) {
        out.reasoning = reply.reasoning;
      }
      const match = buildMatch(reply.matchType, reply.matchValue);
      if (match !== undefined) {
        out.match = match;
      }
      return out;
    })
  };

  return base;
}

function configToForm(config: any): ConfigForm {
  const response = config?.response ?? {};
  const models = config?.models ?? {};
  const routing = models?.routing ?? {};
  const aliases = Array.isArray(routing?.aliases)
    ? routing.aliases.map((alias: any) => ({
        id: makeId(),
        name: alias?.name ?? "",
        strategy: alias?.strategy ?? "round_robin",
        providers: Array.isArray(alias?.providers) ? alias.providers.map(String) : [],
        newProvider: ""
      }))
    : [];
  const reasoningRaw = response?.reasoning_mode ?? "both";
  const reasoningMode = reasoningRaw === "append" ? "prefix" : reasoningRaw;

  return {
    response: {
      reasoning_mode: reasoningMode,
      include_usage: response?.include_usage ?? true,
      schema_strict: response?.schema_strict ?? true
    },
    models: {
      default: models?.default ?? "",
      routing: {
        aliases
      }
    }
  };
}

function configToPayload(form: ConfigForm) {
  return {
    response: {
      reasoning_mode: form.response.reasoning_mode,
      include_usage: form.response.include_usage,
      schema_strict: form.response.schema_strict
    },
    models: {
      default: form.models.default.trim() ? form.models.default.trim() : null,
      routing: {
        aliases: form.models.routing.aliases.map((alias) => ({
          name: alias.name.trim(),
          strategy: alias.strategy,
          providers: alias.providers.map((provider) => provider.trim()).filter(Boolean)
        }))
      }
    }
  };
}
