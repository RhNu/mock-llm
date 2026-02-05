use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::response::sse::{Event, Sse};
use serde_json::json;
use tokio_stream::Stream;

use crate::config::ReasoningMode;
use crate::interactive::{InteractiveHub, InteractiveReply};

pub fn build_sse_stream(
    id: String,
    created: i64,
    model: String,
    content: String,
    reasoning: Option<String>,
    finish_reason: String,
    reasoning_mode: ReasoningMode,
    chunk_size: usize,
    stream_first_delay_ms: u64,
) -> Sse<impl Stream<Item = Result<Event, Infallible>> + Send + 'static> {
    let stream = async_stream::stream! {
        let role_chunk = json!({
            "id": id.clone(),
            "object": "chat.completion.chunk",
            "created": created,
            "model": model.clone(),
            "choices": [
                { "index": 0, "delta": { "role": "assistant" }, "finish_reason": null }
            ]
        });
        yield Ok(Event::default().data(role_chunk.to_string()));

        if stream_first_delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(stream_first_delay_ms)).await;
        }

        if let Some(reasoning_text) = reasoning {
            if matches!(reasoning_mode, ReasoningMode::Field) {
                for part in chunk_text(&reasoning_text, chunk_size) {
                    let chunk = json!({
                        "id": id.clone(),
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model.clone(),
                        "choices": [
                            { "index": 0, "delta": { "reasoning_content": part }, "finish_reason": null }
                        ]
                    });
                    yield Ok(Event::default().data(chunk.to_string()));
                }
            }
        }

        for part in chunk_text(&content, chunk_size) {
            let chunk = json!({
                "id": id.clone(),
                "object": "chat.completion.chunk",
                "created": created,
                "model": model.clone(),
                "choices": [
                    { "index": 0, "delta": { "content": part }, "finish_reason": null }
                ]
            });
            yield Ok(Event::default().data(chunk.to_string()));
        }

        let end_chunk = json!({
            "id": id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [
                { "index": 0, "delta": {}, "finish_reason": finish_reason }
            ]
        });
        yield Ok(Event::default().data(end_chunk.to_string()));
        yield Ok(Event::default().data("[DONE]"));
    };
    Sse::new(stream)
}

pub fn build_interactive_sse_stream(
    id: String,
    created: i64,
    model: String,
    fake_reasoning: Option<String>,
    reasoning_mode: ReasoningMode,
    reply_rx: tokio::sync::oneshot::Receiver<InteractiveReply>,
    timeout_ms: u64,
    fallback_text: String,
    chunk_size: usize,
    stream_first_delay_ms: u64,
    hub: Arc<InteractiveHub>,
    request_id: String,
) -> Sse<impl Stream<Item = Result<Event, Infallible>> + Send + 'static> {
    let stream = async_stream::stream! {
        let role_chunk = json!({
            "id": id.clone(),
            "object": "chat.completion.chunk",
            "created": created,
            "model": model.clone(),
            "choices": [
                { "index": 0, "delta": { "role": "assistant" }, "finish_reason": null }
            ]
        });
        yield Ok(Event::default().data(role_chunk.to_string()));

        if stream_first_delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(stream_first_delay_ms)).await;
        }

        if let Some(reasoning_text) = fake_reasoning {
            if matches!(reasoning_mode, ReasoningMode::Field) {
                for part in chunk_text(&reasoning_text, chunk_size) {
                    let chunk = json!({
                        "id": id.clone(),
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model.clone(),
                        "choices": [
                            { "index": 0, "delta": { "reasoning_content": part }, "finish_reason": null }
                        ]
                    });
                    yield Ok(Event::default().data(chunk.to_string()));
                }
            }
        }

        let reply = match tokio::time::timeout(Duration::from_millis(timeout_ms), reply_rx).await {
            Ok(Ok(reply)) => reply,
            _ => {
                hub.timeout(&request_id);
                InteractiveReply {
                    content: fallback_text,
                    reasoning: None,
                    finish_reason: Some("stop".to_string()),
                }
            }
        };
        let finish_reason = reply.finish_reason.unwrap_or_else(|| "stop".to_string());
        let (content_out, reasoning_field) = match (reply.reasoning, reasoning_mode) {
            (Some(r), ReasoningMode::Prefix) => {
                (format!("<think>{r}</think>\n{}", reply.content), None)
            }
            (Some(r), ReasoningMode::Field) => (reply.content, Some(r)),
            (_, ReasoningMode::None) => (reply.content, None),
            (None, _) => (reply.content, None),
        };

        if let Some(reasoning_text) = reasoning_field {
            for part in chunk_text(&reasoning_text, chunk_size) {
                let chunk = json!({
                    "id": id.clone(),
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model.clone(),
                    "choices": [
                        { "index": 0, "delta": { "reasoning_content": part }, "finish_reason": null }
                    ]
                });
                yield Ok(Event::default().data(chunk.to_string()));
            }
        }

        for part in chunk_text(&content_out, chunk_size) {
            let chunk = json!({
                "id": id.clone(),
                "object": "chat.completion.chunk",
                "created": created,
                "model": model.clone(),
                "choices": [
                    { "index": 0, "delta": { "content": part }, "finish_reason": null }
                ]
            });
            yield Ok(Event::default().data(chunk.to_string()));
        }

        let end_chunk = json!({
            "id": id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [
                { "index": 0, "delta": {}, "finish_reason": finish_reason }
            ]
        });
        yield Ok(Event::default().data(end_chunk.to_string()));
        yield Ok(Event::default().data("[DONE]"));
    };

    Sse::new(stream)
}

pub fn chunk_text(text: &str, chunk_size: usize) -> Vec<String> {
    if chunk_size == 0 {
        return vec![text.to_string()];
    }
    let mut out = Vec::new();
    let mut start = 0;
    let chars: Vec<char> = text.chars().collect();
    while start < chars.len() {
        let end = usize::min(start + chunk_size, chars.len());
        out.push(chars[start..end].iter().collect());
        start = end;
    }
    out
}
