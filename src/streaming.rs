use std::convert::Infallible;

use axum::response::sse::{Event, Sse};
use serde_json::json;
use tokio_stream::Stream;

use crate::config::ReasoningMode;

pub fn build_sse_stream(
    id: String,
    created: i64,
    model: String,
    content: String,
    reasoning: Option<String>,
    finish_reason: String,
    reasoning_mode: ReasoningMode,
    chunk_size: usize,
) -> Sse<impl Stream<Item = Result<Event, Infallible>> + Send + 'static> {
    let mut events: Vec<Result<Event, Infallible>> = Vec::new();

    let role_chunk = json!({
        "id": id.clone(),
        "object": "chat.completion.chunk",
        "created": created,
        "model": model.clone(),
        "choices": [
            { "index": 0, "delta": { "role": "assistant" }, "finish_reason": null }
        ]
    });
    events.push(Ok(Event::default().data(role_chunk.to_string())));

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
        events.push(Ok(Event::default().data(chunk.to_string())));
    }

    if let Some(reasoning_text) = reasoning {
        if matches!(reasoning_mode, ReasoningMode::Field | ReasoningMode::Both) {
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
                events.push(Ok(Event::default().data(chunk.to_string())));
            }
        }
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
    events.push(Ok(Event::default().data(end_chunk.to_string())));
    events.push(Ok(Event::default().data("[DONE]")));

    let stream = tokio_stream::iter(events);
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
