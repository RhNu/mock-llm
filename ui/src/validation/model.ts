type ModelObject = Record<string, any>;

function isObject(value: unknown): value is ModelObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRegexLiteral(source: string): string | null {
  if (!source.startsWith("/")) {
    return "regex 必须使用 /pattern/flags 形式";
  }
  let last = -1;
  let escaped = false;
  for (let i = 1; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "/") {
      last = i;
    }
  }
  if (last < 0) {
    return "regex 缺少结束的 /";
  }
  const flags = source.slice(last + 1);
  for (const ch of flags) {
    if (ch === "i" || ch === " " || ch === "\t") {
      continue;
    }
    return "regex flags 仅支持 i";
  }
  return null;
}

function hasConditionValue(cond: any) {
  if (!isObject(cond)) {
    return false;
  }
  const value =
    cond.contains ??
    cond.equals ??
    cond.starts_with ??
    cond.ends_with ??
    cond.regex ??
    "";
  return typeof value === "string" && value.trim().length > 0;
}

export function validateModelConfig(model: unknown): string[] {
  if (!isObject(model)) {
    return ["根节点必须是对象。"];
  }

  const errors: string[] = [];
  const id = model.id;
  if (typeof id !== "string" || !id.trim()) {
    errors.push("id 不能为空。");
  }

  const kind = model.kind;
  if (kind === "static") {
    const rules = model.static?.rules;
    if (!Array.isArray(rules) || rules.length === 0) {
      errors.push("static.rules 至少需要一条规则。");
      return errors;
    }
    let defaultCount = 0;
    rules.forEach((rule: any, index: number) => {
      const prefix = `static.rules[${index}]`;
      const isDefault = Boolean(rule?.default);
      if (isDefault) {
        defaultCount += 1;
      }
      if (!Array.isArray(rule?.replies) || rule.replies.length === 0) {
        errors.push(`${prefix}.replies 至少需要一条回复。`);
      }
      const when = rule?.when;
      const hasWhen = typeof when !== "undefined";
      const hasConditions =
        (Array.isArray(when?.any) && when.any.some(hasConditionValue)) ||
        (Array.isArray(when?.all) && when.all.some(hasConditionValue)) ||
        (Array.isArray(when?.none) && when.none.some(hasConditionValue));

      if (isDefault) {
        if (hasWhen) {
          errors.push(`${prefix} 为默认规则时不能包含 when。`);
        }
      } else {
        if (!hasConditions) {
          errors.push(`${prefix} 非默认规则必须包含至少一个条件。`);
        }
      }

      if (isObject(when) && hasWhen) {
        ["any", "all", "none"].forEach((bucket) => {
          const list = when[bucket];
          if (!Array.isArray(list)) {
            return;
          }
          list.forEach((cond: any, condIndex: number) => {
            const condPrefix = `${prefix}.when.${bucket}[${condIndex}]`;
            if (!isObject(cond)) {
              errors.push(`${condPrefix} 条件必须是对象。`);
              return;
            }
            if (!hasConditionValue(cond)) {
              errors.push(`${condPrefix} 条件值不能为空。`);
            }
            if (typeof cond.regex === "string") {
              const regexError = parseRegexLiteral(cond.regex.trim());
              if (regexError) {
                errors.push(`${condPrefix} ${regexError}`);
              }
            }
          });
        });
      }
    });
    if (defaultCount !== 1) {
      errors.push("static.rules 必须且只能包含一个 default 规则。");
    }
  }

  if (kind === "interactive") {
    const fallback = model.interactive?.fallback_text;
    if (typeof fallback !== "string" || !fallback.trim()) {
      errors.push("interactive.fallback_text 不能为空。");
    }
  }

  if (kind === "script") {
    const file = model.script?.file;
    if (typeof file !== "string" || !file.trim()) {
      errors.push("script.file 不能为空。");
    }
  }

  return errors;
}
