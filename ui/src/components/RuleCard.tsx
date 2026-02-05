import type { ConditionForm, RuleForm } from "../forms/model";

type ConditionBucket = "any" | "all" | "none";

const CONDITION_TYPES = [
  "contains",
  "equals",
  "starts_with",
  "ends_with",
  "regex",
] as const;
const CONDITION_CASES = ["sensitive", "insensitive"] as const;

export function RuleCard({
  rule,
  index,
  t,
  onSetDefault,
  onRemove,
  onUpdate,
  onAddReply,
  onRemoveReply,
  onUpdateReply,
  onAddCondition,
  onRemoveCondition,
  onUpdateCondition,
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
  onAddCondition: (ruleId: string, bucket: ConditionBucket) => void;
  onRemoveCondition: (
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
  ) => void;
  onUpdateCondition: (
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
    patch: Partial<ConditionForm>,
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
        <button
          className="text-rose-200 hover:text-rose-100"
          onClick={onRemove}
        >
          {t("models.rule.remove")}
        </button>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {t("models.rule.pick")}
          <select
            value={rule.pick}
            onChange={(e) => onUpdate({ pick: e.target.value as any })}
            className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
          >
            <option value="">{t("models.rule.pick.default")}</option>
            <option value="round_robin">{t("models.pick.round_robin")}</option>
            <option value="random">{t("models.pick.random")}</option>
            <option value="weighted">{t("models.pick.weighted")}</option>
          </select>
        </label>
      </div>

      {!rule.default && (
        <div className="mt-3 space-y-3">
          <ConditionGroup
            ruleId={rule.uid}
            bucket="any"
            label={t("models.rule.when.any")}
            conditions={rule.any}
            t={t}
            onAdd={onAddCondition}
            onRemove={onRemoveCondition}
            onUpdate={onUpdateCondition}
          />
          <ConditionGroup
            ruleId={rule.uid}
            bucket="all"
            label={t("models.rule.when.all")}
            conditions={rule.all}
            t={t}
            onAdd={onAddCondition}
            onRemove={onRemoveCondition}
            onUpdate={onUpdateCondition}
          />
          <ConditionGroup
            ruleId={rule.uid}
            bucket="none"
            label={t("models.rule.when.none")}
            conditions={rule.none}
            t={t}
            onAdd={onAddCondition}
            onRemove={onRemoveCondition}
            onUpdate={onUpdateCondition}
          />
        </div>
      )}

      <div className="mt-4 space-y-2">
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
        <div className="space-y-2">
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
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
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
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
                  />
                </label>
              </div>
              <div className="mt-2 grid gap-2 lg:grid-cols-[160px_1fr]">
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
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100"
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

function ConditionGroup({
  ruleId,
  bucket,
  label,
  conditions,
  t,
  onAdd,
  onRemove,
  onUpdate,
}: {
  ruleId: string;
  bucket: ConditionBucket;
  label: string;
  conditions: ConditionForm[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  onAdd: (ruleId: string, bucket: ConditionBucket) => void;
  onRemove: (
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
  ) => void;
  onUpdate: (
    ruleId: string,
    bucket: ConditionBucket,
    conditionId: string,
    patch: Partial<ConditionForm>,
  ) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {label}
        </span>
        <button
          className="rounded-full border border-slate-700/60 bg-slate-900/50 px-2.5 py-1 text-[11px] font-semibold text-slate-100"
          onClick={() => onAdd(ruleId, bucket)}
        >
          {t("models.condition.add")}
        </button>
      </div>
      {conditions.length ? (
        <div className="space-y-2">
          {conditions.map((condition) => (
            <div
              key={condition.uid}
              className="grid gap-2 md:grid-cols-[150px_140px_1fr_auto]"
            >
              <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t("models.condition.type")}
                <select
                  value={condition.type}
                  onChange={(e) => {
                    const nextType = e.target.value as ConditionForm["type"];
                    onUpdate(ruleId, bucket, condition.uid, {
                      type: nextType,
                      case: nextType === "regex" ? "sensitive" : condition.case,
                    });
                  }}
                  className="rounded-lg border border-slate-700/60 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-100"
                >
                  {CONDITION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`models.condition.type.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t("models.condition.case")}
                <select
                  value={condition.case}
                  disabled={condition.type === "regex"}
                  onChange={(e) =>
                    onUpdate(ruleId, bucket, condition.uid, {
                      case: e.target.value as ConditionForm["case"],
                    })
                  }
                  className="rounded-lg border border-slate-700/60 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-60"
                >
                  {CONDITION_CASES.map((value) => (
                    <option key={value} value={value}>
                      {t(`models.condition.case.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t("models.condition.value")}
                <input
                  value={condition.value}
                  onChange={(e) =>
                    onUpdate(ruleId, bucket, condition.uid, {
                      value: e.target.value,
                    })
                  }
                  placeholder="hello"
                  className="rounded-lg border border-slate-700/60 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-100"
                />
              </label>
              <button
                className="self-end text-xs text-rose-200 hover:text-rose-100"
                onClick={() => onRemove(ruleId, bucket, condition.uid)}
              >
                {t("models.condition.remove")}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">{t("models.condition.empty")}</p>
      )}
    </div>
  );
}
