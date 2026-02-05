import { useEffect, useRef, useState } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-yaml";
import { createApi } from "../api";
import { RuleCard } from "../components/RuleCard";
import { makeId } from "../forms/common";
import {
  type ConditionForm,
  type PickStrategy,
  type RuleForm,
  createCondition,
  createReply,
  createRule,
  rulesToForm,
  rulesToPayload,
} from "../forms/model";

type AliasStrategy = "round_robin" | "random";
type TemplateKind = "" | "static" | "script" | "interactive";
type ConditionBucket = "any" | "all" | "none";

type AliasForm = {
  uid: string;
  name: string;
  owned_by: string;
  strategy: AliasStrategy;
  providers: string;
  disabled: boolean;
};

type TemplateForm = {
  uid: string;
  name: string;
  kind: TemplateKind;
  meta: {
    owned_by: string;
    created: string;
    description: string;
    tags: string;
  };
  static: {
    enabled: boolean;
    pick: "" | PickStrategy;
    stream_chunk_chars: string;
    rules: RuleForm[];
  };
  script: {
    enabled: boolean;
    file: string;
    init_file: string;
    timeout_ms: string;
    stream_chunk_chars: string;
  };
  interactive: {
    enabled: boolean;
    timeout_ms: string;
    stream_chunk_chars: string;
    fake_reasoning: string;
    fallback_text: string;
  };
};

type CatalogForm = {
  default_model: string;
  defaults: {
    owned_by: string;
    static_stream: string;
    script_timeout: string;
    script_stream: string;
    interactive_timeout: string;
    interactive_stream: string;
    interactive_fake_reasoning: string;
    interactive_fallback_text: string;
  };
  aliases: AliasForm[];
  templates: TemplateForm[];
};

const DEFAULT_CATALOG_FORM = (): CatalogForm => ({
  default_model: "",
  defaults: {
    owned_by: "",
    static_stream: "",
    script_timeout: "",
    script_stream: "",
    interactive_timeout: "",
    interactive_stream: "",
    interactive_fake_reasoning: "",
    interactive_fallback_text: "",
  },
  aliases: [],
  templates: [],
});

const EMPTY_META_FORM = {
  owned_by: "",
  created: "",
  description: "",
  tags: "",
};

function createAliasForm(): AliasForm {
  return {
    uid: makeId(),
    name: "",
    owned_by: "",
    strategy: "round_robin",
    providers: "",
    disabled: false,
  };
}

function createTemplateForm(): TemplateForm {
  return {
    uid: makeId(),
    name: "",
    kind: "",
    meta: { ...EMPTY_META_FORM },
    static: {
      enabled: false,
      pick: "",
      stream_chunk_chars: "",
      rules: [],
    },
    script: {
      enabled: false,
      file: "",
      init_file: "",
      timeout_ms: "",
      stream_chunk_chars: "",
    },
    interactive: {
      enabled: false,
      timeout_ms: "",
      stream_chunk_chars: "",
      fake_reasoning: "",
      fallback_text: "",
    },
  };
}

export default function CatalogPanel({
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
  const [catalogForm, setCatalogForm] = useState<CatalogForm>(() =>
    DEFAULT_CATALOG_FORM(),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [yamlSaving, setYamlSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [rawYaml, setRawYaml] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const busy = loading || saving || yamlSaving || exporting || importing;

  async function loadBundle() {
    if (busy) {
      return;
    }
    setLoading(true);
    try {
      const data = await api.getModelsBundle();
      setCatalogForm(catalogToForm(data?.catalog));
    } catch (err) {
      onError(err, t("error.load.models"));
    } finally {
      setLoading(false);
    }
  }

  async function loadYaml() {
    if (busy) {
      return;
    }
    try {
      const yaml = await api.getModelsYaml();
      setRawYaml(yaml);
    } catch (err) {
      onError(err, t("error.load.models"));
    }
  }
  function addAlias() {
    setCatalogForm((prev) => ({
      ...prev,
      aliases: [...prev.aliases, createAliasForm()],
    }));
  }

  function updateAlias(uid: string, patch: Partial<AliasForm>) {
    setCatalogForm((prev) => ({
      ...prev,
      aliases: prev.aliases.map((alias) =>
        alias.uid === uid ? { ...alias, ...patch } : alias,
      ),
    }));
  }

  function removeAlias(uid: string) {
    setCatalogForm((prev) => ({
      ...prev,
      aliases: prev.aliases.filter((alias) => alias.uid !== uid),
    }));
  }

  function addTemplate() {
    setCatalogForm((prev) => ({
      ...prev,
      templates: [...prev.templates, createTemplateForm()],
    }));
  }

  function updateTemplate(
    uid: string,
    updater: (tpl: TemplateForm) => TemplateForm,
  ) {
    setCatalogForm((prev) => ({
      ...prev,
      templates: prev.templates.map((tpl) =>
        tpl.uid === uid ? updater(tpl) : tpl,
      ),
    }));
  }

  function removeTemplate(uid: string) {
    setCatalogForm((prev) => ({
      ...prev,
      templates: prev.templates.filter((tpl) => tpl.uid !== uid),
    }));
  }

  function setTemplateKind(uid: string, kind: TemplateKind) {
    updateTemplate(uid, (tpl) => ({
      ...tpl,
      kind,
      static:
        kind === "script" || kind === "interactive"
          ? { ...tpl.static, enabled: false }
          : tpl.static,
      script:
        kind === "static" || kind === "interactive"
          ? { ...tpl.script, enabled: false }
          : tpl.script,
      interactive:
        kind === "static" || kind === "script"
          ? { ...tpl.interactive, enabled: false }
          : tpl.interactive,
    }));
  }

  function toggleTemplateStatic(uid: string, enabled: boolean) {
    updateTemplate(uid, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        enabled,
        rules:
          enabled && tpl.static.rules.length === 0
            ? [createRule(true)]
            : tpl.static.rules,
      },
    }));
  }

  function toggleTemplateScript(uid: string, enabled: boolean) {
    updateTemplate(uid, (tpl) => ({
      ...tpl,
      script: {
        ...tpl.script,
        enabled,
      },
    }));
  }

  function toggleTemplateInteractive(uid: string, enabled: boolean) {
    updateTemplate(uid, (tpl) => ({
      ...tpl,
      interactive: {
        ...tpl.interactive,
        enabled,
      },
    }));
  }

  function validateCatalogForm(nextForm: CatalogForm) {
    for (const alias of nextForm.aliases) {
      const name = alias.name.trim();
      const providers = splitLines(alias.providers);
      const hasContent = name || providers.length;
      if (!hasContent) {
        continue;
      }
      if (!name) {
        onNotify("error", t("error.routing.alias.name"));
        return false;
      }
      if (!providers.length) {
        onNotify("error", t("error.routing.alias.providers", { name }));
        return false;
      }
    }

    for (const template of nextForm.templates) {
      const hasMeta =
        template.meta.owned_by.trim() ||
        template.meta.created.trim() ||
        template.meta.description.trim() ||
        template.meta.tags.trim();
      const hasContent =
        template.name.trim() ||
        template.kind ||
        hasMeta ||
        template.static.enabled ||
        template.script.enabled ||
        template.interactive.enabled;
      if (!hasContent) {
        continue;
      }
      if (!template.name.trim()) {
        onNotify("error", t("error.template.name"));
        return false;
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
    const interactiveDefaults: any = {};
    if (catalogForm.defaults.interactive_timeout.trim()) {
      interactiveDefaults.timeout_ms = Number(
        catalogForm.defaults.interactive_timeout.trim(),
      );
    }
    if (catalogForm.defaults.interactive_stream.trim()) {
      interactiveDefaults.stream_chunk_chars = Number(
        catalogForm.defaults.interactive_stream.trim(),
      );
    }
    if (catalogForm.defaults.interactive_fake_reasoning.trim()) {
      interactiveDefaults.fake_reasoning =
        catalogForm.defaults.interactive_fake_reasoning.trim();
    }
    if (catalogForm.defaults.interactive_fallback_text.trim()) {
      interactiveDefaults.fallback_text =
        catalogForm.defaults.interactive_fallback_text.trim();
    }
    if (Object.keys(interactiveDefaults).length) {
      defaults.interactive = interactiveDefaults;
    }
    next.defaults = defaults;
    const aliases = catalogForm.aliases
      .map((alias) => ({
        name: alias.name.trim(),
        ...(alias.owned_by.trim() ? { owned_by: alias.owned_by.trim() } : {}),
        strategy: alias.strategy,
        providers: splitLines(alias.providers),
        ...(alias.disabled ? { disabled: true } : {}),
      }))
      .filter((alias) => alias.name || alias.providers.length);
    if (aliases.length) {
      next.aliases = aliases;
    } else {
      next.aliases = [];
    }
    const templates = catalogForm.templates
      .map((tpl) => templateFormToPayload(tpl))
      .filter(Boolean);
    next.templates = templates;
    return next;
  }
  async function saveCatalog() {
    if (!validateCatalogForm(catalogForm)) {
      return;
    }
    if (busy) {
      return;
    }
    setSaving(true);
    try {
      const latest = await api.getModelsBundle();
      const nextCatalog = applyCatalogForm(latest?.catalog ?? {});
      const disabledModels = new Set(
        Array.isArray(nextCatalog?.disabled_models)
          ? nextCatalog.disabled_models.map((id: string) => String(id))
          : [],
      );
      const modelIds = new Set(
        Array.isArray(latest?.models)
          ? latest.models.map((item: any) => item.id)
          : [],
      );
      const defaultModel = nextCatalog?.default_model ?? null;
      if (defaultModel && typeof defaultModel === "string") {
        if (disabledModels.has(defaultModel)) {
          nextCatalog.default_model = null;
        } else if (Array.isArray(nextCatalog.aliases)) {
          const alias = nextCatalog.aliases.find(
            (item: any) => item?.name === defaultModel,
          );
          if (alias) {
            if (alias?.disabled) {
              nextCatalog.default_model = null;
            } else {
              const providers = Array.isArray(alias?.providers)
                ? alias.providers
                : [];
              const hasEnabledProvider = providers.some(
                (id: string) =>
                  modelIds.has(id) && !disabledModels.has(String(id)),
              );
              if (!hasEnabledProvider) {
                nextCatalog.default_model = null;
              }
            }
          }
        }
      }
      const nextBundle = {
        catalog: nextCatalog,
        models: Array.isArray(latest?.models) ? latest.models : [],
      };
      const saved = await api.putModelsBundle(nextBundle);
      setCatalogForm(catalogToForm(saved.catalog));
      onNotify("success", t("notice.catalog.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    } finally {
      setSaving(false);
    }
  }

  async function saveYaml() {
    if (busy) {
      return;
    }
    setYamlSaving(true);
    try {
      await api.putModelsYaml(rawYaml);
      await loadBundle();
      onNotify("success", t("notice.catalog.saved"));
    } catch (err) {
      onError(err, t("error.save"));
    } finally {
      setYamlSaving(false);
    }
  }

  async function exportYaml() {
    if (busy) {
      return;
    }
    setExporting(true);
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
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File | null) {
    if (!file) {
      return;
    }
    if (busy) {
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      await api.putModelsYaml(text);
      await loadBundle();
      onNotify("success", t("notice.catalog.saved"));
    } catch (err) {
      onError(err, t("error.import"));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setImporting(false);
    }
  }
  function addTemplateRule(templateId: string) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        enabled: true,
        rules: [...tpl.static.rules, createRule(tpl.static.rules.length === 0)],
      },
    }));
  }

  function setTemplateRuleDefault(templateId: string, ruleId: string) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: setDefaultRuleInList(tpl.static.rules, ruleId),
      },
    }));
  }

  function removeTemplateRule(templateId: string, ruleId: string) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: removeRuleFromList(tpl.static.rules, ruleId, false),
      },
    }));
  }

  function addTemplateReply(templateId: string, ruleId: string) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: addReplyToRuleList(tpl.static.rules, ruleId),
      },
    }));
  }

  function removeTemplateReply(
    templateId: string,
    ruleId: string,
    replyId: string,
  ) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: removeReplyFromRuleList(tpl.static.rules, ruleId, replyId),
      },
    }));
  }

  function updateTemplateReply(
    templateId: string,
    ruleId: string,
    replyId: string,
    patch: Partial<any>,
  ) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: updateReplyInRuleList(tpl.static.rules, ruleId, replyId, patch),
      },
    }));
  }

  function addTemplateCondition(
    templateId: string,
    ruleId: string,
    bucket: ConditionBucket,
  ) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: addConditionToRuleList(tpl.static.rules, ruleId, bucket),
      },
    }));
  }

  function removeTemplateCondition(
    templateId: string,
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
  ) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: removeConditionFromRuleList(
          tpl.static.rules,
          ruleId,
          bucket,
          conditionId,
        ),
      },
    }));
  }

  function updateTemplateCondition(
    templateId: string,
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
    patch: Partial<ConditionForm>,
  ) {
    updateTemplate(templateId, (tpl) => ({
      ...tpl,
      static: {
        ...tpl.static,
        rules: updateConditionInRuleList(
          tpl.static.rules,
          ruleId,
          bucket,
          conditionId,
          patch,
        ),
      },
    }));
  }
  useEffect(() => {
    void loadBundle();
  }, []);

  useEffect(() => {
    if (showYaml) {
      void loadYaml();
    }
  }, [showYaml]);

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,text/yaml"
        className="hidden"
        onChange={(e) => handleImport(e.target.files?.[0] ?? null)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("catalog.title")}</h2>
          <p className="text-sm text-slate-400">{t("catalog.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={loadBundle}
            disabled={busy}
          >
            {t("models.refresh")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={saveCatalog}
            disabled={busy}
          >
            {saving ? "..." : t("models.save")}
          </button>
          <button
            className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200"
            onClick={exportYaml}
            disabled={busy}
          >
            {t("models.export")}
          </button>
          <button
            className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {t("models.import")}
          </button>
          <button
            className="rounded-full border border-slate-600/50 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-200"
            onClick={() => setShowYaml((prev) => !prev)}
            disabled={busy}
          >
            {showYaml ? t("models.mode.form") : t("models.mode.yaml")}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
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
                placeholder="cognition-flash"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.catalog.static_stream")}
              <input
                value={catalogForm.defaults.static_stream}
                onChange={(e) =>
                  setCatalogForm((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      static_stream: e.target.value,
                    },
                  }))
                }
                placeholder="8"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.catalog.script_timeout")}
              <input
                value={catalogForm.defaults.script_timeout}
                onChange={(e) =>
                  setCatalogForm((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      script_timeout: e.target.value,
                    },
                  }))
                }
                placeholder="1500"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.catalog.script_stream")}
              <input
                value={catalogForm.defaults.script_stream}
                onChange={(e) =>
                  setCatalogForm((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      script_stream: e.target.value,
                    },
                  }))
                }
                placeholder="12"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.catalog.interactive_timeout")}
              <input
                value={catalogForm.defaults.interactive_timeout}
                onChange={(e) =>
                  setCatalogForm((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      interactive_timeout: e.target.value,
                    },
                  }))
                }
                placeholder="15000"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("models.catalog.interactive_stream")}
              <input
                value={catalogForm.defaults.interactive_stream}
                onChange={(e) =>
                  setCatalogForm((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      interactive_stream: e.target.value,
                    },
                  }))
                }
                placeholder="8"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 md:col-span-2">
              {t("models.catalog.interactive_fake_reasoning")}
              <input
                value={catalogForm.defaults.interactive_fake_reasoning}
                onChange={(e) =>
                  setCatalogForm((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      interactive_fake_reasoning: e.target.value,
                    },
                  }))
                }
                placeholder="思考中..."
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 md:col-span-2">
              {t("models.catalog.interactive_fallback_text")}
              <textarea
                value={catalogForm.defaults.interactive_fallback_text}
                onChange={(e) =>
                  setCatalogForm((prev) => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      interactive_fallback_text: e.target.value,
                    },
                  }))
                }
                rows={2}
                placeholder="暂未收到回复，请稍后再试。"
                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">{t("models.catalog.note")}</p>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                {t("models.aliases.section")}
              </div>
              <p className="text-sm text-slate-400">
                {t("models.aliases.desc")}
              </p>
            </div>
            <button
              className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-100"
              onClick={addAlias}
            >
              {t("models.alias.add")}
            </button>
          </div>
          {catalogForm.aliases.length ? (
            <div className="space-y-2">
              {catalogForm.aliases.map((alias) => (
                <div
                  key={alias.uid}
                  className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{alias.name || t("models.alias.item")}</span>
                    <button
                      className="text-rose-200 hover:text-rose-100"
                      onClick={() => removeAlias(alias.uid)}
                    >
                      {t("models.alias.remove")}
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-[1fr_160px]">
                    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {t("models.alias.name")}
                      <input
                        value={alias.name}
                        onChange={(e) =>
                          updateAlias(alias.uid, { name: e.target.value })
                        }
                        placeholder="cognition-proxy"
                        className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                      />
                    </label>
                    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {t("models.alias.strategy")}
                      <select
                        value={alias.strategy}
                        onChange={(e) =>
                          updateAlias(alias.uid, {
                            strategy: e.target.value as AliasStrategy,
                          })
                        }
                        className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                      >
                        <option value="round_robin">
                          {t("models.alias.strategy.round_robin")}
                        </option>
                        <option value="random">
                          {t("models.alias.strategy.random")}
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-[1fr_200px]">
                    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {t("models.alias.owned_by")}
                      <input
                        value={alias.owned_by}
                        onChange={(e) =>
                          updateAlias(alias.uid, { owned_by: e.target.value })
                        }
                        placeholder="llm-lab"
                        className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      <span>{t("models.alias.disabled")}</span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-sky-400"
                        checked={alias.disabled}
                        onChange={(e) =>
                          updateAlias(alias.uid, { disabled: e.target.checked })
                        }
                      />
                    </label>
                  </div>
                  <label className="mt-2 grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {t("models.alias.providers")}
                    <textarea
                      value={alias.providers}
                      onChange={(e) =>
                        updateAlias(alias.uid, { providers: e.target.value })
                      }
                      placeholder="cognition-flash\ncognition-pro"
                      rows={2}
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">{t("models.aliases.empty")}</p>
          )}
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                {t("models.templates.section")}
              </div>
              <p className="text-sm text-slate-400">
                {t("models.templates.desc")}
              </p>
            </div>
            <button
              className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-100"
              onClick={addTemplate}
            >
              {t("models.template.add")}
            </button>
          </div>
          {catalogForm.templates.length ? (
            <div className="space-y-3">
              {catalogForm.templates.map((template) => {
                const staticDisabled =
                  template.kind === "script" || template.kind === "interactive";
                const scriptDisabled =
                  template.kind === "static" || template.kind === "interactive";
                const interactiveDisabled =
                  template.kind === "static" || template.kind === "script";
                return (
                  <div
                    key={template.uid}
                    className="space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/60 p-3"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{template.name || t("models.template.item")}</span>
                      <button
                        className="text-rose-200 hover:text-rose-100"
                        onClick={() => removeTemplate(template.uid)}
                      >
                        {t("models.template.remove")}
                      </button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[1fr_180px]">
                      <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {t("models.template.name")}
                        <input
                          value={template.name}
                          onChange={(e) =>
                            updateTemplate(template.uid, (tpl) => ({
                              ...tpl,
                              name: e.target.value,
                            }))
                          }
                          placeholder="base-static"
                          className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {t("models.template.kind")}
                        <select
                          value={template.kind}
                          onChange={(e) =>
                            setTemplateKind(
                              template.uid,
                              e.target.value as TemplateKind,
                            )
                          }
                          className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                        >
                          <option value="">
                            {t("models.template.kind.any")}
                          </option>
                          <option value="static">
                            {t("models.template.kind.static")}
                          </option>
                          <option value="script">
                            {t("models.template.kind.script")}
                          </option>
                          <option value="interactive">
                            {t("models.template.kind.interactive")}
                          </option>
                        </select>
                      </label>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {t("models.meta.owned_by")}
                        <input
                          value={template.meta.owned_by}
                          onChange={(e) =>
                            updateTemplate(template.uid, (tpl) => ({
                              ...tpl,
                              meta: { ...tpl.meta, owned_by: e.target.value },
                            }))
                          }
                          placeholder="llm-lab"
                          className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {t("models.meta.created")}
                        <input
                          value={template.meta.created}
                          onChange={(e) =>
                            updateTemplate(template.uid, (tpl) => ({
                              ...tpl,
                              meta: { ...tpl.meta, created: e.target.value },
                            }))
                          }
                          placeholder="1700000000"
                          className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {t("models.meta.description")}
                        <input
                          value={template.meta.description}
                          onChange={(e) =>
                            updateTemplate(template.uid, (tpl) => ({
                              ...tpl,
                              meta: {
                                ...tpl.meta,
                                description: e.target.value,
                              },
                            }))
                          }
                          placeholder="Short description"
                          className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {t("models.meta.tags")}
                        <textarea
                          value={template.meta.tags}
                          onChange={(e) =>
                            updateTemplate(template.uid, (tpl) => ({
                              ...tpl,
                              meta: { ...tpl.meta, tags: e.target.value },
                            }))
                          }
                          placeholder="tag-one\ntag-two"
                          rows={2}
                          className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                        />
                      </label>
                    </div>

                    <div className="space-y-2 rounded-xl border border-slate-700/50 bg-slate-900/70 p-2">
                      <label
                        className={`flex items-center justify-between gap-3 text-sm ${
                          staticDisabled ? "opacity-50" : ""
                        }`}
                      >
                        <span className="text-sm text-slate-200">
                          {t("models.template.static.enable")}
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-sky-400"
                          checked={template.static.enabled}
                          disabled={staticDisabled}
                          onChange={(e) =>
                            toggleTemplateStatic(
                              template.uid,
                              e.target.checked,
                            )
                          }
                        />
                      </label>
                      {template.static.enabled && (
                        <div className="space-y-3 pt-2">
                          <div className="grid gap-2 md:grid-cols-2">
                            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                              {t("models.static.pick")}
                              <select
                                value={template.static.pick}
                                onChange={(e) =>
                                  updateTemplate(template.uid, (tpl) => ({
                                    ...tpl,
                                    static: {
                                      ...tpl.static,
                                      pick: e.target.value as
                                        | ""
                                        | PickStrategy,
                                    },
                                  }))
                                }
                                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                              >
                                <option value="">
                                  {t("models.static.pick.default")}
                                </option>
                                <option value="round_robin">
                                  {t("models.pick.round_robin")}
                                </option>
                                <option value="random">
                                  {t("models.pick.random")}
                                </option>
                                <option value="weighted">
                                  {t("models.pick.weighted")}
                                </option>
                              </select>
                            </label>
                            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                              {t("models.static.stream")}
                              <input
                                value={template.static.stream_chunk_chars}
                                onChange={(e) =>
                                  updateTemplate(template.uid, (tpl) => ({
                                    ...tpl,
                                    static: {
                                      ...tpl.static,
                                      stream_chunk_chars: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="32"
                                className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                              />
                            </label>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                {t("models.rules")}
                              </span>
                              <button
                                className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-100"
                                onClick={() => addTemplateRule(template.uid)}
                              >
                                {t("models.rule.add")}
                              </button>
                            </div>
                            {template.static.rules.length ? (
                              <div className="space-y-2">
                                {template.static.rules.map((rule, idx) => (
                                  <RuleCard
                                    key={rule.uid}
                                    rule={rule}
                                    index={idx}
                                    t={t}
                                    onSetDefault={() =>
                                      setTemplateRuleDefault(
                                        template.uid,
                                        rule.uid,
                                      )
                                    }
                                    onRemove={() =>
                                      removeTemplateRule(
                                        template.uid,
                                        rule.uid,
                                      )
                                    }
                                    onUpdate={(patch) =>
                                      updateTemplate(template.uid, (tpl) => ({
                                        ...tpl,
                                        static: {
                                          ...tpl.static,
                                          rules: tpl.static.rules.map((item) =>
                                            item.uid === rule.uid
                                              ? { ...item, ...patch }
                                              : item,
                                          ),
                                        },
                                      }))
                                    }
                                    onAddReply={(ruleId) =>
                                      addTemplateReply(template.uid, ruleId)
                                    }
                                    onRemoveReply={(ruleId, replyId) =>
                                      removeTemplateReply(
                                        template.uid,
                                        ruleId,
                                        replyId,
                                      )
                                    }
                                    onUpdateReply={(ruleId, replyId, patch) =>
                                      updateTemplateReply(
                                        template.uid,
                                        ruleId,
                                        replyId,
                                        patch,
                                      )
                                    }
                                    onAddCondition={(ruleId, bucket) =>
                                      addTemplateCondition(
                                        template.uid,
                                        ruleId,
                                        bucket,
                                      )
                                    }
                                    onRemoveCondition={(
                                      ruleId,
                                      bucket,
                                      conditionId,
                                    ) =>
                                      removeTemplateCondition(
                                        template.uid,
                                        ruleId,
                                        bucket,
                                        conditionId,
                                      )
                                    }
                                    onUpdateCondition={(
                                      ruleId,
                                      bucket,
                                      conditionId,
                                      patch,
                                    ) =>
                                      updateTemplateCondition(
                                        template.uid,
                                        ruleId,
                                        bucket,
                                        conditionId,
                                        patch,
                                      )
                                    }
                                  />
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">
                                {t("models.rules.empty")}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 rounded-xl border border-slate-700/50 bg-slate-900/70 p-2">
                      <label
                        className={`flex items-center justify-between gap-3 text-sm ${
                          scriptDisabled ? "opacity-50" : ""
                        }`}
                      >
                        <span className="text-sm text-slate-200">
                          {t("models.template.script.enable")}
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-sky-400"
                          checked={template.script.enabled}
                          disabled={scriptDisabled}
                          onChange={(e) =>
                            toggleTemplateScript(
                              template.uid,
                              e.target.checked,
                            )
                          }
                        />
                      </label>
                      {template.script.enabled && (
                        <div className="grid gap-2 pt-2 md:grid-cols-2">
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {t("models.script.file")}
                            <input
                              value={template.script.file}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  script: {
                                    ...tpl.script,
                                    file: e.target.value,
                                  },
                                }))
                              }
                              placeholder="example.js"
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {t("models.script.init")}
                            <input
                              value={template.script.init_file}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  script: {
                                    ...tpl.script,
                                    init_file: e.target.value,
                                  },
                                }))
                              }
                              placeholder="init.js"
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {t("models.script.timeout")}
                            <input
                              value={template.script.timeout_ms}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  script: {
                                    ...tpl.script,
                                    timeout_ms: e.target.value,
                                  },
                                }))
                              }
                              placeholder="1500"
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {t("models.script.stream")}
                            <input
                              value={template.script.stream_chunk_chars}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  script: {
                                    ...tpl.script,
                                    stream_chunk_chars: e.target.value,
                                  },
                                }))
                              }
                              placeholder="24"
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 rounded-xl border border-slate-700/50 bg-slate-900/70 p-2">
                      <label
                        className={`flex items-center justify-between gap-3 text-sm ${
                          interactiveDisabled ? "opacity-50" : ""
                        }`}
                      >
                        <span className="text-sm text-slate-200">
                          {t("models.template.interactive.enable")}
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-sky-400"
                          checked={template.interactive.enabled}
                          disabled={interactiveDisabled}
                          onChange={(e) =>
                            toggleTemplateInteractive(
                              template.uid,
                              e.target.checked,
                            )
                          }
                        />
                      </label>
                      {template.interactive.enabled && (
                        <div className="grid gap-2 pt-2 md:grid-cols-2">
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {t("models.interactive.timeout")}
                            <input
                              value={template.interactive.timeout_ms}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  interactive: {
                                    ...tpl.interactive,
                                    timeout_ms: e.target.value,
                                  },
                                }))
                              }
                              placeholder="15000"
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            {t("models.interactive.stream")}
                            <input
                              value={template.interactive.stream_chunk_chars}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  interactive: {
                                    ...tpl.interactive,
                                    stream_chunk_chars: e.target.value,
                                  },
                                }))
                              }
                              placeholder="8"
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 md:col-span-2">
                            {t("models.interactive.fake_reasoning")}
                            <input
                              value={template.interactive.fake_reasoning}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  interactive: {
                                    ...tpl.interactive,
                                    fake_reasoning: e.target.value,
                                  },
                                }))
                              }
                              placeholder="思考中..."
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 md:col-span-2">
                            {t("models.interactive.fallback_text")}
                            <textarea
                              value={template.interactive.fallback_text}
                              onChange={(e) =>
                                updateTemplate(template.uid, (tpl) => ({
                                  ...tpl,
                                  interactive: {
                                    ...tpl.interactive,
                                    fallback_text: e.target.value,
                                  },
                                }))
                              }
                              rows={2}
                              placeholder="暂未收到回复，请稍后再试。"
                              className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {t("models.templates.empty")}
            </p>
          )}
        </div>
        {showYaml && (
          <div className="space-y-2 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                {t("models.raw.title")}
              </div>
              <button
                className="rounded-full bg-emerald-400/90 px-3 py-1 text-xs font-semibold text-slate-900"
                onClick={saveYaml}
                disabled={busy}
              >
                {yamlSaving ? "..." : t("models.raw.save")}
              </button>
            </div>
            <div className="rounded-2xl border border-slate-700/40 bg-[#0b1220]">
              <Editor
                value={rawYaml}
                onValueChange={setRawYaml}
                highlight={(code) =>
                  Prism.highlight(code, Prism.languages.yaml, "yaml")
                }
                padding={12}
                className="min-h-[240px] font-mono text-xs text-slate-100"
              />
            </div>
            <p className="text-xs text-slate-500">{t("models.raw.hint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function templateToForm(template: any): TemplateForm {
  const meta = template?.meta ?? {};
  const staticCfg = template?.static ?? null;
  const scriptCfg = template?.script ?? null;
  const interactiveCfg = template?.interactive ?? null;
  const kind =
    template?.kind === "static" ||
    template?.kind === "script" ||
    template?.kind === "interactive"
      ? (template.kind as TemplateKind)
      : "";
  return {
    uid: makeId(),
    name: template?.name ?? "",
    kind,
    meta: {
      owned_by: meta?.owned_by ?? "",
      created: meta?.created ? String(meta.created) : "",
      description: meta?.description ?? "",
      tags: Array.isArray(meta?.tags) ? meta.tags.join("\n") : "",
    },
    static: {
      enabled: Boolean(staticCfg),
      pick: staticCfg?.pick ?? "",
      stream_chunk_chars: staticCfg?.stream_chunk_chars
        ? String(staticCfg.stream_chunk_chars)
        : "",
      rules: rulesToForm(staticCfg?.rules),
    },
    script: {
      enabled: Boolean(scriptCfg),
      file: scriptCfg?.file ?? "",
      init_file: scriptCfg?.init_file ?? "",
      timeout_ms: scriptCfg?.timeout_ms ? String(scriptCfg.timeout_ms) : "",
      stream_chunk_chars: scriptCfg?.stream_chunk_chars
        ? String(scriptCfg.stream_chunk_chars)
        : "",
    },
    interactive: {
      enabled: Boolean(interactiveCfg),
      timeout_ms: interactiveCfg?.timeout_ms
        ? String(interactiveCfg.timeout_ms)
        : "",
      stream_chunk_chars: interactiveCfg?.stream_chunk_chars
        ? String(interactiveCfg.stream_chunk_chars)
        : "",
      fake_reasoning: interactiveCfg?.fake_reasoning ?? "",
      fallback_text: interactiveCfg?.fallback_text ?? "",
    },
  };
}

function templateFormToPayload(template: TemplateForm) {
  const name = template.name.trim();
  const hasMeta =
    template.meta.owned_by.trim() ||
    template.meta.created.trim() ||
    template.meta.description.trim() ||
    template.meta.tags.trim();
  const hasContent =
    name ||
    template.kind ||
    hasMeta ||
    template.static.enabled ||
    template.script.enabled ||
    template.interactive.enabled;
  if (!hasContent) {
    return null;
  }

  const payload: any = { name };
  if (template.kind) {
    payload.kind = template.kind;
  }

  const meta: any = {};
  if (template.meta.owned_by.trim()) {
    meta.owned_by = template.meta.owned_by.trim();
  }
  if (template.meta.created.trim()) {
    const parsed = Number(template.meta.created.trim());
    if (!Number.isNaN(parsed)) {
      meta.created = parsed;
    }
  }
  if (template.meta.description.trim()) {
    meta.description = template.meta.description.trim();
  }
  const tags = splitLines(template.meta.tags);
  if (tags.length) {
    meta.tags = tags;
  }
  if (Object.keys(meta).length) {
    payload.meta = meta;
  }

  if (template.static.enabled) {
    const staticPayload: any = {};
    if (template.static.pick) {
      staticPayload.pick = template.static.pick;
    }
    if (template.static.stream_chunk_chars.trim()) {
      const parsed = Number(template.static.stream_chunk_chars.trim());
      if (!Number.isNaN(parsed)) {
        staticPayload.stream_chunk_chars = parsed;
      }
    }
    if (template.static.rules.length) {
      staticPayload.rules = rulesToPayload(template.static.rules);
    }
    payload.static = staticPayload;
  }

  if (template.script.enabled) {
    const scriptPayload: any = {};
    if (template.script.file.trim()) {
      scriptPayload.file = template.script.file.trim();
    }
    if (template.script.init_file.trim()) {
      scriptPayload.init_file = template.script.init_file.trim();
    }
    if (template.script.timeout_ms.trim()) {
      const parsed = Number(template.script.timeout_ms.trim());
      if (!Number.isNaN(parsed)) {
        scriptPayload.timeout_ms = parsed;
      }
    }
    if (template.script.stream_chunk_chars.trim()) {
      const parsed = Number(template.script.stream_chunk_chars.trim());
      if (!Number.isNaN(parsed)) {
        scriptPayload.stream_chunk_chars = parsed;
      }
    }
    payload.script = scriptPayload;
  }

  if (template.interactive.enabled) {
    const interactivePayload: any = {};
    if (template.interactive.timeout_ms.trim()) {
      const parsed = Number(template.interactive.timeout_ms.trim());
      if (!Number.isNaN(parsed)) {
        interactivePayload.timeout_ms = parsed;
      }
    }
    if (template.interactive.stream_chunk_chars.trim()) {
      const parsed = Number(template.interactive.stream_chunk_chars.trim());
      if (!Number.isNaN(parsed)) {
        interactivePayload.stream_chunk_chars = parsed;
      }
    }
    if (template.interactive.fake_reasoning.trim()) {
      interactivePayload.fake_reasoning =
        template.interactive.fake_reasoning.trim();
    }
    if (template.interactive.fallback_text.trim()) {
      interactivePayload.fallback_text =
        template.interactive.fallback_text.trim();
    }
    payload.interactive = interactivePayload;
  }

  return payload;
}

function catalogToForm(catalog: any): CatalogForm {
  const base = DEFAULT_CATALOG_FORM();
  if (!catalog) {
    return base;
  }
  const defaults = catalog.defaults ?? {};
  return {
    ...base,
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
      interactive_timeout: defaults?.interactive?.timeout_ms
        ? String(defaults.interactive.timeout_ms)
        : "",
      interactive_stream: defaults?.interactive?.stream_chunk_chars
        ? String(defaults.interactive.stream_chunk_chars)
        : "",
      interactive_fake_reasoning: defaults?.interactive?.fake_reasoning ?? "",
      interactive_fallback_text: defaults?.interactive?.fallback_text ?? "",
    },
    aliases: Array.isArray(catalog.aliases)
      ? catalog.aliases.map((alias: any) => ({
          uid: makeId(),
          name: alias?.name ?? "",
          owned_by: alias?.owned_by ?? "",
          strategy: alias?.strategy ?? "round_robin",
          providers: Array.isArray(alias?.providers)
            ? alias.providers.join("\n")
            : "",
          disabled: Boolean(alias?.disabled),
        }))
      : [],
    templates: Array.isArray(catalog.templates)
      ? catalog.templates.map((tpl: any) => templateToForm(tpl))
      : [],
  };
}

function setDefaultRuleInList(rules: RuleForm[], ruleId: string) {
  return rules.map((rule) =>
    rule.uid === ruleId
      ? { ...rule, default: true, any: [], all: [], none: [] }
      : { ...rule, default: false },
  );
}

function removeRuleFromList(
  rules: RuleForm[],
  ruleId: string,
  ensureOne: boolean,
) {
  const remaining = rules.filter((rule) => rule.uid !== ruleId);
  if (!remaining.length && ensureOne) {
    return [createRule(true)];
  }
  return remaining;
}

function addReplyToRuleList(rules: RuleForm[], ruleId: string) {
  return rules.map((rule) =>
    rule.uid === ruleId
      ? { ...rule, replies: [...rule.replies, createReply()] }
      : rule,
  );
}

function removeReplyFromRuleList(
  rules: RuleForm[],
  ruleId: string,
  replyId: string,
) {
  return rules.map((rule) => {
    if (rule.uid !== ruleId) {
      return rule;
    }
    const remaining = rule.replies.filter((reply) => reply.uid !== replyId);
    return {
      ...rule,
      replies: remaining.length ? remaining : [createReply()],
    };
  });
}

function updateReplyInRuleList(
  rules: RuleForm[],
  ruleId: string,
  replyId: string,
  patch: Partial<any>,
) {
  return rules.map((rule) => {
    if (rule.uid !== ruleId) {
      return rule;
    }
    const replies = rule.replies.map((reply) =>
      reply.uid === replyId ? { ...reply, ...patch } : reply,
    );
    return { ...rule, replies };
  });
}

function addConditionToRuleList(
  rules: RuleForm[],
  ruleId: string,
  bucket: ConditionBucket,
) {
  return rules.map((rule) =>
    rule.uid === ruleId
      ? {
          ...rule,
          [bucket]: [...rule[bucket], createCondition()],
        }
      : rule,
  );
}

function removeConditionFromRuleList(
  rules: RuleForm[],
  ruleId: string,
  bucket: ConditionBucket,
  conditionId: string,
) {
  return rules.map((rule) => {
    if (rule.uid !== ruleId) {
      return rule;
    }
    const remaining = rule[bucket].filter((cond) => cond.uid !== conditionId);
    return { ...rule, [bucket]: remaining };
  });
}

function updateConditionInRuleList(
  rules: RuleForm[],
  ruleId: string,
  bucket: ConditionBucket,
  conditionId: string,
  patch: Partial<ConditionForm>,
) {
  return rules.map((rule) => {
    if (rule.uid !== ruleId) {
      return rule;
    }
    const updated = rule[bucket].map((cond) =>
      cond.uid === conditionId ? { ...cond, ...patch } : cond,
    );
    return { ...rule, [bucket]: updated };
  });
}
