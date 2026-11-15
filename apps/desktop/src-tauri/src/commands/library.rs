use super::fs::ProjectState;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

const PAPERS_DIRECTORY: &str = "papers";
const PDF_LIMIT: u64 = 128 * 1024 * 1024;
const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
const LOOKUP_HOSTS: [&str; 2] = ["api.crossref.org", "export.arxiv.org"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPaper {
    pub relative_path: String,
}

fn project_relative(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn safe_stem(source: &Path) -> String {
    let stem: String = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .take(80)
        .collect();
    let stem = stem.trim_matches(|character| character == '-' || character == '.');
    if stem.is_empty() {
        "paper".into()
    } else {
        stem.into()
    }
}

/// Copies a user-selected PDF into `papers/`; PDFs already in the project stay in place.
fn import_pdf(project: &str, expected_project: &str, source: &str) -> Result<ImportedPaper, String> {
    use std::io::{Read, Write};
    let root = std::fs::canonicalize(project).map_err(|error| error.to_string())?;
    if root != std::fs::canonicalize(expected_project).map_err(|error| error.to_string())? {
        return Err("LIBRARY_PROJECT_CHANGED".into());
    }
    let source =
        std::fs::canonicalize(source).map_err(|_| "LIBRARY_SOURCE_UNAVAILABLE".to_string())?;
    let metadata = std::fs::metadata(&source).map_err(|error| error.to_string())?;
    if !metadata.is_file()
        || metadata.len() > PDF_LIMIT
        || !source
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("LIBRARY_INVALID_PDF".into());
    }
    let mut input = std::fs::File::open(&source).map_err(|error| error.to_string())?;
    let mut magic = [0u8; 5];
    if input.read_exact(&mut magic).is_err() || &magic != b"%PDF-" {
        return Err("LIBRARY_INVALID_PDF".into());
    }
    if let Ok(relative) = source.strip_prefix(&root) {
        return Ok(ImportedPaper {
            relative_path: project_relative(relative),
        });
    }

    let directory = root.join(PAPERS_DIRECTORY);
    match std::fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("LIBRARY_UNSAFE_DIRECTORY".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }
    let stem = safe_stem(&source);
    for index in 0..1000 {
        let filename = if index == 0 {
            format!("{stem}.pdf")
        } else {
            format!("{stem}-{index}.pdf")
        };
        let target = directory.join(&filename);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut output) => {
                let copied = output
                    .write_all(&magic)
                    .and_then(|_| std::io::copy(&mut (&mut input).take(PDF_LIMIT), &mut output))
                    .and_then(|_| output.sync_all());
                if let Err(error) = copied {
                    let _ = std::fs::remove_file(&target);
                    return Err(error.to_string());
                }
                return Ok(ImportedPaper {
                    relative_path: format!("{PAPERS_DIRECTORY}/{filename}"),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("LIBRARY_NAME_UNAVAILABLE".into())
}

#[tauri::command]
pub async fn library_import_pdf(
    state: tauri::State<'_, Mutex<ProjectState>>,
    source_path: String,
    expected_project: String,
) -> Result<ImportedPaper, String> {
    let project = state
        .lock()
        .map_err(|error| error.to_string())?
        .project_path
        .clone()
        .ok_or_else(|| "No project open".to_string())?;
    tokio::task::spawn_blocking(move || import_pdf(&project, &expected_project, &source_path))
        .await
        .map_err(|error| error.to_string())?
}

/// Builds the request for a fixed public metadata service; callers never supply a URL.
fn lookup_url(source: &str, query: &str) -> Result<url::Url, String> {
    let query = query.trim();
    if query.is_empty() || query.len() > 512 || query.chars().any(char::is_control) {
        return Err("LIBRARY_INVALID_QUERY".into());
    }
    let url = match source {
        "crossref-doi" => {
            let mut url = url::Url::parse("https://api.crossref.org/works")
                .map_err(|error| error.to_string())?;
            url.path_segments_mut()
                .map_err(|_| "LIBRARY_INVALID_QUERY".to_string())?
                .push(query);
            Ok(url)
        }
        "crossref-title" => url::Url::parse_with_params(
            "https://api.crossref.org/works",
            &[("query.bibliographic", query), ("rows", "5")],
        ),
        "arxiv-id" => url::Url::parse_with_params(
            "https://export.arxiv.org/api/query",
            &[("id_list", query), ("max_results", "1")],
        ),
        "arxiv-title" => {
            let phrase = format!("ti:\"{}\"", query.replace('"', " "));
            url::Url::parse_with_params(
                "https://export.arxiv.org/api/query",
                &[("search_query", phrase.as_str()), ("max_results", "5")],
            )
        }
        _ => return Err("LIBRARY_INVALID_QUERY".into()),
    };
    url.map_err(|error| error.to_string())
}

fn trusted_lookup_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| LOOKUP_HOSTS.contains(&host))
}

/// Fetches bibliographic metadata from Crossref or arXiv and returns the raw response body.
#[tauri::command]
pub async fn library_lookup(source: String, query: String) -> Result<String, String> {
    let url = lookup_url(&source, &query)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("Inkwell/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 3 && trusted_lookup_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Metadata lookup left the trusted hosts.")
            }
        }))
        .build()
        .map_err(|_| "LIBRARY_LOOKUP_FAILED".to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "LIBRARY_LOOKUP_FAILED".to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("LIBRARY_NOT_FOUND".into());
    }
    if !response.status().is_success() {
        return Err("LIBRARY_LOOKUP_FAILED".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "LIBRARY_LOOKUP_FAILED".to_string())?
    {
        if body.len() + chunk.len() > RESPONSE_LIMIT {
            return Err("LIBRARY_LOOKUP_FAILED".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "LIBRARY_LOOKUP_FAILED".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_urls_use_fixed_hosts_and_encode_queries() {
        let doi = lookup_url("crossref-doi", " 10.1000/a b ").unwrap();
        assert_eq!(doi.as_str(), "https://api.crossref.org/works/10.1000%2Fa%20b");
        let arxiv = lookup_url("arxiv-id", "1706.03762").unwrap();
        assert_eq!(arxiv.host_str(), Some("export.arxiv.org"));
        assert!(trusted_lookup_url(&doi) && trusted_lookup_url(&arxiv));
        assert!(lookup_url("https://example.com", "x").is_err());
        assert!(lookup_url("crossref-title", "").is_err());
        assert!(!trusted_lookup_url(&url::Url::parse("http://api.crossref.org/").unwrap()));
    }

    #[test]
    fn imports_external_pdfs_with_unique_names() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = project.path().to_str().unwrap();
        let source = outside.path().join("My Paper (v2).pdf");
        std::fs::write(&source, b"%PDF-1.7 body").unwrap();
        let source = source.to_str().unwrap();

        let first = import_pdf(root, root, source).unwrap();
        let second = import_pdf(root, root, source).unwrap();
        assert_eq!(first.relative_path, "papers/My-Paper--v2.pdf");
        assert_eq!(second.relative_path, "papers/My-Paper--v2-1.pdf");
        assert_eq!(
            std::fs::read(project.path().join(&first.relative_path)).unwrap(),
            b"%PDF-1.7 body"
        );

        let inside = project.path().join(&first.relative_path);
        let existing = import_pdf(root, root, inside.to_str().unwrap()).unwrap();
        assert_eq!(existing.relative_path, first.relative_path);
    }

    #[test]
    fn rejects_files_that_are_not_pdfs() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = project.path().to_str().unwrap();
        let fake = outside.path().join("fake.pdf");
        std::fs::write(&fake, b"plain text").unwrap();
        let text = outside.path().join("notes.txt");
        std::fs::write(&text, b"%PDF-1.7").unwrap();
        for source in [&fake, &text] {
            assert_eq!(
                import_pdf(root, root, source.to_str().unwrap()).unwrap_err(),
                "LIBRARY_INVALID_PDF"
            );
        }
        assert!(!project.path().join("papers").exists());
    }
}
