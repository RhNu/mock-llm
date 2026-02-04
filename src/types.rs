use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatRequest {
    pub model: Option<String>,
    pub messages: Option<Vec<Message>>,
    pub stream: Option<bool>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stop: Option<Stop>,
    #[serde(default, flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Message {
    pub role: String,
    pub content: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Stop {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub stream: bool,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stop: Option<Stop>,
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptInput {
    pub request: Value,
    pub parsed: ParsedRequest,
    pub model: Value,
    pub meta: ScriptMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptMeta {
    pub request_id: String,
    pub now: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptOutput {
    pub content: String,
    pub reasoning: Option<String>,
    pub finish_reason: Option<String>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone)]
pub struct Reply {
    pub content: String,
    pub reasoning: Option<String>,
    pub finish_reason: String,
    pub usage: Option<Usage>,
}
