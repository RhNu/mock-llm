use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, oneshot};

use crate::types::Message;

#[derive(Debug, Clone, Serialize)]
pub struct InteractiveRequest {
    pub id: String,
    pub model: String,
    pub messages: Vec<Message>,
    pub stream: bool,
    pub created: i64,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveReply {
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InteractiveEvent {
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<InteractiveRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug)]
struct PendingRequest {
    request: InteractiveRequest,
    reply_tx: oneshot::Sender<InteractiveReply>,
}

#[derive(Debug)]
pub struct InteractiveHub {
    pending: Mutex<HashMap<String, PendingRequest>>,
    sender: broadcast::Sender<InteractiveEvent>,
}

impl InteractiveHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(128);
        InteractiveHub {
            pending: Mutex::new(HashMap::new()),
            sender,
        }
    }

    pub fn enqueue(&self, request: InteractiveRequest) -> oneshot::Receiver<InteractiveReply> {
        let (reply_tx, reply_rx) = oneshot::channel();
        let mut pending = self
            .pending
            .lock()
            .expect("interactive pending lock poisoned");
        pending.insert(
            request.id.clone(),
            PendingRequest {
                request: request.clone(),
                reply_tx,
            },
        );
        let _ = self.sender.send(InteractiveEvent {
            r#type: "queued".to_string(),
            request: Some(request),
            id: None,
        });
        reply_rx
    }

    pub fn list(&self) -> Vec<InteractiveRequest> {
        let pending = self
            .pending
            .lock()
            .expect("interactive pending lock poisoned");
        pending.values().map(|item| item.request.clone()).collect()
    }

    pub fn reply(&self, id: &str, reply: InteractiveReply) -> bool {
        let pending = self
            .pending
            .lock()
            .expect("interactive pending lock poisoned")
            .remove(id);
        if let Some(pending) = pending {
            let _ = pending.reply_tx.send(reply);
            let _ = self.sender.send(InteractiveEvent {
                r#type: "replied".to_string(),
                request: None,
                id: Some(id.to_string()),
            });
            true
        } else {
            false
        }
    }

    pub fn timeout(&self, id: &str) -> bool {
        let pending = self
            .pending
            .lock()
            .expect("interactive pending lock poisoned")
            .remove(id);
        if pending.is_some() {
            let _ = self.sender.send(InteractiveEvent {
                r#type: "timeout".to_string(),
                request: None,
                id: Some(id.to_string()),
            });
            true
        } else {
            false
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<InteractiveEvent> {
        self.sender.subscribe()
    }
}
