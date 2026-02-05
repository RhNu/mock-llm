import { useState } from "react";

type Mode = "checking" | "login";

export default function LoginScreen({
  mode,
  token,
  onChange,
  onSubmit,
  onRetry,
  busy,
  error,
  t,
}: {
  mode: Mode;
  token: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onRetry?: () => void;
  busy?: boolean;
  error?: string | null;
  t: (key: string) => string;
}) {
  const [show, setShow] = useState(false);
  const canSubmit = token.trim().length > 0 && !busy;

  if (mode === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-10 text-slate-100">
        <div className="w-full max-w-md rounded-3xl border border-slate-700/40 bg-[var(--panel)] p-8 text-center shadow-[var(--shadow)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-slate-700/60 bg-slate-900/70">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          </div>
          <div className="mt-4 text-sm uppercase tracking-[0.3em] text-slate-400">
            {t("login.loading")}
          </div>
          <div className="mt-2 text-lg font-semibold">{t("login.checking")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10 text-slate-100">
      <div className="w-full max-w-5xl">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col justify-center gap-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">
              mock-llm
            </div>
            <div>
              <div className="text-3xl font-semibold">{t("login.title")}</div>
              <div className="mt-2 text-sm text-slate-300">
                {t("login.subtitle")}
              </div>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  {t("login.scope.title")}
                </div>
                <div className="mt-2 text-sm text-slate-200">
                  {t("login.scope.desc")}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  {t("login.storage.title")}
                </div>
                <div className="mt-2 text-sm text-slate-200">
                  {t("login.storage.desc")}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/50 bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  {t("login.label")}
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={t("login.placeholder")}
                    className="min-w-[220px] flex-1 rounded-2xl border border-slate-700/60 bg-slate-950/70 px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-sky-500/60"
                  />
                  <button
                    type="button"
                    className="rounded-full border border-slate-700/60 bg-slate-900/80 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500/80"
                    onClick={() => setShow((prev) => !prev)}
                  >
                    {show ? t("login.hide") : t("login.show")}
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {t("login.remember")}
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  <div>{error}</div>
                  {onRetry ? (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold uppercase tracking-[0.3em] text-rose-200/80 transition hover:text-rose-100"
                      onClick={onRetry}
                    >
                      {t("login.retry")}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
                  canSubmit
                    ? "bg-sky-400/90 text-slate-900 hover:bg-sky-300"
                    : "cursor-not-allowed bg-slate-800/80 text-slate-500"
                }`}
              >
                {busy ? t("login.signing") : t("login.cta")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
