use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use wait_timeout::ChildExt;

const GIT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GithubRepository {
    pub clone_url: String,
    pub display_name: String,
}

pub struct RepositoryCheckout {
    temporary_root: PathBuf,
    pub project_path: PathBuf,
    pub display_name: String,
}

impl Drop for RepositoryCheckout {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temporary_root);
    }
}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
}

fn from_slug(slug: &str, ssh: bool) -> Result<GithubRepository, String> {
    let parts = slug.split('/').collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err(
            "Use a GitHub repository such as owner/repository or https://github.com/owner/repository."
                .to_string(),
        );
    }
    let owner = parts[0];
    let repository = parts[1].strip_suffix(".git").unwrap_or(parts[1]);
    if !valid_name(owner) || !valid_name(repository) {
        return Err("GitHub repository names must use owner/repository.".to_string());
    }

    let display_name = format!("https://github.com/{owner}/{repository}");
    let clone_url = if ssh {
        format!("git@github.com:{owner}/{repository}.git")
    } else {
        format!("https://github.com/{owner}/{repository}.git")
    };
    Ok(GithubRepository {
        clone_url,
        display_name,
    })
}

pub fn parse_github_repository(value: &str) -> Result<Option<GithubRepository>, String> {
    let input = value.trim();
    if input.is_empty() {
        return Ok(None);
    }

    if let Some(slug) = input.strip_prefix("git@github.com:") {
        return from_slug(slug, true).map(Some);
    }

    if let Some(slug) = input.strip_prefix("ssh://git@github.com/") {
        let mut parsed = from_slug(slug, true)?;
        parsed.clone_url = format!("ssh://git@github.com/{slug}");
        if !parsed.clone_url.ends_with(".git") {
            parsed.clone_url.push_str(".git");
        }
        return Ok(Some(parsed));
    }

    if input.starts_with("https://") && input.contains("github.com") {
        let Some(slug) = input.strip_prefix("https://github.com/") else {
            return Err("Do not put credentials or access tokens in a GitHub repository URL.".to_string());
        };
        return from_slug(slug.trim_end_matches('/'), false).map(Some);
    }

    if input.contains("://") || input.starts_with("git@") {
        return Ok(None);
    }

    if input.split('/').count() == 2 {
        return from_slug(input, false).map(Some);
    }

    Ok(None)
}

fn validate_ref(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 200
        || value.starts_with('-')
        || value.chars().any(|character| matches!(character, '\r' | '\n' | '\0'))
    {
        return Err("The Git ref is not safe to pass to git.".to_string());
    }
    Ok(Some(value.to_string()))
}

fn temporary_root() -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "ship-check-repo-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir(&root)
        .map_err(|error| format!("Could not prepare a temporary repository checkout: {error}"))?;
    Ok(root)
}

fn clone_repository(repository: &GithubRepository, git_ref: Option<&str>, destination: &Path) -> Result<(), String> {
    let git_ref = validate_ref(git_ref)?;
    let mut command = Command::new("git");
    command
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg("--single-branch");
    if let Some(git_ref) = &git_ref {
        command.arg("--branch").arg(git_ref);
    }
    command
        .arg(&repository.clone_url)
        .arg(destination)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start git. Install Git and make sure it is available to Ship Check: {error}"
        )
    })?;

    let status = child
        .wait_timeout(GIT_TIMEOUT)
        .map_err(|error| format!("Could not wait for git clone: {error}"))?;
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "Cloning {} took longer than two minutes, so Ship Check stopped it.",
            repository.display_name
        ));
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not read git clone output: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Git could not clone {}.", repository.display_name)
        } else {
            format!("Git could not clone {}: {stderr}", repository.display_name)
        });
    }
    Ok(())
}

pub fn checkout_github_repository(value: &str, git_ref: Option<&str>) -> Result<RepositoryCheckout, String> {
    let repository = parse_github_repository(value)?.ok_or_else(|| {
        "Use owner/repository or a github.com repository URL for a GitHub scan.".to_string()
    })?;
    let temporary_root = temporary_root()?;
    let project_path = temporary_root.join("repository");

    if let Err(error) = clone_repository(&repository, git_ref, &project_path) {
        let _ = fs::remove_dir_all(&temporary_root);
        return Err(error);
    }

    let display_name = match validate_ref(git_ref)? {
        Some(git_ref) => format!("{}#{git_ref}", repository.display_name),
        None => repository.display_name,
    };

    Ok(RepositoryCheckout {
        temporary_root,
        project_path,
        display_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_slug() {
        assert_eq!(
            parse_github_repository("openai/openai").expect("parse"),
            Some(GithubRepository {
                clone_url: "https://github.com/openai/openai.git".to_string(),
                display_name: "https://github.com/openai/openai".to_string(),
            })
        );
    }

    #[test]
    fn parses_https() {
        assert_eq!(
            parse_github_repository("https://github.com/openai/openai.git").expect("parse"),
            Some(GithubRepository {
                clone_url: "https://github.com/openai/openai.git".to_string(),
                display_name: "https://github.com/openai/openai".to_string(),
            })
        );
    }

    #[test]
    fn parses_ssh() {
        assert_eq!(
            parse_github_repository("git@github.com:openai/openai.git").expect("parse"),
            Some(GithubRepository {
                clone_url: "git@github.com:openai/openai.git".to_string(),
                display_name: "https://github.com/openai/openai".to_string(),
            })
        );
    }

    #[test]
    fn rejects_embedded_credentials() {
        let error = parse_github_repository("https://token@github.com/openai/openai")
            .expect_err("reject credentials");
        assert!(error.contains("credentials or access tokens"));
    }

    #[test]
    fn rejects_github_web_subpaths() {
        let error = parse_github_repository("https://github.com/openai/openai/tree/main")
            .expect_err("reject path");
        assert!(error.contains("GitHub repository"));
    }

    #[test]
    fn validates_refs() {
        assert_eq!(validate_ref(Some("feature/repo-mode")).expect("ref"), Some("feature/repo-mode".to_string()));
        assert!(validate_ref(Some("--upload-pack=bad")).is_err());
    }
}
