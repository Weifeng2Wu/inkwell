use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

fn credential_account(scope: &str) -> Result<String, String> {
    if scope.len() > 4096 {
        return Err("Invalid credential scope.".into());
    }
    let (protocol, provider, base_url): (String, String, String) =
        serde_json::from_str(scope).map_err(|_| "Invalid credential scope.".to_string())?;
    if !["", "openai", "anthropic", "gemini"].contains(&protocol.as_str())
        || (protocol.is_empty() && provider.trim().is_empty())
    {
        return Err("Invalid credential provider.".into());
    }
    let endpoint = if protocol.is_empty() && base_url.is_empty() {
        String::new()
    } else {
        let parsed = url::Url::parse(base_url.trim())
            .map_err(|_| "Invalid credential endpoint.".to_string())?;
        if !["http", "https"].contains(&parsed.scheme())
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err("Invalid credential endpoint.".into());
        }
        parsed.as_str().trim_end_matches('/').to_string()
    };
    let provider = if protocol.is_empty() {
        provider
    } else {
        String::new()
    };
    let identity = serde_json::to_vec(&(protocol, provider, endpoint))
        .map_err(|_| "Invalid credential scope.".to_string())?;
    Ok(format!("{:x}", Sha256::digest(identity)))
}

#[tauri::command]
pub async fn agent_api_key_read(
    app: AppHandle,
    scope: String,
) -> Result<Option<String>, String> {
    let account = credential_account(&scope)?;
    let response = super::storage::internal_request(&app, json!({
        "type": "credential_read", "account": account,
    })).await?;
    match response.get("value") {
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(Value::Null) => Ok(None),
        _ => Err("Invalid API key database response.".into()),
    }
}

#[tauri::command]
pub async fn agent_api_key_write(
    app: AppHandle,
    scope: String,
    api_key: String,
) -> Result<(), String> {
    let account = credential_account(&scope)?;
    if api_key.trim().is_empty() || api_key.len() > 16_384 {
        return Err("Invalid API key.".into());
    }
    super::storage::internal_request(&app, json!({
        "type": "credential_write", "account": account, "apiKey": api_key.trim(),
    })).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::credential_account;

    #[test]
    fn normalizes_endpoints_and_separates_providers() {
        let first = credential_account(r#"["openai","","https://example.com/v1"]"#).unwrap();
        let equivalent =
            credential_account(r#"["openai","ignored","https://EXAMPLE.com/v1/"]"#).unwrap();
        assert_eq!(first, equivalent);
        assert_ne!(
            first,
            credential_account(r#"["anthropic","","https://example.com/v1"]"#).unwrap()
        );
        assert_ne!(
            first,
            credential_account(r#"["openai","","https://other.example/v1"]"#).unwrap()
        );
        assert_ne!(
            first,
            credential_account(r#"["","inkwell-imagegen","https://example.com/v1"]"#).unwrap()
        );
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn rejects_invalid_scopes_and_embedded_secrets() {
        for scope in [
            "invalid",
            r#"["invalid","","https://example.com"]"#,
            r#"["","",""]"#,
            r#"["openai","","file:///tmp/key"]"#,
            r#"["openai","","https://user:secret@example.com"]"#,
            r#"["openai","","https://example.com?key=secret"]"#,
        ] {
            assert!(credential_account(scope).is_err());
        }
    }

}
