use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use rand::prelude::IndexedRandom;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::config::{AliasStrategy, GlobalConfig, LoadedModel, ModelKind, ReasoningMode, ReplyStrategy};
use crate::error::AppError;
use crate::kernel::{CompiledRule, CompiledSpec, KernelState, MatchCache};
use crate::scripting::run_script;
use crate::state::AppState;
use crate::streaming::build_sse_stream;
use crate::types::{ChatRequest, ParsedRequest, Reply, ScriptInput, ScriptMeta, Usage};

const DEFAULT_STATIC_CHUNK: usize = 16;
const DEFAULT_SCRIPT_CHUNK: usize = 24;

pub async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(raw): Json<Value>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    check_auth(&kernel.config, &headers)?;

    let req: ChatRequest = serde_json::from_value(raw.clone())
        .map_err(|_| AppError::bad_request("invalid request body"))?;
    let messages = req
        .messages
        .clone()
        .ok_or_else(|| AppError::bad_request("messages is required"))?;
    if messages.is_empty() {
        return Err(AppError::bad_request("messages is required"));
    }

    let model_id = req
        .model
        .clone()
        .or_else(|| kernel.config.default_model.clone())
        .ok_or_else(|| AppError::bad_request("model is required"))?;

    let alias = kernel
        .aliases
        .get(&model_id)
        .ok_or_else(|| AppError::not_found("model not found"))?;
    let provider_id = select_provider(alias, &kernel.alias_rr)?;
    let model = kernel
        .models
        .get(&provider_id)
        .ok_or_else(|| AppError::not_found("provider not found"))?
        .clone();

    let stream = req.stream.unwrap_or(false);
    let parsed = ParsedRequest {
        model: model_id.clone(),
        messages: messages.clone(),
        stream,
        temperature: req.temperature,
        top_p: req.top_p,
        max_tokens: req.max_tokens,
        stop: req.stop.clone(),
        extra: req.extra.clone(),
    };

    let reply = generate_reply(&kernel, &model, raw.clone(), parsed.clone()).await?;

    let reasoning_mode = kernel.config.response.reasoning_mode.clone();
    let (content_out, reasoning_field) = apply_reasoning(
        reply.content,
        reply.reasoning.clone(),
        reasoning_mode.clone(),
    );

    let usage = reply.usage.or_else(|| {
        if kernel.config.response.include_usage {
            Some(estimate_usage(&messages, &content_out))
        } else {
            None
        }
    });

    let id = format!("chatcmpl-{}", Uuid::new_v4());
    let created = Utc::now().timestamp();

    if stream {
        let chunk_size = stream_chunk_size(&model);
        let sse = build_sse_stream(
            id,
            created,
            model_id,
            content_out,
            reasoning_field,
            reply.finish_reason,
            reasoning_mode,
            chunk_size,
        );
        return Ok(sse.into_response());
    }

    let mut body = json!({
        "id": id,
        "object": "chat.completion",
        "created": created,
        "model": model_id,
        "choices": [
            {
                "index": 0,
                "message": { "role": "assistant", "content": content_out },
                "finish_reason": reply.finish_reason
            }
        ]
    });

    if let Some(reasoning) = reasoning_field {
        body["mock_reasoning"] = json!(reasoning);
    }
    if let Some(usage) = usage {
        body["usage"] = json!(usage);
    }

    Ok(Json(body).into_response())
}

pub async fn list_models(State(state): State<AppState>) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    let mut data = Vec::new();
    let mut keys: Vec<String> = kernel.aliases.keys().cloned().collect();
    keys.sort();
    for id in keys {
        if let Some(alias) = kernel.aliases.get(&id) {
            data.push(model_object(alias, &kernel.models));
        }
    }
    let body = json!({
        "object": "list",
        "data": data
    });
    Ok(Json(body).into_response())
}

pub async fn get_model(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    let alias = kernel
        .aliases
        .get(&id)
        .ok_or_else(|| AppError::not_found("model not found"))?;
    Ok(Json(model_object(alias, &kernel.models)).into_response())
}

fn model_object(alias: &crate::config::AliasConfig, providers: &HashMap<String, LoadedModel>) -> Value {
    let (created, owned_by) = alias
        .providers
        .first()
        .and_then(|id| providers.get(id))
        .map(|model| (model.created, model.config.owned_by.clone()))
        .unwrap_or_else(|| (Utc::now().timestamp(), "llm-lab".to_string()));
    json!({
        "id": alias.name.clone(),
        "object": "model",
        "created": created,
        "owned_by": owned_by
    })
}

fn check_auth(config: &GlobalConfig, headers: &HeaderMap) -> Result<(), AppError> {
    if !config.server.auth.enabled {
        return Ok(());
    }
    let expected = config.server.auth.api_key.as_str();
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if auth == format!("Bearer {}", expected) {
        Ok(())
    } else {
        Err(AppError::unauthorized("unauthorized"))
    }
}

async fn generate_reply(
    kernel: &KernelState,
    model: &LoadedModel,
    raw: Value,
    parsed: ParsedRequest,
) -> Result<Reply, AppError> {
    match model.config.kind {
        ModelKind::Static => {
            let cfg = model
                .config
                .r#static
                .as_ref()
                .ok_or_else(|| AppError::internal("static config missing"))?;
            let user_text = last_user_text(&parsed.messages);
            let cache = kernel.match_cache.get(&model.config.id);
            let reply = select_static_reply(
                &model.config.id,
                cfg,
                &kernel.rr_state,
                cache,
                user_text.as_deref(),
            )?;
            Ok(reply)
        }
        ModelKind::Script => {
            let model_value = serde_json::to_value(&model.config)
                .map_err(|e| AppError::internal(format!("serialize model failed: {e}")))?;
            let input = ScriptInput {
                request: raw,
                parsed,
                model: model_value,
                meta: ScriptMeta {
                    request_id: Uuid::new_v4().to_string(),
                    now: Utc::now().to_rfc3339(),
                },
            };
            let engine = kernel
                .engines
                .get(&model.config.id)
                .ok_or_else(|| AppError::internal("script engine missing"))?;
            let output = run_script(engine, input).await?;
            let finish_reason = output.finish_reason.unwrap_or_else(|| "stop".to_string());
            Ok(Reply {
                content: output.content,
                reasoning: output.reasoning,
                finish_reason,
                usage: output.usage,
            })
        }
    }
}

fn select_static_reply(
    model_id: &str,
    cfg: &crate::config::StaticConfig,
    rr_state: &std::sync::Mutex<HashMap<String, usize>>,
    match_cache: Option<&MatchCache>,
    user_text: Option<&str>,
) -> Result<Reply, AppError> {
    let reply = match cfg.strategy {
        ReplyStrategy::Match => select_match_reply(cfg, match_cache, user_text)
            .unwrap_or_else(|| select_round_robin(model_id, cfg, rr_state)),
        ReplyStrategy::RoundRobin => select_round_robin(model_id, cfg, rr_state),
        ReplyStrategy::Random => select_random(cfg)?,
    };

    Ok(Reply {
        content: reply.content,
        reasoning: reply.reasoning,
        finish_reason: "stop".to_string(),
        usage: None,
    })
}

fn select_round_robin(
    model_id: &str,
    cfg: &crate::config::StaticConfig,
    rr_state: &std::sync::Mutex<HashMap<String, usize>>,
) -> crate::config::StaticReply {
    let mut map = rr_state.lock().expect("rr lock poisoned");
    let idx = map.entry(model_id.to_string()).or_insert(0);
    let reply = cfg.replies[*idx % cfg.replies.len()].clone();
    *idx = (*idx + 1) % cfg.replies.len();
    reply
}

fn select_random(
    cfg: &crate::config::StaticConfig,
) -> Result<crate::config::StaticReply, AppError> {
    let mut rng = rand::rng();
    cfg.replies
        .choose(&mut rng)
        .cloned()
        .ok_or_else(|| AppError::internal("no static reply"))
}

fn select_provider(
    alias: &crate::config::AliasConfig,
    alias_rr: &std::sync::Mutex<HashMap<String, usize>>,
) -> Result<String, AppError> {
    match alias.strategy {
        AliasStrategy::RoundRobin => {
            let mut map = alias_rr
                .lock()
                .map_err(|_| AppError::internal("alias rr lock poisoned"))?;
            let idx = map.entry(alias.name.clone()).or_insert(0);
            let provider = alias.providers[*idx % alias.providers.len()].clone();
            *idx = (*idx + 1) % alias.providers.len();
            Ok(provider)
        }
        AliasStrategy::Random => {
            let mut rng = rand::rng();
            alias
                .providers
                .choose(&mut rng)
                .cloned()
                .ok_or_else(|| AppError::internal("no providers for alias"))
        }
    }
}

fn select_match_reply(
    cfg: &crate::config::StaticConfig,
    match_cache: Option<&MatchCache>,
    user_text: Option<&str>,
) -> Option<crate::config::StaticReply> {
    let cache = match_cache?;
    let text = user_text?;
    for (idx, compiled) in cache.compiled.iter().enumerate() {
        let Some(spec) = compiled else { continue };
        if compiled_matches(spec, text) {
            return cfg.replies.get(idx).cloned();
        }
    }
    cache
        .fallback_index
        .and_then(|idx| cfg.replies.get(idx).cloned())
}

fn compiled_matches(spec: &CompiledSpec, text: &str) -> bool {
    spec.rules.iter().any(|rule| match rule {
        CompiledRule::Plain(s) => text.contains(s),
        CompiledRule::Regex(re) => re.is_match(text),
    })
}

fn last_user_text(messages: &[crate::types::Message]) -> Option<String> {
    messages.iter().rev().find_map(|msg| {
        if msg.role == "user" {
            match &msg.content {
                Value::String(s) => Some(s.clone()),
                other => Some(other.to_string()),
            }
        } else {
            None
        }
    })
}

fn apply_reasoning(
    content: String,
    reasoning: Option<String>,
    mode: ReasoningMode,
) -> (String, Option<String>) {
    match (reasoning, mode) {
        (Some(r), ReasoningMode::Append) => (format!("{content}\n\n[Reasoning]\n{r}"), None),
        (Some(r), ReasoningMode::Field) => (content, Some(r)),
        (Some(r), ReasoningMode::Both) => (format!("{content}\n\n[Reasoning]\n{r}"), Some(r)),
        (None, _) => (content, None),
    }
}

fn estimate_usage(messages: &[crate::types::Message], content: &str) -> Usage {
    let prompt_tokens = estimate_tokens_from_messages(messages);
    let completion_tokens = estimate_tokens_from_str(content);
    Usage {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
    }
}

fn estimate_tokens_from_messages(messages: &[crate::types::Message]) -> u32 {
    let mut bytes = 0usize;
    for msg in messages {
        bytes += msg.role.len();
        bytes += match &msg.content {
            Value::String(s) => s.len(),
            other => other.to_string().len(),
        };
    }
    estimate_tokens(bytes)
}

fn estimate_tokens_from_str(text: &str) -> u32 {
    estimate_tokens(text.len())
}

fn estimate_tokens(bytes: usize) -> u32 {
    ((bytes + 3) / 4) as u32
}

fn stream_chunk_size(model: &LoadedModel) -> usize {
    match model.config.kind {
        ModelKind::Static => model
            .config
            .r#static
            .as_ref()
            .and_then(|s| s.stream_chunk_chars)
            .unwrap_or(DEFAULT_STATIC_CHUNK),
        ModelKind::Script => model
            .config
            .script
            .as_ref()
            .and_then(|s| s.stream_chunk_chars)
            .unwrap_or(DEFAULT_SCRIPT_CHUNK),
    }
}
