use keyring::Entry;
use sha2::{Digest, Sha256};

const SERVICE: &str = "com.inkwell.agent.api-key";

#[derive(Default)]
pub struct AgentCredentialState {
    access: tokio::sync::Mutex<()>,
}

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
    scope: String,
    state: tauri::State<'_, AgentCredentialState>,
) -> Result<Option<String>, String> {
    let account = credential_account(&scope)?;
    let _guard = state.access.lock().await;
    tokio::task::spawn_blocking(move || {
        let entry = Entry::new(SERVICE, &account)
            .map_err(|_| "System credential storage is unavailable.".to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read the API key from system credential storage.".into()),
        }
    })
    .await
    .map_err(|_| "Could not access system credential storage.".to_string())?
}

#[tauri::command]
pub async fn agent_api_key_write(
    scope: String,
    api_key: String,
    state: tauri::State<'_, AgentCredentialState>,
) -> Result<(), String> {
    let account = credential_account(&scope)?;
    if api_key.trim().is_empty() || api_key.len() > 16_384 {
        return Err("Invalid API key.".into());
    }
    let _guard = state.access.lock().await;
    tokio::task::spawn_blocking(move || {
        let entry = Entry::new(SERVICE, &account)
            .map_err(|_| "System credential storage is unavailable.".to_string())?;
        entry
            .set_password(api_key.trim())
            .map_err(|_| "Could not save the API key in system credential storage.".to_string())
    })
    .await
    .map_err(|_| "Could not access system credential storage.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{credential_account, SERVICE};
    use keyring::Entry;

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

    #[test]
    #[ignore = "Requires unlocked system credential storage"]
    fn platform_vault_round_trip() {
        let account = uuid::Uuid::new_v4().to_string();
        let service = format!("{SERVICE}.test");
        let entry = Entry::new(&service, &account).unwrap();
        entry.set_password("inkwell-test-first-key").unwrap();
        let reopened = Entry::new(&service, &account).unwrap();
        let first = reopened.get_password();
        let overwrite = reopened.set_password("inkwell-test-overwritten-key");
        let second = Entry::new(&service, &account).unwrap().get_password();
        let cleanup = reopened.delete_credential();
        assert_eq!(first.unwrap(), "inkwell-test-first-key");
        overwrite.unwrap();
        assert_eq!(second.unwrap(), "inkwell-test-overwritten-key");
        cleanup.unwrap();
    }
}
