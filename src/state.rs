use std::sync::Arc;
use std::time::Instant;

use crate::kernel::KernelHandle;
use crate::interactive::InteractiveHub;

#[derive(Clone)]
pub struct AppState {
    pub kernel: KernelHandle,
    pub started_at: Instant,
    pub interactive: Arc<InteractiveHub>,
}

impl AppState {
    pub fn new(kernel: KernelHandle, interactive: Arc<InteractiveHub>) -> Self {
        AppState {
            kernel,
            started_at: Instant::now(),
            interactive,
        }
    }
}
