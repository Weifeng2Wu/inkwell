//! PDF sidecars are ordinary Markdown, scoped to the active project. All app writers
//! share a lock and compare the on-disk revision before replacing a notes file.
use super::fs::ProjectState;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tokio::fs;

const NOTES_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub struct PdfNotesState {
    pub access: tokio::sync::Mutex<()>,
}

/// A sidecar and the revision a later save must still find on disk.
#[derive(Serialize)]
pub struct PdfNotesDocument {
    content: String,
    revision: String,
}

async fn pdf_in_project(project: &str, expected: &str, relative: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(project).await.map_err(|e| e.to_string())?;
    if root != fs::canonicalize(expected).await.map_err(|e| e.to_string())? {
        return Err("PDF_PROJECT_CHANGED".into());
    }
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path.components().any(|part| !matches!(part, Component::Normal(_)))
        || relative.contains('\\') || relative.contains(':')
        || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")) {
        return Err("Expected a project-relative PDF path.".into());
    }
    let target = root.join(path);
    let metadata = fs::symlink_metadata(&target).await.map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("PDF must be a regular project file.".into());
    }
    let canonical = fs::canonicalize(&target).await.map_err(|e| e.to_string())?;
    if !canonical.starts_with(&root) {
        return Err("PDF is outside the project.".into());
    }
    Ok(canonical)
}

fn revision_of(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn notes_path(pdf: &Path) -> Result<PathBuf, String> {
    let name = pdf.file_name().ok_or("PDF name unavailable.")?.to_string_lossy();
    Ok(pdf.with_file_name(format!("{name}.notes.md")))
}

/// The sidecar's bytes, or `None` while no notes have been written. Blocking.
fn read_notes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    use std::io::Read;
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > NOTES_LIMIT as u64 {
        return Err("PDF notes must be a regular file no larger than 4 MiB.".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path).map_err(|e| e.to_string())?
        .take(NOTES_LIMIT as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > NOTES_LIMIT { return Err("PDF notes exceed 4 MiB.".into()); }
    Ok(Some(bytes))
}

/// Opening a PDF never creates its sidecar; the first save does.
async fn load_notes(path: PathBuf) -> Result<Option<PdfNotesDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<PdfNotesDocument>, String> {
        let Some(bytes) = read_notes(&path)? else { return Ok(None) };
        let revision = revision_of(&bytes);
        let content = String::from_utf8(bytes).map_err(|_| "PDF notes must use UTF-8.".to_string())?;
        Ok(Some(PdfNotesDocument { content, revision }))
    }).await.map_err(|e| e.to_string())?
}

/// Writes the sidecar if it is still at `expected` (`None`: not created yet) and
/// returns the new revision.
async fn replace_notes(path: PathBuf, content: String, expected: Option<String>) -> Result<String, String> {
    if content.len() > NOTES_LIMIT { return Err("PDF notes exceed 4 MiB.".into()); }
    // tempfile.persist replaces atomically on Windows as well as Unix. Keep the
    // temporary on the same filesystem and drop it automatically on any failure.
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use std::io::Write;
        if read_notes(&path)?.map(|bytes| revision_of(&bytes)) != expected {
            return Err("PDF_NOTES_CONFLICT".into());
        }
        let parent = path.parent().ok_or("Notes directory unavailable.")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temporary.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        if expected.is_some() {
            temporary.persist(&path).map_err(|e| e.to_string())?;
        } else {
            // A sidecar that appeared since the check is someone else's notes.
            temporary.persist_noclobber(&path).map_err(|error| {
                if error.error.kind() == ErrorKind::AlreadyExists { "PDF_NOTES_CONFLICT".to_string() }
                else { error.to_string() }
            })?;
        }
        Ok(revision_of(content.as_bytes()))
    }).await.map_err(|e| e.to_string())?
}

/// Whether a compiled PDF has its `.tex` source and SyncTeX data beside it.
async fn can_sync_source(pdf: &Path) -> bool {
    let source = pdf.with_extension("tex");
    let source_in_project = fs::metadata(&source).await.is_ok_and(|metadata| metadata.is_file())
        && fs::canonicalize(&source).await.is_ok_and(|path| pdf.parent().is_some_and(|parent| path.starts_with(parent)));
    let mut has_sync = false;
    for extension in ["synctex.gz", "synctex"] {
        has_sync |= fs::metadata(pdf.with_extension(extension)).await.is_ok_and(|metadata| metadata.is_file());
    }
    source_in_project && has_sync
}

fn active_project(state: &Mutex<ProjectState>) -> Result<String, String> {
    state.lock().map_err(|e| e.to_string())?.project_path.clone().ok_or_else(|| "No project open".into())
}

#[tauri::command]
pub async fn pdf_notes_load(
    state: tauri::State<'_, Mutex<ProjectState>>,
    notes: tauri::State<'_, PdfNotesState>,
    expected_project: String,
    relative_path: String,
) -> Result<Option<PdfNotesDocument>, String> {
    let project = active_project(&state)?;
    let pdf = pdf_in_project(&project, &expected_project, &relative_path).await?;
    let _guard = notes.access.lock().await;
    load_notes(notes_path(&pdf)?).await
}

#[tauri::command]
pub async fn pdf_notes_save(
    state: tauri::State<'_, Mutex<ProjectState>>,
    notes: tauri::State<'_, PdfNotesState>,
    expected_project: String,
    relative_path: String,
    expected_revision: Option<String>,
    content: String,
) -> Result<String, String> {
    let project = active_project(&state)?;
    let pdf = pdf_in_project(&project, &expected_project, &relative_path).await?;
    let _guard = notes.access.lock().await;
    replace_notes(notes_path(&pdf)?, content, expected_revision).await
}

#[tauri::command]
pub async fn pdf_can_sync_source(
    state: tauri::State<'_, Mutex<ProjectState>>,
    expected_project: String,
    relative_path: String,
) -> Result<bool, String> {
    let project = active_project(&state)?;
    let pdf = pdf_in_project(&project, &expected_project, &relative_path).await?;
    Ok(can_sync_source(&pdf).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn save(path: &Path, content: &str, expected: Option<&str>) -> Result<String, String> {
        replace_notes(path.to_owned(), content.to_owned(), expected.map(str::to_owned)).await
    }

    #[tokio::test]
    async fn creates_the_sidecar_on_first_save_and_never_overwrites_existing_notes() {
        let root = tempfile::tempdir().unwrap();
        let pdf = root.path().join("paper.pdf");
        fs::write(&pdf, b"%PDF-1.7").await.unwrap();
        let notes = notes_path(&pdf).unwrap();
        assert_eq!(notes, root.path().join("paper.pdf.notes.md"));
        assert!(load_notes(notes.clone()).await.unwrap().is_none());
        assert!(!fs::try_exists(&notes).await.unwrap());
        let revision = save(&notes, "original notes", None).await.unwrap();
        let loaded = load_notes(notes.clone()).await.unwrap().unwrap();
        assert_eq!((loaded.content.as_str(), &loaded.revision), ("original notes", &revision));
        assert_eq!(save(&notes, "replacement", None).await.unwrap_err(), "PDF_NOTES_CONFLICT");
        assert_eq!(fs::read_to_string(&notes).await.unwrap(), "original notes");
        let other = notes_path(&root.path().join("references").join("paper.pdf")).unwrap();
        assert_ne!(other, notes);
    }

    #[tokio::test]
    async fn rejects_stale_saves_and_keeps_original_bytes() {
        let root = tempfile::tempdir().unwrap();
        let notes = root.path().join("paper.pdf.notes.md");
        let original = save(&notes, "original", None).await.unwrap();
        let next = save(&notes, "new", Some(&original)).await.unwrap();
        assert_ne!(next, original);
        assert_eq!(save(&notes, "lost", Some(&original)).await.unwrap_err(), "PDF_NOTES_CONFLICT");
        assert_eq!(fs::read_to_string(&notes).await.unwrap(), "new");
        // Notes edited outside the app change the revision as well.
        fs::write(&notes, "external").await.unwrap();
        assert_eq!(save(&notes, "lost", Some(&next)).await.unwrap_err(), "PDF_NOTES_CONFLICT");
        assert_eq!(fs::read_to_string(&notes).await.unwrap(), "external");
    }

    #[tokio::test]
    async fn detects_source_sync_only_with_both_source_and_synctex() {
        let root = tempfile::tempdir().unwrap();
        // Commands pass a canonical path; a raw temp path differs from it on Windows and macOS.
        let pdf = fs::canonicalize(root.path()).await.unwrap().join("paper.pdf");
        fs::write(&pdf, b"%PDF-1.7").await.unwrap();
        assert!(!can_sync_source(&pdf).await);
        fs::write(pdf.with_extension("tex"), b"source").await.unwrap();
        assert!(!can_sync_source(&pdf).await);
        fs::write(pdf.with_extension("synctex.gz"), b"sync").await.unwrap();
        assert!(can_sync_source(&pdf).await);
    }

    #[tokio::test]
    async fn rejects_paths_outside_the_expected_project() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let project = root.path().to_str().unwrap();
        fs::write(root.path().join("paper.pdf"), b"%PDF-1.7").await.unwrap();
        assert!(pdf_in_project(project, project, "../paper.pdf").await.is_err());
        assert!(pdf_in_project(project, project, "C:/paper.pdf").await.is_err());
        assert!(pdf_in_project(project, other.path().to_str().unwrap(), "paper.pdf").await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlinked_pdfs_and_notes() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let project = root.path().to_str().unwrap();
        let external = other.path().join("paper.pdf");
        fs::write(&external, b"%PDF-1.7").await.unwrap();
        std::os::unix::fs::symlink(&external, root.path().join("paper.pdf")).unwrap();
        assert!(pdf_in_project(project, project, "paper.pdf").await.is_err());
        let notes = root.path().join("notes.md");
        std::os::unix::fs::symlink(&external, &notes).unwrap();
        assert!(load_notes(notes.clone()).await.is_err());
        assert!(save(&notes, "overwrite", Some(&revision_of(b"%PDF-1.7"))).await.is_err());
        assert!(save(&notes, "overwrite", None).await.is_err());
        assert_eq!(fs::read(&external).await.unwrap(), b"%PDF-1.7");
    }
}
