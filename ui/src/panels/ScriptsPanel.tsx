import { useEffect, useState } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import { createApi } from "../api";

const SCRIPT_TEMPLATE = `// @ts-check
/** @param {import("./types").ScriptInput} input */
export function handle(input) {
  return { content: "Hello from script" };
}
`;

export default function ScriptsPanel({
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("scripts.title")}</h2>
          <p className="text-sm text-slate-400">{t("scripts.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={loadList}
            disabled={loading}
          >
            {t("scripts.refresh")}
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={newScript}
          >
            {t("scripts.new")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={save}
          >
            {t("scripts.save")}
          </button>
          <button
            className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200"
            onClick={remove}
          >
            {t("scripts.delete")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("scripts.list")}
          </div>
          <div className="mt-3 max-h-[440px] space-y-2 overflow-auto">
            {scripts.map((item) => (
              <button
                key={item}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-left text-sm transition ${
                  name === item
                    ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                    : "border-transparent bg-slate-900/60 text-slate-100 hover:border-slate-600/60"
                }`}
                onClick={() => select(item)}
              >
                <span>{item}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  script
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("scripts.name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="example.js"
              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
            />
          </label>
          <div className="rounded-2xl border border-slate-700/40 bg-[#0b1220]">
            <Editor
              value={content}
              onValueChange={setContent}
              highlight={(code) =>
                Prism.highlight(code, Prism.languages.javascript, "javascript")
              }
              padding={16}
              className="min-h-[360px] font-mono text-sm text-slate-100"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
