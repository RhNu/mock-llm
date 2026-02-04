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

export interface ScriptInput {
  request: unknown;
  parsed: ParsedRequest;
  model: unknown;
  meta: ScriptMeta;
}

export interface ScriptOutput {
  content: string;
  reasoning?: string;
  finish_reason?: string;
  usage?: Usage;
}
