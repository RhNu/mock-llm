import { useEffect, useRef, useState } from "react";
import { createApi } from "../api";
import {
  type ConditionForm,
  type ModelForm,
  type PickStrategy,
  type RuleForm,
  DEFAULT_MODEL_FORM,
  createCondition,
  createReply,
  createRule,
  formToModel,
  modelToForm,
} from "../forms/model";

const DEFAULT_CATALOG_FORM = {
  default_model: "",
  defaults: {
    owned_by: "",
    static_stream: "",
    script_timeout: "",
    script_stream: "",
  },
};

const CONDITION_TYPES = [
  "contains",
  "equals",
  "starts_with",
  "ends_with",
  "regex",
] as const;

type ConditionType = (typeof CONDITION_TYPES)[number];

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
  const [bundle, setBundle] = useState<any>(null);
  const [catalogForm, setCatalogForm] = useState(DEFAULT_CATALOG_FORM);
  const [models, setModels] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState<ModelForm>(DEFAULT_MODEL_FORM());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [yamlMode, setYamlMode] = useState(false);
  const [rawYaml, setRawYaml] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadBundle() {
    setLoading(true);
    try {
      const data = await api.getModelsBundle();
      setBundle(data);
      setModels(Array.isArray(data?.models) ? data.models : []);
      setCatalogForm(catalogToForm(data?.catalog));
      if (selectedId) {
        const match = (data?.models ?? []).find(
          (model: any) => model.id === selectedId,
        );
        if (match) {
          setForm(modelToForm(match));
        }
      }
    } catch (err) {
      onError(err, t("error.load.models"));
    } finally {
      setLoading(false);
    }
  }

  async function loadYaml() {
    try {
      const yaml = await api.getModelsYaml();
      setRawYaml(yaml);
    } catch (err) {
      onError(err, t("error.load.models"));
    }
  }

  function select(id: string) {
    setSelectedId(id);
    const model = models.find((item) => item.id === id);
    if (!model) {
      return;
    }
    setForm(modelToForm(model));
  }

  function newModel() {
    setSelectedId("");
    setForm(DEFAULT_MODEL_FORM());
  }

  function validateForm(nextForm: ModelForm) {
    if (!nextForm.id.trim()) {
      onNotify("error", t("error.model.id"));
      return false;
    }
    if (nextForm.kind === "static") {
      const rules = nextForm.static.rules;
      if (!rules.length) {
        onNotify("error", t("error.rule.empty"));
        return false;
      }
      const defaultRules = rules.filter((rule) => rule.default);
      if (defaultRules.length !== 1) {
        onNotify("error", t("error.rule.default"));
        return false;
      }
      for (const rule of rules) {
        if (!rule.replies.length) {
          onNotify("error", t("error.rule.replies"));
          return false;
        }
        if (rule.default) {
          if (rule.any.length || rule.all.length || rule.none.length) {
            onNotify("error", t("error.rule.default.when"));
            return false;
          }
        } else if (!rule.any.length && !rule.all.length && !rule.none.length) {
          onNotify("error", t("error.rule.when"));
          return false;
        }
      }
    }
    return true;
  }

  function applyCatalogForm(catalog: any) {
    const next = { ...catalog, schema: 2 };
    next.default_model = catalogForm.default_model.trim() || null;
    const defaults: any = {};
    if (catalogForm.defaults.owned_by.trim()) {
      defaults.owned_by = catalogForm.defaults.owned_by.trim();
    }
    const staticDefaults: any = {};
    if (catalogForm.defaults.static_stream.trim()) {
      staticDefaults.stream_chunk_chars = Number(
        catalogForm.defaults.static_stream.trim(),
      );
    }
    if (Object.keys(staticDefaults).length) {
      defaults.static = staticDefaults;
    }
    const scriptDefaults: any = {};
    if (catalogForm.defaults.script_timeout.trim()) {
      scriptDefaults.timeout_ms = Number(
        catalogForm.defaults.script_timeout.trim(),
      );
    }
    if (catalogForm.defaults.script_stream.trim()) {
      scriptDefaults.stream_chunk_chars = Number(
        catalogForm.defaults.script_stream.trim(),
      );
    }
    if (Object.keys(scriptDefaults).length) {
      defaults.script = scriptDefaults;
    }
    next.defaults = defaults;
    return next;
  }

  async function saveBundle() {
    if (!bundle) {
      return;
    }
    if (!validateForm(form)) {
      return;
    }
    setSaving(true);
    try {
      const modelPayload = formToModel(form);
      const modelId = modelPayload.id;
      let nextModels = Array.isArray(bundle.models) ? [...bundle.models] : [];
      const existingIndex = nextModels.findIndex((item) => item.id === modelId);
      if (existingIndex >= 0) {
        nextModels[existingIndex] = modelPayload;
      } else {
        if (selectedId) {
          nextModels = nextModels.filter((item) => item.id !== selectedId);
        }
        nextModels.push(modelPayload);
      }

      const nextCatalog = applyCatalogForm(bundle.catalog ?? {});
      const nextBundle = { catalog: nextCatalog, models: nextModels };
      const saved = await api.putModelsBundle(nextBundle);
      setBundle(saved);
      setModels(saved.models ?? []);
      setCatalogForm(catalogToForm(saved.catalog));
      setSelectedId(modelId);
      const next = (saved.models ?? []).find(
        (item: any) => item.id === modelId,
      );
      if (next) {
        setForm(modelToForm(next));
      }
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
      const nextModels = models.filter((item) => item.id !== id);
      const nextCatalog = applyCatalogForm(bundle?.catalog ?? {});
      const saved = await api.putModelsBundle({
        catalog: nextCatalog,
        models: nextModels,
      });
      setBundle(saved);
      setModels(saved.models ?? []);
      setCatalogForm(catalogToForm(saved.catalog));
      newModel();
      onNotify("success", t("notice.model.deleted"));
    } catch (err) {
      onError(err, t("error.delete"));
    }
  }

  async function saveYaml() {
    try {
      await api.putModelsYaml(rawYaml);
      await loadBundle();
      onNotify("success", t("notice.model.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    }
  }

  async function exportYaml() {
    try {
      const yaml = await api.getModelsYaml();
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "models-bundle.yaml";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      onError(err, t("error.export"));
    }
  }

  async function handleImport(file: File | null) {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      await api.putModelsYaml(text);
      await loadBundle();
      onNotify("success", t("notice.model.saved"));
    } catch (err) {
      onError(err, t("error.import"));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function setRuleDefault(ruleId: string) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: prev.static.rules.map((rule) =>
          rule.uid === ruleId
            ? { ...rule, default: true, any: [], all: [], none: [] }
            : { ...rule, default: false },
        ),
      },
    }));
  }

  function removeRule(ruleId: string) {
    setForm((prev) => {
      const remaining = prev.static.rules.filter((rule) => rule.uid !== ruleId);
      return {
        ...prev,
        static: {
          ...prev.static,
          rules: remaining.length ? remaining : [createRule(true)],
        },
      };
    });
  }

  function addReply(ruleId: string) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: prev.static.rules.map((rule) =>
          rule.uid === ruleId
            ? { ...rule, replies: [...rule.replies, createReply()] }
            : rule,
        ),
      },
    }));
  }

  function removeReply(ruleId: string, replyId: string) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: prev.static.rules.map((rule) => {
          if (rule.uid !== ruleId) {
            return rule;
          }
          const remaining = rule.replies.filter(
            (reply) => reply.uid !== replyId,
          );
          return {
            ...rule,
            replies: remaining.length ? remaining : [createReply()],
          };
        }),
      },
    }));
  }

  function updateReply(ruleId: string, replyId: string, patch: Partial<any>) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: prev.static.rules.map((rule) => {
          if (rule.uid !== ruleId) {
            return rule;
          }
          const replies = rule.replies.map((reply) =>
            reply.uid === replyId ? { ...reply, ...patch } : reply,
          );
          return { ...rule, replies };
        }),
      },
    }));
  }

  function updateRuleConditions(
    ruleId: string,
    bucket: "any" | "all" | "none",
    text: string,
  ) {
    const conditions = textToConditions(text);
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: prev.static.rules.map((rule) =>
          rule.uid === ruleId ? { ...rule, [bucket]: conditions } : rule,
        ),
      },
    }));
  }

  useEffect(() => {
    void loadBundle();
  }, []);

  useEffect(() => {
    if (yamlMode) {
      void loadYaml();
    }
  }, [yamlMode]);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,text/yaml"
        className="hidden"
        onChange={(e) => handleImport(e.target.files?.[0] ?? null)}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("models.title")}</h2>
          <p className="text-sm text-slate-400">{t("models.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={loadBundle}
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
            onClick={yamlMode ? saveYaml : saveBundle}
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
          <button
            className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-200"
            onClick={exportYaml}
          >
            {t("models.export")}
          </button>
          <button
            className="rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200"
            onClick={() => fileInputRef.current?.click()}
          >
            {t("models.import")}
          </button>
          <button
            className="rounded-full border border-slate-600/50 bg-slate-900/70 px-4 py-2 text-xs font-semibold text-slate-200"
            onClick={() => setYamlMode((prev) => !prev)}
          >
            {yamlMode ? t("models.mode.form") : t("models.mode.yaml")}
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
                  {model.kind}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {t("models.catalog.section")}
                </div>
                <p className="text-sm text-slate-400">
                  {t("models.catalog.desc")}
                </p>
              </div>
              <span className="text-xs text-slate-500">schema: 2</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("models.catalog.default")}
                <input
                  value={catalogForm.default_model}
                  onChange={(e) =>
                    setCatalogForm((prev) => ({
                      ...prev,
                      default_model: e.target.value,
                    }))
                  }
                  placeholder="llm-flash"
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("models.catalog.owned_by")}
                <input
                  value={catalogForm.defaults.owned_by}
                  onChange={(e) =>
                    setCatalogForm((prev) => ({
                      ...prev,
                      defaults: { ...prev.defaults, owned_by: e.target.value },
                    }))
                  }
                  placeholder="llm-lab"
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("models.catalog.static_stream")}
                <input
                  value={catalogForm.defaults.static_stream}
                  onChange={(e) =>
                    setCatalogForm((prev) => ({
                      ...prev,
                      defaults: { ...prev.defaults, static_stream: e.target.value },
                    }))
                  }
                  placeholder="16"
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("models.catalog.script_timeout")}
                <input
                  value={catalogForm.defaults.script_timeout}
                  onChange={(e) =>
                    setCatalogForm((prev) => ({
                      ...prev,
                      defaults: { ...prev.defaults, script_timeout: e.target.value },
                    }))
                  }
                  placeholder="1500"
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("models.catalog.script_stream")}
                <input
                  value={catalogForm.defaults.script_stream}
                  onChange={(e) =>
                    setCatalogForm((prev) => ({
                      ...prev,
                      defaults: { ...prev.defaults, script_stream: e.target.value },
                    }))
                  }
                  placeholder="24"
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>
            </div>
            <p className="text-xs text-slate-500">
              {t("models.catalog.note")}
            </p>
          </div>

          {yamlMode ? (
            <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {t("models.raw.title")}
                </div>
                <span className="text-xs text-slate-500">YAML</span>
              </div>
              <textarea
                value={rawYaml}
                onChange={(e) => setRawYaml(e.target.value)}
                spellCheck={false}
                rows={18}
                className="w-full rounded-2xl border border-slate-700/60 bg-slate-950/60 px-4 py-3 text-xs text-slate-100"
              />
              <p className="text-xs text-slate-500">{t("models.raw.hint")}</p>
            </div>
          ) : (
            <div className="space-y-5 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.id")}
                  <input
                    value={form.id}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, id: e.target.value }))
                    }
                    placeholder="llm-example"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.kind")}
                  <select
                    value={form.kind}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        kind: e.target.value as "static" | "script",
                      }))
                    }
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="static">{t("models.type.static")}</option>
                    <option value="script">{t("models.type.script")}</option>
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.extends")}
                  <textarea
                    value={form.extends}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, extends: e.target.value }))
                    }
                    placeholder="base-static"
                    rows={2}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.meta.owned_by")}
                  <input
                    value={form.meta.owned_by}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        meta: { ...prev.meta, owned_by: e.target.value },
                      }))
                    }
                    placeholder="llm-lab"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.meta.created")}
                  <input
                    value={form.meta.created}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        meta: { ...prev.meta, created: e.target.value },
                      }))
                    }
                    placeholder="1700000000"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.meta.description")}
                  <input
                    value={form.meta.description}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        meta: { ...prev.meta, description: e.target.value },
                      }))
                    }
                    placeholder="Short description"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.meta.tags")}
                  <textarea
                    value={form.meta.tags}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        meta: { ...prev.meta, tags: e.target.value },
                      }))
                    }
                    placeholder="tag-one\ntag-two"
                    rows={2}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              </div>

              {form.kind === "static" ? (
                <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    {t("models.static.section")}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {t("models.static.pick")}
                      <select
                        value={form.static.pick}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            static: {
                              ...prev.static,
                              pick: e.target.value as "" | PickStrategy,
                            },
                          }))
                        }
                        className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="">
                          {t("models.static.pick.default")}
                        </option>
                        <option value="round_robin">
                          {t("models.pick.round_robin")}
                        </option>
                        <option value="random">{t("models.pick.random")}</option>
                        <option value="weighted">
                          {t("models.pick.weighted")}
                        </option>
                      </select>
                    </label>
                    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {t("models.static.stream")}
                      <input
                        value={form.static.stream_chunk_chars}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            static: {
                              ...prev.static,
                              stream_chunk_chars: e.target.value,
                            },
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
                        {t("models.rules")}
                      </span>
                      <button
                        className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-100"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            static: {
                              ...prev.static,
                              rules: [...prev.static.rules, createRule(false)],
                            },
                          }))
                        }
                      >
                        {t("models.rule.add")}
                      </button>
                    </div>

                    <div className="space-y-3">
                      {form.static.rules.map((rule, idx) => (
                        <RuleCard
                          key={rule.uid}
                          rule={rule}
                          index={idx}
                          t={t}
                          onSetDefault={() => setRuleDefault(rule.uid)}
                          onRemove={() => removeRule(rule.uid)}
                          onUpdate={(patch) =>
                            setForm((prev) => ({
                              ...prev,
                              static: {
                                ...prev.static,
                                rules: prev.static.rules.map((item) =>
                                  item.uid === rule.uid
                                    ? { ...item, ...patch }
                                    : item,
                                ),
                              },
                            }))
                          }
                          onAddReply={addReply}
                          onRemoveReply={removeReply}
                          onUpdateReply={updateReply}
                          onUpdateConditions={updateRuleConditions}
                        />
                      ))}
                    </div>
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
                            script: { ...prev.script, file: e.target.value },
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
                            script: { ...prev.script, init_file: e.target.value },
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
                            script: {
                              ...prev.script,
                              timeout_ms: e.target.value,
                            },
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
                            script: {
                              ...prev.script,
                              stream_chunk_chars: e.target.value,
                            },
                          }))
                        }
                        placeholder="24"
                        className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function catalogToForm(catalog: any) {
  if (!catalog) {
    return DEFAULT_CATALOG_FORM;
  }
  const defaults = catalog.defaults ?? {};
  return {
    default_model: catalog.default_model ?? "",
    defaults: {
      owned_by: defaults.owned_by ?? "",
      static_stream: defaults?.static?.stream_chunk_chars
        ? String(defaults.static.stream_chunk_chars)
        : "",
      script_timeout: defaults?.script?.timeout_ms
        ? String(defaults.script.timeout_ms)
        : "",
      script_stream: defaults?.script?.stream_chunk_chars
        ? String(defaults.script.stream_chunk_chars)
        : "",
    },
  };
}

function RuleCard({
  rule,
  index,
  t,
  onSetDefault,
  onRemove,
  onUpdate,
  onAddReply,
  onRemoveReply,
  onUpdateReply,
  onUpdateConditions,
}: {
  rule: RuleForm;
  index: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onSetDefault: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<RuleForm>) => void;
  onAddReply: (ruleId: string) => void;
  onRemoveReply: (ruleId: string, replyId: string) => void;
  onUpdateReply: (ruleId: string, replyId: string, patch: Partial<any>) => void;
  onUpdateConditions: (
    ruleId: string,
    bucket: "any" | "all" | "none",
    text: string,
  ) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span>#{index + 1}</span>
          {rule.default ? (
            <span className="rounded-full bg-sky-400/20 px-2 py-0.5 text-[10px] text-sky-200">
              {t("models.rule.default")}
            </span>
          ) : (
            <button
              className="rounded-full border border-slate-700/60 bg-slate-900/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300"
              onClick={onSetDefault}
            >
              {t("models.rule.make_default")}
            </button>
          )}
        </div>
        <button className="text-rose-200 hover:text-rose-100" onClick={onRemove}>
          {t("models.rule.remove")}
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {t("models.rule.pick")}
          <select
            value={rule.pick}
            onChange={(e) => onUpdate({ pick: e.target.value as any })}
            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">{t("models.rule.pick.default")}</option>
            <option value="round_robin">{t("models.pick.round_robin")}</option>
            <option value="random">{t("models.pick.random")}</option>
            <option value="weighted">{t("models.pick.weighted")}</option>
          </select>
        </label>
      </div>

      {!rule.default && (
        <div className="mt-3 grid gap-3">
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("models.rule.when.any")}
            <textarea
              value={conditionsToText(rule.any)}
              onChange={(e) =>
                onUpdateConditions(rule.uid, "any", e.target.value)
              }
              placeholder="contains:hello\nregex:/world/i"
              rows={3}
              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-xs text-slate-100"
            />
          </label>
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("models.rule.when.all")}
            <textarea
              value={conditionsToText(rule.all)}
              onChange={(e) =>
                onUpdateConditions(rule.uid, "all", e.target.value)
              }
              placeholder="contains:must"
              rows={3}
              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-xs text-slate-100"
            />
          </label>
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("models.rule.when.none")}
            <textarea
              value={conditionsToText(rule.none)}
              onChange={(e) =>
                onUpdateConditions(rule.uid, "none", e.target.value)
              }
              placeholder="contains:blocked"
              rows={3}
              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-xs text-slate-100"
            />
          </label>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("models.rule.replies")}
          </span>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-100"
            onClick={() => onAddReply(rule.uid)}
          >
            {t("models.reply.add")}
          </button>
        </div>
        <div className="space-y-3">
          {rule.replies.map((reply) => (
            <div
              key={reply.uid}
              className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-3"
            >
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t("models.reply")}</span>
                <button
                  className="text-rose-200 hover:text-rose-100"
                  onClick={() => onRemoveReply(rule.uid, reply.uid)}
                >
                  {t("models.reply.remove")}
                </button>
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.reply.content")}
                  <textarea
                    value={reply.content}
                    onChange={(e) =>
                      onUpdateReply(rule.uid, reply.uid, {
                        content: e.target.value,
                      })
                    }
                    spellCheck={false}
                    rows={3}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.reply.reasoning")}
                  <textarea
                    value={reply.reasoning}
                    onChange={(e) =>
                      onUpdateReply(rule.uid, reply.uid, {
                        reasoning: e.target.value,
                      })
                    }
                    spellCheck={false}
                    rows={3}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-[160px_1fr]">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {t("models.reply.weight")}
                  <input
                    value={reply.weight}
                    onChange={(e) =>
                      onUpdateReply(rule.uid, reply.uid, {
                        weight: e.target.value,
                      })
                    }
                    placeholder="1"
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function conditionsToText(list: ConditionForm[]) {
  return list
    .map((cond) => {
      const caseSuffix =
        cond.case === "insensitive" && cond.type !== "regex"
          ? ":insensitive"
          : "";
      return `${cond.type}:${cond.value}${caseSuffix}`;
    })
    .join("\n");
}

function textToConditions(text: string): ConditionForm[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(":");
      if (parts.length >= 2) {
        const type = parts[0] as ConditionType;
        const last = parts[parts.length - 1];
        const isCase = last === "insensitive" || last === "sensitive";
        const value = isCase
          ? parts.slice(1, -1).join(":")
          : parts.slice(1).join(":");
        const caseValue = isCase ? (last as "sensitive" | "insensitive") : "sensitive";
        const finalType = CONDITION_TYPES.includes(type) ? type : "contains";
        return {
          ...createCondition(finalType),
          value,
          case: caseValue,
        };
      }
      return {
        ...createCondition("contains"),
        value: line,
      };
    });
}
