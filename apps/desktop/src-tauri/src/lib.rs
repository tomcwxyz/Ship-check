mod engine;

use engine::{EngineStatus, ScanRequest};
use serde_json::Value;
use tauri::AppHandle;

#[tauri::command]
async fn choose_project() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choose a project to check")
            .pick_folder()
            .map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| format!("Could not open the project picker: {error}"))
}

#[tauri::command]
async fn engine_status(app: AppHandle) -> Result<EngineStatus, String> {
    tauri::async_runtime::spawn_blocking(move || engine::status(&app))
        .await
        .map_err(|error| format!("Could not inspect the Ship Check engine: {error}"))
}

#[tauri::command]
async fn scan_project(app: AppHandle, request: ScanRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || engine::scan(&app, request))
        .await
        .map_err(|error| format!("Ship Check scan task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            choose_project,
            engine_status,
            scan_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ship Check desktop");
}
