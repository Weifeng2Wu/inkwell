use serde_json::{json, Value};
use std::{process::Stdio, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::{io::AsyncWriteExt, process::Command};
use tokio::sync::OnceCell;

static TRANSLATION_SCRIPT: OnceCell<std::path::PathBuf> = OnceCell::const_new();

fn key_scope(config: &Value, field: &str) -> Result<String, String> {
    let provider = config.get("provider").and_then(Value::as_str).ok_or("TRANSLATION_CONFIG")?;
    let endpoint = match provider {
        "google" => "https://translation.googleapis.com",
        "tencent" => "https://tmt.tencentcloudapi.com",
        "azure" => "https://api.cognitive.microsofttranslator.com",
        "llm" | "deeplx" | "deepl" => config.get("baseUrl").and_then(Value::as_str).ok_or("TRANSLATION_CONFIG")?.trim().trim_end_matches('/'),
        _ => return Err("TRANSLATION_CONFIG".into()),
    };
    let url = url::Url::parse(endpoint).map_err(|_| "TRANSLATION_CONFIG")?;
    if (url.scheme() != "https" && !(url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
    { return Err("TRANSLATION_CONFIG".into()); }
    Ok(json!(["", format!("translation-{provider}-{field}"), url.as_str().trim_end_matches('/')]).to_string())
}

#[tauri::command]
pub async fn translation_request(app: AppHandle, config: Value, text: String) -> Result<String, String> {
    if text.is_empty() || text.chars().count() > 5000 || text.len() > 20000 || config.to_string().len() > 8192 {
        return Err("TRANSLATION_TOO_LONG".into());
    }
    let provider = config.get("provider").and_then(Value::as_str).ok_or("TRANSLATION_CONFIG")?;
    let mut request = json!({"config": config, "text": text});
    if !["transmart", "volcano", "google-free", "deepl-web"].contains(&provider) {
        for field in if provider == "tencent" { vec!["key", "secretId"] } else { vec!["key"] } {
            let scope = key_scope(&config, field)?;
            let key = super::agent_credentials::agent_api_key_read(app.clone(), scope).await
                .map_err(|_| "TRANSLATION_KEY")?;
            match key {
                Some(key) => request[field] = Value::String(key),
                None if ["llm", "deeplx"].contains(&provider) => {},
                None => return Err("TRANSLATION_KEY".into()),
            }
        }
    }
    // Initialize once per app process so simultaneous pane requests cannot truncate
    // the script while another Node process is loading it. No credentials go to disk here.
    let script = TRANSLATION_SCRIPT.get_or_try_init(|| async {
        let directory = app.path().app_data_dir().map_err(|_| "TRANSLATION_RUNTIME")?.join("translation");
        tokio::fs::create_dir_all(&directory).await.map_err(|_| "TRANSLATION_RUNTIME")?;
        let script = directory.join("translation.mjs");
        tokio::fs::write(&script, include_str!("../../../../../packages/academic-agent/src/translation.mjs")).await.map_err(|_| "TRANSLATION_RUNTIME")?;
        Ok::<_, String>(script)
    }).await?;
    let node = super::agent_runtime::node_binary().map_err(|_| "TRANSLATION_RUNTIME")?;
    let mut command = Command::new(node);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true).spawn().map_err(|_| "TRANSLATION_RUNTIME")?;
    let mut stdin = child.stdin.take().ok_or("TRANSLATION_RUNTIME")?;
    stdin.write_all(&serde_json::to_vec(&request).map_err(|_| "TRANSLATION_CONFIG")?).await.map_err(|_| "TRANSLATION_RUNTIME")?;
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(70), child.wait_with_output()).await
        .map_err(|_| "TRANSLATION_TIMEOUT")?.map_err(|_| "TRANSLATION_RUNTIME")?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        // Accept only the script's closed error-code vocabulary, not arbitrary stderr.
        let code = message.trim();
        if code.starts_with("TRANSLATION_") && code.len() < 80 && code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_' || b == b' ') {
            return Err(code.into());
        }
        return Err("TRANSLATION_RUNTIME".into());
    }
    if output.stdout.len() > 256000 { return Err("TRANSLATION_RESPONSE".into()); }
    serde_json::from_slice(&output.stdout).map_err(|_| "TRANSLATION_RESPONSE".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scopes_are_dedicated_and_endpoints_are_restricted() {
        assert_eq!(key_scope(&json!({"provider":"google"}), "key").unwrap(), r#"["","translation-google-key","https://translation.googleapis.com"]"#);
        for endpoint in ["file:///tmp/key", "http://remote.example/v1", "https://user:secret@example.com", "https://example.com?key=secret"] {
            assert!(key_scope(&json!({"provider":"llm","baseUrl":endpoint}), "key").is_err());
        }
    }
}
