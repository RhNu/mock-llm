import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { parse, stringify } from "yaml";
import { createApi } from "../api";
const YamlEditor = lazy(() => import("../components/YamlEditor"));
import { MODEL_SCHEMA } from "../schemas/modelSchema";
import { validateModelConfig } from "../validation/model";

const DEFAULT_MODEL = {
  schema: 2,
  id: "new-model",
  kind: "static",
  static: {
    rules: [
      {
        default: true,
        replies: [{ content: "你好。" }],
      },
    ],
  },
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

export default function ModelsPanel({
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
  const [models, setModels] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [yamlText, setYamlText] = useState<string>(() => toYaml(DEFAULT_MODEL));
  const [disabledModels, setDisabledModels] = useState<string[]>([]);
  const [modelDisabled, setModelDisabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [markers, setMarkers] = useState<editor.IMarkerData[]>([]);
  const [customErrors, setCustomErrors] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const disabledSet = useMemo(() => new Set(disabledModels), [disabledModels]);
  const busy = loading || saving || deleting;

  const schemaErrors = useMemo(
    () => markers.filter((marker) => marker.severity === 8),
    [markers],
  );
  const hasErrors = Boolean(parseError) || customErrors.length > 0 || schemaErrors.length > 0;

  async function loadBundle() {
    if (busy) {
      return;
    }
    setLoading(true);
    try {
      const data = await api.getModelsBundle();
      const nextModels = Array.isArray(data?.models) ? data.models : [];
      setModels(nextModels);
      const nextDisabledModels = Array.isArray(data?.catalog?.disabled_models)
        ? data.catalog.disabled_models
        : [];
      setDisabledModels(nextDisabledModels);
      const nextDisabledSet = new Set(nextDisabledModels);
      if (selectedId) {
        const match = nextModels.find((model: any) => model.id === selectedId);
        if (match) {
          setYamlText(toYaml(match));
          setModelDisabled(nextDisabledSet.has(match.id));
        }
      }
    } catch (err) {
      onError(err, t("error.load.models"));
    } finally {
      setLoading(false);
    }
  }

  function select(id: string) {
    setSelectedId(id);
    const model = models.find((item) => item.id === id);
    if (!model) {
      return;
    }
    setYamlText(toYaml(model));
    setModelDisabled(disabledSet.has(id));
  }

  function newModel() {
    setSelectedId("");
    setYamlText(toYaml(DEFAULT_MODEL));
    setModelDisabled(false);
  }

  async function saveBundle() {
    if (hasErrors) {
      onNotify("error", t("error.model.validation"));
      return;
    }
    if (busy) {
      return;
    }
    const trimmed = yamlText.trim();
    if (!trimmed) {
      onNotify("error", t("error.model.empty"));
      return;
    }
    const parsed = parseYaml(yamlText);
    if (parsed.error || !parsed.value) {
      onNotify("error", t("error.model.yaml"));
      return;
    }
    const modelPayload = parsed.value;
    const modelId = typeof modelPayload.id === "string" ? modelPayload.id.trim() : "";
    if (!modelId) {
      onNotify("error", t("error.model.id"));
      return;
    }
    setSaving(true);
    try {
      const latest = await api.getModelsBundle();
      let nextModels = Array.isArray(latest?.models) ? [...latest.models] : [];
      const existingIndex = nextModels.findIndex((item) => item.id === modelId);
      if (existingIndex >= 0) {
        nextModels[existingIndex] = modelPayload;
      } else {
        if (selectedId) {
          nextModels = nextModels.filter((item) => item.id !== selectedId);
        }
        nextModels.push(modelPayload);
      }

      const nextCatalog = { ...(latest?.catalog ?? { schema: 2 }) } as any;
      const disabled = Array.isArray(nextCatalog?.disabled_models)
        ? nextCatalog.disabled_models.map((id: string) => String(id))
        : [];
      const nextDisabled = new Set(disabled);
      if (selectedId && selectedId !== modelId) {
        nextDisabled.delete(selectedId);
      }
      if (modelDisabled) {
        nextDisabled.add(modelId);
      } else {
        nextDisabled.delete(modelId);
      }
      nextCatalog.disabled_models = Array.from(nextDisabled);

      const nextBundle = {
        catalog: nextCatalog,
        models: nextModels,
      };
      const saved = await api.putModelsBundle(nextBundle);
      setModels(saved.models ?? []);
      setDisabledModels(saved.catalog?.disabled_models ?? []);
      setSelectedId(modelId);
      const next = (saved.models ?? []).find((item: any) => item.id === modelId);
      if (next) {
        setYamlText(toYaml(next));
      }
      setModelDisabled(
        Array.isArray(saved.catalog?.disabled_models)
          ? saved.catalog.disabled_models.includes(modelId)
          : false,
      );
      onNotify("success", t("notice.model.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId) {
      onNotify("error", t("error.model.id"));
      return;
    }
    if (!window.confirm(t("confirm.delete.model", { id: selectedId }))) {
      return;
    }
    if (busy) {
      return;
    }
    setDeleting(true);
    try {
      const latest = await api.getModelsBundle();
      const nextModels = Array.isArray(latest?.models)
        ? latest.models.filter((item: any) => item.id !== selectedId)
        : [];
      const nextCatalog = { ...(latest?.catalog ?? { schema: 2 }) } as any;
      const disabled = Array.isArray(nextCatalog?.disabled_models)
        ? nextCatalog.disabled_models.map((item: string) => String(item))
        : [];
      const nextDisabled = new Set(disabled);
      nextDisabled.delete(selectedId);
      nextCatalog.disabled_models = Array.from(nextDisabled);
      const saved = await api.putModelsBundle({
        catalog: nextCatalog,
        models: nextModels,
      });
      setModels(saved.models ?? []);
      setDisabledModels(saved.catalog?.disabled_models ?? []);
      newModel();
      onNotify("success", t("notice.model.deleted"));
    } catch (err) {
      onError(err, t("error.delete"));
    } finally {
      setDeleting(false);
    }
  }

  function formatYaml() {
    if (!editorRef.current) {
      return;
    }
    const action = editorRef.current.getAction(
      "editor.action.formatDocument",
    );
    if (action) {
      void action.run();
    }
  }

  useEffect(() => {
    void loadBundle();
  }, []);

  useEffect(() => {
    if (!yamlText.trim()) {
      setParseError(t("error.model.empty"));
      setCustomErrors([]);
      return;
    }
    const parsed = parseYaml(yamlText);
    if (parsed.error || !parsed.value) {
      setParseError(parsed.error ?? t("error.model.yaml"));
      setCustomErrors([]);
      return;
    }
    setParseError(null);
    setCustomErrors(validateModelConfig(parsed.value));
  }, [t, yamlText]);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("models.title")}</h2>
          <p className="text-sm text-slate-400">{t("models.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500 disabled:opacity-60"
            onClick={loadBundle}
            disabled={busy}
          >
            {t("models.refresh")}
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500 disabled:opacity-60"
            onClick={newModel}
            disabled={busy}
          >
            {t("models.new")}
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
            onClick={saveBundle}
            disabled={busy || hasErrors}
          >
            {saving ? "..." : t("models.save")}
          </button>
          <button
            className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 disabled:opacity-60"
            onClick={remove}
            disabled={busy || !selectedId}
          >
            {t("models.delete")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("models.list")}
          </div>
          <div className="mt-3 max-h-[440px] space-y-2 overflow-auto">
            {models.map((model) => (
              <button
                key={model.id}
                className={[
                  "flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-left text-sm transition",
                  selectedId === model.id
                    ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                    : "border-transparent bg-slate-900/60 text-slate-100 hover:border-slate-600/60",
                  disabledSet.has(model.id) ? "opacity-60" : "",
                ].join(" ")}
                onClick={() => select(model.id)}
              >
                <span>{model.id}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {disabledSet.has(model.id) ? t("models.disabled") : model.kind}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
              {t("models.editor.section")}
            </div>
            <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              <span>{t("models.disabled")}</span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-400"
                checked={modelDisabled}
                onChange={(e) => setModelDisabled(e.target.checked)}
              />
            </label>
          </div>

          <div className="rounded-xl border border-slate-700/40 bg-slate-900/60">
            <Suspense
              fallback={
                <div className="flex h-[58vh] items-center justify-center text-sm text-slate-400">
                  正在加载编辑器...
                </div>
              }
            >
              <YamlEditor
                value={yamlText}
                onChange={setYamlText}
                onValidate={setMarkers}
                onMount={(editorInstance) => {
                  editorRef.current = editorInstance;
                }}
                schema={MODEL_SCHEMA}
                path="inmemory://models/current.yaml"
              />
            </Suspense>
          </div>

          <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.validation.title")}
            </div>
            {hasErrors ? (
              <div className="mt-2 space-y-2 text-xs text-rose-200">
                {parseError ? <p>{parseError}</p> : null}
                {customErrors.map((item) => (
                  <p key={item}>{item}</p>
                ))}
                {schemaErrors.map((marker, index) => (
                  <p key={`${marker.message}-${index}`}>
                    {marker.message}
                  </p>
                ))}
                <p className="text-rose-300/80">{t("models.validation.blocked")}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-emerald-200">
                {t("models.validation.ok")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
