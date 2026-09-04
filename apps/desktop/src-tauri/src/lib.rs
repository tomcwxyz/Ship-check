mod engine;
mod repository;

use engine::{EngineStatus, ScanRequest};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubScanRequest {
    repository: String,
    git_ref: Option<String>,
    #[serde(default)]
    packs: Vec<String>,
}

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

#[tauri::command]
async fn scan_github_repository(
    app: AppHandle,
    request: GithubScanRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = repository::checkout_github_repository(
            &request.repository,
            request.git_ref.as_deref(),
        )?;
        let mut report = engine::scan(
            &app,
            ScanRequest {
                project_path: checkout.project_path.to_string_lossy().to_string(),
                packs: request.packs,
            },
        )?;

        if let Some(project) = report.get_mut("project").and_then(Value::as_object_mut) {
            project.insert("path".to_string(), Value::String(checkout.display_name.clone()));
        }
        Ok(report)
    })
    .await
    .map_err(|error| format!("GitHub repository scan task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            choose_project,
            engine_status,
            scan_project,
            scan_github_repository
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ship Check desktop");
}
