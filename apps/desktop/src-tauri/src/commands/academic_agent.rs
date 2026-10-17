use super::fs::ProjectState;
use super::util::command;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};

const RUNTIME_SOURCE: &str =
    include_str!("../../../../../packages/academic-agent/runtime-source.json");
const BRIDGE: &str = include_str!("../../../../../packages/academic-agent/src/bridge.mjs");
const IMAGE_GENERATION: &str =
    include_str!("../../../../../packages/academic-agent/src/image-generation.mjs");
const ATTACHMENTS: &str = include_str!("../../../../../packages/academic-agent/src/attachments.mjs");
const LIBRARY: &str = include_str!("../../../../../packages/academic-agent/src/library.mjs");
const MODEL: &str = include_str!("../../../../../packages/academic-agent/src/model.mjs");
const MARKET: &str = include_str!("../../../../../packages/academic-agent/src/market.mjs");
const ZIP_SKILLS: &str = include_str!("../../../../../packages/academic-agent/src/zip-skills.mjs");
const GITHUB_SKILLS: &str =
    include_str!("../../../../../packages/academic-agent/src/github-skills.mjs");
const GITHUB_BUNDLE: &str =
    include_str!("../../../../../packages/academic-agent/skills/github-bundle.json");
const HISTORY: &str = include_str!("../../../../../packages/academic-agent/src/history.mjs");
const POLICY: &str = include_str!("../../../../../packages/academic-agent/src/policy.mjs");
const PROTOCOL: &str = include_str!("../../../../../packages/academic-agent/src/protocol.mjs");
const EMPTY_REGISTRY: &str =
    include_str!("../../../../../packages/academic-agent/skills/registry.json");

struct Runtime {
    id: String,
    project: PathBuf,
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct AcademicAgentState {
    runtime: tokio::sync::Mutex<Option<Runtime>>,
}

fn project_path(state: &tauri::State<'_, Mutex<ProjectState>>) -> Result<String, String> {
    state
        .lock()
        .map_err(|_| "Project state is unavailable.".to_string())?
        .project_path
        .clone()
        .ok_or_else(|| "Open a project first.".into())
}

async fn stop_runtime(runtime: &mut Option<Runtime>) {
    if let Some(mut running) = runtime.take() {
        let _ = running.stdin.shutdown().await;
        let _ = running.child.kill().await;
        let _ = running.child.wait().await;
    }
}

fn serialize_request(request: &Value) -> Result<Vec<u8>, String> {
    let command_type = request
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !matches!(
        command_type,
        "catalog"
            | "configure"
            | "prompt"
            | "abort"
            | "permission"
            | "list_models"
            | "test_connection"
            | "git_commit"
            | "format_skill_generate"
            | "history_list"
            | "history_read"
            | "history_rename"
            | "history_delete"
            | "skill_preview"
            | "market_change"
            | "skill_import"
    ) {
        return Err("Unsupported academic agent command.".into());
    }
    let mut serialized =
        serde_json::to_vec(request).map_err(|_| "Invalid runtime request.".to_string())?;
    if serialized.len() > 2 * 1024 * 1024 {
        return Err("Runtime request is too large.".into());
    }
    serialized.push(b'\n');
    Ok(serialized)
}

fn runtime_cache_key(revision: &str) -> String {
    let platform = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    };
    format!("{revision}-{platform}-{arch}")
}

#[tauri::command]
pub async fn academic_agent_start(
    app: AppHandle,
    state: tauri::State<'_, AcademicAgentState>,
    project: tauri::State<'_, Mutex<ProjectState>>,
) -> Result<String, String> {
    let project = tokio::fs::canonicalize(project_path(&project)?)
        .await
        .map_err(|_| "Project directory is unavailable.".to_string())?;
    let source: Value = serde_json::from_str(RUNTIME_SOURCE)
        .map_err(|_| "Invalid runtime source metadata.".to_string())?;
    let revision = source
        .get("revision")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing runtime revision.".to_string())?;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .join(".cache/agent-runtime")
                .join(runtime_cache_key(revision));
    let sdk = super::agent_runtime::sdk_path(&app, root).await?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "App data directory is unavailable.".to_string())?
        .join("academic-agent");
    let mut guard = state.runtime.lock().await;
    stop_runtime(&mut guard).await;
    tokio::fs::create_dir_all(directory.join("skills"))
        .await
        .map_err(|error| error.to_string())?;
    for (name, contents) in [
        ("storage.mjs", include_str!("../../../../../packages/academic-agent/src/storage.mjs")),
        ("bridge.mjs", BRIDGE),
        ("image-generation.mjs", IMAGE_GENERATION),
        ("format-review.mjs", include_str!("../../../../../packages/academic-agent/src/format-review.mjs")),
        ("review-prompt.json", include_str!("../../../../../packages/academic-agent/src/review-prompt.json")),
        ("attachments.mjs", ATTACHMENTS),
        ("library.mjs", LIBRARY),
        ("model.mjs", MODEL),
        ("market.mjs", MARKET),
        ("github-skills.mjs", GITHUB_SKILLS),
        ("zip-skills.mjs", ZIP_SKILLS),
        ("skills/github-bundle.json", GITHUB_BUNDLE),
        ("skills/nature-bundle.json", include_str!("../../../../../packages/academic-agent/skills/nature-bundle.json")),
        ("skills/poster-bundle.json", include_str!("../../../../../packages/academic-agent/skills/poster-bundle.json")),
        ("history.mjs", HISTORY),
        ("policy.mjs", POLICY),
        ("protocol.mjs", PROTOCOL),
    ] {
        tokio::fs::write(directory.join(name), contents)
            .await
            .map_err(|error| error.to_string())?;
    }
    let registry = directory.join("skills/registry.json");
    if !tokio::fs::try_exists(&registry)
        .await
        .map_err(|error| error.to_string())?
    {
        tokio::fs::write(&registry, EMPTY_REGISTRY)
            .await
            .map_err(|error| error.to_string())?;
    }
    let node = super::agent_runtime::node_binary()?;
    let review_workspace = super::agent_review::workspace(&app, &project).await?;
    let mut child = command(node.to_str().ok_or("Invalid Node.js executable path.")?)
        .arg(directory.join("bridge.mjs"))
        .arg(&review_workspace)
        .arg(&directory)
        .arg(sdk)
        .arg(&project)
        .env("INKWELL_DATABASE_PATH", directory.join("inkwell.sqlite"))
        .current_dir(&review_workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| {
            "Could not start the Agent runtime. Check the Node.js override or reinstall Inkwell.".to_string()
        })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Runtime stdin is unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Runtime stdout is unavailable.".to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let event_id = id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.len() > 4 * 1024 * 1024 {
                let _ = app.emit("academic-agent-event", json!({"runtimeId": event_id, "event": {"type":"fatal", "error":"Runtime record exceeded the size limit."}}));
                break;
            }
            if let Ok(event) = serde_json::from_str::<Value>(&line) {
                let _ = app.emit(
                    "academic-agent-event",
                    json!({"runtimeId": event_id, "event": event}),
                );
            }
        }
        let _ = app.emit(
            "academic-agent-event",
            json!({"runtimeId": event_id, "event": {"type":"exit"}}),
        );
    });
    *guard = Some(Runtime {
        id: id.clone(),
        project,
        child,
        stdin,
    });
    Ok(id)
}

#[tauri::command]
pub async fn academic_agent_command(
    state: tauri::State<'_, AcademicAgentState>,
    project: tauri::State<'_, Mutex<ProjectState>>,
    runtime_id: String,
    request: Value,
) -> Result<(), String> {
    let current_project = tokio::fs::canonicalize(project_path(&project)?)
        .await
        .map_err(|_| "Project directory is unavailable.".to_string())?;
    let serialized = serialize_request(&request)?;
    let mut guard = state.runtime.lock().await;
    let runtime = guard
        .as_mut()
        .ok_or_else(|| "Start the academic runtime first.".to_string())?;
    if runtime.id != runtime_id || runtime.project != current_project {
        return Err("Runtime belongs to a different project or session.".into());
    }
    tokio::time::timeout(
        Duration::from_secs(10),
        runtime.stdin.write_all(&serialized),
    )
    .await
    .map_err(|_| "Runtime transport timed out. Disconnect and reconnect.".to_string())?
    .map_err(|_| "Runtime disconnected. Reconnect and resume the session.".to_string())
}

#[tauri::command]
pub async fn academic_agent_stop(
    state: tauri::State<'_, AcademicAgentState>,
    runtime_id: String,
) -> Result<(), String> {
    let mut guard = state.runtime.lock().await;
    if guard
        .as_ref()
        .is_some_and(|runtime| runtime.id == runtime_id)
    {
        stop_runtime(&mut guard).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{runtime_cache_key, serialize_request};
    use serde_json::{json, Value};

    #[test]
    fn isolates_runtime_dependencies_by_platform_and_architecture() {
        let key = runtime_cache_key("fixture");
        assert!(key.starts_with("fixture-"));
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        assert_eq!(key, "fixture-win32-x64");
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert_eq!(key, "fixture-darwin-arm64");
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        assert_eq!(key, "fixture-linux-x64");
    }

    #[test]
    fn forwards_all_supported_bridge_commands() {
        for command_type in [
            "catalog",
            "configure",
            "prompt",
            "abort",
            "permission",
            "list_models",
            "test_connection",
            "git_commit",
            "format_skill_generate",
            "history_list",
            "history_read",
            "history_rename",
            "history_delete",
            "skill_preview",
            "market_change",
            "skill_import",
        ] {
            let request = json!({ "type": command_type, "id": "fixture" });
            let serialized = serialize_request(&request).unwrap();
            assert_eq!(serialized.last(), Some(&b'\n'));
            assert_eq!(
                serde_json::from_slice::<Value>(&serialized).unwrap(),
                request
            );
        }
    }

    #[test]
    fn rejects_unknown_missing_and_non_string_commands() {
        for request in [
            json!({}),
            json!({ "type": null }),
            json!({ "type": 1 }),
            json!({ "type": "" }),
            json!({ "type": "shell" }),
            json!({ "type": "unknown" }),
        ] {
            assert_eq!(
                serialize_request(&request).unwrap_err(),
                "Unsupported academic agent command."
            );
        }
    }

    #[test]
    fn preserves_request_fields_and_rejects_oversized_requests() {
        let request = json!({
            "type": "list_models", "id": "fixture", "protocol": "openai",
            "baseUrl": "https://example.com/v1", "apiKey": "fixture-key",
        });
        let serialized = serialize_request(&request).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&serialized).unwrap(),
            request
        );
        let oversized = json!({ "type": "prompt", "text": "x".repeat(2 * 1024 * 1024) });
        assert_eq!(
            serialize_request(&oversized).unwrap_err(),
            "Runtime request is too large."
        );
    }
}
