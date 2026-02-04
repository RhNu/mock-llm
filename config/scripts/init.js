// Initialization script executed once when the script engine starts.
// Use globalThis to share values with the main module.
globalThis._mockInit = { startedAt: Date.now() };
