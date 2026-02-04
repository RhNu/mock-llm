use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use rand::distr::Distribution;
use rand::distr::weighted::WeightedIndex;
use rand::prelude::IndexedRandom;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::config::{AliasStrategy, GlobalConfig, LoadedModel, ModelKind, PickStrategy, StaticReply};
use crate::error::AppError;
use crate::kernel::{KernelState, MatchCache, compiled_matches};
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
        .or_else(|| kernel.catalog.default_model.clone())
        .ok_or_else(|| AppError::bad_request("model is required"))?;

    let provider_id = resolve_provider_id(&kernel, &model_id)?;
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
        body["reasoning_content"] = json!(reasoning);
    }
    if let Some(usage) = usage {
        body["usage"] = json!(usage);
    }

    Ok(Json(body).into_response())
}

pub async fn list_models(State(state): State<AppState>) -> Result<Response, AppError> {
    let kernel = state.kernel.current();
    let mut data = Vec::new();
    let mut ids: Vec<String> = kernel.aliases.keys().cloned().collect();
    for id in kernel.models.keys() {
        if !kernel.aliases.contains_key(id) {
            ids.push(id.clone());
        }
    }
    ids.sort();
    for id in ids {
        if let Some(obj) = model_object_for_id(&id, &kernel) {
            data.push(obj);
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
    let obj = model_object_for_id(&id, &kernel)
        .ok_or_else(|| AppError::not_found("model not found"))?;
    Ok(Json(obj).into_response())
}

fn model_object_for_id(id: &str, kernel: &KernelState) -> Option<Value> {
    if let Some(alias) = kernel.aliases.get(id) {
        return Some(model_object(alias, &kernel.models));
    }
    kernel
        .models
        .get(id)
        .map(|model| model_object_for_model(id, model))
}

fn model_object_for_model(id: &str, model: &LoadedModel) -> Value {
    json!({
        "id": id,
        "object": "model",
        "created": model.created,
        "owned_by": model.config.owned_by.clone()
    })
}

fn model_object(
    alias: &crate::config::AliasConfig,
    providers: &HashMap<String, LoadedModel>,
) -> Value {
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

fn resolve_provider_id(kernel: &KernelState, model_id: &str) -> Result<String, AppError> {
    if let Some(alias) = kernel.aliases.get(model_id) {
        return select_provider(alias, &kernel.alias_rr);
    }
    if kernel.models.contains_key(model_id) {
        return Ok(model_id.to_string());
    }
    Err(AppError::not_found("model not found"))
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
    let request_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

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
                &request_id,
                &now,
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
                    request_id,
                    now,
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
    request_id: &str,
    now: &str,
) -> Result<Reply, AppError> {
    let rule_idx = select_rule_index(cfg, match_cache, user_text)
        .ok_or_else(|| AppError::internal("no matching rule"))?;
    let rule = cfg
        .rules
        .get(rule_idx)
        .ok_or_else(|| AppError::internal("rule index out of range"))?;

    let pick = rule.pick.or(cfg.pick).unwrap_or(PickStrategy::RoundRobin);
    let reply = match pick {
        PickStrategy::RoundRobin => select_round_robin(model_id, rule_idx, rule, rr_state),
        PickStrategy::Random => select_random(rule)?,
        PickStrategy::Weighted => select_weighted(rule)?,
    };

    let ctx = InterpolationContext {
        last_user: user_text,
        model_id,
        request_id,
        now,
    };
    let (content, reasoning) = interpolate_reply(&reply, &ctx);

    Ok(Reply {
        content,
        reasoning,
        finish_reason: "stop".to_string(),
        usage: None,
    })
}

fn select_rule_index(
    cfg: &crate::config::StaticConfig,
    match_cache: Option<&MatchCache>,
    user_text: Option<&str>,
) -> Option<usize> {
    let cache = match_cache?;
    if let Some(text) = user_text {
        for (idx, compiled) in cache.compiled.iter().enumerate() {
            let Some(when) = compiled.as_ref() else {
                continue;
            };
            if compiled_matches(when, text) {
                return Some(idx);
            }
        }
    }
    cache.default_index.or_else(|| {
        if cfg.rules.len() == 1 { Some(0) } else { None }
    })
}

fn select_round_robin(
    model_id: &str,
    rule_index: usize,
    rule: &crate::config::ModelRule,
    rr_state: &std::sync::Mutex<HashMap<String, usize>>,
) -> StaticReply {
    let key = format!("{}:{}", model_id, rule_index);
    let mut map = rr_state.lock().expect("rr lock poisoned");
    let idx = map.entry(key).or_insert(0);
    let reply = rule.replies[*idx % rule.replies.len()].clone();
    *idx = (*idx + 1) % rule.replies.len();
    reply
}

fn select_random(rule: &crate::config::ModelRule) -> Result<StaticReply, AppError> {
    let mut rng = rand::rng();
    rule.replies
        .choose(&mut rng)
        .cloned()
        .ok_or_else(|| AppError::internal("no static reply"))
}

fn select_weighted(rule: &crate::config::ModelRule) -> Result<StaticReply, AppError> {
    let weights: Vec<u64> = rule
        .replies
        .iter()
        .map(|reply| reply.weight.unwrap_or(1).max(1))
        .collect();
    let dist = WeightedIndex::new(&weights)
        .map_err(|_| AppError::internal("invalid weight configuration"))?;
    let mut rng = rand::rng();
    let idx = dist.sample(&mut rng);
    rule.replies
        .get(idx)
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

struct InterpolationContext<'a> {
    last_user: Option<&'a str>,
    model_id: &'a str,
    request_id: &'a str,
    now: &'a str,
}

fn interpolate_reply(reply: &StaticReply, ctx: &InterpolationContext<'_>) -> (String, Option<String>) {
    let content = interpolate_value(&reply.content, ctx);
    let reasoning = reply
        .reasoning
        .as_ref()
        .map(|value| interpolate_value(value, ctx));
    (content, reasoning)
}

fn interpolate_value(value: &str, ctx: &InterpolationContext<'_>) -> String {
    let mut out = value.replace("{{model.id}}", ctx.model_id);
    out = out.replace("{{now}}", ctx.now);
    out = out.replace("{{request_id}}", ctx.request_id);
    let last_user = ctx.last_user.unwrap_or("");
    out = out.replace("{{last_user}}", last_user);
    out
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
    mode: crate::config::ReasoningMode,
) -> (String, Option<String>) {
    match (reasoning, mode) {
        (Some(r), crate::config::ReasoningMode::Prefix) => {
            (format!("<think>{r}</think>\n{content}"), None)
        }
        (Some(r), crate::config::ReasoningMode::Field) => (content, Some(r)),
        (Some(r), crate::config::ReasoningMode::Both) => {
            (format!("<think>{r}</think>\n{content}"), Some(r))
        }
        (_, crate::config::ReasoningMode::None) => (content, None),
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
