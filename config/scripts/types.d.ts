export type Stop = string | string[];

export interface Message {
  role: string;
  content: unknown;
}

export interface ParsedRequest {
  model: string;
  messages: Message[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: Stop;
  extra?: Record<string, unknown>;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ScriptMeta {
  request_id: string;
  now: string;
}

export interface ModelMeta {
  description?: string;
  tags?: string[];
}

export type PickStrategy = "round_robin" | "random" | "weighted";

export interface StaticReply {
  content: string;
  reasoning?: string;
  weight?: number;
}

export type Condition =
  | { contains: string; case?: "sensitive" | "insensitive" }
  | { equals: string; case?: "sensitive" | "insensitive" }
  | { starts_with: string; case?: "sensitive" | "insensitive" }
  | { ends_with: string; case?: "sensitive" | "insensitive" }
  | { regex: string };

export interface RuleWhen {
  any?: Condition[];
  all?: Condition[];
  none?: Condition[];
}

export interface ModelRule {
  default: boolean;
  when?: RuleWhen;
  pick?: PickStrategy;
  replies: StaticReply[];
}

export interface ModelConfig {
  id: string;
  owned_by: string;
  created: number;
  kind: "static" | "script";
  meta?: ModelMeta;
  static?: {
    pick?: PickStrategy;
    stream_chunk_chars?: number;
    rules: ModelRule[];
  };
  script?: {
    file: string;
    init_file?: string;
    timeout_ms: number;
    stream_chunk_chars?: number;
  };
}

export interface ScriptInput {
  request: unknown;
  parsed: ParsedRequest;
  model: ModelConfig;
  meta: ScriptMeta;
}

export interface ScriptOutput {
  content: string;
  reasoning?: string;
  finish_reason?: string;
  usage?: Usage;
}
