use serde_json::{json, Value};
use std::{process::Stdio, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::{io::AsyncWriteExt, process::Command};

use super::fs::ProjectState;

#[derive(Default)]
pub struct CloudBackupState {
    access: tokio::sync::Mutex<()>,
}

#[tauri::command]
pub async fn cloud_backup_request(
    app: AppHandle,
    state: tauri::State<'_, CloudBackupState>,
    project: tauri::State<'_, Mutex<ProjectState>>,
    mut request: Value,
) -> Result<Value, String> {
    let operation = request.get("type").and_then(Value::as_str).unwrap_or("").to_owned();
    if !matches!(operation.as_str(), "status" | "save" | "test" | "backup" | "list" | "restore") {
        return Err("CLOUD_CONFIG".into());
    }
    let _guard = state.access.try_lock().map_err(|_| "CLOUD_BUSY")?;
    if operation == "backup" || (operation == "status" && request.get("projectPath").is_some_and(Value::is_string)) {
        let expected = request.get("projectPath").and_then(Value::as_str).ok_or("CLOUD_PROJECT")?;
        let active = project.lock().map_err(|_| "CLOUD_PROJECT")?.project_path.clone().ok_or("CLOUD_PROJECT")?;
        let root = tokio::fs::canonicalize(expected).await.map_err(|_| "CLOUD_PROJECT")?;
        if root != tokio::fs::canonicalize(active).await.map_err(|_| "CLOUD_PROJECT")? {
            return Err("CLOUD_PROJECT".into());
        }
        request["projectPath"] = json!(root.to_string_lossy());
    }
    if operation == "restore" {
        let dialog_app = app.clone();
        let destination = tauri::async_runtime::spawn_blocking(move || {
            dialog_app.dialog().file().blocking_pick_folder()
        }).await.map_err(|_| "CLOUD_LOCAL")?;
        let Some(destination) = destination else { return Ok(Value::Null); };
        request["destination"] = json!(destination.into_path().map_err(|_| "CLOUD_PATH")?.to_string_lossy());
    }
    let directory = app.path().app_data_dir().map_err(|_| "CLOUD_LOCAL")?;
    let runtime = directory.join("cloud-backup-runtime");
    tokio::fs::create_dir_all(&runtime).await.map_err(|_| "CLOUD_LOCAL")?;
    for (name, source) in [
        ("cloud-backup.mjs", include_str!("../../../../../packages/academic-agent/src/cloud-backup.mjs")),
        ("object-store.mjs", include_str!("../../../../../packages/academic-agent/src/object-store.mjs")),
        ("storage.mjs", include_str!("../../../../../packages/academic-agent/src/storage.mjs")),
    ] {
        tokio::fs::write(runtime.join(name), source).await.map_err(|_| "CLOUD_LOCAL")?;
    }
    let bytes = serde_json::to_vec(&request).map_err(|_| "CLOUD_CONFIG")?;
    if bytes.len() > 64 * 1024 { return Err("CLOUD_SIZE_LIMIT".into()); }
    let mut command = Command::new(super::agent_runtime::node_binary()?);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.arg(runtime.join("cloud-backup.mjs"))
        .arg(directory.join("academic-agent").join("inkwell.sqlite"))
        .env("NODE_USE_ENV_PROXY", "1")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true).spawn().map_err(|_| "CLOUD_RUNTIME")?;
    let mut stdin = child.stdin.take().ok_or("CLOUD_RUNTIME")?;
    tokio::time::timeout(Duration::from_secs(30), stdin.write_all(&bytes)).await
        .map_err(|_| "CLOUD_TIMEOUT")?.map_err(|_| "CLOUD_RUNTIME")?;
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(3600), child.wait_with_output()).await
        .map_err(|_| "CLOUD_TIMEOUT")?.map_err(|_| "CLOUD_RUNTIME")?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(error.lines().find(|line| line.starts_with("CLOUD_") && line.len() <= 80)
            .unwrap_or("CLOUD_LOCAL").to_owned());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "CLOUD_RESPONSE".into())
}
