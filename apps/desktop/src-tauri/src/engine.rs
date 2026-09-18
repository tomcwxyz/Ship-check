use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

const ENGINE_ENV: &str = "SHIP_CHECK_ENGINE_PATH";
const DESKTOP_DATABASE_ENV: &str = "SHIP_CHECK_DESKTOP_DATABASE_URL";
const ALLOWED_PACKS: [&str; 3] = ["secure-build", "production-ready", "cost-aware"];
const ALLOWED_DATABASE_PLATFORMS: [&str; 3] = ["postgres", "supabase", "neon"];
const DEFAULT_DATABASE_TABLE_LIMIT: u32 = 1000;
const MAX_DATABASE_TABLE_LIMIT: u32 = 5000;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub project_path: String,
    pub deployment_url: Option<String>,
    #[serde(default)]
    pub packs: Vec<String>,
    #[serde(default)]
    pub local_semgrep_scan: bool,
    #[serde(default)]
    pub networked_dependency_scan: bool,
    #[serde(default)]
    pub inspect_database: bool,
    pub database_connection_string: Option<String>,
    pub database_platform: Option<String>,
    pub database_table_limit: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

struct DatabaseInspection {
    connection_string: String,
    platform: String,
    table_limit: u32,
}

fn engine_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "ship-check-engine.exe"
    } else {
        "ship-check-engine"
    }
}

fn push_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn engine_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(configured) = env::var(ENGINE_ENV) {
        let configured = configured.trim();
        if !configured.is_empty() {
            push_candidate(&mut candidates, PathBuf::from(configured));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        push_candidate(&mut candidates, resource_dir.join(engine_filename()));
        push_candidate(
            &mut candidates,
            resource_dir.join("resources").join(engine_filename()),
        );
    }

    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            push_candidate(&mut candidates, parent.join(engine_filename()));
            push_candidate(
                &mut candidates,
                parent.join("resources").join(engine_filename()),
            );
        }
    }

    let development_engine = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../dist")
        .join(if cfg!(target_os = "windows") {
            "ship-check.exe"
        } else {
            "ship-check"
        });
    push_candidate(&mut candidates, development_engine);

    candidates
}

fn locate_engine(app: &AppHandle) -> Result<PathBuf, String> {
    let candidates = engine_candidates(app);
    for candidate in &candidates {
        if candidate.is_file() {
            return fs::canonicalize(candidate).map_err(|error| {
                format!(
                    "Found the Ship Check engine at {} but could not resolve it: {error}",
                    candidate.display()
                )
            });
        }
    }

    let searched = candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join("; ");
    Err(format!(
        "Ship Check's local engine is not available. Searched: {searched}. For development you can set {ENGINE_ENV}."
    ))
}

fn looks_like_runtime_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn validated_source(project_path: &str) -> Result<String, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("Choose a project source before running Ship Check.".to_string());
    }

    if looks_like_runtime_url(trimmed) {
        return Ok(trimmed.to_string());
    }

    let source = fs::canonicalize(trimmed)
        .map_err(|error| format!("Could not open the selected project source: {error}"))?;
    let metadata = fs::metadata(&source)
        .map_err(|error| format!("Could not inspect the selected project source: {error}"))?;

    if metadata.is_dir() {
        return Ok(source.to_string_lossy().to_string());
    }

    if metadata.is_file()
        && source
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Ok(source.to_string_lossy().to_string());
    }

    Err("Ship Check desktop sources must be a project folder, project ZIP export, or http(s) deployment URL.".to_string())
}

fn validated_deployment_url(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !looks_like_runtime_url(trimmed) {
        return Err("The live deployment must use an http:// or https:// URL.".to_string());
    }
    Ok(Some(trimmed.to_string()))
}

fn validated_packs(packs: &[String]) -> Result<Vec<String>, String> {
    if packs.is_empty() {
        return Ok(ALLOWED_PACKS.iter().map(|pack| (*pack).to_string()).collect());
    }

    let mut output = Vec::new();
    for pack in packs {
        if !ALLOWED_PACKS.contains(&pack.as_str()) {
            return Err(format!("Unknown Ship Check pack: {pack}"));
        }
        if !output.contains(pack) {
            output.push(pack.clone());
        }
    }
    Ok(output)
}

fn validated_database_inspection(
    request: &ScanRequest,
    packs: &[String],
) -> Result<Option<DatabaseInspection>, String> {
    let has_database_options = request.database_connection_string.as_ref().is_some_and(|value| !value.trim().is_empty())
        || request.database_platform.as_ref().is_some_and(|value| !value.trim().is_empty())
        || request.database_table_limit.is_some();

    if !request.inspect_database {
        if has_database_options {
            return Err("Database connection settings require explicit database inspection consent.".to_string());
        }
        return Ok(None);
    }

    if !packs.iter().any(|pack| pack == "production-ready") {
        return Err("Database metadata inspection requires the Production Ready pack.".to_string());
    }

    let connection_string = request
        .database_connection_string
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Enter a PostgreSQL connection URL for this database inspection.".to_string())?
        .to_string();
    let lower = connection_string.to_ascii_lowercase();
    if !lower.starts_with("postgres://") && !lower.starts_with("postgresql://") {
        return Err("Database inspection requires a postgres:// or postgresql:// connection URL.".to_string());
    }

    let platform = request
        .database_platform
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("postgres");
    if !ALLOWED_DATABASE_PLATFORMS.contains(&platform) {
        return Err(format!("Unknown database platform: {platform}"));
    }

    let table_limit = request.database_table_limit.unwrap_or(DEFAULT_DATABASE_TABLE_LIMIT);
    if table_limit == 0 || table_limit > MAX_DATABASE_TABLE_LIMIT {
        return Err(format!(
            "Database metadata table limit must be between 1 and {MAX_DATABASE_TABLE_LIMIT}."
        ));
    }

    Ok(Some(DatabaseInspection {
        connection_string,
        platform: platform.to_string(),
        table_limit,
    }))
}

fn engine_version(engine: &Path) -> Result<String, String> {
    let output = Command::new(engine)
        .arg("--version")
        .output()
        .map_err(|error| format!("Could not start the Ship Check engine: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Ship Check engine exited with {}.", output.status)
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn redact_database_connection(message: &str, database: Option<&DatabaseInspection>) -> String {
    match database {
        Some(database) => message.replace(&database.connection_string, "[redacted-database-url]"),
        None => message.to_string(),
    }
}

pub fn status(app: &AppHandle) -> EngineStatus {
    match locate_engine(app) {
        Ok(engine) => match engine_version(&engine) {
            Ok(version) => EngineStatus {
                available: true,
                path: Some(engine.display().to_string()),
                version: Some(version),
                message: "Local engine ready.".to_string(),
            },
            Err(error) => EngineStatus {
                available: false,
                path: Some(engine.display().to_string()),
                version: None,
                message: error,
            },
        },
        Err(error) => EngineStatus {
            available: false,
            path: None,
            version: None,
            message: error,
        },
    }
}

pub fn scan(app: &AppHandle, request: ScanRequest) -> Result<Value, String> {
    let engine = locate_engine(app)?;
    let source = validated_source(&request.project_path)?;
    let deployment_url = validated_deployment_url(request.deployment_url.as_deref())?;
    let packs = validated_packs(&request.packs)?;
    let database = validated_database_inspection(&request, &packs)?;
    let runtime_only = looks_like_runtime_url(&source);

    if runtime_only && deployment_url.is_some() {
        return Err("Choose either a live site as the primary source or add a live deployment to source code, not both.".to_string());
    }
    if request.local_semgrep_scan && !packs.iter().any(|pack| pack == "secure-build") {
        return Err("Local Semgrep scanning requires the Secure Build pack.".to_string());
    }
    if request.networked_dependency_scan && !packs.iter().any(|pack| pack == "production-ready") {
        return Err("Networked dependency scanning requires the Production Ready pack.".to_string());
    }
    if runtime_only && (request.local_semgrep_scan || request.networked_dependency_scan) {
        return Err("Deep source checks need source files and are unavailable for a live-site-only review.".to_string());
    }

    let mut command = Command::new(&engine);
    command
        .arg("scan")
        .arg(&source)
        .arg("--format")
        .arg("json")
        .arg("--fail-on")
        .arg("never");

    for pack in packs {
        command.arg("--pack").arg(pack);
    }
    if let Some(deployment_url) = deployment_url {
        command.arg("--deployment-url").arg(deployment_url);
    }
    if request.local_semgrep_scan {
        command.arg("--local-semgrep-scan");
    }
    if request.networked_dependency_scan {
        command.arg("--networked-dependency-scan");
    }
    if let Some(database) = database.as_ref() {
        command
            .env(DESKTOP_DATABASE_ENV, &database.connection_string)
            .arg("--inspect-database")
            .arg("--database-url-env")
            .arg(DESKTOP_DATABASE_ENV)
            .arg("--database-platform")
            .arg(&database.platform)
            .arg("--database-table-limit")
            .arg(database.table_limit.to_string());
    }

    let output = command
        .output()
        .map_err(|error| format!("Could not start the Ship Check engine: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Ship Check engine exited with {}.", output.status)
        } else {
            redact_database_connection(&stderr, database.as_ref())
        });
    }

    serde_json::from_slice::<Value>(&output.stdout).map_err(|error| {
        format!(
            "Ship Check returned an invalid report: {error}. The desktop and engine versions may not match."
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ScanRequest {
        ScanRequest {
            project_path: "https://example.com".to_string(),
            deployment_url: None,
            packs: vec!["production-ready".to_string()],
            local_semgrep_scan: false,
            networked_dependency_scan: false,
            inspect_database: false,
            database_connection_string: None,
            database_platform: None,
            database_table_limit: None,
        }
    }

    #[test]
    fn defaults_to_all_packs() {
        assert_eq!(
            validated_packs(&[]).expect("packs"),
            vec!["secure-build", "production-ready", "cost-aware"]
        );
    }

    #[test]
    fn rejects_unknown_pack_names() {
        let error = validated_packs(&["run-anything".to_string()]).expect_err("reject");
        assert!(error.contains("Unknown Ship Check pack"));
    }

    #[test]
    fn removes_duplicate_pack_names() {
        assert_eq!(
            validated_packs(&[
                "cost-aware".to_string(),
                "cost-aware".to_string(),
                "secure-build".to_string(),
            ])
            .expect("packs"),
            vec!["cost-aware", "secure-build"]
        );
    }

    #[test]
    fn accepts_runtime_urls_without_filesystem_canonicalisation() {
        assert_eq!(
            validated_source("https://example.com/app").expect("url"),
            "https://example.com/app"
        );
    }

    #[test]
    fn rejects_non_http_deployment_urls() {
        let error = validated_deployment_url(Some("ftp://example.com"))
            .expect_err("reject non-http deployment");
        assert!(error.contains("http:// or https://"));
    }

    #[test]
    fn database_inspection_is_explicit_and_requires_production_ready() {
        let mut value = request();
        value.database_connection_string = Some("postgresql://reader:secret@example.com/app".to_string());
        let error = validated_database_inspection(&value, &value.packs)
            .err()
            .expect("explicit consent");
        assert!(error.contains("explicit database inspection consent"));

        value.inspect_database = true;
        value.packs = vec!["secure-build".to_string()];
        let error = validated_database_inspection(&value, &value.packs)
            .err()
            .expect("production ready");
        assert!(error.contains("Production Ready"));
    }

    #[test]
    fn database_inspection_validates_provider_and_bound_without_exposing_secret() {
        let mut value = request();
        value.inspect_database = true;
        value.database_connection_string = Some("postgresql://reader:very-secret@example.com/app".to_string());
        value.database_platform = Some("supabase".to_string());
        value.database_table_limit = Some(250);
        let database = validated_database_inspection(&value, &value.packs)
            .expect("database")
            .expect("enabled");
        assert_eq!(database.platform, "supabase");
        assert_eq!(database.table_limit, 250);
        assert!(!redact_database_connection(
            "failed postgresql://reader:very-secret@example.com/app",
            Some(&database)
        )
        .contains("very-secret"));
    }
}
