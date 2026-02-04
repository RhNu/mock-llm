import { useState } from "react";

export default function TokenModal({
  token,
  onChange,
  onSave,
  onSkip,
  t,
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
