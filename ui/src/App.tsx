import { useEffect, useMemo, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import { ApiError, createApi } from "./api";
import { createTranslator, getInitialLang, saveLang, Lang } from "./i18n";
import TokenModal from "./components/TokenModal";
import ConfigPanel from "./panels/ConfigPanel";
import ModelsPanel from "./panels/ModelsPanel";
import ScriptsPanel from "./panels/ScriptsPanel";
import StatusPanel from "./panels/StatusPanel";

type View = "status" | "config" | "models" | "scripts";

export default function App() {
  const [view, setView] = useState<View>("status");

  const [token, setToken] = useState(
    () => localStorage.getItem("admin_token") ?? "",
  );
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
        () => setNeedsToken(true),
      ),
    [token],
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
    notify(
      "success",
      value ? t("notice.token.saved") : t("notice.token.cleared"),
    );
  }

  const navItems = [
    {
      id: "status" as const,
      label: t("nav.status"),
      hint: t("nav.status.hint"),
    },
    {
      id: "config" as const,
      label: t("nav.config"),
      hint: t("nav.config.hint"),
    },
    {
      id: "models" as const,
      label: t("nav.models"),
      hint: t("nav.models.hint"),
    },
    {
      id: "scripts" as const,
      label: t("nav.scripts"),
      hint: t("nav.scripts.hint"),
    },
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
              ZH
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
            <ConfigPanel
              api={api}
              t={t}
              onError={handleApiError}
              onNotify={notify}
            />
          )}
          {view === "models" && (
            <ModelsPanel
              api={api}
              t={t}
              onError={handleApiError}
              onNotify={notify}
            />
          )}
          {view === "scripts" && (
            <ScriptsPanel
              api={api}
              t={t}
              onError={handleApiError}
              onNotify={notify}
            />
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
