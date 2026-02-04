use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use rquickjs::loader::{FileResolver, ScriptLoader};
use rquickjs::{Context, Function, Module, Persistent, Runtime, Value};
use rquickjs_serde::{from_value, to_value};
use tokio::sync::oneshot;
use tracing::{error, info};

use crate::error::AppError;
use crate::types::{ScriptInput, ScriptOutput};

pub struct ScriptEngineHandle {
    sender: mpsc::SyncSender<ScriptTask>,
    timeout_ms: u64,
}

struct ScriptTask {
    input: ScriptInput,
    resp: oneshot::Sender<Result<ScriptOutput, AppError>>,
}

struct ScriptEngine {
    _runtime: Runtime,
    context: Context,
    handle: Persistent<Function<'static>>,
}

impl ScriptEngine {
    fn new(script_path: &Path, init_path: Option<&Path>) -> Result<Self, AppError> {
        let runtime = Runtime::new()
            .map_err(|e| AppError::internal(format!("quickjs runtime init failed: {e}")))?;

        let resolver = FileResolver::default();
        let loader = ScriptLoader::default();
        runtime.set_loader(resolver, loader);

        let context = Context::full(&runtime)
            .map_err(|e| AppError::internal(format!("quickjs context init failed: {e}")))?;

        if let Some(init_script_path) = init_path {
            let init_source = std::fs::read_to_string(init_script_path)
                .map_err(|e| AppError::internal(format!("read init script failed: {e}")))?;
            let init_name = relative_module_name(init_script_path);
            context.with(|ctx| {
                let promise = Module::evaluate(ctx.clone(), init_name, init_source)
                    .map_err(|e| AppError::internal(format!("init module compile failed: {e}")))?;
                promise
                    .finish::<()>()
                    .map_err(|e| AppError::internal(format!("init module eval failed: {e}")))?;
                Ok::<(), AppError>(())
            })?;
        }

        let script_source = std::fs::read_to_string(script_path)
            .map_err(|e| AppError::internal(format!("read script failed: {e}")))?;
        let module_name = relative_module_name(script_path);
        let module_name_log = module_name.clone();
        let looks_es = looks_like_es_module(&script_source);
        let script_source_fallback = script_source.clone();

        info!(
            "loading script: path={}, module={}",
            script_path.display(),
            module_name_log
        );

        let handle = context.with(|ctx| {
            let module = Module::declare(ctx.clone(), module_name.clone(), script_source)
                .map_err(|e| AppError::internal(format!("module declare failed: {e}")))?;
            let (module, promise) = module
                .eval()
                .map_err(|e| AppError::internal(format!("module eval failed: {e}")))?;
            promise
                .finish::<()>()
                .map_err(|e| AppError::internal(format!("module eval failed: {e}")))?;

            match module.get::<_, Function>("handle") {
                Ok(func) => Ok(Persistent::save(&ctx, func)),
                Err(err) => {
                    let exported = module
                        .namespace()
                        .ok()
                        .and_then(|ns| {
                            ns.keys::<String>()
                                .collect::<rquickjs::Result<Vec<String>>>()
                                .ok()
                        })
                        .unwrap_or_default();
                    error!(
                        "missing export handle: {}, exports={:?}, path={}",
                        err,
                        exported,
                        script_path.display()
                    );

                    // Optional fallback for legacy scripts without ES module exports.
                    if !looks_es {
                        if let Err(eval_err) = ctx.eval::<(), _>(script_source_fallback.clone()) {
                            error!("legacy script eval failed: {}", eval_err);
                        } else if let Ok(func) = ctx.globals().get::<_, Function>("handle") {
                            info!("using global handle() fallback");
                            return Ok(Persistent::save(&ctx, func));
                        }
                    }

                    Err(AppError::internal(format!(
                        "missing export handle: {err}. expected: `export function handle(input) {{ ... }}`"
                    )))
                }
            }
        })?;

        Ok(ScriptEngine {
            _runtime: runtime,
            context,
            handle,
        })
    }

    fn call(&self, input: ScriptInput) -> Result<ScriptOutput, AppError> {
        self.context.with(|ctx| {
            let func = self
                .handle
                .clone()
                .restore(&ctx)
                .map_err(|e| AppError::internal(format!("restore handle failed: {e}")))?;
            let arg: Value = to_value(ctx, &input)
                .map_err(|e| AppError::internal(format!("serialize input failed: {e}")))?;
            let value: Value = func
                .call((arg,))
                .map_err(|e| AppError::internal(format!("script execution failed: {e}")))?;
            let output: ScriptOutput = from_value(value)
                .map_err(|e| AppError::internal(format!("decode output failed: {e}")))?;
            Ok(output)
        })
    }
}

fn relative_module_name(script_path: &Path) -> String {
    if let Ok(cwd) = std::env::current_dir() {
        if let Ok(rel) = script_path.strip_prefix(cwd) {
            return normalize_module_path(rel.to_string_lossy().as_ref());
        }
    }
    normalize_module_path(script_path.to_string_lossy().as_ref())
}

fn normalize_module_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn looks_like_es_module(source: &str) -> bool {
    // Best-effort check to avoid evaluating module code as a classic script.
    for line in source.lines() {
        let line = line.trim_start();
        if line.starts_with("//") || line.starts_with("/*") {
            continue;
        }
        if line.starts_with("export") || line.starts_with("import") {
            return true;
        }
    }
    false
}

pub fn start_engine(
    script_path: PathBuf,
    init_path: Option<PathBuf>,
    timeout_ms: u64,
) -> Result<ScriptEngineHandle, AppError> {
    let (sender, receiver) = mpsc::sync_channel::<ScriptTask>(64);
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), AppError>>();

    thread::spawn(move || {
        let engine = match ScriptEngine::new(&script_path, init_path.as_deref()) {
            Ok(engine) => {
                let _ = ready_tx.send(Ok(()));
                engine
            }
            Err(err) => {
                error!(
                    "script engine init failed: {:?} (path={})",
                    err,
                    script_path.display()
                );
                let _ = ready_tx.send(Err(err));
                return;
            }
        };
        for task in receiver {
            let result = engine.call(task.input);
            let _ = task.resp.send(result);
        }
    });

    ready_rx
        .recv()
        .map_err(|_| AppError::internal("script engine init failed"))??;

    Ok(ScriptEngineHandle { sender, timeout_ms })
}

pub async fn run_script(
    handle: &ScriptEngineHandle,
    input: ScriptInput,
) -> Result<ScriptOutput, AppError> {
    let (resp_tx, resp_rx) = oneshot::channel();
    handle
        .sender
        .send(ScriptTask {
            input,
            resp: resp_tx,
        })
        .map_err(|_| AppError::internal("script queue closed"))?;

    let result = tokio::time::timeout(Duration::from_millis(handle.timeout_ms), resp_rx)
        .await
        .map_err(|_| AppError::internal("script timeout"))?;

    match result {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(err)) => Err(err),
        Err(_) => Err(AppError::internal("script response dropped")),
    }
}
