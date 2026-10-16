use serde_json::Value;
use std::{process::Stdio, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::{io::AsyncWriteExt, process::Command};

#[tauri::command]
pub async fn layout_parser_request(app: AppHandle, request: Value) -> Result<Value, String> {
    let directory = app.path().app_data_dir().map_err(|_| "App data unavailable.")?.join("layout-parser");
    tokio::fs::create_dir_all(&directory).await.map_err(|_| "Could not prepare layout parser.")?;
    for (name, content) in [
        ("layout-parser.mjs", include_str!("../../../../../packages/academic-agent/src/layout-parser.mjs")),
        ("zip-skills.mjs", include_str!("../../../../../packages/academic-agent/src/zip-skills.mjs")),
        ("library.mjs", include_str!("../../../../../packages/academic-agent/src/library.mjs")),
    ] {
        tokio::fs::write(directory.join(name), content).await.map_err(|_| "Could not prepare layout parser.")?;
    }
    let bytes = serde_json::to_vec(&request).map_err(|_| "Invalid parser request.")?;
    if bytes.len() > 18 * 1024 * 1024 { return Err("Parser request too large.".into()); }
    let node = std::env::var("INKWELL_NODE_BINARY").unwrap_or_else(|_| "node".into());
    let mut command = Command::new(node);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.arg(directory.join("layout-parser.mjs"))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true).spawn().map_err(|_| "Could not start layout parser. Check Node.js installation.")?;
    let mut stdin = child.stdin.take().ok_or("Parser unavailable.")?;
    stdin.write_all(&bytes).await.map_err(|_| "Could not send parser request.")?;
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(570), child.wait_with_output())
        .await.map_err(|_| "Layout parsing timed out.")?.map_err(|_| "Layout parser failed.")?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).chars().take(1200).collect::<String>();
        let key = request.get("apiKey").and_then(Value::as_str).unwrap_or("");
        return Err(if key.is_empty() { message } else { message.replace(key, "[REDACTED]") });
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Invalid parser response.".into())
}
