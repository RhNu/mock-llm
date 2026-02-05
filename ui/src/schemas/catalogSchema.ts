export const CATALOG_SCHEMA: Record<string, unknown> = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Mock LLM Catalog",
  type: "object",
  additionalProperties: false,
  required: ["schema"],
  properties: {
    schema: {
      const: 2,
      description: "Catalog schema version (must be 2).",
    },
    default_model: {
      description: "Default model id or alias.",
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        owned_by: { type: "string" },
        static: {
          type: "object",
          additionalProperties: false,
          properties: {
            stream_chunk_chars: { type: "integer", minimum: 1 },
          },
        },
        script: {
          type: "object",
          additionalProperties: false,
          properties: {
            timeout_ms: { type: "integer", minimum: 1 },
            stream_chunk_chars: { type: "integer", minimum: 1 },
          },
        },
        interactive: {
          type: "object",
          additionalProperties: false,
          properties: {
            timeout_ms: { type: "integer", minimum: 1 },
            stream_chunk_chars: { type: "integer", minimum: 1 },
            fake_reasoning: { type: "string" },
            fallback_text: { type: "string" },
          },
        },
      },
    },
    aliases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "providers"],
        properties: {
          name: { type: "string", minLength: 1 },
          owned_by: { type: "string" },
          strategy: { type: "string", enum: ["round_robin", "random"] },
          providers: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
          disabled: { type: "boolean" },
        },
      },
    },
    templates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          kind: { type: "string", enum: ["static", "script", "interactive"] },
          meta: {
            type: "object",
            additionalProperties: false,
            properties: {
              owned_by: { type: "string" },
              created: { type: "integer" },
              description: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
          },
          static: {
            type: "object",
            additionalProperties: false,
            properties: {
              pick: {
                type: "string",
                enum: ["round_robin", "random", "weighted"],
              },
              stream_chunk_chars: { type: "integer", minimum: 1 },
              rules: { type: "array", items: { type: "object" } },
            },
          },
          script: {
            type: "object",
            additionalProperties: false,
            properties: {
              file: { type: "string" },
              init_file: { type: "string" },
              timeout_ms: { type: "integer", minimum: 1 },
              stream_chunk_chars: { type: "integer", minimum: 1 },
            },
          },
          interactive: {
            type: "object",
            additionalProperties: false,
            properties: {
              timeout_ms: { type: "integer", minimum: 1 },
              stream_chunk_chars: { type: "integer", minimum: 1 },
              fake_reasoning: { type: "string" },
              fallback_text: { type: "string" },
            },
          },
        },
      },
    },
    disabled_models: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
};
