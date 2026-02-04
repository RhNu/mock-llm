use std::time::Instant;

use crate::kernel::KernelHandle;

#[derive(Clone)]
pub struct AppState {
    pub kernel: KernelHandle,
    pub started_at: Instant,
}

impl AppState {
    pub fn new(kernel: KernelHandle) -> Self {
        AppState {
            kernel,
            started_at: Instant::now(),
        }
    }
}
