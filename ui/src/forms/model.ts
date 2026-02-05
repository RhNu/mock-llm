import type { Dispatch, SetStateAction } from "react";
import { makeId } from "./common";

export type PickStrategy = "round_robin" | "random" | "weighted";
export type ConditionType =
  | "contains"
  | "equals"
  | "starts_with"
  | "ends_with"
  | "regex";
export type CaseSensitivity = "sensitive" | "insensitive";

export type ConditionForm = {
  uid: string;
  type: ConditionType;
  value: string;
  case: CaseSensitivity;
};

export type ReplyForm = {
  uid: string;
  content: string;
  reasoning: string;
  weight: string;
};

export type RuleForm = {
  uid: string;
  default: boolean;
  pick: "" | PickStrategy;
  any: ConditionForm[];
  all: ConditionForm[];
  none: ConditionForm[];
  replies: ReplyForm[];
};

export type ModelForm = {
  id: string;
  kind: "static" | "script" | "interactive";
  extends: string;
  meta: {
    owned_by: string;
    created: string;
    description: string;
    tags: string;
  };
  static: {
    pick: "" | PickStrategy;
    stream_chunk_chars: string;
    rules: RuleForm[];
  };
  script: {
    file: string;
    init_file: string;
    timeout_ms: string;
    stream_chunk_chars: string;
  };
  interactive: {
    timeout_ms: string;
    stream_chunk_chars: string;
    fake_reasoning: string;
    fallback_text: string;
  };
};

export function createReply(): ReplyForm {
  return {
    uid: makeId(),
    content: "",
    reasoning: "",
    weight: "",
  };
}

export function createCondition(
  type: ConditionType = "contains",
): ConditionForm {
  return {
    uid: makeId(),
    type,
    value: "",
    case: "sensitive",
  };
}

export function createRule(defaultRule = false): RuleForm {
  return {
    uid: makeId(),
    default: defaultRule,
    pick: "",
    any: [],
    all: [],
    none: [],
    replies: [createReply()],
  };
}

export const DEFAULT_MODEL_FORM = (): ModelForm => ({
  id: "",
  kind: "static",
  extends: "",
  meta: {
    owned_by: "llm-lab",
    created: "",
    description: "",
    tags: "",
  },
  static: {
    pick: "round_robin",
    stream_chunk_chars: "",
    rules: [createRule(true)],
  },
  script: {
    file: "example.js",
    init_file: "",
    timeout_ms: "1500",
    stream_chunk_chars: "",
  },
  interactive: {
    timeout_ms: "15000",
    stream_chunk_chars: "",
    fake_reasoning: "",
    fallback_text: "",
  },
});

export function updateRule(
  setForm: Dispatch<SetStateAction<ModelForm>>,
  uid: string,
  patch: Partial<RuleForm>,
) {
  setForm((prev) => {
    const rules = prev.static.rules.map((rule) =>
      rule.uid === uid ? { ...rule, ...patch } : rule,
    );
    return {
      ...prev,
      static: {
        ...prev.static,
        rules,
      },
    };
  });
}

export function updateReply(
  setForm: Dispatch<SetStateAction<ModelForm>>,
  ruleId: string,
  replyId: string,
  patch: Partial<ReplyForm>,
) {
  setForm((prev) => {
    const rules = prev.static.rules.map((rule) => {
      if (rule.uid !== ruleId) {
        return rule;
      }
      const replies = rule.replies.map((reply) =>
        reply.uid === replyId ? { ...reply, ...patch } : reply,
      );
      return { ...rule, replies };
    });
    return {
      ...prev,
      static: {
        ...prev.static,
        rules,
      },
    };
  });
}

export function updateCondition(
  setForm: Dispatch<SetStateAction<ModelForm>>,
  ruleId: string,
  bucket: "any" | "all" | "none",
  conditionId: string,
  patch: Partial<ConditionForm>,
) {
  setForm((prev) => {
    const rules = prev.static.rules.map((rule) => {
      if (rule.uid !== ruleId) {
        return rule;
      }
      const list = rule[bucket].map((cond) =>
        cond.uid === conditionId ? { ...cond, ...patch } : cond,
      );
      return { ...rule, [bucket]: list } as RuleForm;
    });
    return {
      ...prev,
      static: {
        ...prev.static,
        rules,
      },
    };
  });
}

export function modelToForm(model: any): ModelForm {
  const base = DEFAULT_MODEL_FORM();
  const kind =
    model?.kind === "script"
      ? "script"
      : model?.kind === "interactive"
        ? "interactive"
        : "static";
  const meta = model?.meta ?? {};

  const form: ModelForm = {
    ...base,
    id: model?.id ?? "",
    kind,
    extends: Array.isArray(model?.extends) ? model.extends.join("\n") : "",
    meta: {
      owned_by: meta?.owned_by ?? base.meta.owned_by,
      created: meta?.created ? String(meta.created) : "",
      description: meta?.description ?? "",
      tags: Array.isArray(meta?.tags) ? meta.tags.join("\n") : "",
    },
  };

  if (kind === "script") {
    return {
      ...form,
      script: {
        file: model?.script?.file ?? base.script.file,
        init_file: model?.script?.init_file ?? "",
        timeout_ms: model?.script?.timeout_ms
          ? String(model.script.timeout_ms)
          : "",
        stream_chunk_chars: model?.script?.stream_chunk_chars
          ? String(model.script.stream_chunk_chars)
          : "",
      },
    };
  }

  if (kind === "interactive") {
    return {
      ...form,
      interactive: {
        timeout_ms: model?.interactive?.timeout_ms
          ? String(model.interactive.timeout_ms)
          : "",
        stream_chunk_chars: model?.interactive?.stream_chunk_chars
          ? String(model.interactive.stream_chunk_chars)
          : "",
        fake_reasoning: model?.interactive?.fake_reasoning ?? "",
        fallback_text: model?.interactive?.fallback_text ?? "",
      },
    };
  }

  const rules = rulesToForm(model?.static?.rules);

  return {
    ...form,
    static: {
      pick: model?.static?.pick ?? base.static.pick,
      stream_chunk_chars: model?.static?.stream_chunk_chars
        ? String(model.static.stream_chunk_chars)
        : "",
      rules: rules.length ? rules : base.static.rules,
    },
  };
}

export function rulesToForm(list: any): RuleForm[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((rule: any) => parseRule(rule));
}

function parseRule(rule: any): RuleForm {
  const when = rule?.when ?? {};
  const replies = Array.isArray(rule?.replies) ? rule.replies : [];
  return {
    uid: makeId(),
    default: Boolean(rule?.default),
    pick: rule?.pick ?? "",
    any: parseConditions(when?.any),
    all: parseConditions(when?.all),
    none: parseConditions(when?.none),
    replies: replies.length
      ? replies.map((reply: any) => ({
          uid: makeId(),
          content: reply?.content ?? "",
          reasoning: reply?.reasoning ?? "",
          weight: reply?.weight ? String(reply.weight) : "",
        }))
      : [createReply()],
  };
}

function parseConditions(list: any): ConditionForm[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((item: any) => {
    if (item && typeof item === "object") {
      if ("contains" in item) {
        return {
          uid: makeId(),
          type: "contains" as const,
          value: String(item.contains ?? ""),
          case: item.case ?? "sensitive",
        };
      }
      if ("equals" in item) {
        return {
          uid: makeId(),
          type: "equals" as const,
          value: String(item.equals ?? ""),
          case: item.case ?? "sensitive",
        };
      }
      if ("starts_with" in item) {
        return {
          uid: makeId(),
          type: "starts_with" as const,
          value: String(item.starts_with ?? ""),
          case: item.case ?? "sensitive",
        };
      }
      if ("ends_with" in item) {
        return {
          uid: makeId(),
          type: "ends_with" as const,
          value: String(item.ends_with ?? ""),
          case: item.case ?? "sensitive",
        };
      }
      if ("regex" in item) {
        return {
          uid: makeId(),
          type: "regex" as const,
          value: String(item.regex ?? ""),
          case: "sensitive",
        };
      }
    }
    return createCondition();
  });
}

export function formToModel(form: ModelForm) {
  const id = form.id.trim();
  const base: any = {
    schema: 2,
    id,
    kind: form.kind,
  };

  const extendsList = form.extends
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (extendsList.length) {
    base.extends = extendsList;
  }

  const meta: any = {};
  if (form.meta.owned_by.trim()) {
    meta.owned_by = form.meta.owned_by.trim();
  }
  if (form.meta.created.trim()) {
    const parsed = Number(form.meta.created.trim());
    if (!Number.isNaN(parsed)) {
      meta.created = parsed;
    }
  }
  if (form.meta.description.trim()) {
    meta.description = form.meta.description.trim();
  }
  const tags = form.meta.tags
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.length) {
    meta.tags = tags;
  }
  if (Object.keys(meta).length) {
    base.meta = meta;
  }

  if (form.kind === "script") {
    base.script = {
      file: form.script.file.trim(),
      ...(form.script.init_file.trim()
        ? { init_file: form.script.init_file.trim() }
        : {}),
      ...(form.script.timeout_ms.trim()
        ? { timeout_ms: Number(form.script.timeout_ms.trim()) }
        : {}),
      ...(form.script.stream_chunk_chars.trim()
        ? { stream_chunk_chars: Number(form.script.stream_chunk_chars.trim()) }
        : {}),
    };
    return base;
  }

  if (form.kind === "interactive") {
    base.interactive = {
      ...(form.interactive.timeout_ms.trim()
        ? { timeout_ms: Number(form.interactive.timeout_ms.trim()) }
        : {}),
      ...(form.interactive.stream_chunk_chars.trim()
        ? { stream_chunk_chars: Number(form.interactive.stream_chunk_chars.trim()) }
        : {}),
      ...(form.interactive.fake_reasoning.trim()
        ? { fake_reasoning: form.interactive.fake_reasoning.trim() }
        : {}),
      ...(form.interactive.fallback_text.trim()
        ? { fallback_text: form.interactive.fallback_text.trim() }
        : {}),
    };
    return base;
  }

  const rules = rulesToPayload(form.static.rules);

  base.static = {
    ...(form.static.pick ? { pick: form.static.pick } : {}),
    ...(form.static.stream_chunk_chars.trim()
      ? { stream_chunk_chars: Number(form.static.stream_chunk_chars.trim()) }
      : {}),
    rules,
  };

  return base;
}

export function rulesToPayload(rules: RuleForm[]) {
  return rules.map((rule) => {
    const out: any = {
      default: rule.default,
      replies: rule.replies.map((reply) => {
        const replyOut: any = {
          content: reply.content,
        };
        if (reply.reasoning.trim()) {
          replyOut.reasoning = reply.reasoning.trim();
        }
        if (reply.weight.trim()) {
          const parsed = Number(reply.weight.trim());
          if (!Number.isNaN(parsed)) {
            replyOut.weight = parsed;
          }
        }
        return replyOut;
      }),
    };

    if (rule.pick) {
      out.pick = rule.pick;
    }

    if (!rule.default) {
      const when: any = {};
      const anyList = buildConditions(rule.any);
      const allList = buildConditions(rule.all);
      const noneList = buildConditions(rule.none);
      if (anyList.length) {
        when.any = anyList;
      }
      if (allList.length) {
        when.all = allList;
      }
      if (noneList.length) {
        when.none = noneList;
      }
      if (Object.keys(when).length) {
        out.when = when;
      }
    }

    return out;
  });
}

function buildConditions(list: ConditionForm[]) {
  return list
    .filter((cond) => cond.value.trim())
    .map((cond) => {
      const value = cond.value.trim();
      switch (cond.type) {
        case "contains":
          return cond.case === "insensitive"
            ? { contains: value, case: "insensitive" }
            : { contains: value };
        case "equals":
          return cond.case === "insensitive"
            ? { equals: value, case: "insensitive" }
            : { equals: value };
        case "starts_with":
          return cond.case === "insensitive"
            ? { starts_with: value, case: "insensitive" }
            : { starts_with: value };
        case "ends_with":
          return cond.case === "insensitive"
            ? { ends_with: value, case: "insensitive" }
            : { ends_with: value };
        case "regex":
          return { regex: value };
        default:
          return { contains: value };
      }
    });
}
