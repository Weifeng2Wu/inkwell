use super::util::{cli_command, cli_environment_path, command, CommandExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GhStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub username: String,
    pub accounts: Vec<GhAccount>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhAccount {
    pub username: String,
    pub active: bool,
    pub authenticated: bool,
}

#[derive(Deserialize)]
struct GhAuthEntry {
    login: String,
    active: bool,
    state: String,
}

#[derive(Deserialize)]
struct GhAuthStatus {
    hosts: std::collections::HashMap<String, Vec<GhAuthEntry>>,
}

fn parse_gh_status(output: &str) -> Result<GhStatus, String> {
    let mut parsed: GhAuthStatus = serde_json::from_str(output).map_err(|_| {
        "Unable to read GitHub CLI account status. Update GitHub CLI and try again.".to_string()
    })?;
    let accounts: Vec<GhAccount> = parsed
        .hosts
        .remove("github.com")
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| !entry.login.is_empty())
        .map(|entry| GhAccount {
            username: entry.login,
            active: entry.active,
            authenticated: entry.state == "success",
        })
        .collect();
    let active = accounts.iter().find(|account| account.active);
    Ok(GhStatus {
        installed: true,
        authenticated: active.is_some_and(|account| account.authenticated),
        username: active
            .map(|account| account.username.clone())
            .unwrap_or_default(),
        accounts,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhRepoResult {
    pub url: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitFileChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub remote: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    #[serde(rename = "hasUpstream")]
    pub has_upstream: bool,
    #[serde(rename = "hasCommits")]
    pub has_commits: bool,
    pub changes: Vec<GitFileChange>,
    #[serde(rename = "isRepo")]
    pub is_repo: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLogEntry {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

async fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    // Git also needs the CLI PATH for credential helpers such as gh when the
    // app was launched from Finder rather than a terminal.
    let mut cmd = cli_command("git");
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| "Git operation timed out. Check your network and credentials, then retry.".to_string())?
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_status(dir: String) -> Result<GitStatus, String> {
    if run_git(&dir, &["rev-parse", "--is-inside-work-tree"])
        .await
        .map(|output| output.trim() != "true")
        .unwrap_or(true)
    {
        return Ok(GitStatus {
            branch: String::new(),
            remote: None,
            ahead: 0,
            behind: 0,
            has_upstream: false,
            has_commits: false,
            changes: Vec::new(),
            is_repo: false,
        });
    }

    let dir_ref = &dir;

    // Check if repo has any commits
    let has_commits = run_git(dir_ref, &["rev-parse", "HEAD"]).await.is_ok();

    let (branch_result, status_result, remote_result, upstream_result, ahead_behind_result) = tokio::join!(
        async {
            if has_commits {
                run_git(dir_ref, &["rev-parse", "--abbrev-ref", "HEAD"]).await
            } else {
                // No commits yet - get branch from symbolic-ref or default to "main"
                run_git(dir_ref, &["symbolic-ref", "--short", "HEAD"])
                    .await
                    .or_else(|_| Ok("main".to_string()))
            }
        },
        run_git(dir_ref, &["status", "--porcelain"]),
        run_git(dir_ref, &["remote"]),
        async {
            if has_commits {
                run_git(
                    dir_ref,
                    &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
                )
                .await
            } else {
                Err("no commits".to_string())
            }
        },
        async {
            if has_commits {
                run_git(
                    dir_ref,
                    &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
                )
                .await
            } else {
                Ok("0\t0".to_string())
            }
        }
    );

    let branch = branch_result
        .unwrap_or_else(|_| "main".to_string())
        .trim()
        .to_string();
    let status_output = status_result.unwrap_or_default();
    let has_upstream = upstream_result.is_ok();

    let mut changes = Vec::new();
    for line in status_output.lines() {
        if line.len() < 3 {
            continue;
        }
        let staged =
            line.chars().next().unwrap_or(' ') != ' ' && line.chars().next().unwrap_or(' ') != '?';
        let status_char = if staged {
            line.chars().next().unwrap_or(' ')
        } else {
            line.chars().nth(1).unwrap_or(' ')
        };

        let status = match status_char {
            'M' => "modified",
            'A' => "added",
            'D' => "deleted",
            'R' => "renamed",
            '?' => "untracked",
            _ => "modified",
        }
        .to_string();

        let path = line[3..].trim().to_string();
        changes.push(GitFileChange {
            path,
            status,
            staged,
        });
    }

    let remote = remote_result
        .ok()
        .and_then(|r| r.lines().next().map(|s| s.to_string()));

    let remote_url = if let Some(ref name) = remote {
        run_git(dir_ref, &["remote", "get-url", name])
            .await
            .ok()
            .map(|u| u.trim().to_string())
    } else {
        None
    };

    let (ahead, behind) = ahead_behind_result
        .ok()
        .and_then(|output| {
            let parts: Vec<&str> = output.trim().split('\t').collect();
            if parts.len() == 2 {
                Some((parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(0)))
            } else {
                None
            }
        })
        .unwrap_or((0, 0));

    Ok(GitStatus {
        branch,
        remote: remote_url,
        ahead,
        behind,
        has_upstream,
        has_commits,
        changes,
        is_repo: true,
    })
}

#[tauri::command]
pub async fn git_log(dir: String, limit: Option<i32>) -> Result<Vec<GitLogEntry>, String> {
    let limit = limit.unwrap_or(20);
    let format = "%H%n%h%n%s%n%an%n%ci%n---";

    let output = match run_git(
        &dir,
        &[
            "log",
            &format!("-{}", limit),
            &format!("--format={}", format),
        ],
    )
    .await
    {
        Ok(out) => out,
        Err(e) if e.contains("does not have any commits") => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };

    let mut entries = Vec::new();
    for part in output.split("---\n").filter(|s| !s.is_empty()) {
        let lines: Vec<&str> = part.trim().lines().collect();
        if lines.len() >= 5 {
            entries.push(GitLogEntry {
                hash: lines[0].to_string(),
                short_hash: lines[1].to_string(),
                message: lines[2].to_string(),
                author: lines[3].to_string(),
                date: lines[4].to_string(),
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn git_graph(dir: String, limit: Option<i32>) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(40).clamp(1, 200);
    let limit_arg = format!("-{}", limit);

    let output = match run_git(
        &dir,
        &[
            "log",
            limit_arg.as_str(),
            "--graph",
            "--decorate",
            "--oneline",
            "--all",
            "--no-color",
        ],
    )
    .await
    {
        Ok(out) => out,
        Err(e) if e.contains("does not have any commits") || e.contains("bad default revision") => {
            return Ok(Vec::new())
        }
        Err(e) => return Err(e),
    };

    Ok(output
        .lines()
        .map(|line| line.trim_end().to_string())
        .filter(|line| !line.is_empty())
        .collect())
}

#[tauri::command]
pub async fn git_diff(
    dir: String,
    file: Option<String>,
    staged: Option<bool>,
) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged.unwrap_or(false) {
        args.push("--staged");
    }
    if let Some(ref f) = file {
        args.push("--");
        args.push(f);
    }
    run_git(&dir, &args).await
}

#[tauri::command]
pub async fn git_discard_all(dir: String) -> Result<(), String> {
    // Restore all tracked modified/deleted files
    run_git(&dir, &["checkout", "--", "."]).await?;
    // Remove all untracked files and directories
    run_git(&dir, &["clean", "-fd"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_discard_file(dir: String, file: String) -> Result<(), String> {
    // Check if it's an untracked file by looking at git status
    let status = run_git(&dir, &["status", "--porcelain", "--", &file]).await?;
    if status.starts_with("??") {
        // Untracked file: delete it
        let path = std::path::Path::new(&dir).join(&file);
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to remove {}: {}", file, e))?;
        } else {
            std::fs::remove_file(&path).map_err(|e| format!("Failed to remove {}: {}", file, e))?;
        }
    } else {
        // Tracked file: restore it
        run_git(&dir, &["checkout", "--", &file]).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(dir: String, files: Vec<String>) -> Result<(), String> {
    let mut args = vec!["reset", "HEAD", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    run_git(&dir, &args).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_add(dir: String, files: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    run_git(&dir, &args).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_commit(dir: String, message: String) -> Result<String, String> {
    run_git(&dir, &["commit", "-m", &message]).await?;
    run_git(&dir, &["rev-parse", "--short", "HEAD"])
        .await
        .map(|s| s.trim().to_string())
}

#[tauri::command]
pub async fn git_push(dir: String) -> Result<(), String> {
    let has_commits = run_git(&dir, &["rev-parse", "--verify", "HEAD"])
        .await
        .is_ok();
    if !has_commits {
        return Err("No commits to push".to_string());
    }

    if run_git(&dir, &["remote", "get-url", "origin"])
        .await
        .is_err()
    {
        return Err("No remote named 'origin'. Add or publish a remote first.".to_string());
    }

    let branch = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await?
        .trim()
        .to_string();

    if branch == "HEAD" {
        return Err("Cannot push from detached HEAD".to_string());
    }

    let has_upstream = run_git(
        &dir,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .await
    .is_ok();

    if has_upstream {
        run_git(&dir, &["push"]).await?;
    } else {
        run_git(&dir, &["push", "-u", "origin", &branch]).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn git_fetch(dir: String) -> Result<(), String> {
    let remotes = run_git(&dir, &["remote"]).await?;
    if remotes.lines().all(|line| line.trim().is_empty()) {
        return Ok(());
    }

    run_git(&dir, &["fetch", "--all", "--prune"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_pull(dir: String) -> Result<(), String> {
    let branch = if run_git(&dir, &["rev-parse", "--verify", "HEAD"])
        .await
        .is_ok()
    {
        run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await?
            .trim()
            .to_string()
    } else {
        run_git(&dir, &["symbolic-ref", "--short", "HEAD"])
            .await
            .unwrap_or_else(|_| "main".to_string())
            .trim()
            .to_string()
    };

    if branch == "HEAD" {
        return Err("Cannot pull from detached HEAD".to_string());
    }

    let has_upstream = run_git(
        &dir,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .await
    .is_ok();

    if has_upstream {
        run_git(&dir, &["pull", "--ff-only", "--no-rebase"]).await?;
    } else {
        run_git(&dir, &["pull", "--ff-only", "--no-rebase", "--set-upstream", "origin", &branch]).await?;
    }

    Ok(())
}

// ── Automatic backup ────────────────────────────────────────────────

const GIT_BACKUP_NOT_A_REPO: &str = "GIT_BACKUP_NOT_A_REPO";
const GIT_BACKUP_IN_PROGRESS: &str = "GIT_BACKUP_IN_PROGRESS";
const GIT_BACKUP_DETACHED_HEAD: &str = "GIT_BACKUP_DETACHED_HEAD";
const GIT_BACKUP_NO_IDENTITY: &str = "GIT_BACKUP_NO_IDENTITY";
const GIT_BACKUP_INVALID_MESSAGE: &str = "GIT_BACKUP_INVALID_MESSAGE";

/// Files above this size are left out of automatic backups. GitHub warns above
/// 50 MB and rejects files above 100 MB.
const GIT_BACKUP_LARGE_FILE_BYTES: u64 = 50 * 1024 * 1024;
const GIT_BACKUP_MESSAGE_MAX_CHARS: usize = 200;
const GIT_BACKUP_BATCH_PATHS: usize = 200;
/// Keeps each command line well below the Windows limit of 32,767 characters.
const GIT_BACKUP_BATCH_BYTES: usize = 8 * 1024;
/// Present in the git directory while an operation is unfinished.
const GIT_BACKUP_OPERATION_MARKERS: [&str; 6] = [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBackupResult {
    pub committed: bool,
    pub pushed: bool,
    pub skipped_large_files: Vec<String>,
    pub push_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PorcelainEntry {
    index: char,
    worktree: char,
    path: String,
    original: Option<String>,
}

/// Parses `git status --porcelain=v1 -z`. Entries are `XY <path>` separated by
/// NUL; a rename or copy is followed by its source path as a separate field.
fn parse_porcelain_z(output: &str) -> Vec<PorcelainEntry> {
    let mut entries = Vec::new();
    let mut fields = output.split('\0');
    while let Some(field) = fields.next() {
        let bytes = field.as_bytes();
        if bytes.len() < 4 || bytes[2] != b' ' {
            continue;
        }
        let path = match field.get(3..) {
            Some(path) => path.to_string(),
            None => continue,
        };
        let index = char::from(bytes[0]);
        let worktree = char::from(bytes[1]);
        let original = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            fields
                .next()
                .filter(|source| !source.is_empty())
                .map(|source| source.to_string())
        } else {
            None
        };
        entries.push(PorcelainEntry {
            index,
            worktree,
            path,
            original,
        });
    }
    entries
}

fn is_unmerged(entry: &PorcelainEntry) -> bool {
    matches!(
        (entry.index, entry.worktree),
        ('D', 'D') | ('A', 'A') | ('U', _) | (_, 'U')
    )
}

fn validate_backup_message(message: &str) -> Result<&str, String> {
    let trimmed = message.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > GIT_BACKUP_MESSAGE_MAX_CHARS
        || trimmed.chars().any(|character| character.is_control())
    {
        return Err(GIT_BACKUP_INVALID_MESSAGE.to_string());
    }
    Ok(trimmed)
}

fn batch_paths(paths: &[String], max_count: usize, max_bytes: usize) -> Vec<Vec<&str>> {
    let mut batches: Vec<Vec<&str>> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    let mut bytes = 0usize;
    for path in paths {
        let size = path.len() + 1;
        if !current.is_empty() && (current.len() >= max_count || bytes + size > max_bytes) {
            batches.push(std::mem::take(&mut current));
            bytes = 0;
        }
        current.push(path.as_str());
        bytes += size;
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

#[derive(Debug, Default, PartialEq, Eq)]
struct BackupPlan {
    /// Paths passed to `git add -A`.
    add: Vec<String>,
    /// Large files that are already staged and have to leave the index.
    unstage: Vec<String>,
    skipped: Vec<String>,
}

fn plan_backup(
    entries: &[PorcelainEntry],
    large: &std::collections::HashSet<String>,
) -> BackupPlan {
    let mut plan = BackupPlan::default();
    for entry in entries {
        if entry.index == '!' {
            continue;
        }
        if large.contains(&entry.path) {
            plan.skipped.push(entry.path.clone());
            if !matches!(entry.index, ' ' | '?') {
                plan.unstage.push(entry.path.clone());
                // Restores the source of a staged rename, so that the commit
                // does not delete the file without adding its new name.
                if matches!(entry.index, 'R' | 'C') {
                    if let Some(original) = &entry.original {
                        plan.unstage.push(original.clone());
                    }
                }
            }
            continue;
        }
        // A blank worktree column means the change is already fully staged.
        // Adding such a path again fails when it exists neither on disk nor
        // in the index (a staged deletion).
        if entry.worktree == ' ' {
            continue;
        }
        plan.add.push(entry.path.clone());
        if matches!(entry.worktree, 'R' | 'C') {
            if let Some(original) = &entry.original {
                plan.add.push(original.clone());
            }
        }
    }
    plan
}

fn is_identity_error(stderr: &str) -> bool {
    let message = stderr.to_lowercase();
    [
        "please tell me who you are",
        "identity unknown",
        "empty ident name",
        "unable to auto-detect email address",
        "auto-detection is disabled",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

fn trim_line_end(output: &str) -> &str {
    output.trim_end_matches(|character: char| character == '\n' || character == '\r')
}

/// Pushes commits that are waiting to upload. Returns whether a push succeeded
/// and, when one was attempted and failed, why.
async fn backup_push(dir: &str) -> (bool, Option<String>) {
    if run_git(dir, &["rev-parse", "--verify", "HEAD"])
        .await
        .is_err()
    {
        return (false, None);
    }
    let has_upstream = run_git(
        dir,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .await
    .is_ok();

    let pushed = if has_upstream {
        let ahead = run_git(dir, &["rev-list", "--count", "@{u}..HEAD"])
            .await
            .ok()
            .and_then(|count| count.trim().parse::<u64>().ok())
            .unwrap_or(1);
        if ahead == 0 {
            return (false, None);
        }
        run_git(dir, &["push"]).await.map(|_| ())
    } else if run_git(dir, &["remote", "get-url", "origin"])
        .await
        .is_ok()
    {
        // Publishes the branch with `push -u origin <branch>`.
        git_push(dir.to_string()).await
    } else {
        return (false, None);
    };

    match pushed {
        Ok(()) => (true, None),
        Err(error) => {
            let error = error.trim();
            (
                false,
                Some(if error.is_empty() {
                    "git push failed".to_string()
                } else {
                    error.to_string()
                }),
            )
        }
    }
}

/// Commits every change in the project to the current branch and optionally
/// pushes it. Never commits during a merge, rebase or cherry-pick, and leaves
/// files larger than 50 MiB out of the commit.
#[tauri::command]
pub async fn git_backup(
    dir: String,
    message: String,
    push: bool,
) -> Result<GitBackupResult, String> {
    let message = validate_backup_message(&message)?.to_string();

    if run_git(&dir, &["rev-parse", "--is-inside-work-tree"])
        .await
        .map(|output| output.trim() != "true")
        .unwrap_or(true)
    {
        return Err(GIT_BACKUP_NOT_A_REPO.to_string());
    }

    let root = trim_line_end(&run_git(&dir, &["rev-parse", "--show-toplevel"]).await?).to_string();
    let git_dir =
        trim_line_end(&run_git(&dir, &["rev-parse", "--absolute-git-dir"]).await?).to_string();
    if root.is_empty() || git_dir.is_empty() {
        return Err(GIT_BACKUP_NOT_A_REPO.to_string());
    }

    for marker in GIT_BACKUP_OPERATION_MARKERS {
        if tokio::fs::symlink_metadata(std::path::Path::new(&git_dir).join(marker))
            .await
            .is_ok()
        {
            return Err(GIT_BACKUP_IN_PROGRESS.to_string());
        }
    }
    // A commit on a detached HEAD belongs to no branch and is easily lost.
    if run_git(&dir, &["symbolic-ref", "-q", "HEAD"]).await.is_err() {
        return Err(GIT_BACKUP_DETACHED_HEAD.to_string());
    }

    // Limited to the project directory: a project opened inside a larger
    // repository must not commit unrelated files. Paths are relative to `root`.
    let status = run_git(
        &dir,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
    )
    .await?;
    let entries = parse_porcelain_z(&status);
    if entries.iter().any(is_unmerged) {
        return Err(GIT_BACKUP_IN_PROGRESS.to_string());
    }

    let mut large = std::collections::HashSet::new();
    for entry in &entries {
        let path = std::path::Path::new(&root).join(&entry.path);
        if let Ok(metadata) = tokio::fs::symlink_metadata(&path).await {
            if metadata.is_file() && metadata.len() > GIT_BACKUP_LARGE_FILE_BYTES {
                large.insert(entry.path.clone());
            }
        }
    }
    let plan = plan_backup(&entries, &large);

    if !plan.unstage.is_empty() {
        let has_commits = run_git(&root, &["rev-parse", "--verify", "HEAD"])
            .await
            .is_ok();
        for batch in batch_paths(&plan.unstage, GIT_BACKUP_BATCH_PATHS, GIT_BACKUP_BATCH_BYTES) {
            let mut args: Vec<&str> = if has_commits {
                vec!["--literal-pathspecs", "reset", "-q", "HEAD", "--"]
            } else {
                vec![
                    "--literal-pathspecs",
                    "rm",
                    "--cached",
                    "-q",
                    "--ignore-unmatch",
                    "--",
                ]
            };
            args.extend(batch);
            run_git(&root, &args).await?;
        }
    }

    for batch in batch_paths(&plan.add, GIT_BACKUP_BATCH_PATHS, GIT_BACKUP_BATCH_BYTES) {
        let mut args: Vec<&str> = vec!["--literal-pathspecs", "add", "-A", "--"];
        args.extend(batch);
        run_git(&root, &args).await?;
    }

    let staged = run_git(&root, &["diff", "--cached", "--name-only", "-z"]).await?;
    let committed = !staged.is_empty();
    if committed {
        if let Err(error) = run_git(&root, &["commit", "-m", message.as_str()]).await {
            // Git's messages may be translated, so also ask git directly
            // whether it can determine an author and committer.
            let no_identity = is_identity_error(&error)
                || run_git(&root, &["var", "GIT_AUTHOR_IDENT"]).await.is_err()
                || run_git(&root, &["var", "GIT_COMMITTER_IDENT"]).await.is_err();
            return Err(if no_identity {
                GIT_BACKUP_NO_IDENTITY.to_string()
            } else if error.trim().is_empty() {
                "git commit failed".to_string()
            } else {
                error.trim().to_string()
            });
        }
    }

    let (pushed, push_error) = if push {
        backup_push(&dir).await
    } else {
        (false, None)
    };

    Ok(GitBackupResult {
        committed,
        pushed,
        skipped_large_files: plan.skipped,
        push_error,
    })
}

// Fallback .gitignore content from https://github.com/github/gitignore/blob/main/TeX.gitignore
const FALLBACK_TEX_GITIGNORE: &str = r#"## Core latex/pdflatex auxiliary files:
*.aux
*.lof
*.log
*.lot
*.fls
*.out
*.toc
*.fmt
*.fot
*.cb
*.cb2
.*.lb

## Intermediate documents:
*.dvi
*.xdv
*-converted-to.*

## Generated if empty string is given at "Please type another file name for output:"
.pdf

## Bibliography auxiliary files (bibtex/biblatex/biber):
*.bbl
*.bbl-SAVE-ERROR
*.bcf
*.bcf-SAVE-ERROR
*.blg
*-blx.aux
*-blx.bib
*.run.xml

## Build tool auxiliary files:
*.fdb_latexmk
*.synctex
*.synctex(busy)
*.synctex.gz
*.synctex.gz(busy)
*.pdfsync
*.rubbercache
rubber.cache

## Build tool directories for auxiliary files
latex.out/

## Auxiliary and intermediate files from other packages:
*.alg
*.loa
acs-*.bib
*.thm
*.atfi
*.nav
*.pre
*.snm
*.vrb
*.soc
*.loc
*.cut
*.cpt
*.spl
*.ent
*.lox
*.mf
*.mp
*.t[1-9]
*.t[1-9][0-9]
*.tfm
*.end
*.?end
*.[1-9]
*.[1-9][0-9]
*.[1-9][0-9][0-9]
*.[1-9]R
*.[1-9][0-9]R
*.[1-9][0-9][0-9]R
*.eledsec[1-9]
*.eledsec[1-9]R
*.eledsec[1-9][0-9]
*.eledsec[1-9][0-9]R
*.eledsec[1-9][0-9][0-9]
*.eledsec[1-9][0-9][0-9]R
*.acn
*.acr
*.glg
*.glg-abr
*.glo
*.glo-abr
*.gls
*.gls-abr
*.glsdefs
*.lzo
*.lzs
*.slg
*.slo
*.sls
*.gnuplot
*.table
*-gnuplottex-*
*.gaux
*.glog
*.gtex
*.4ct
*.4tc
*.idv
*.lg
*.trc
*.xref
*.hd
*.brf
*-concordance.tex
*-tikzDictionary
*.lol
*.ltjruby
*.idx
*.ilg
*.ind
*.maf
*.mlf
*.mlt
*.mtc[0-9]*
*.slf[0-9]*
*.slt[0-9]*
*.stc[0-9]*
_minted*
*.data.minted
*.pyg
*.mw
*.newpax
*.nlg
*.nlo
*.nls
*.pax
*.pdfpc
*.sagetex.sage
*.sagetex.py
*.sagetex.scmd
*.wrt
*.spell.bad
*.spell.txt
svg-inkscape/
*.sout
*.sympy
sympy-plots-for-*.tex/
*.upa
*.upb
*.pytxcode
pythontex-files-*/
*.listing
*.loe
*.dpth
*.md5
*.auxlock
*.ptc
*.tdo
*.hst
*.ver
*.lod
*.xcp
*.xmpi
*.xdy
*.xyc
*.xyd
*.ttt
*.fff
TSWLatexianTemp*

## Editors:
*.bak
*.sav
*.bak[0-9]*
.texpadtmp
*.lyx~
*.backup
.*.swp
*~[0-9]*
*.tps
./auto/*
*.el
*-tags.tex
*.sta
*.lpz
*.xwm

## OS files
.DS_Store
Thumbs.db
"#;

async fn fetch_gitignore() -> Option<String> {
    let url = "https://raw.githubusercontent.com/github/gitignore/main/TeX.gitignore";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let response = client.get(url).send().await.ok()?;
    if response.status().is_success() {
        response.text().await.ok()
    } else {
        None
    }
}

#[tauri::command]
pub async fn git_init(dir: String) -> Result<(), String> {
    run_git(&dir, &["init"]).await?;

    // Create a .gitignore file for LaTeX projects
    let gitignore_path = std::path::Path::new(&dir).join(".gitignore");
    if !gitignore_path.exists() {
        // Try to fetch from GitHub, fallback to hardcoded version
        let gitignore_content = fetch_gitignore()
            .await
            .unwrap_or_else(|| FALLBACK_TEX_GITIGNORE.to_string());

        std::fs::write(&gitignore_path, gitignore_content)
            .map_err(|e| format!("Failed to create .gitignore: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn git_clone(url: String, directory: String) -> Result<String, String> {
    if url.starts_with('-') {
        return Err("Invalid URL: cannot start with '-'".to_string());
    }

    let output = command("git")
        .args(["clone", "--", &url, &directory])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(directory)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_add_remote(dir: String, name: String, url: String) -> Result<(), String> {
    run_git(&dir, &["remote", "add", &name, &url]).await?;
    Ok(())
}

// ── GitHub CLI helpers ──────────────────────────────────────────────

#[cfg(any(windows, test))]
async fn gh_command_with_paths(paths: &[std::path::PathBuf]) -> tokio::process::Command {
    let mut program = std::path::PathBuf::from("gh");
    for directory in paths {
        let candidate = directory.join("gh.exe");
        if tokio::fs::metadata(&candidate)
            .await
            .is_ok_and(|metadata| metadata.is_file())
        {
            program = candidate;
            break;
        }
    }
    let mut cmd = command(program);
    cmd.env(
        "PATH",
        std::env::join_paths(paths).unwrap_or_else(|_| cli_environment_path()),
    );
    cmd
}

async fn gh_command() -> tokio::process::Command {
    #[cfg(windows)]
    return gh_command_with_paths(&super::util::cli_search_paths()).await;
    #[cfg(not(windows))]
    cli_command("gh")
}

async fn run_gh(args: &[&str]) -> Result<String, String> {
    let output = gh_command()
        .await
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

async fn run_gh_in(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = gh_command()
        .await
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

const GH_AUTH_LOGIN_COMMAND: &str =
    "gh auth login --web --git-protocol https --hostname github.com";
const GH_AUTH_LOGIN_ARGS: [&str; 7] = [
    "auth",
    "login",
    "--web",
    "--git-protocol",
    "https",
    "--hostname",
    "github.com",
];
const GH_AUTH_LOGIN_WINDOWS_ARGS: [&str; 6] =
    ["/c", "start", "", "cmd", "/c", GH_AUTH_LOGIN_COMMAND];
const GH_AUTH_LOGIN_MACOS_OSASCRIPT_ARGS: [&str; 4] = [
    "-e",
    "tell application \"Terminal\" to activate",
    "-e",
    "tell application \"Terminal\" to do script \"gh auth login --web --git-protocol https --hostname github.com\"",
];

// In normal single-target builds (e.g. Windows CI/local builds), only one variant is
// constructed by `cfg(...)` branches. The other variants are exercised by cross-platform
// unit tests and other target builds.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GhAuthLoginPlatform {
    Windows,
    MacOs,
    Unix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GhAuthLoginLaunchPlan {
    program: &'static str,
    args: &'static [&'static str],
    hide_outer_window: bool,
}

fn gh_auth_login_launch_plan(platform: GhAuthLoginPlatform) -> GhAuthLoginLaunchPlan {
    match platform {
        GhAuthLoginPlatform::Windows => GhAuthLoginLaunchPlan {
            program: "cmd",
            args: &GH_AUTH_LOGIN_WINDOWS_ARGS,
            hide_outer_window: true,
        },
        GhAuthLoginPlatform::MacOs => GhAuthLoginLaunchPlan {
            program: "osascript",
            args: &GH_AUTH_LOGIN_MACOS_OSASCRIPT_ARGS,
            hide_outer_window: false,
        },
        GhAuthLoginPlatform::Unix => GhAuthLoginLaunchPlan {
            program: "gh",
            args: &GH_AUTH_LOGIN_ARGS,
            hide_outer_window: false,
        },
    }
}

fn gh_installation_status(output: std::io::Result<std::process::Output>) -> Result<bool, String> {
    match output {
        Ok(output) if output.status.success() => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Failed to run GitHub CLI: {error}")),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            Err(format!(
                "GitHub CLI version check failed ({}): {detail}",
                output.status
            ))
        }
    }
}

#[tauri::command]
pub async fn gh_check() -> Result<GhStatus, String> {
    let installed = gh_installation_status(gh_command().await.arg("--version").output().await)?;
    if !installed {
        return Ok(GhStatus {
            installed: false,
            authenticated: false,
            username: String::new(),
            accounts: Vec::new(),
        });
    }

    let output = run_gh(&[
        "auth",
        "status",
        "--hostname",
        "github.com",
        "--json",
        "hosts",
    ])
    .await?;
    parse_gh_status(&output)
}

#[tauri::command]
pub async fn gh_auth_switch(username: String) -> Result<GhStatus, String> {
    if username.is_empty()
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Invalid GitHub username".to_string());
    }
    if std::env::var_os("GH_TOKEN").is_some() || std::env::var_os("GITHUB_TOKEN").is_some() {
        return Err("GH_TOKEN or GITHUB_TOKEN overrides saved accounts. Remove the environment override and restart Inkwell before switching accounts.".to_string());
    }
    run_gh(&[
        "auth",
        "switch",
        "--hostname",
        "github.com",
        "--user",
        &username,
    ])
    .await?;
    gh_check().await
}

#[tauri::command]
pub async fn gh_auth_login() -> Result<String, String> {
    // Spawn gh auth login in a visible terminal so the user can see the device code
    // and complete the interactive browser-based auth flow.
    #[cfg(target_os = "windows")]
    let plan = gh_auth_login_launch_plan(GhAuthLoginPlatform::Windows);
    #[cfg(target_os = "macos")]
    let plan = gh_auth_login_launch_plan(GhAuthLoginPlatform::MacOs);
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let plan = gh_auth_login_launch_plan(GhAuthLoginPlatform::Unix);

    let mut cmd = tokio::process::Command::new(plan.program);
    cmd.args(plan.args).env("PATH", cli_environment_path());
    if plan.hide_outer_window {
        cmd.hide_window();
    }
    cmd.spawn().map_err(|error| error.to_string())?;

    Ok("Authentication started".to_string())
}

#[tauri::command]
pub async fn gh_create_repo(
    dir: String,
    name: String,
    private: bool,
    description: Option<String>,
) -> Result<GhRepoResult, String> {
    let visibility = if private { "--private" } else { "--public" };
    let has_commits = run_git(&dir, &["rev-parse", "--verify", "HEAD"])
        .await
        .is_ok();

    let mut args = vec![
        "repo",
        "create",
        &name,
        visibility,
        "--source=.",
        "--remote=origin",
    ];

    if has_commits {
        args.push("--push");
    }

    let desc_string;
    if let Some(ref desc) = description {
        if !desc.trim().is_empty() {
            desc_string = format!("--description={}", desc);
            args.push(&desc_string);
        }
    }

    let output = run_gh_in(&dir, &args).await?;

    // gh repo create prints the URL on stdout
    let url = output.trim().to_string();

    Ok(GhRepoResult { url, name })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn git_sync_fetches_remote_updates_and_pulls_with_or_without_upstream() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        let local = directory.path().join("local");
        std::fs::create_dir(&source).unwrap();
        let source_dir = source.to_str().unwrap();
        let local_dir = local.to_str().unwrap();
        run_git(source_dir, &["init", "-b", "main"]).await.unwrap();
        run_git(source_dir, &["config", "user.name", "Test"]).await.unwrap();
        run_git(source_dir, &["config", "user.email", "test@example.com"]).await.unwrap();
        std::fs::write(source.join("note.md"), "first").unwrap();
        run_git(source_dir, &["add", "note.md"]).await.unwrap();
        run_git(source_dir, &["commit", "-m", "initial"]).await.unwrap();
        run_git(source_dir, &["clone", source_dir, local_dir]).await.unwrap();

        std::fs::write(source.join("note.md"), "remote update").unwrap();
        run_git(source_dir, &["commit", "-am", "remote update"]).await.unwrap();
        assert_eq!(git_status(local_dir.into()).await.unwrap().behind, 0);
        git_fetch(local_dir.into()).await.unwrap();
        assert_eq!(git_status(local_dir.into()).await.unwrap().behind, 1);
        // Fetch updates commit information, without modifying local files.
        assert_eq!(std::fs::read_to_string(local.join("note.md")).unwrap(), "first");

        run_git(local_dir, &["branch", "--unset-upstream"]).await.unwrap();
        git_pull(local_dir.into()).await.unwrap();
        let status = git_status(local_dir.into()).await.unwrap();
        assert!(status.has_upstream);
        assert_eq!(status.behind, 0);
        assert_eq!(std::fs::read_to_string(local.join("note.md")).unwrap(), "remote update");

        // An existing upstream can use a remote with any name.
        run_git(local_dir, &["remote", "rename", "origin", "papers"]).await.unwrap();
        run_git(source_dir, &["commit", "--allow-empty", "-m", "next"]).await.unwrap();
        git_pull(local_dir.into()).await.unwrap();
        assert_eq!(run_git(local_dir, &["rev-parse", "HEAD"]).await.unwrap(), run_git(source_dir, &["rev-parse", "HEAD"]).await.unwrap());

        // Divergence must leave local commits and files intact.
        run_git(local_dir, &["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "local only"]).await.unwrap();
        run_git(source_dir, &["commit", "--allow-empty", "-m", "remote only"]).await.unwrap();
        let before = run_git(local_dir, &["rev-parse", "HEAD"]).await.unwrap();
        assert!(git_pull(local_dir.into()).await.is_err());
        assert_eq!(run_git(local_dir, &["rev-parse", "HEAD"]).await.unwrap(), before);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_status_recognizes_worktrees_with_git_file() {
        let directory = tempfile::tempdir().unwrap();
        let repo = directory.path().join("repo");
        let worktree = directory.path().join("worktree");
        std::fs::create_dir(&repo).unwrap();

        run_git(repo.to_str().unwrap(), &["init", "-b", "main"])
            .await
            .unwrap();
        run_git(
            repo.to_str().unwrap(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        )
        .await
        .unwrap();
        run_git(
            repo.to_str().unwrap(),
            &["worktree", "add", "-b", "feature", worktree.to_str().unwrap()],
        )
        .await
        .unwrap();

        assert!(worktree.join(".git").is_file());
        let status = git_status(worktree.to_str().unwrap().to_string())
            .await
            .unwrap();
        assert!(status.is_repo);
        assert_eq!(status.branch, "feature");
    }

    async fn git_available() -> bool {
        run_git(".", &["--version"]).await.is_ok()
    }

    async fn backup_repo(path: &std::path::Path) -> String {
        std::fs::create_dir_all(path).unwrap();
        let dir = path.to_str().unwrap().to_string();
        run_git(&dir, &["init", "-b", "main"]).await.unwrap();
        run_git(&dir, &["config", "user.name", "Test"]).await.unwrap();
        run_git(&dir, &["config", "user.email", "test@example.com"]).await.unwrap();
        run_git(&dir, &["config", "commit.gpgsign", "false"]).await.unwrap();
        dir
    }

    async fn tracked_files(dir: &str) -> Vec<String> {
        run_git(dir, &["ls-files"])
            .await
            .unwrap()
            .lines()
            .map(|line| line.to_string())
            .collect()
    }

    fn entry(index: char, worktree: char, path: &str, original: Option<&str>) -> PorcelainEntry {
        PorcelainEntry {
            index,
            worktree,
            path: path.to_string(),
            original: original.map(|value| value.to_string()),
        }
    }

    #[test]
    fn porcelain_z_parses_plain_entries_renames_and_unusual_names() {
        let output = " M notes/a b.md\0?? papers/新 文献.pdf\0R  new name.tex\0old name.tex\0D  gone.bib\0RM moved.md\0was.md\0";
        assert_eq!(
            parse_porcelain_z(output),
            vec![
                entry(' ', 'M', "notes/a b.md", None),
                entry('?', '?', "papers/新 文献.pdf", None),
                entry('R', ' ', "new name.tex", Some("old name.tex")),
                entry('D', ' ', "gone.bib", None),
                entry('R', 'M', "moved.md", Some("was.md")),
            ]
        );
        assert!(parse_porcelain_z("").is_empty());
        assert!(parse_porcelain_z("\0\0x\0").is_empty());
        // A source path that looks like a status line stays a source path.
        assert_eq!(
            parse_porcelain_z("R  b.txt\0 M a.txt\0?? c.txt\0"),
            vec![
                entry('R', ' ', "b.txt", Some(" M a.txt")),
                entry('?', '?', "c.txt", None),
            ]
        );
    }

    #[test]
    fn porcelain_conflicts_are_recognized() {
        for (index, worktree) in [('U', 'U'), ('A', 'A'), ('D', 'D'), ('A', 'U'), ('U', 'D')] {
            assert!(is_unmerged(&entry(index, worktree, "paper.tex", None)));
        }
        for (index, worktree) in [(' ', 'M'), ('A', ' '), ('?', '?'), ('D', ' '), ('A', 'M')] {
            assert!(!is_unmerged(&entry(index, worktree, "paper.tex", None)));
        }
    }

    #[test]
    fn backup_message_must_be_a_single_short_line() {
        assert_eq!(
            validate_backup_message("  Auto backup 2026-11-14 23:05 "),
            Ok("Auto backup 2026-11-14 23:05")
        );
        assert_eq!(validate_backup_message("自动备份").unwrap(), "自动备份");
        assert!(validate_backup_message(&"字".repeat(200)).is_ok());
        for invalid in [
            String::new(),
            "   ".to_string(),
            "first\nsecond".to_string(),
            "tab\there".to_string(),
            "bell\u{7}".to_string(),
            "字".repeat(201),
        ] {
            assert_eq!(
                validate_backup_message(&invalid),
                Err(GIT_BACKUP_INVALID_MESSAGE.to_string())
            );
        }
    }

    #[test]
    fn backup_paths_are_batched_by_count_and_length() {
        let paths: Vec<String> = (0..450).map(|index| format!("f{index}.tex")).collect();
        let batches = batch_paths(&paths, 200, usize::MAX);
        assert_eq!(
            batches.iter().map(|batch| batch.len()).collect::<Vec<_>>(),
            vec![200, 200, 50]
        );
        assert_eq!(batches.concat(), paths.iter().map(|path| path.as_str()).collect::<Vec<_>>());

        let long = vec!["a".repeat(60), "b".repeat(60), "c".repeat(60)];
        let batches = batch_paths(&long, 200, 130);
        assert_eq!(batches.iter().map(|batch| batch.len()).collect::<Vec<_>>(), vec![2, 1]);
        // A single path longer than the limit still gets its own batch.
        assert_eq!(batch_paths(&long, 200, 10).len(), 3);
        assert!(batch_paths(&[], 200, 100).is_empty());
    }

    #[test]
    fn backup_plan_skips_large_files_and_already_staged_changes() {
        let entries = vec![
            entry(' ', 'M', "paper.tex", None),
            entry('?', '?', "papers/huge.pdf", None),
            entry('M', ' ', "data/tracked-huge.bin", None),
            entry('R', ' ', "renamed-huge.bin", Some("old-huge.bin")),
            entry('D', ' ', "removed.bib", None),
            entry(' ', 'D', "deleted.md", None),
            entry('A', 'M', "new.md", None),
            entry('!', '!', "ignored.log", None),
        ];
        let large: std::collections::HashSet<String> = ["papers/huge.pdf", "data/tracked-huge.bin", "renamed-huge.bin"]
            .into_iter()
            .map(|path| path.to_string())
            .collect();
        let plan = plan_backup(&entries, &large);
        assert_eq!(plan.add, vec!["paper.tex", "deleted.md", "new.md"]);
        assert_eq!(
            plan.unstage,
            vec!["data/tracked-huge.bin", "renamed-huge.bin", "old-huge.bin"]
        );
        assert_eq!(
            plan.skipped,
            vec!["papers/huge.pdf", "data/tracked-huge.bin", "renamed-huge.bin"]
        );
    }

    #[test]
    fn backup_recognizes_missing_identity_errors() {
        assert!(is_identity_error(
            "Author identity unknown\n\n*** Please tell me who you are.\n"
        ));
        assert!(is_identity_error("fatal: empty ident name (for <a@b>) not allowed"));
        assert!(!is_identity_error("error: pathspec 'x' did not match any file(s)"));
    }

    #[test]
    fn backup_result_serializes_in_camel_case() {
        let value = serde_json::to_value(GitBackupResult {
            committed: true,
            pushed: false,
            skipped_large_files: vec!["papers/huge.pdf".to_string()],
            push_error: None,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "committed": true,
                "pushed": false,
                "skippedLargeFiles": ["papers/huge.pdf"],
                "pushError": null
            })
        );
    }

    #[tokio::test]
    async fn backup_commits_additions_edits_deletions_and_renames() {
        if !git_available().await {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("paper");
        let dir = backup_repo(&path).await;

        // Nothing to commit in an empty repository.
        let empty = git_backup(dir.clone(), "Auto backup".into(), true).await.unwrap();
        assert_eq!(
            empty,
            GitBackupResult {
                committed: false,
                pushed: false,
                skipped_large_files: Vec::new(),
                push_error: None,
            }
        );

        std::fs::create_dir(path.join("notes")).unwrap();
        std::fs::write(path.join("main.tex"), "draft").unwrap();
        std::fs::write(path.join("notes").join("a b.md"), "note").unwrap();
        std::fs::write(path.join("-dash.txt"), "dash").unwrap();
        std::fs::write(path.join("old.bib"), "@article{a}").unwrap();
        let first = git_backup(dir.clone(), "Auto backup 1".into(), false).await.unwrap();
        assert!(first.committed);
        assert!(!first.pushed);
        assert_eq!(first.push_error, None);
        assert_eq!(
            tracked_files(&dir).await,
            vec!["-dash.txt", "main.tex", "notes/a b.md", "old.bib"]
        );

        std::fs::write(path.join("main.tex"), "second draft").unwrap();
        std::fs::remove_file(path.join("notes").join("a b.md")).unwrap();
        run_git(&dir, &["rm", "-q", "--", "-dash.txt"]).await.unwrap();
        run_git(&dir, &["mv", "old.bib", "references.bib"]).await.unwrap();
        std::fs::write(path.join("new.md"), "new").unwrap();
        // No remote is configured: the commit succeeds without a push error.
        let second = git_backup(dir.clone(), "Auto backup 2".into(), true).await.unwrap();
        assert!(second.committed);
        assert!(!second.pushed);
        assert_eq!(second.push_error, None);
        assert_eq!(tracked_files(&dir).await, vec!["main.tex", "new.md", "references.bib"]);
        assert_eq!(run_git(&dir, &["status", "--porcelain"]).await.unwrap(), "");
        assert_eq!(
            run_git(&dir, &["log", "--format=%s"]).await.unwrap(),
            "Auto backup 2\nAuto backup 1\n"
        );

        let unchanged = git_backup(dir.clone(), "Auto backup 3".into(), false).await.unwrap();
        assert!(!unchanged.committed);
        assert_eq!(
            git_backup(dir.clone(), "two\nlines".into(), false).await,
            Err(GIT_BACKUP_INVALID_MESSAGE.to_string())
        );
    }

    #[tokio::test]
    async fn backup_leaves_large_files_out_of_the_commit() {
        if !git_available().await {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("paper");
        let dir = backup_repo(&path).await;
        std::fs::create_dir(path.join("papers")).unwrap();
        std::fs::write(path.join("data.bin"), "small").unwrap();
        std::fs::write(path.join("staged.bin"), "small").unwrap();
        git_backup(dir.clone(), "initial".into(), false).await.unwrap();

        // Staged while still small, then grown past the limit.
        std::fs::write(path.join("staged.bin"), "changed").unwrap();
        std::fs::write(path.join("added.bin"), "new").unwrap();
        run_git(&dir, &["add", "--", "staged.bin", "added.bin"]).await.unwrap();
        // Sparse files: no disk space is used for the padding.
        for name in ["data.bin", "staged.bin", "papers/huge.pdf", "added.bin"] {
            let file = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(path.join(name))
                .unwrap();
            file.set_len(GIT_BACKUP_LARGE_FILE_BYTES + 1).unwrap();
        }
        // A file of exactly the limit is still included.
        let exact = std::fs::File::create(path.join("limit.bin")).unwrap();
        exact.set_len(GIT_BACKUP_LARGE_FILE_BYTES).unwrap();
        drop(exact);
        std::fs::write(path.join("main.tex"), "draft").unwrap();

        let result = git_backup(dir.clone(), "Auto backup".into(), false).await.unwrap();
        assert!(result.committed);
        let mut skipped = result.skipped_large_files.clone();
        skipped.sort();
        assert_eq!(skipped, vec!["added.bin", "data.bin", "papers/huge.pdf", "staged.bin"]);
        assert_eq!(
            tracked_files(&dir).await,
            vec!["data.bin", "limit.bin", "main.tex", "staged.bin"]
        );
        assert_eq!(run_git(&dir, &["show", "HEAD:data.bin"]).await.unwrap(), "small");
        assert_eq!(run_git(&dir, &["show", "HEAD:staged.bin"]).await.unwrap(), "small");
        assert_eq!(
            run_git(&dir, &["show", "--format=", "--name-only", "HEAD"]).await.unwrap(),
            "limit.bin\nmain.tex\n"
        );

        // Only large files remain: nothing is committed, and they are reported again.
        let again = git_backup(dir.clone(), "Auto backup".into(), false).await.unwrap();
        assert!(!again.committed);
        assert_eq!(again.skipped_large_files.len(), 4);
    }

    #[tokio::test]
    async fn backup_refuses_unfinished_operations_conflicts_and_missing_repositories() {
        if !git_available().await {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let outside = directory.path().join("plain");
        std::fs::create_dir(&outside).unwrap();
        // The temporary directory may itself sit inside a repository.
        if run_git(outside.to_str().unwrap(), &["rev-parse", "--is-inside-work-tree"])
            .await
            .is_err()
        {
            assert_eq!(
                git_backup(outside.to_str().unwrap().into(), "Auto backup".into(), false).await,
                Err(GIT_BACKUP_NOT_A_REPO.to_string())
            );
        }

        let path = directory.path().join("paper");
        let dir = backup_repo(&path).await;
        std::fs::write(path.join("main.tex"), "base\n").unwrap();
        git_backup(dir.clone(), "base".into(), false).await.unwrap();
        let head = run_git(&dir, &["rev-parse", "HEAD"]).await.unwrap();

        for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD"] {
            std::fs::write(path.join(".git").join(marker), head.as_str()).unwrap();
            std::fs::write(path.join("main.tex"), "edited\n").unwrap();
            assert_eq!(
                git_backup(dir.clone(), "Auto backup".into(), false).await,
                Err(GIT_BACKUP_IN_PROGRESS.to_string())
            );
            std::fs::remove_file(path.join(".git").join(marker)).unwrap();
        }
        for marker in ["rebase-merge", "rebase-apply"] {
            std::fs::create_dir(path.join(".git").join(marker)).unwrap();
            assert_eq!(
                git_backup(dir.clone(), "Auto backup".into(), false).await,
                Err(GIT_BACKUP_IN_PROGRESS.to_string())
            );
            std::fs::remove_dir(path.join(".git").join(marker)).unwrap();
        }
        assert_eq!(run_git(&dir, &["rev-parse", "HEAD"]).await.unwrap(), head);
        run_git(&dir, &["checkout", "--", "main.tex"]).await.unwrap();

        // A real conflict: the merge stops and nothing may be committed.
        run_git(&dir, &["checkout", "-q", "-b", "other"]).await.unwrap();
        std::fs::write(path.join("main.tex"), "theirs\n").unwrap();
        run_git(&dir, &["commit", "-qam", "theirs"]).await.unwrap();
        run_git(&dir, &["checkout", "-q", "main"]).await.unwrap();
        std::fs::write(path.join("main.tex"), "ours\n").unwrap();
        run_git(&dir, &["commit", "-qam", "ours"]).await.unwrap();
        assert!(run_git(&dir, &["merge", "other"]).await.is_err());
        let before = run_git(&dir, &["rev-parse", "HEAD"]).await.unwrap();
        assert_eq!(
            git_backup(dir.clone(), "Auto backup".into(), true).await,
            Err(GIT_BACKUP_IN_PROGRESS.to_string())
        );
        // Unresolved entries block the backup even without MERGE_HEAD.
        std::fs::remove_file(path.join(".git").join("MERGE_HEAD")).unwrap();
        assert_eq!(
            git_backup(dir.clone(), "Auto backup".into(), true).await,
            Err(GIT_BACKUP_IN_PROGRESS.to_string())
        );
        assert_eq!(run_git(&dir, &["rev-parse", "HEAD"]).await.unwrap(), before);
        run_git(&dir, &["reset", "-q", "--hard", "HEAD"]).await.unwrap();

        run_git(&dir, &["checkout", "-q", "--detach"]).await.unwrap();
        std::fs::write(path.join("main.tex"), "detached\n").unwrap();
        assert_eq!(
            git_backup(dir.clone(), "Auto backup".into(), false).await,
            Err(GIT_BACKUP_DETACHED_HEAD.to_string())
        );
    }

    #[tokio::test]
    async fn backup_reports_a_missing_identity() {
        if !git_available().await {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("paper");
        let dir = backup_repo(&path).await;
        run_git(&dir, &["config", "user.useConfigOnly", "true"]).await.unwrap();
        run_git(&dir, &["config", "user.name", ""]).await.unwrap();
        run_git(&dir, &["config", "user.email", ""]).await.unwrap();
        std::fs::write(path.join("main.tex"), "draft").unwrap();
        assert_eq!(
            git_backup(dir.clone(), "Auto backup".into(), false).await,
            Err(GIT_BACKUP_NO_IDENTITY.to_string())
        );
        assert!(run_git(&dir, &["rev-parse", "--verify", "HEAD"]).await.is_err());
    }

    #[tokio::test]
    async fn backup_pushes_when_possible_and_keeps_the_commit_when_pushing_fails() {
        if !git_available().await {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote.git");
        std::fs::create_dir(&remote).unwrap();
        let remote_dir = remote.to_str().unwrap().to_string();
        run_git(&remote_dir, &["init", "--bare", "-b", "main"]).await.unwrap();
        let path = directory.path().join("paper");
        let dir = backup_repo(&path).await;
        run_git(&dir, &["remote", "add", "origin", &remote_dir]).await.unwrap();

        // No upstream yet: the branch is published to origin.
        std::fs::write(path.join("main.tex"), "one").unwrap();
        let first = git_backup(dir.clone(), "Auto backup 1".into(), true).await.unwrap();
        assert_eq!((first.committed, first.pushed, first.push_error.clone()), (true, true, None));
        assert!(git_status(dir.clone()).await.unwrap().has_upstream);

        std::fs::write(path.join("main.tex"), "two").unwrap();
        let second = git_backup(dir.clone(), "Auto backup 2".into(), true).await.unwrap();
        assert_eq!((second.committed, second.pushed), (true, true));
        assert_eq!(
            run_git(&remote_dir, &["rev-parse", "main"]).await.unwrap(),
            run_git(&dir, &["rev-parse", "HEAD"]).await.unwrap()
        );

        // Nothing new and nothing waiting to upload.
        let idle = git_backup(dir.clone(), "Auto backup 3".into(), true).await.unwrap();
        assert_eq!((idle.committed, idle.pushed, idle.push_error.clone()), (false, false, None));

        // Commits made earlier without pushing are uploaded by the next backup.
        std::fs::write(path.join("main.tex"), "three").unwrap();
        let local = git_backup(dir.clone(), "Auto backup 4".into(), false).await.unwrap();
        assert_eq!((local.committed, local.pushed), (true, false));
        let catch_up = git_backup(dir.clone(), "Auto backup 5".into(), true).await.unwrap();
        assert_eq!((catch_up.committed, catch_up.pushed), (false, true));

        // A failing push leaves the local commit in place.
        let missing = directory.path().join("missing.git");
        run_git(&dir, &["remote", "set-url", "origin", missing.to_str().unwrap()]).await.unwrap();
        std::fs::write(path.join("main.tex"), "four").unwrap();
        let failed = git_backup(dir.clone(), "Auto backup 6".into(), true).await.unwrap();
        assert!(failed.committed);
        assert!(!failed.pushed);
        assert!(failed.push_error.is_some_and(|error| !error.is_empty()));
        assert_eq!(
            run_git(&dir, &["log", "-1", "--format=%s"]).await.unwrap(),
            "Auto backup 6\n"
        );
    }

    #[tokio::test]
    async fn backup_is_limited_to_the_project_directory() {
        if !git_available().await {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("repo");
        let dir = backup_repo(&path).await;
        let project = path.join("thesis");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("main.tex"), "draft").unwrap();
        std::fs::write(path.join("unrelated.txt"), "other").unwrap();
        let result = git_backup(project.to_str().unwrap().into(), "Auto backup".into(), false)
            .await
            .unwrap();
        assert!(result.committed);
        assert_eq!(tracked_files(&dir).await, vec!["thesis/main.tex"]);
    }

    #[test]
    fn gh_search_keeps_user_path_and_adds_missing_install_locations() {
        use std::path::PathBuf;
        let existing = PathBuf::from("user-bin");
        let fallback = PathBuf::from("github-bin");
        let original = std::env::join_paths([&existing, &fallback]).unwrap();
        let result = crate::commands::util::merge_search_paths(Some(original), &[fallback.clone(), PathBuf::from("homebrew-bin")]);
        assert_eq!(result, vec![existing, fallback, PathBuf::from("homebrew-bin")]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn gh_runs_with_gui_path_and_a_fallback_install_directory() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("gh");
        std::fs::write(&executable, "#!/bin/sh\nprintf 'github-cli-fixture'\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let paths = crate::commands::util::merge_search_paths(
            Some(directory.path().join("gui-bin").into_os_string()),
            &[directory.path().to_path_buf()],
        );
        let output = gh_command()
            .await
            .env("PATH", std::env::join_paths(paths).unwrap())
            .arg("--version")
            .output()
            .await
            .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"github-cli-fixture");
    }

    #[test]
    fn gh_detection_only_reports_missing_for_not_found() {
        use std::io::{Error, ErrorKind};
        assert!(!gh_installation_status(Err(Error::from(ErrorKind::NotFound))).unwrap());
        for kind in [
            ErrorKind::PermissionDenied,
            ErrorKind::InvalidInput,
            ErrorKind::Other,
        ] {
            let error = gh_installation_status(Err(Error::new(kind, "launch failed"))).unwrap_err();
            assert!(error.contains("launch failed"));
        }
    }

    #[test]
    fn gh_detection_reports_a_failed_version_check() {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        let output = |code, stderr: &[u8]| std::process::Output {
            status: std::process::ExitStatus::from_raw(code),
            stdout: Vec::new(),
            stderr: stderr.to_vec(),
        };
        assert!(gh_installation_status(Ok(output(0, b""))).unwrap());
        let error =
            gh_installation_status(Ok(output(256, b"cannot load configuration"))).unwrap_err();
        assert!(error.contains("cannot load configuration"));
    }

    #[tokio::test]
    async fn gh_windows_resolves_install_paths_without_changing_the_parent_path() {
        let directory = tempfile::tempdir().unwrap();
        let preferred = directory.path().join("custom cli");
        let fallback = directory.path().join("GitHub CLI");
        tokio::fs::create_dir_all(preferred.join("gh.exe"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(&fallback).await.unwrap();
        tokio::fs::write(fallback.join("gh.exe"), b"fixture")
            .await
            .unwrap();
        let paths = vec![preferred.clone(), fallback.clone()];
        let cmd = gh_command_with_paths(&paths).await;
        assert_eq!(cmd.as_std().get_program(), fallback.join("gh.exe").as_os_str());
        assert!(cmd.as_std().get_envs().any(|(key, value)| {
            key == "PATH" && value == Some(std::env::join_paths(&paths).unwrap().as_os_str())
        }));

        tokio::fs::remove_dir(preferred.join("gh.exe"))
            .await
            .unwrap();
        tokio::fs::write(preferred.join("gh.exe"), b"fixture")
            .await
            .unwrap();
        let cmd = gh_command_with_paths(&paths).await;
        assert_eq!(cmd.as_std().get_program(), preferred.join("gh.exe").as_os_str());
    }

    #[test]
    fn gh_status_uses_active_account_even_when_another_account_is_invalid() {
        let status = parse_gh_status(r#"{"hosts":{"github.com":[{"login":"personal","active":true,"state":"success"},{"login":"work","active":false,"state":"error"}],"enterprise.example":[{"login":"enterprise","active":true,"state":"success"}]}}"#).unwrap();
        assert!(status.authenticated);
        assert_eq!(status.username, "personal");
        assert_eq!(status.accounts.len(), 2);
        assert!(!status.accounts[1].authenticated);
    }

    #[test]
    fn gh_status_does_not_use_inactive_valid_accounts_as_active_authentication() {
        let status = parse_gh_status(r#"{"hosts":{"github.com":[{"login":"personal","active":true,"state":"error"},{"login":"work","active":false,"state":"success"}]}}"#).unwrap();
        assert!(!status.authenticated);
        assert_eq!(status.username, "personal");
        assert!(status.accounts[1].authenticated);
    }

    #[test]
    fn gh_status_handles_signed_out_accounts_and_rejects_invalid_output() {
        let status = parse_gh_status(r#"{"hosts":{}}"#).unwrap();
        assert!(!status.authenticated);
        assert!(status.accounts.is_empty());
        assert!(status.username.is_empty());
        assert!(parse_gh_status("not json").is_err());
    }

    #[test]
    fn gh_auth_login_windows_launch_plan_uses_visible_cmd() {
        let plan = gh_auth_login_launch_plan(GhAuthLoginPlatform::Windows);

        assert_eq!(plan.program, "cmd");
        assert_eq!(plan.args, GH_AUTH_LOGIN_WINDOWS_ARGS.as_slice());
        assert!(plan.hide_outer_window);
    }

    #[test]
    fn gh_auth_login_macos_launch_plan_uses_terminal_app() {
        let plan = gh_auth_login_launch_plan(GhAuthLoginPlatform::MacOs);

        assert_eq!(plan.program, "osascript");
        assert_eq!(plan.args, GH_AUTH_LOGIN_MACOS_OSASCRIPT_ARGS.as_slice());
        assert!(plan
            .args
            .iter()
            .any(|arg| arg.contains("Terminal") && arg.contains("do script")));
        assert!(!plan.hide_outer_window);
    }

    #[test]
    fn gh_auth_login_unix_launch_plan_runs_gh_directly() {
        let plan = gh_auth_login_launch_plan(GhAuthLoginPlatform::Unix);

        assert_eq!(plan.program, "gh");
        assert_eq!(plan.args, GH_AUTH_LOGIN_ARGS.as_slice());
        assert_eq!(
            format!("{} {}", plan.program, plan.args.join(" ")),
            GH_AUTH_LOGIN_COMMAND
        );
        assert!(!plan.hide_outer_window);
    }
}
