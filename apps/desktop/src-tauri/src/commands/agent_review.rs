use super::fs::ProjectState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

const MAX_FILE: u64 = 1024 * 1024;
const MAX_TOTAL: u64 = 64 * 1024 * 1024;

#[derive(Default)]
pub struct AgentReviewState(pub tokio::sync::Mutex<Option<ReviewWorkspace>>, AtomicBool);

#[derive(Serialize, Deserialize)]
pub struct ReviewWorkspace {
    project: PathBuf,
    pub work: PathBuf,
    baseline: BTreeMap<String, String>,
    disk: BTreeMap<String, String>,
}

async fn persist(app: &AppHandle, current: &ReviewWorkspace) -> Result<(), String> {
    super::storage::internal_request(
        app,
        serde_json::json!({
            "type": "record_write", "namespace": "agent-review",
            "key": current.project.to_string_lossy(), "value": current
        }),
    )
    .await?;
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChange {
    path: String,
    before: Option<String>,
    after: Option<String>,
}

#[derive(Deserialize)]
pub struct EditorBuffer {
    path: String,
    content: String,
}

fn document(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".poster.json"))
        || matches!(
            path.extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("tex" | "bib" | "cls" | "sty" | "md" | "txt" | "csv")
        )
}

fn relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty() || value.contains('\\') || value.contains(':') || value.chars().any(char::is_control) || value.split('/').any(|part| part.is_empty() || part == "." || part == "..") ||
        !document(path) || path.components().any(|part| !matches!(part, Component::Normal(name) if !name.to_string_lossy().starts_with('.') && name != "node_modules")) {
        return Err("Only project-relative manuscript paths may be reviewed.".into());
    }
    Ok(path.to_path_buf())
}

async fn safe_target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let metadata = tokio::fs::symlink_metadata(root)
        .await
        .map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Invalid review root.".into());
    }
    let relative = relative_path(relative)?;
    let mut target = root.to_path_buf();
    for component in relative.components() {
        target.push(component);
        match tokio::fs::symlink_metadata(&target).await {
            Ok(info) if info.file_type().is_symlink() => {
                return Err("Linked manuscript paths are not allowed.".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(target)
}

async fn text_file(filename: &Path) -> Result<Option<String>, String> {
    match tokio::fs::symlink_metadata(filename).await {
        Ok(info) => {
            if !info.is_file() || info.file_type().is_symlink() || info.len() > MAX_FILE {
                return Err("Linked, non-text or oversized manuscript file.".into());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if info.nlink() != 1 {
                    return Err("Hard-linked manuscripts are not allowed.".into());
                }
            }
            let content = tokio::fs::read_to_string(filename)
                .await
                .map_err(|error| error.to_string())?;
            if content.len() as u64 > MAX_FILE || content.contains('\0') {
                return Err("Invalid manuscript text.".into());
            }
            Ok(Some(content))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn matches_review_snapshot(
    disk: &Option<String>,
    snapshot: Option<&String>,
    expected: Option<&String>,
    proposed: Option<&String>,
) -> bool {
    disk.as_ref() == snapshot
        || disk.as_ref() == expected
        || disk.as_ref() == proposed
        // Accepting a proposal explicitly can restore a file deleted during review.
        || (disk.is_none() && proposed.is_some())
}

async fn scan(root: &Path) -> Result<BTreeMap<String, String>, String> {
    let metadata = tokio::fs::symlink_metadata(root)
        .await
        .map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Linked review roots are not allowed.".into());
    }
    let mut result = BTreeMap::new();
    let mut folders = vec![root.to_path_buf()];
    let mut total = 0;
    let mut inspected = 0;
    while let Some(folder) = folders.pop() {
        let mut entries = tokio::fs::read_dir(folder)
            .await
            .map_err(|error| error.to_string())?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            inspected += 1;
            if inspected > 10_000 {
                return Err("Project exceeds the review file limit.".into());
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.')
                || matches!(name.as_ref(), "node_modules" | "target" | "out" | "dist")
            {
                continue;
            }
            let kind = entry.file_type().await.map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                if document(&entry.path()) {
                    return Err("Linked manuscript files cannot be reviewed.".into());
                }
                continue;
            }
            if kind.is_dir() {
                folders.push(entry.path());
            } else if kind.is_file() && document(&entry.path()) {
                let relative = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                relative_path(&relative)?;
                if let Some(content) = text_file(&entry.path()).await? {
                    total += content.len() as u64;
                    if total > MAX_TOTAL || result.len() >= 2000 {
                        return Err("Project exceeds the review text limit.".into());
                    }
                    result.insert(relative, content);
                }
            }
        }
    }
    Ok(result)
}

fn agent_script(name: &str) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "py" | "pyw"
            | "js"
            | "mjs"
            | "cjs"
            | "jsx"
            | "ts"
            | "mts"
            | "cts"
            | "tsx"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "command"
            | "ps1"
            | "bat"
            | "cmd"
            | "rb"
            | "pl"
            | "php"
            | "r"
            | "jl"
            | "lua"
            | "go"
            | "rs"
    )
}

async fn cleanup_agent_scripts(root: &Path) -> Result<(), String> {
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let mut entries = tokio::fs::read_dir(&folder)
            .await
            .map_err(|error| error.to_string())?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            let kind = entry.file_type().await.map_err(|error| error.to_string())?;
            if kind.is_dir() {
                folders.push(entry.path());
            } else if kind.is_file() && agent_script(&entry.file_name().to_string_lossy()) {
                tokio::fs::remove_file(entry.path())
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

async fn cleanup_saved_review_workspaces(root: &Path) -> Result<(), String> {
    if !tokio::fs::try_exists(root)
        .await
        .map_err(|error| error.to_string())?
    {
        return Ok(());
    }
    let mut entries = tokio::fs::read_dir(root)
        .await
        .map_err(|error| error.to_string())?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        if !entry
            .file_type()
            .await
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let work = entry.path().join("workspace");
        if let Ok(metadata) = tokio::fs::symlink_metadata(&work).await {
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                cleanup_agent_scripts(&work).await?;
            }
        }
    }
    Ok(())
}

impl ReviewWorkspace {
    async fn changes(&self) -> Result<Vec<ReviewChange>, String> {
        let modified = scan(&self.work).await?;
        let mut paths = self
            .baseline
            .keys()
            .chain(modified.keys())
            .cloned()
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        Ok(paths
            .into_iter()
            .filter_map(|path| {
                let before = self.baseline.get(&path).cloned();
                let after = modified.get(&path).cloned();
                (before != after).then_some(ReviewChange {
                    path,
                    before,
                    after,
                })
            })
            .collect())
    }
}

pub async fn workspace(app: &AppHandle, project: &Path) -> Result<PathBuf, String> {
    let state = app.state::<AgentReviewState>();
    if !state.1.swap(true, Ordering::AcqRel) {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("agent-review");
        if let Err(error) = cleanup_saved_review_workspaces(&root).await {
            state.1.store(false, Ordering::Release);
            return Err(error);
        }
    }
    let mut guard = state.0.lock().await;
    if let Some(current) = guard.as_ref() {
        if current.project == project {
            cleanup_agent_scripts(&current.work).await?;
            return Ok(current.work.clone());
        }
    }
    let key = format!("{:x}", Sha256::digest(project.to_string_lossy().as_bytes()));
    let work = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("agent-review")
        .join(key)
        .join("workspace");
    tokio::fs::create_dir_all(&work)
        .await
        .map_err(|error| error.to_string())?;
    let response = super::storage::internal_request(
        app,
        serde_json::json!({
            "type": "record_read", "namespace": "agent-review", "key": project.to_string_lossy()
        }),
    )
    .await?;
    let saved = if let Some(value) = response.get("value").filter(|value| !value.is_null()) {
        Some(
            serde_json::from_value::<ReviewWorkspace>(value.clone())
                .map_err(|error| format!("Cannot restore pending Agent review: {error}"))?,
        )
    } else {
        let state_path = work
            .parent()
            .ok_or("Invalid review directory.")?
            .join("state.json");
        if tokio::fs::try_exists(&state_path)
            .await
            .map_err(|error| error.to_string())?
        {
            let bytes = tokio::fs::read(&state_path)
                .await
                .map_err(|error| error.to_string())?;
            Some(
                serde_json::from_slice::<ReviewWorkspace>(&bytes)
                    .map_err(|error| format!("Cannot migrate pending Agent review: {error}"))?,
            )
        } else {
            None
        }
    };
    if let Some(saved) = saved {
        if saved.project != project || saved.work != work {
            return Err("Invalid saved review workspace.".into());
        }
        persist(app, &saved).await?;
        cleanup_agent_scripts(&saved.work).await?;
        *guard = Some(saved);
        return Ok(work);
    }
    let baseline = scan(project).await?;
    for (relative, content) in &baseline {
        let target = safe_target(&work, relative).await?;
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| error.to_string())?;
        }
        tokio::fs::write(target, content)
            .await
            .map_err(|error| error.to_string())?;
    }
    let current = ReviewWorkspace {
        project: project.to_path_buf(),
        work: work.clone(),
        disk: baseline.clone(),
        baseline,
    };
    persist(app, &current).await?;
    *guard = Some(current);
    Ok(work)
}

fn project_root(project: &tauri::State<'_, Mutex<ProjectState>>) -> Result<String, String> {
    project
        .lock()
        .map_err(|_| "Project state unavailable.")?
        .project_path
        .clone()
        .ok_or("Open a project first.".into())
}

#[tauri::command]
pub async fn agent_review_prepare(
    app: AppHandle,
    project: tauri::State<'_, Mutex<ProjectState>>,
    buffers: Vec<EditorBuffer>,
) -> Result<(), String> {
    let root = tokio::fs::canonicalize(project_root(&project)?)
        .await
        .map_err(|error| error.to_string())?;
    workspace(&app, &root).await?;
    let state = app.state::<AgentReviewState>();
    let mut guard = state.0.lock().await;
    let current = guard.as_mut().ok_or("Review workspace unavailable.")?;
    if current.project != root {
        return Err("Project changed.".into());
    }
    if !current.changes().await?.is_empty() {
        return Err("Review or reject pending Agent changes before starting another turn.".into());
    }
    let baseline = scan(&root).await?;
    if buffers.len() > 20 {
        return Err("Too many editor buffers.".into());
    }
    let mut contents = baseline.clone();
    for buffer in buffers {
        relative_path(&buffer.path)?;
        if buffer.content.len() as u64 > MAX_FILE {
            return Err("Editor buffer is too large.".into());
        }
        if !baseline.contains_key(&buffer.path) {
            return Err("Save new manuscript files before asking the Agent to edit them.".into());
        }
        contents.insert(buffer.path, buffer.content);
    }
    for old in scan(&current.work).await?.keys() {
        if !contents.contains_key(old) {
            tokio::fs::remove_file(safe_target(&current.work, old).await?)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    for (relative, content) in &contents {
        let target = safe_target(&current.work, relative).await?;
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| error.to_string())?;
        }
        tokio::fs::write(target, content)
            .await
            .map_err(|error| error.to_string())?;
    }
    current.baseline = contents;
    current.disk = baseline;
    persist(&app, current).await
}

#[tauri::command]
pub async fn agent_review_changes(
    app: AppHandle,
    project: tauri::State<'_, Mutex<ProjectState>>,
) -> Result<Vec<ReviewChange>, String> {
    let root = tokio::fs::canonicalize(project_root(&project)?)
        .await
        .map_err(|error| error.to_string())?;
    workspace(&app, &root).await?;
    let state = app.state::<AgentReviewState>();
    let guard = state.0.lock().await;
    match guard.as_ref() {
        Some(current) if current.project == root => {
            cleanup_agent_scripts(&current.work).await?;
            current.changes().await
        }
        _ => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn agent_review_resolve(
    app: AppHandle,
    project: tauri::State<'_, Mutex<ProjectState>>,
    path: String,
    expected: Option<String>,
    proposed: Option<String>,
    content: Option<String>,
    accept: bool,
    remaining: Option<String>,
) -> Result<(), String> {
    let root = tokio::fs::canonicalize(project_root(&project)?)
        .await
        .map_err(|error| error.to_string())?;
    let state = app.state::<AgentReviewState>();
    let mut guard = state.0.lock().await;
    let current = guard.as_mut().ok_or("Review workspace unavailable.")?;
    if current.project != root {
        return Err("Project changed.".into());
    }
    let change = current
        .changes()
        .await?
        .into_iter()
        .find(|change| change.path == path)
        .ok_or("This change is no longer pending.")?;
    if change.before != expected || change.after != proposed {
        return Err("Agent proposal changed. Refresh the review.".into());
    }
    if remaining
        .as_ref()
        .is_some_and(|text| text.len() as u64 > MAX_FILE || text.contains('\0'))
    {
        return Err("Invalid remaining proposal.".into());
    }
    if accept {
        if content
            .as_ref()
            .is_some_and(|text| text.len() as u64 > MAX_FILE || text.contains('\0'))
        {
            return Err("Invalid reviewed content.".into());
        }
        let target = safe_target(&root, &path).await?;
        let disk = text_file(&target).await?;
        let snapshot = current.disk.get(&path);
        if !matches_review_snapshot(&disk, snapshot, expected.as_ref(), content.as_ref()) {
            return Err("The manuscript changed since this proposal. Original content was preserved; reject and regenerate this suggestion.".into());
        }
        if let Some(content) = content.as_ref() {
            if disk.as_deref() != Some(content) {
                if let Some(parent) = target.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|error| error.to_string())?;
                }
                let temporary =
                    target.with_file_name(format!(".inkwell-review-{}.tmp", uuid::Uuid::new_v4()));
                tokio::fs::write(&temporary, content)
                    .await
                    .map_err(|error| error.to_string())?;
                if let Ok(metadata) = tokio::fs::metadata(&target).await {
                    tokio::fs::set_permissions(&temporary, metadata.permissions())
                        .await
                        .map_err(|error| error.to_string())?;
                }
                if text_file(&target).await? != disk {
                    let _ = tokio::fs::remove_file(&temporary).await;
                    return Err(
                        "File changed while applying review. Original content was preserved."
                            .into(),
                    );
                }
                if let Err(error) = tokio::fs::rename(&temporary, &target).await {
                    let _ = tokio::fs::remove_file(&temporary).await;
                    return Err(error.to_string());
                }
            }
        } else if disk.is_some() {
            tokio::fs::remove_file(&target)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    if accept {
        match &content {
            Some(content) => {
                current.disk.insert(path.clone(), content.clone());
            }
            None => {
                current.disk.remove(&path);
            }
        }
    }
    let resolved = if accept { content } else { expected };
    let working_content = remaining.or_else(|| resolved.clone());
    let target = safe_target(&current.work, &path).await?;
    match working_content {
        Some(content) => {
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            tokio::fs::write(target, &content)
                .await
                .map_err(|error| error.to_string())?;
        }
        None => {
            if tokio::fs::try_exists(&target)
                .await
                .map_err(|error| error.to_string())?
            {
                tokio::fs::remove_file(target)
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    match resolved {
        Some(content) => {
            current.baseline.insert(path, content);
        }
        None => {
            current.baseline.remove(&path);
        }
    }
    persist(&app, current).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_paths_reject_escapes_and_non_manuscripts() {
        for value in [
            "../paper.tex",
            "/paper.tex",
            "C:/paper.tex",
            "folder\\paper.tex",
            ".git/config",
            "paper/../main.tex",
            "paper//main.tex",
            "paper/./main.tex",
            "script.js",
            "node_modules/paper.tex",
        ] {
            assert!(relative_path(value).is_err(), "{value}");
        }
        assert!(relative_path("chapters/introduction.tex").is_ok());
        assert!(relative_path("posters/research.poster.json").is_ok());
        assert!(relative_path("settings.json").is_err());
    }

    #[test]
    fn agent_scripts_are_selected_for_cleanup() {
        for name in [
            "test_poster.py",
            "generate_poster_json.py",
            "validate_poster.js",
            "check_poster.mjs",
            "qa_poster.sh",
            "analysis.RS",
        ] {
            assert!(agent_script(name), "{name}");
        }
        for name in [
            "test_poster.tex",
            "generate_poster.json",
            "references.bib",
            "paper.tex",
            "poster.svg",
        ] {
            assert!(!agent_script(name), "{name}");
        }
    }

    #[tokio::test]
    async fn cleanup_removes_scripts_but_keeps_other_workspace_files() {
        let work = tempfile::tempdir().unwrap();
        let posters = work.path().join("posters");
        tokio::fs::create_dir_all(&posters).await.unwrap();
        let temporary = work.path().join("test_poster.py");
        let generated = posters.join("generate_poster_json.py");
        let poster = posters.join("cot-distill-01.poster.json");
        let source = work.path().join("analysis.ts");
        for file in [&temporary, &generated, &poster, &source] {
            tokio::fs::write(file, "content").await.unwrap();
        }

        cleanup_agent_scripts(work.path()).await.unwrap();

        assert!(!temporary.exists());
        assert!(!generated.exists());
        assert!(!source.exists());
        assert!(poster.exists());
    }

    #[tokio::test]
    async fn startup_sweep_cleans_scripts_across_saved_workspaces() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("project-hash").join("workspace");
        tokio::fs::create_dir_all(&workspace).await.unwrap();
        let script = workspace.join("generate_poster_json.py");
        let manuscript = workspace.join("paper.tex");
        tokio::fs::write(&script, "temporary").await.unwrap();
        tokio::fs::write(&manuscript, "manuscript").await.unwrap();

        cleanup_saved_review_workspaces(root.path()).await.unwrap();

        assert!(!script.exists());
        assert!(manuscript.exists());
    }

    #[test]
    fn review_acceptance_allows_unchanged_snapshots_and_idempotent_retries() {
        let original = Some("original".to_string());
        let proposed = Some("proposal".to_string());
        assert!(matches_review_snapshot(
            &original,
            original.as_ref(),
            original.as_ref(),
            proposed.as_ref(),
        ));
        assert!(matches_review_snapshot(
            &proposed,
            original.as_ref(),
            original.as_ref(),
            proposed.as_ref(),
        ));
        assert!(matches_review_snapshot(
            &None,
            original.as_ref(),
            original.as_ref(),
            proposed.as_ref(),
        ));
        let user_edit = Some("user edit".to_string());
        assert!(!matches_review_snapshot(
            &user_edit,
            original.as_ref(),
            original.as_ref(),
            proposed.as_ref(),
        ));
    }

    #[tokio::test]
    async fn proposals_do_not_change_originals_and_detect_creations_and_deletions() {
        let root = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        tokio::fs::write(root.path().join("paper.tex"), "Original")
            .await
            .unwrap();
        let baseline = scan(root.path()).await.unwrap();
        tokio::fs::write(work.path().join("paper.tex"), "Proposal")
            .await
            .unwrap();
        let current = ReviewWorkspace {
            project: root.path().to_path_buf(),
            work: work.path().to_path_buf(),
            disk: baseline.clone(),
            baseline,
        };
        let changes = current.changes().await.unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].before.as_deref(), Some("Original"));
        assert_eq!(changes[0].after.as_deref(), Some("Proposal"));
        assert_eq!(
            tokio::fs::read_to_string(root.path().join("paper.tex"))
                .await
                .unwrap(),
            "Original"
        );
        tokio::fs::remove_file(work.path().join("paper.tex"))
            .await
            .unwrap();
        tokio::fs::write(work.path().join("new.tex"), "New")
            .await
            .unwrap();
        let changes = current.changes().await.unwrap();
        assert_eq!(changes.len(), 2);
        assert!(
            changes
                .iter()
                .any(|change| change.path == "new.tex" && change.before.is_none())
        );
        assert!(
            changes
                .iter()
                .any(|change| change.path == "paper.tex" && change.after.is_none())
        );
    }

    #[tokio::test]
    async fn invalid_text_and_oversized_files_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("paper.tex");
        tokio::fs::write(&file, b"bad\0text").await.unwrap();
        assert!(scan(root.path()).await.is_err());
        tokio::fs::write(&file, vec![b'x'; MAX_FILE as usize + 1])
            .await
            .unwrap();
        assert!(scan(root.path()).await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn linked_files_cannot_be_accepted_as_manuscript_proposals() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        tokio::fs::write(outside.path().join("paper.tex"), "Private")
            .await
            .unwrap();
        tokio::fs::symlink(
            outside.path().join("paper.tex"),
            root.path().join("paper.tex"),
        )
        .await
        .unwrap();
        assert!(scan(root.path()).await.is_err());
        assert!(safe_target(root.path(), "paper.tex").await.is_err());
    }
}
