export const MODEL_SCHEMA: Record<string, unknown> = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Mock LLM Model",
  type: "object",
  additionalProperties: false,
  required: ["schema", "id", "kind"],
  properties: {
    schema: {
      const: 2,
      description: "配置版本，必须为 2。",
    },
    id: {
      type: "string",
      minLength: 1,
      description: "模型 ID（文件名需与此一致）。",
    },
    extends: {
      type: "array",
      description: "继承模板列表。",
      items: { type: "string", minLength: 1 },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        owned_by: { type: "string" },
        created: { type: "integer" },
        description: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    kind: {
      type: "string",
      enum: ["static", "script", "interactive"],
      description: "模型类型。",
    },
    static: {
      type: "object",
      additionalProperties: false,
      required: ["rules"],
      properties: {
        pick: {
          type: "string",
          enum: ["round_robin", "random", "weighted"],
        },
        stream_chunk_chars: { type: "integer", minimum: 1 },
        rules: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["default", "replies"],
            properties: {
              default: { type: "boolean" },
              pick: {
                type: "string",
                enum: ["round_robin", "random", "weighted"],
              },
              when: {
                type: "object",
                additionalProperties: false,
                properties: {
                  any: { $ref: "#/definitions/conditions" },
                  all: { $ref: "#/definitions/conditions" },
                  none: { $ref: "#/definitions/conditions" },
                },
              },
              replies: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["content"],
                  properties: {
                    content: { type: "string" },
                    reasoning: { type: "string" },
                    weight: { type: "integer", minimum: 1 },
                  },
                },
              },
            },
            allOf: [
              {
                if: {
                  properties: { default: { const: true } },
                  required: ["default"],
                },
                then: { not: { required: ["when"] } },
              },
              {
                if: {
                  properties: { default: { const: false } },
                  required: ["default"],
                },
                then: { required: ["when"] },
              },
            ],
          },
        },
      },
    },
    script: {
      type: "object",
      additionalProperties: false,
      required: ["file"],
      properties: {
        file: { type: "string", minLength: 1 },
        init_file: { type: "string" },
        timeout_ms: { type: "integer", minimum: 1 },
        stream_chunk_chars: { type: "integer", minimum: 1 },
      },
    },
    interactive: {
      type: "object",
      additionalProperties: false,
      required: ["fallback_text"],
      properties: {
        timeout_ms: { type: "integer", minimum: 1 },
        stream_chunk_chars: { type: "integer", minimum: 1 },
        fake_reasoning: { type: "string" },
        fallback_text: { type: "string", minLength: 1 },
      },
    },
  },
  allOf: [
    {
      if: { properties: { kind: { const: "static" } }, required: ["kind"] },
      then: {
        required: ["static"],
        not: {
          anyOf: [{ required: ["script"] }, { required: ["interactive"] }],
        },
      },
    },
    {
      if: { properties: { kind: { const: "script" } }, required: ["kind"] },
      then: {
        required: ["script"],
        not: {
          anyOf: [{ required: ["static"] }, { required: ["interactive"] }],
        },
      },
    },
    {
      if: {
        properties: { kind: { const: "interactive" } },
        required: ["kind"],
      },
      then: {
        required: ["interactive"],
        not: { anyOf: [{ required: ["static"] }, { required: ["script"] }] },
      },
    },
  ],
  definitions: {
    conditions: {
      type: "array",
      items: { $ref: "#/definitions/condition" },
    },
    condition: {
      type: "object",
      oneOf: [
        {
          additionalProperties: false,
          required: ["contains"],
          properties: {
            contains: { type: "string" },
            case: { type: "string", enum: ["sensitive", "insensitive"] },
          },
        },
        {
          additionalProperties: false,
          required: ["equals"],
          properties: {
            equals: { type: "string" },
            case: { type: "string", enum: ["sensitive", "insensitive"] },
          },
        },
        {
          additionalProperties: false,
          required: ["starts_with"],
          properties: {
            starts_with: { type: "string" },
            case: { type: "string", enum: ["sensitive", "insensitive"] },
          },
        },
        {
          additionalProperties: false,
          required: ["ends_with"],
          properties: {
            ends_with: { type: "string" },
            case: { type: "string", enum: ["sensitive", "insensitive"] },
          },
        },
        {
          additionalProperties: false,
          required: ["regex"],
          properties: {
            regex: { type: "string" },
          },
        },
      ],
    },
  },
};
