use notify::{
    event::{ModifyKind, RenameMode},
    Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// Read only explicitly referenced PDFs from the session's active project.
#[tauri::command]
pub async fn read_chat_pdf(
    state: tauri::State<'_, Mutex<ProjectState>>,
    relative_path: String,
    expected_project: String,
) -> Result<Vec<u8>, String> {
    let project = state.lock().map_err(|e| e.to_string())?.project_path.clone()
        .ok_or_else(|| "No project open".to_string())?;
    read_chat_pdf_in_project(&project, &expected_project, &relative_path).await
}

async fn read_chat_pdf_in_project(
    project: &str,
    expected_project: &str,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let root = std::fs::canonicalize(project).map_err(|e| e.to_string())?;
    if root != std::fs::canonicalize(expected_project).map_err(|e| e.to_string())? {
        return Err("PDF reference belongs to a different project.".into());
    }
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative.components().any(|part| !matches!(part, std::path::Component::Normal(_)))
        || !relative.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    {
        return Err("Expected a project-relative PDF reference.".into());
    }
    let path = std::fs::canonicalize(root.join(relative)).map_err(|e| e.to_string())?;
    if !path.starts_with(&root) {
        return Err("Access denied: PDF is outside project directory.".into());
    }
    let mut file = fs::File::open(path).await.map_err(|e| e.to_string())?;
    let metadata = file.metadata().await.map_err(|e| e.to_string())?;
    const LIMIT: u64 = 12 * 1024 * 1024;
    if !metadata.is_file() || metadata.len() > LIMIT {
        return Err("PDF must be a file no larger than 12 MiB.".into());
    }
    use tokio::io::AsyncReadExt;
    let mut bytes = Vec::new();
    (&mut file).take(LIMIT + 1).read_to_end(&mut bytes).await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT || !bytes.starts_with(b"%PDF-") {
        return Err("Invalid or oversized PDF reference.".into());
    }
    Ok(bytes)
}

/// Poster figures are bounded raster assets inside the current project.
#[tauri::command]
pub async fn read_poster_image(
    state: tauri::State<'_, Mutex<ProjectState>>,
    path: String,
) -> Result<Vec<u8>, String> {
    let project = state.lock().map_err(|e| e.to_string())?.project_path.clone()
        .ok_or_else(|| "No project open".to_string())?;
    validate_path_within_project(&path, &project)?;
    let extension = Path::new(&path).extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "webp"].contains(&extension.as_str()) {
        return Err("Unsupported poster image type".into());
    }
    let mut file = fs::File::open(&path).await.map_err(|e| e.to_string())?;
    use tokio::io::AsyncReadExt;
    let mut bytes = Vec::new();
    (&mut file).take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes).await.map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 { return Err("Poster figure exceeds 8 MiB".into()); }
    Ok(bytes)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedGeneratedImage {
    pub path: String,
    pub relative_path: String,
    pub mime_type: String,
}

fn save_generated_image_in_project(
    project_path: &str,
    bytes: &[u8],
    mime_type: &str,
) -> Result<SavedGeneratedImage, String> {
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return Err("Generated image must be between 1 byte and 8 MiB.".into());
    }
    let extension = match mime_type {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
        "image/jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => "jpg",
        "image/webp" if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            "webp"
        }
        _ => return Err("Generated image has an unsupported or invalid format.".into()),
    };
    let root = std::fs::canonicalize(project_path)
        .map_err(|_| "Project directory is unavailable.".to_string())?;
    let directory = root.join("generated-images");
    match std::fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("The generated-images path is not a safe directory.".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }
    let canonical_directory =
        std::fs::canonicalize(&directory).map_err(|error| error.to_string())?;
    if !canonical_directory.starts_with(&root) {
        return Err("Generated image directory escapes the project.".into());
    }
    for index in 1..=999 {
        let filename = format!("image-{index:02}.{extension}");
        let target = canonical_directory.join(&filename);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut file) => {
                use std::io::Write;
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    let _ = std::fs::remove_file(&target);
                    return Err(error.to_string());
                }
                return Ok(SavedGeneratedImage {
                    path: target.to_string_lossy().into_owned(),
                    relative_path: format!("generated-images/{filename}"),
                    mime_type: mime_type.to_string(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Could not choose a unique generated image filename.".into())
}

#[tauri::command]
pub fn save_generated_image(
    state: tauri::State<'_, Mutex<ProjectState>>,
    data: String,
    mime_type: String,
    expected_project: String,
) -> Result<SavedGeneratedImage, String> {
    use base64::Engine;
    if data.len() > 11_184_812 {
        return Err("Generated image exceeds the 8 MiB limit.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Generated image data is invalid.".to_string())?;
    let project = state
        .lock()
        .map_err(|error| error.to_string())?
        .project_path
        .clone()
        .ok_or_else(|| "Open a project first.".to_string())?;
    let active_project = std::fs::canonicalize(&project)
        .map_err(|_| "Project directory is unavailable.".to_string())?;
    let expected_project = std::fs::canonicalize(expected_project)
        .map_err(|_| "ACP workspace is unavailable.".to_string())?;
    if active_project != expected_project {
        return Err("The workspace changed before the Agent image could be saved.".into());
    }
    save_generated_image_in_project(&project, &bytes, &mime_type)
}

/// The native save dialog chooses the destination; callers cannot supply a path.
#[tauri::command]
pub async fn save_poster_export(
    app: AppHandle,
    bytes: Vec<u8>,
    name: String,
    extension: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if !["svg", "pptx", "pdf", "png", "jpeg", "jpg"].contains(&extension.as_str()) || bytes.len() > 64 * 1024 * 1024 {
        return Err("Invalid poster export".into());
    }
    let safe_name = Path::new(&name).file_name().and_then(|s| s.to_str()).unwrap_or("poster").to_string();
    let destination = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_file_name(safe_name).add_filter("Poster", &[extension.as_str()]).blocking_save_file()
    }).await.map_err(|e| e.to_string())?;
    let Some(destination) = destination else { return Ok(false); };
    let path = destination.into_path().map_err(|e| e.to_string())?;
    fs::write(path, bytes).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String,
}

pub struct WatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_path: Option<String>,
    last_events: Arc<Mutex<HashMap<String, Instant>>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watcher: None,
            watched_path: None,
            last_events: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Default)]
pub struct ProjectState {
    pub project_path: Option<String>,
}

fn validate_path_within_project(path: &str, project_path: &str) -> Result<(), String> {
    let canonical_project =
        std::fs::canonicalize(project_path).map_err(|e| format!("Invalid project path: {}", e))?;

    let target_path = Path::new(path);
    let canonical_target = if target_path.exists() {
        std::fs::canonicalize(target_path).map_err(|e| format!("Invalid target path: {}", e))?
    } else {
        let parent = target_path
            .parent()
            .ok_or_else(|| "Invalid path: no parent directory".to_string())?;
        let parent_canonical =
            std::fs::canonicalize(parent).map_err(|e| format!("Invalid parent path: {}", e))?;
        parent_canonical.join(target_path.file_name().unwrap_or_default())
    };

    if !canonical_target.starts_with(&canonical_project) {
        return Err("Access denied: path is outside project directory".to_string());
    }

    Ok(())
}

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "__pycache__",
    ".cache",
    "out",
];

const DEBOUNCE_MS: u64 = 100;
const DEFAULT_TEXT_ENCODING: &str = "utf-8";

fn ensure_utf8_encoding(encoding: Option<&str>) -> Result<(), String> {
    let requested = encoding.unwrap_or(DEFAULT_TEXT_ENCODING).trim();
    let normalized = requested.to_ascii_lowercase();
    if normalized == "utf-8" || normalized == "utf8" {
        return Ok(());
    }
    Err(format!(
        "Unsupported encoding '{}'. Only UTF-8 is supported for text files.",
        requested
    ))
}

async fn write_utf8_file(path: &str, content: &str) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .await
        .map_err(|e| e.to_string())?;

    // String in Rust is guaranteed UTF-8; write bytes directly as UTF-8 (no BOM).
    file.write_all(content.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    file.flush().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_project_path(
    state: tauri::State<'_, Mutex<ProjectState>>,
    path: String,
) -> Result<(), String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("Invalid project path: {}", e))?;

    if !canonical.is_dir() {
        return Err("Project path must be a directory".to_string());
    }

    let mut state_guard = state.lock().map_err(|e| e.to_string())?;
    state_guard.project_path = Some(canonical.to_string_lossy().to_string());
    Ok(())
}

#[tauri::command]
pub async fn read_file(
    state: tauri::State<'_, Mutex<ProjectState>>,
    path: String,
) -> Result<String, String> {
    let project_path = {
        let state_guard = state.lock().map_err(|e| e.to_string())?;
        state_guard
            .project_path
            .clone()
            .ok_or_else(|| "No project open".to_string())?
    };

    validate_path_within_project(&path, &project_path)?;

    let metadata = fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        return Err("Cannot read directory as file".to_string());
    }
    fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(
    state: tauri::State<'_, Mutex<ProjectState>>,
    path: String,
    content: String,
    encoding: Option<String>,
) -> Result<(), String> {
    let project_path = {
        let state_guard = state.lock().map_err(|e| e.to_string())?;
        state_guard
            .project_path
            .clone()
            .ok_or_else(|| "No project open".to_string())?
    };

    validate_path_within_project(&path, &project_path)?;

    ensure_utf8_encoding(encoding.as_deref())?;
    write_utf8_file(&path, &content).await
}

#[tauri::command]
pub async fn create_file(path: String, encoding: Option<String>) -> Result<(), String> {
    ensure_utf8_encoding(encoding.as_deref())?;

    // Create parent directory if it doesn't exist
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Check if file already exists
    if Path::new(&path).exists() {
        return Err(format!("File already exists: {}", path));
    }

    // Create empty file
    write_utf8_file(&path, "").await
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    // Check if directory already exists
    if Path::new(&path).exists() {
        return Err(format!("Directory already exists: {}", path));
    }

    fs::create_dir_all(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    // Check if old path exists
    if !Path::new(&old_path).exists() {
        return Err(format!("Path not found: {}", old_path));
    }

    // Check if new path already exists
    if Path::new(&new_path).exists() {
        return Err(format!("Path already exists: {}", new_path));
    }

    fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);

    // Check if path exists
    if !path_obj.exists() {
        return Err(format!("Path not found: {}", path));
    }

    if path_obj.is_dir() {
        fs::remove_dir_all(&path).await.map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).await.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn get_file_tree(dir: String) -> Result<Vec<FileNode>, String> {
    let path = Path::new(&dir);
    if !path.exists() {
        return Err(format!("Directory not found: {}", dir));
    }

    let dir_clone = dir.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || build_file_tree(Path::new(&dir_clone), ""))
            .await
            .map_err(|e| e.to_string())?;

    Ok(result)
}

fn build_file_tree(dir: &Path, base_path: &str) -> Vec<FileNode> {
    let mut nodes = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return nodes,
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        if IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        let relative_path = if base_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", base_path, name)
        };

        if file_type.is_dir() {
            let children = build_file_tree(&entry.path(), &relative_path);
            nodes.push(FileNode {
                name,
                path: relative_path,
                node_type: "directory".to_string(),
                children: Some(children),
            });
        } else if file_type.is_file() {
            nodes.push(FileNode {
                name,
                path: relative_path,
                node_type: "file".to_string(),
                children: None,
            });
        }
    }

    nodes.sort_by(|a, b| {
        if a.node_type != b.node_type {
            if a.node_type == "directory" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.cmp(&b.name)
        }
    });

    nodes
}

fn should_ignore_path(path: &Path) -> bool {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        if IGNORED_DIRS.contains(&name.as_ref()) {
            return true;
        }
    }

    false
}

fn event_kind_to_string(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(modify_kind) => {
            // Distinguish rename events from other modifications
            match modify_kind {
                ModifyKind::Name(rename_mode) => match rename_mode {
                    // Some platforms report rename-as-delete/create pairs.
                    RenameMode::From => "remove",
                    RenameMode::To => "create",
                    RenameMode::Both | RenameMode::Any | RenameMode::Other => "rename",
                },
                _ => "modify",
            }
        }
        EventKind::Remove(_) => "remove",
        EventKind::Access(_) => "access",
        EventKind::Other => "other",
        _ => "unknown",
    }
}

#[tauri::command]
pub fn watch_directory(
    app: AppHandle,
    state: tauri::State<'_, Mutex<WatcherState>>,
    path: String,
) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;
    state_guard.watcher = None;
    state_guard.watched_path = None;

    let watch_path = Path::new(&path);
    if !watch_path.exists() {
        return Err(format!("Directory not found: {}", path));
    }

    let last_events = state_guard.last_events.clone();
    let app_handle = app.clone();

    // Canonicalize base_path for reliable path comparison on Windows
    let base_path: PathBuf =
        std::fs::canonicalize(&path).map_err(|e| format!("Failed to canonicalize path: {}", e))?;

    let watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                for event_path in &event.paths {
                    if should_ignore_path(event_path) {
                        continue;
                    }

                    let path_str = event_path.to_string_lossy().to_string();

                    {
                        let Ok(mut events) = last_events.lock() else {
                            continue;
                        };
                        let now = Instant::now();

                        // Clean up old entries when map grows too large (prevent memory leak)
                        if events.len() > 100 {
                            events.retain(|_, time| {
                                now.duration_since(*time) < Duration::from_secs(5)
                            });
                        }

                        if let Some(last) = events.get(&path_str) {
                            if now.duration_since(*last) < Duration::from_millis(DEBOUNCE_MS) {
                                continue;
                            }
                        }
                        events.insert(path_str.clone(), now);
                    }

                    // Calculate relative path with proper handling for Windows paths
                    let relative_path = match event_path.canonicalize() {
                        Ok(canonical_event_path) => canonical_event_path
                            .strip_prefix(&base_path)
                            .map(|p| p.to_string_lossy().replace("\\", "/"))
                            .unwrap_or_else(|_| event_path.to_string_lossy().replace("\\", "/")),
                        Err(_) => {
                            // File might have been deleted, try direct comparison
                            event_path
                                .strip_prefix(&base_path)
                                .map(|p| p.to_string_lossy().replace("\\", "/"))
                                .unwrap_or_else(|_| event_path.to_string_lossy().replace("\\", "/"))
                        }
                    };

                    let change_event = FileChangeEvent {
                        path: relative_path,
                        kind: event_kind_to_string(&event.kind).to_string(),
                    };

                    app_handle.emit("file-changed", change_event).ok();
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut watcher = watcher;
    watcher
        .watch(watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    state_guard.watcher = Some(watcher);
    state_guard.watched_path = Some(path);

    Ok(())
}

#[tauri::command]
pub fn stop_watch(state: tauri::State<'_, Mutex<WatcherState>>) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;
    state_guard.watcher = None;
    state_guard.watched_path = None;

    // Clear debounce cache to free memory
    if let Ok(mut events) = state_guard.last_events.lock() {
        events.clear();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, RemoveKind};
    use notify::EventKind;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[tokio::test]
    async fn reads_chat_pdfs_only_from_the_expected_project() {
        let project = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let root = project.path().to_str().unwrap();
        fs::create_dir(project.path().join("papers")).unwrap();
        fs::write(project.path().join("papers/draft.PDF"), b"%PDF-1.7\ntest").unwrap();
        assert_eq!(read_chat_pdf_in_project(root, root, "papers/draft.PDF").await.unwrap(), b"%PDF-1.7\ntest");
        assert!(read_chat_pdf_in_project(root, outside.path().to_str().unwrap(), "papers/draft.PDF").await.is_err());
        for path in ["../outside.pdf", "/outside.pdf", "papers", "missing.pdf", "papers/draft.txt"] {
            assert!(read_chat_pdf_in_project(root, root, path).await.is_err(), "{path}");
        }
        fs::write(project.path().join("invalid.pdf"), b"not a PDF").unwrap();
        assert!(read_chat_pdf_in_project(root, root, "invalid.pdf").await.is_err());
        let large = fs::File::create(project.path().join("large.pdf")).unwrap();
        large.set_len(12 * 1024 * 1024 + 1).unwrap();
        assert!(read_chat_pdf_in_project(root, root, "large.pdf").await.is_err());
        #[cfg(unix)]
        {
            fs::write(outside.path().join("secret.pdf"), b"%PDF-1.7\nsecret").unwrap();
            std::os::unix::fs::symlink(outside.path().join("secret.pdf"), project.path().join("linked.pdf")).unwrap();
            assert!(read_chat_pdf_in_project(root, root, "linked.pdf").await.is_err());
        }
    }

    #[test]
    fn saves_generated_images_with_unique_names_inside_the_project() {
        let temp_dir = TempDir::new().unwrap();
        let project = temp_dir.path().join("project");
        fs::create_dir_all(&project).unwrap();
        let png = b"\x89PNG\r\n\x1a\nimage";
        let first =
            save_generated_image_in_project(&project.to_string_lossy(), png, "image/png").unwrap();
        let second =
            save_generated_image_in_project(&project.to_string_lossy(), png, "image/png").unwrap();
        assert_eq!(first.relative_path, "generated-images/image-01.png");
        assert_eq!(second.relative_path, "generated-images/image-02.png");
        assert!(std::path::Path::new(&first.path).starts_with(fs::canonicalize(&project).unwrap()));
        assert_eq!(fs::read(first.path).unwrap(), png);
    }

    #[test]
    fn rejects_invalid_generated_image_data_and_symlink_directories() {
        let temp_dir = TempDir::new().unwrap();
        let project = temp_dir.path().join("project");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&outside).unwrap();
        assert!(
            save_generated_image_in_project(&project.to_string_lossy(), b"bad", "image/png")
                .is_err()
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, project.join("generated-images")).unwrap();
            assert!(save_generated_image_in_project(
                &project.to_string_lossy(),
                b"\x89PNG\r\n\x1a\nimage",
                "image/png"
            )
            .is_err());
            assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
        }
    }

    #[test]
    fn test_validate_path_within_project_allows_file_within_project() {
        let temp_dir = TempDir::new().unwrap();
        let project = temp_dir.path().join("project");
        fs::create_dir_all(&project).unwrap();
        let file_path = project.join("main.tex");
        fs::write(&file_path, "hello").unwrap();

        let result =
            validate_path_within_project(&file_path.to_string_lossy(), &project.to_string_lossy());
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_path_within_project_rejects_outside_project() {
        let temp_dir = TempDir::new().unwrap();
        let project = temp_dir.path().join("project");
        let outside = temp_dir.path().join("outside.txt");
        fs::create_dir_all(&project).unwrap();
        fs::write(&outside, "nope").unwrap();

        let result =
            validate_path_within_project(&outside.to_string_lossy(), &project.to_string_lossy());
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_file_creates_utf8_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("new.txt");

        create_file(
            file_path.to_string_lossy().to_string(),
            Some("utf-8".to_string()),
        )
        .await
        .unwrap();

        assert!(file_path.exists());
        let content = fs::read_to_string(file_path).unwrap();
        assert_eq!(content, "");
    }

    #[tokio::test]
    async fn test_create_file_rejects_non_utf8_encoding() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("new.txt");

        let result = create_file(
            file_path.to_string_lossy().to_string(),
            Some("latin1".to_string()),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rename_and_delete_path_for_file() {
        let temp_dir = TempDir::new().unwrap();
        let old_path = temp_dir.path().join("draft.tex");
        let new_path = temp_dir.path().join("renamed.tex");
        fs::write(&old_path, "content").unwrap();

        rename_path(
            old_path.to_string_lossy().to_string(),
            new_path.to_string_lossy().to_string(),
        )
        .await
        .unwrap();

        assert!(!old_path.exists());
        assert!(new_path.exists());

        delete_path(new_path.to_string_lossy().to_string())
            .await
            .unwrap();
        assert!(!new_path.exists());
    }

    #[test]
    fn test_event_kind_to_string_handles_rename_modes() {
        assert_eq!(
            event_kind_to_string(&EventKind::Modify(ModifyKind::Name(RenameMode::From))),
            "remove"
        );
        assert_eq!(
            event_kind_to_string(&EventKind::Modify(ModifyKind::Name(RenameMode::To))),
            "create"
        );
        assert_eq!(
            event_kind_to_string(&EventKind::Modify(ModifyKind::Name(RenameMode::Both))),
            "rename"
        );
        assert_eq!(
            event_kind_to_string(&EventKind::Create(CreateKind::Any)),
            "create"
        );
        assert_eq!(
            event_kind_to_string(&EventKind::Remove(RemoveKind::Any)),
            "remove"
        );
    }

    #[test]
    fn test_should_ignore_path_matches_ignored_directories() {
        let ignored = PathBuf::from("/tmp/project/node_modules/pkg/index.js");
        let normal = PathBuf::from("/tmp/project/src/main.tex");

        assert!(should_ignore_path(&ignored));
        assert!(!should_ignore_path(&normal));
    }

    #[tokio::test]
    async fn test_get_file_tree_returns_files_and_directories() {
        let temp_dir = TempDir::new().unwrap();

        fs::write(temp_dir.path().join("file1.tex"), "").unwrap();
        fs::write(temp_dir.path().join("file2.txt"), "").unwrap();
        fs::create_dir(temp_dir.path().join("subdir")).unwrap();
        fs::write(temp_dir.path().join("subdir/nested.tex"), "").unwrap();

        let tree = get_file_tree(temp_dir.path().to_string_lossy().to_string())
            .await
            .unwrap();

        assert!(!tree.is_empty());

        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"file1.tex"));
        assert!(names.contains(&"file2.txt"));
        assert!(names.contains(&"subdir"));
    }

    #[tokio::test]
    async fn test_get_file_tree_shows_dotfiles() {
        let temp_dir = TempDir::new().unwrap();

        fs::write(temp_dir.path().join(".gitignore"), "").unwrap();
        fs::write(temp_dir.path().join("visible.tex"), "").unwrap();

        let tree = get_file_tree(temp_dir.path().to_string_lossy().to_string())
            .await
            .unwrap();

        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&".gitignore"));
        assert!(names.contains(&"visible.tex"));
    }

    #[tokio::test]
    async fn test_get_file_tree_shows_all_files() {
        let temp_dir = TempDir::new().unwrap();

        fs::write(temp_dir.path().join("main.tex"), "").unwrap();
        fs::write(temp_dir.path().join("main.aux"), "").unwrap();
        fs::write(temp_dir.path().join("main.log"), "").unwrap();
        fs::write(temp_dir.path().join("main.synctex.gz"), "").unwrap();

        let tree = get_file_tree(temp_dir.path().to_string_lossy().to_string())
            .await
            .unwrap();

        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"main.tex"));
        assert!(names.contains(&"main.aux"));
        assert!(names.contains(&"main.log"));
        assert!(names.contains(&"main.synctex.gz"));
    }

    #[tokio::test]
    async fn test_get_file_tree_returns_error_for_nonexistent_dir() {
        let result = get_file_tree("/nonexistent/directory".to_string()).await;
        assert!(result.is_err());
    }
}
