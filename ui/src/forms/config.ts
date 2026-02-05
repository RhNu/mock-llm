export type ReasoningMode = "none" | "prefix" | "field";

export type ConfigForm = {
  response: {
    reasoning_mode: ReasoningMode;
    stream_first_delay_ms: string;
    include_usage: boolean;
    schema_strict: boolean;
  };
};

export const DEFAULT_CONFIG: ConfigForm = {
  response: {
    reasoning_mode: "field",
    stream_first_delay_ms: "0",
    include_usage: true,
    schema_strict: true,
  },
};

export function configToForm(config: any): ConfigForm {
  const response = config?.response ?? {};
  const reasoningRaw = response?.reasoning_mode ?? "field";
  const reasoningMode =
    reasoningRaw === "append" ? "prefix" : reasoningRaw === "both" ? "field" : reasoningRaw;

  return {
    response: {
      reasoning_mode: reasoningMode,
      stream_first_delay_ms: response?.stream_first_delay_ms
        ? String(response.stream_first_delay_ms)
        : "",
      include_usage: response?.include_usage ?? true,
      schema_strict: response?.schema_strict ?? true,
    },
  };
}

export function configToPayload(form: ConfigForm) {
  const delayRaw = form.response.stream_first_delay_ms.trim();
  const parsedDelay = Number(delayRaw);
  return {
    response: {
      reasoning_mode: form.response.reasoning_mode,
      stream_first_delay_ms: Number.isNaN(parsedDelay) ? 0 : parsedDelay,
      include_usage: form.response.include_usage,
      schema_strict: form.response.schema_strict,
    },
  };
}
