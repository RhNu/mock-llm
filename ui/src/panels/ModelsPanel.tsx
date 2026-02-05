import { useEffect, useState } from "react";
import { createApi } from "../api";
import { RuleCard } from "../components/RuleCard";
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

type ConditionBucket = "any" | "all" | "none";

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
  const [form, setForm] = useState<ModelForm>(DEFAULT_MODEL_FORM());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadBundle() {
    setLoading(true);
    try {
      const data = await api.getModelsBundle();
      setModels(Array.isArray(data?.models) ? data.models : []);
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
    if (nextForm.kind === "interactive") {
      if (!nextForm.interactive.fallback_text.trim()) {
        onNotify("error", t("error.interactive.fallback"));
        return false;
      }
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
        const hasConditions =
          rule.any.some((cond) => cond.value.trim()) ||
          rule.all.some((cond) => cond.value.trim()) ||
          rule.none.some((cond) => cond.value.trim());
        if (rule.default) {
          if (hasConditions) {
            onNotify("error", t("error.rule.default.when"));
            return false;
          }
        } else if (!hasConditions) {
          onNotify("error", t("error.rule.when"));
          return false;
        }
      }
    }
    return true;
  }

  async function saveBundle() {
    if (!validateForm(form)) {
      return;
    }
    setSaving(true);
    try {
      const modelPayload = formToModel(form);
      const modelId = modelPayload.id;
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

      const nextBundle = {
        catalog: latest?.catalog ?? { schema: 2 },
        models: nextModels,
      };
      const saved = await api.putModelsBundle(nextBundle);
      setModels(saved.models ?? []);
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
      const latest = await api.getModelsBundle();
      const nextModels = Array.isArray(latest?.models)
        ? latest.models.filter((item: any) => item.id !== id)
        : [];
      const saved = await api.putModelsBundle({
        catalog: latest?.catalog ?? { schema: 2 },
        models: nextModels,
      });
      setModels(saved.models ?? []);
      newModel();
      onNotify("success", t("notice.model.deleted"));
    } catch (err) {
      onError(err, t("error.delete"));
    }
  }

  function setRuleDefault(ruleId: string) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: setDefaultRuleInList(prev.static.rules, ruleId),
      },
    }));
  }

  function removeRule(ruleId: string) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: removeRuleFromList(prev.static.rules, ruleId, true),
      },
    }));
  }

  function addReply(ruleId: string) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: addReplyToRuleList(prev.static.rules, ruleId),
      },
    }));
  }

  function removeReply(ruleId: string, replyId: string) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: removeReplyFromRuleList(prev.static.rules, ruleId, replyId),
      },
    }));
  }

  function updateReply(ruleId: string, replyId: string, patch: Partial<any>) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: updateReplyInRuleList(prev.static.rules, ruleId, replyId, patch),
      },
    }));
  }

  function addCondition(ruleId: string, bucket: ConditionBucket) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: addConditionToRuleList(prev.static.rules, ruleId, bucket),
      },
    }));
  }

  function removeCondition(
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
  ) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: removeConditionFromRuleList(
          prev.static.rules,
          ruleId,
          bucket,
          conditionId,
        ),
      },
    }));
  }

  function updateCondition(
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
    patch: Partial<ConditionForm>,
  ) {
    setForm((prev) => ({
      ...prev,
      static: {
        ...prev.static,
        rules: updateConditionInRuleList(
          prev.static.rules,
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

  return (
    <div className="animate-[rise_0.5s_ease-out] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("models.title")}</h2>
          <p className="text-sm text-slate-400">{t("models.desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={loadBundle}
            disabled={loading}
          >
            {t("models.refresh")}
          </button>
          <button
            className="rounded-full border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            onClick={newModel}
          >
            {t("models.new")}
          </button>
          <button
            className="rounded-full bg-sky-400/90 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-sky-300"
            onClick={saveBundle}
            disabled={saving}
          >
            {saving ? "..." : t("models.save")}
          </button>
          <button
            className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200"
            onClick={remove}
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
                ].join(" ")}
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

        <div className="space-y-4 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            {t("models.section")}
          </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("models.id")}
                <input
                  value={form.id}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, id: e.target.value }))
                  }
                  placeholder="llm-example"
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                >
                  <option value="static">{t("models.type.static")}</option>
                  <option value="script">{t("models.type.script")}</option>
                  <option value="interactive">{t("models.type.interactive")}</option>
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
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                  className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                />
              </label>
            </div>

            {form.kind === "static" ? (
              <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
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
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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

                  <div className="space-y-2">
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
                        onAddCondition={addCondition}
                        onRemoveCondition={removeCondition}
                        onUpdateCondition={updateCondition}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : form.kind === "script" ? (
              <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
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
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {t("models.interactive.section")}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {t("models.interactive.timeout")}
                    <input
                      value={form.interactive.timeout_ms}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          interactive: {
                            ...prev.interactive,
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
                      value={form.interactive.stream_chunk_chars}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          interactive: {
                            ...prev.interactive,
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
                      value={form.interactive.fake_reasoning}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          interactive: {
                            ...prev.interactive,
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
                      value={form.interactive.fallback_text}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          interactive: {
                            ...prev.interactive,
                            fallback_text: e.target.value,
                          },
                        }))
                      }
                      spellCheck={false}
                      rows={3}
                      placeholder="暂未收到回复，请稍后再试。"
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
