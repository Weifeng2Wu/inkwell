use super::util::command;
use std::collections::BTreeSet;
use std::time::Duration;

fn normalize_families(names: impl Iterator<Item = String>) -> Vec<String> {
    names
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && !name.starts_with('@'))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[cfg(target_os = "macos")]
fn collect_families(value: &serde_json::Value, families: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(family) = object.get("family").and_then(serde_json::Value::as_str) {
                families.push(family.to_string());
            }
            for child in object.values() {
                collect_families(child, families);
            }
        }
        serde_json::Value::Array(array) => {
            for child in array {
                collect_families(child, families);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    let mut process = {
        let mut process = command("powershell.exe");
        process.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; $fonts = New-Object System.Drawing.Text.InstalledFontCollection; try { $fonts.Families | ForEach-Object { $_.Name } } finally { $fonts.Dispose() }",
        ]);
        process
    };

    #[cfg(target_os = "macos")]
    let mut process = {
        let mut process = command("/usr/sbin/system_profiler");
        process.args(["SPFontsDataType", "-json"]);
        process
    };

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut process = {
        let mut process = command("fc-list");
        process.arg("--format=%{family}\n");
        process
    };

    process.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(30), process.output())
        .await
        .map_err(|_| "System font discovery timed out.".to_string())?
        .map_err(|error| format!("Could not list system fonts: {error}"))?;
    if !output.status.success() {
        return Err("System font discovery failed.".to_string());
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|_| "System font names were not valid UTF-8.".to_string())?;

    #[cfg(target_os = "macos")]
    let names = {
        let data: serde_json::Value = serde_json::from_str(&text)
            .map_err(|error| format!("Could not parse system fonts: {error}"))?;
        let mut families = Vec::new();
        collect_families(&data, &mut families);
        normalize_families(families.into_iter())
    };

    #[cfg(target_os = "windows")]
    let names = normalize_families(text.lines().map(String::from));

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let names = normalize_families(
        text.lines()
            .flat_map(|line| line.split(','))
            .map(String::from),
    );

    if names.is_empty() {
        return Err("No installed font families were found.".to_string());
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_deduplicates_font_families() {
        let names = [" Arial ", "", "Arial", "@Arial", "宋体", "Geist"];
        assert_eq!(
            normalize_families(names.into_iter().map(String::from)),
            vec!["Arial", "Geist", "宋体"]
        );
    }
}
