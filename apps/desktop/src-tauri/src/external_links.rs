use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// External URLs are deliberately fixed to known Ship Check Cloud pages.
// The desktop does not let scan results, repository content, or the webview
// choose an arbitrary browser destination.
pub(crate) const CLOUD_DASHBOARD: &str = "https://cloud-check.good-ship.co.uk/dashboard";
const PROJECT_PREFIX: &str = "https://cloud-check.good-ship.co.uk/dashboard/projects/";

fn uuid_shape(id: &str) -> bool {
    let b = id.as_bytes();
    b.len() == 36 && b.iter().enumerate().all(|(i, c)| {
        if [8, 13, 18, 23].contains(&i) {
            *c == b'-'
        } else {
            c.is_ascii_hexdigit()
        }
    })
}

pub(crate) fn allowed_cloud_url(url: &str) -> bool {
    url == CLOUD_DASHBOARD ||
        url.strip_prefix(PROJECT_PREFIX).is_some_and(uuid_shape)
}

pub(crate) fn open_cloud_url(app: &AppHandle, url: String) -> Result<(), String> {
    if !allowed_cloud_url(&url) {
        return Err("This Cloud link is not allowed. Only the Cloud dashboard and project histories can be opened.".to_owned());
    }
    // Opens the system default browser. This plugin is called only from a
    // user-initiated command with an explicit URL allowlist, not generic links.
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open the default browser. Copy the Cloud dashboard link and open it manually.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_dashboard_and_real_project_path() {
        assert!(allowed_cloud_url(CLOUD_DASHBOARD));
        assert!(allowed_cloud_url(
            "https://cloud-check.good-ship.co.uk/dashboard/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        ));
    }

    #[test]
    fn rejects_credentials_query_fragments_lookalike_hosts_and_unsafe_schemes() {
        for url in [
            "http://cloud-check.good-ship.co.uk/dashboard",
            "https://cloud-check.good-ship.co.uk.evil.test/dashboard",
            "https://evil.test/dashboard",
            "https://cloud-check.good-ship.co.uk/dashboard?redirect=https://evil.test",
            "https://cloud-check.good-ship.co.uk/dashboard#fragment",
            "https://cloud-check.good-ship.co.uk/dashboard/projects/not-a-uuid",
            "https://cloud-check.good-ship.co.uk/dashboard/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?next=https://evil.test",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://cloud-check.good-ship.co.uk@evil.test/dashboard",
        ] {
            assert!(!allowed_cloud_url(url), "must reject {url}");
        }
    }
}
