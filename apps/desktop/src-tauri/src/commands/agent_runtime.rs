use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn node_binary() -> Result<PathBuf, String> {
    if let Some(binary) = std::env::var_os("INKWELL_NODE_BINARY") {
        return Ok(PathBuf::from(binary));
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from("node"));
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = executable.parent().ok_or("Application directory is unavailable.")?;
    Ok(directory.join(if cfg!(windows) { "inkwell-node.exe" } else { "inkwell-node" }))
}

pub async fn sdk_path(app: &AppHandle, development_root: PathBuf) -> Result<PathBuf, String> {
    let sdk = if let Some(root) = std::env::var_os("INKWELL_AGENT_RUNTIME_ROOT") {
        PathBuf::from(root).join("packages/coding-agent/dist/index.js")
    } else if cfg!(debug_assertions) {
        development_root.join("packages/coding-agent/dist/index.js")
    } else {
        app.path().resource_dir().map_err(|error| error.to_string())?
            .join("agent/sdk/dist/index.js")
    };
    tokio::fs::canonicalize(sdk).await.map_err(|_| {
        if cfg!(debug_assertions) {
            "Agent runtime is unavailable. Run `pnpm agent:setup` for this platform.".into()
        } else {
            "Bundled Agent runtime is missing. Reinstall Inkwell from a complete desktop installer.".into()
        }
    })
}
