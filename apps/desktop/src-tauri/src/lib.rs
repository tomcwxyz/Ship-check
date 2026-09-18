mod engine;
mod repository;

use engine::{EngineStatus, ScanRequest};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubScanRequest {
    repository: String,
    git_ref: Option<String>,
    deployment_url: Option<String>,
    #[serde(default)]
    packs: Vec<String>,
    #[serde(default)]
    local_semgrep_scan: bool,
    #[serde(default)]
    networked_dependency_scan: bool,
    #[serde(default)]
    inspect_database: bool,
    database_connection_string: Option<String>,
    database_platform: Option<String>,
    database_table_limit: Option<u32>,
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
async fn choose_project_archive() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choose an exported project ZIP")
            .add_filter("Project ZIP", &["zip"])
            .pick_file()
            .map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| format!("Could not open the project ZIP picker: {error}"))
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
                deployment_url: request.deployment_url,
                packs: request.packs,
                local_semgrep_scan: request.local_semgrep_scan,
                networked_dependency_scan: request.networked_dependency_scan,
                inspect_database: request.inspect_database,
                database_connection_string: request.database_connection_string,
                database_platform: request.database_platform,
                database_table_limit: request.database_table_limit,
            },
        )?;

        if let Some(project) = report.get_mut("project").and_then(Value::as_object_mut) {
            project.insert("path".to_string(), Value::String(checkout.display_name.clone()));
            if let Some(snapshot) = project.get_mut("snapshot").and_then(Value::as_object_mut) {
                if let Some(source) = snapshot.get_mut("source").and_then(Value::as_object_mut) {
                    source.insert("provider".to_string(), Value::String("github".to_string()));
                    source.insert("label".to_string(), Value::String(checkout.display_name.clone()));
                    source.insert("acquisition".to_string(), Value::String("transient-checkout".to_string()));
                    source.insert("ephemeral".to_string(), Value::Bool(true));
                    source.insert("id".to_string(), Value::String(format!("github:{}", checkout.display_name)));
                }
            }
            if let Some(evidence_sources) = project.get_mut("evidenceSources").and_then(Value::as_array_mut) {
                if let Some(source) = evidence_sources.first_mut().and_then(Value::as_object_mut) {
                    source.insert("provider".to_string(), Value::String("github".to_string()));
                    source.insert("label".to_string(), Value::String(checkout.display_name.clone()));
                    source.insert("acquisition".to_string(), Value::String("transient-checkout".to_string()));
                    source.insert("ephemeral".to_string(), Value::Bool(true));
                    source.insert("id".to_string(), Value::String(format!("github:{}", checkout.display_name)));
                }
            }
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
            choose_project_archive,
            engine_status,
            scan_project,
            scan_github_repository
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ship Check desktop");
}
