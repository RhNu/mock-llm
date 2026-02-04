export type ReasoningMode = "none" | "prefix" | "field" | "both";

export type ConfigForm = {
  response: {
    reasoning_mode: ReasoningMode;
    include_usage: boolean;
    schema_strict: boolean;
  };
};

export const DEFAULT_CONFIG: ConfigForm = {
  response: {
    reasoning_mode: "both",
    include_usage: true,
    schema_strict: true,
  },
};

export function configToForm(config: any): ConfigForm {
  const response = config?.response ?? {};
  const reasoningRaw = response?.reasoning_mode ?? "both";
  const reasoningMode = reasoningRaw === "append" ? "prefix" : reasoningRaw;

  return {
    response: {
      reasoning_mode: reasoningMode,
      include_usage: response?.include_usage ?? true,
      schema_strict: response?.schema_strict ?? true,
    },
  };
}

export function configToPayload(form: ConfigForm) {
  return {
    response: {
      reasoning_mode: form.response.reasoning_mode,
      include_usage: form.response.include_usage,
      schema_strict: form.response.schema_strict,
    },
  };
}
