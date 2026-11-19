use tauri::{ipc::Request, ipc::Response, Manager, State};

struct AppCore(fixer_core::Core);

fn reply(r: anyhow::Result<fixer_core::Reply>) -> Result<Response, String> {
    match r {
        Ok(fixer_core::Reply::Bytes(b)) => Ok(Response::new(b)),
        Ok(fixer_core::Reply::Json(v)) => Ok(Response::new(v.to_string().into_bytes())),
        Err(e) => Err(format!("{e:#}")),
    }
}

/// JSON-argument commands. Runs on a worker thread (async command) so the UI never blocks.
#[tauri::command]
async fn call(core: State<'_, AppCore>, cmd: String, args: serde_json::Value) -> Result<Response, String> {
    reply(fixer_core::dispatch(&core.0, &cmd, &args, None))
}

/// Binary-payload commands (export tiles): body is raw bytes, cmd/args travel in headers.
#[tauri::command]
async fn call_raw(core: State<'_, AppCore>, request: Request<'_>) -> Result<Response, String> {
    let h = request.headers();
    let cmd = h.get("x-cmd").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let args: serde_json::Value = h
        .get("x-args")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let raw = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.as_slice(),
        _ => return Err("expected raw body".into()),
    };
    reply(fixer_core::dispatch(&core.0, &cmd, &args, Some(raw)))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let cache = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir().join("fixer-film-lab"));
            app.manage(AppCore(fixer_core::Core::new(cache)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call, call_raw])
        .run(tauri::generate_context!())
        .expect("error while running Fixer Film Lab");
}
