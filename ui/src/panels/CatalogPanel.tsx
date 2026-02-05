import { useEffect, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { parse, stringify } from "yaml";
import { createApi } from "../api";
import YamlEditor from "../components/YamlEditor";
import { CATALOG_SCHEMA } from "../schemas/catalogSchema";

type CatalogPanelProps = {
  api: ReturnType<typeof createApi>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onError: (err: unknown, fallback: string) => void;
  onNotify: (type: "success" | "error", text: string) => void;
};

function toYaml(value: unknown) {
  return stringify(value, { indent: 2, lineWidth: 0 });
}

function parseYaml(text: string): { value?: any; error?: string } {
  try {
    const value = parse(text);
    return { value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export default function CatalogPanel({
  api,
  t,
  onError,
  onNotify,
}: CatalogPanelProps) {
  const [yamlText, setYamlText] = useState<string>(() => toYaml({ schema: 2 }));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markers, setMarkers] = useState<editor.IMarkerData[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const busy = loading || saving;

  const schemaErrors = useMemo(
    () => markers.filter((marker) => marker.severity === 8),
    [markers],
  );
  const hasErrors = Boolean(parseError) || schemaErrors.length > 0;

  async function loadCatalog() {
    if (busy) {
      return;
    }
    setLoading(true);
    try {
      const data = await api.getModelsBundle();
      const catalog = data?.catalog ?? { schema: 2 };
      setYamlText(toYaml(catalog));
    } catch (err) {
      onError(err, t("error.load.models"));
    } finally {
      setLoading(false);
    }
  }

  async function saveCatalog() {
    if (hasErrors) {
      onNotify("error", t("error.catalog.validation"));
      return;
    }
    if (busy) {
      return;
    }
    const trimmed = yamlText.trim();
    if (!trimmed) {
      onNotify("error", t("error.catalog.empty"));
      return;
    }
    const parsed = parseYaml(yamlText);
    if (parsed.error || !parsed.value || typeof parsed.value !== "object") {
      onNotify("error", t("error.catalog.yaml"));
      return;
    }
    setSaving(true);
    try {
      const latest = await api.getModelsBundle();
      const nextBundle = {
        catalog: parsed.value,
        models: Array.isArray(latest?.models) ? latest.models : [],
      };
      const saved = await api.putModelsBundle(nextBundle);
      setYamlText(toYaml(saved.catalog ?? parsed.value));
      onNotify("success", t("notice.catalog.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    } finally {
      setSaving(false);
    }
  }

  function formatYaml() {
    if (!editorRef.current) {
      return;
    }
    const action = editorRef.current.getAction("editor.action.formatDocument");
    if (action) {
      void action.run();
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!yamlText.trim()) {
      setParseError(t("error.catalog.empty"));
      return;
    }
    const parsed = parseYaml(yamlText);
    if (parsed.error || !parsed.value || typeof parsed.value !== "object") {
      setParseError(parsed.error ?? t("error.catalog.yaml"));
      return;
    }
    setParseError(null);
  }, [t, yamlText]);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("catalog.title")}</h2>
          <p className="text-sm text-slate-400">{t("catalog.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500 disabled:opacity-60"
            onClick={loadCatalog}
            disabled={busy}
          >
            {t("models.refresh")}
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500 disabled:opacity-60"
            onClick={formatYaml}
            disabled={busy}
          >
            {t("models.format")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-sky-300 disabled:opacity-60"
            onClick={saveCatalog}
            disabled={busy || hasErrors}
          >
            {saving ? "..." : t("models.save")}
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("models.catalog.section")}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/40 bg-slate-900/60">
          <YamlEditor
            value={yamlText}
            onChange={setYamlText}
            onValidate={setMarkers}
            onMount={(editorInstance) => {
              editorRef.current = editorInstance;
            }}
            schema={CATALOG_SCHEMA}
            path="inmemory://catalog/current.yaml"
          />
        </div>

        <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("models.validation.title")}
          </div>
          {hasErrors ? (
            <div className="mt-2 space-y-2 text-xs text-rose-200">
              {parseError ? <p>{parseError}</p> : null}
              {schemaErrors.map((marker, index) => (
                <p key={`${marker.message}-${index}`}>{marker.message}</p>
              ))}
              <p className="text-rose-300/80">
                {t("models.validation.blocked")}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-emerald-200">
              {t("models.validation.ok")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
