//! PDF sidecars are ordinary Markdown, scoped to the active project. All app writers
//! share a lock and compare the on-disk baseline before replacing a notes file.
use super::fs::ProjectState;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tokio::{fs, io::AsyncReadExt};

pub const NOTES_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub struct PdfNotesState {
    pub access: tokio::sync::Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfNotesDocument {
    path: String,
    content: String,
    can_sync_source: bool,
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

async fn read_notes(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).await.map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > NOTES_LIMIT as u64 {
        return Err("PDF notes must be a regular file no larger than 4 MiB.".into());
    }
    let file = fs::File::open(path).await.map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(NOTES_LIMIT as u64 + 1).read_to_end(&mut bytes).await.map_err(|e| e.to_string())?;
    if bytes.len() > NOTES_LIMIT { return Err("PDF notes exceed 4 MiB.".into()); }
    String::from_utf8(bytes).map_err(|_| "PDF notes must use UTF-8.".into())
}

pub async fn replace_notes(path: &Path, content: &str, expected: &str) -> Result<(), String> {
    if content.len() > NOTES_LIMIT { return Err("PDF notes exceed 4 MiB.".into()); }
    if read_notes(path).await? != expected { return Err("PDF_NOTES_CONFLICT".into()); }
    let target = path.to_owned();
    let content = content.to_owned();
    let expected = expected.to_owned();
    // tempfile.persist replaces atomically on Windows as well as Unix. Keep the
    // temporary on the same filesystem and drop it automatically on any failure.
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        let parent = target.parent().ok_or("Notes directory unavailable.")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temporary.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        let metadata = std::fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file()
            || std::fs::read_to_string(&target).map_err(|e| e.to_string())? != expected {
            return Err("PDF_NOTES_CONFLICT".into());
        }
        temporary.persist(&target).map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

async fn load_document(pdf: &Path, relative: &str, initial: &str) -> Result<PdfNotesDocument, String> {
    if initial.len() > NOTES_LIMIT { return Err("PDF notes exceed 4 MiB.".into()); }
    let name = pdf.file_name().ok_or("PDF name unavailable.")?.to_string_lossy();
    let notes = pdf.with_file_name(format!("{name}.notes.md"));
    if !fs::try_exists(&notes).await.map_err(|e| e.to_string())? {
        let target = notes.clone();
        let initial = initial.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            use std::io::Write;
            let mut temporary = tempfile::NamedTempFile::new_in(target.parent().ok_or("Notes directory unavailable.")?)
                .map_err(|e| e.to_string())?;
            temporary.write_all(initial.as_bytes()).map_err(|e| e.to_string())?;
            temporary.as_file().sync_all().map_err(|e| e.to_string())?;
            match temporary.persist_noclobber(&target) {
                Ok(_) => Ok(()),
                Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        }).await.map_err(|e| e.to_string())??;
    }
    let source = pdf.with_extension("tex");
    let source_in_project = fs::metadata(&source).await.is_ok_and(|metadata| metadata.is_file())
        && fs::canonicalize(&source).await.is_ok_and(|path| pdf.parent().is_some_and(|parent| path.starts_with(parent)));
    let mut has_sync = false;
    for extension in ["synctex.gz", "synctex"] {
        has_sync |= fs::metadata(pdf.with_extension(extension)).await.is_ok_and(|metadata| metadata.is_file());
    }
    Ok(PdfNotesDocument {
        path: format!("{relative}.notes.md"), content: read_notes(&notes).await?,
        can_sync_source: source_in_project && has_sync,
    })
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
    initial_content: String,
) -> Result<PdfNotesDocument, String> {
    let project = active_project(&state)?;
    let pdf = pdf_in_project(&project, &expected_project, &relative_path).await?;
    let _guard = notes.access.lock().await;
    load_document(&pdf, &relative_path, &initial_content).await
}

#[tauri::command]
pub async fn pdf_notes_save(
    state: tauri::State<'_, Mutex<ProjectState>>,
    notes: tauri::State<'_, PdfNotesState>,
    expected_project: String,
    relative_path: String,
    expected_content: String,
    content: String,
) -> Result<(), String> {
    let project = active_project(&state)?;
    let pdf = pdf_in_project(&project, &expected_project, &relative_path).await?;
    let name = pdf.file_name().ok_or("PDF name unavailable.")?.to_string_lossy();
    let target = pdf.with_file_name(format!("{name}.notes.md"));
    let _guard = notes.access.lock().await;
    replace_notes(&target, &content, &expected_content).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn creates_distinct_sidecars_and_never_overwrites_existing_notes() {
        let root = tempfile::tempdir().unwrap();
        let pdf = root.path().join("paper.pdf");
        fs::write(&pdf, b"%PDF-1.7").await.unwrap();
        let first = load_document(&pdf, "paper.pdf", "original notes").await.unwrap();
        assert_eq!(first.path, "paper.pdf.notes.md");
        assert!(!first.can_sync_source);
        assert_eq!(load_document(&pdf, "paper.pdf", "replacement").await.unwrap().content, "original notes");
        let directory = root.path().join("references");
        fs::create_dir(&directory).await.unwrap();
        let other = directory.join("paper.pdf");
        fs::write(&other, b"%PDF-1.7").await.unwrap();
        assert_eq!(load_document(&other, "references/paper.pdf", "other notes").await.unwrap().content, "other notes");
        fs::write(pdf.with_extension("tex"), b"source").await.unwrap();
        assert!(!load_document(&pdf, "paper.pdf", "").await.unwrap().can_sync_source);
        fs::write(pdf.with_extension("synctex.gz"), b"sync").await.unwrap();
        assert!(load_document(&pdf, "paper.pdf", "").await.unwrap().can_sync_source);
    }

    #[tokio::test]
    async fn rejects_stale_saves_and_keeps_original_bytes() {
        let root = tempfile::tempdir().unwrap();
        let notes = root.path().join("paper.pdf.notes.md");
        fs::write(&notes, "original").await.unwrap();
        replace_notes(&notes, "new", "original").await.unwrap();
        assert_eq!(replace_notes(&notes, "lost", "original").await.unwrap_err(), "PDF_NOTES_CONFLICT");
        assert_eq!(fs::read_to_string(&notes).await.unwrap(), "new");
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
        assert!(replace_notes(&notes, "overwrite", "%PDF-1.7").await.is_err());
        assert_eq!(fs::read(&external).await.unwrap(), b"%PDF-1.7");
    }
}
