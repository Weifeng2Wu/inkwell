use super::{fs::ProjectState, util::command};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
};

struct Runtime {
    child: Child,
    stdin: ChildStdin,
    project: PathBuf,
}

#[derive(Default)]
pub struct ExternalAgentState {
    runtimes: tokio::sync::Mutex<HashMap<String, Runtime>>,
    install: tokio::sync::Mutex<()>,
    skills: tokio::sync::Mutex<()>,
    shutting_down: AtomicBool,
    shutdown_complete: AtomicBool,
}

impl ExternalAgentState {
    pub fn begin_shutdown(&self) -> bool {
        !self.shutting_down.swap(true, Ordering::SeqCst)
    }

    pub fn shutdown_complete(&self) -> bool {
        self.shutdown_complete.load(Ordering::SeqCst)
    }

    pub async fn stop_all(&self) {
        let mut runtimes = self.runtimes.lock().await;
        for (_, mut runtime) in runtimes.drain() {
            let _ = runtime.stdin.shutdown().await;
            stop_child(&mut runtime.child).await;
        }
        self.shutdown_complete.store(true, Ordering::SeqCst);
    }
}

async fn stop_child(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)]
        let _ = command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .await;
        #[cfg(unix)]
        let _ = command("/bin/kill")
            .args(["-KILL", &format!("-{pid}")])
            .output()
            .await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

struct Agent {
    id: &'static str,
    binary: &'static str,
    adapter: &'static str,
    args: &'static [&'static str],
    packages: &'static [&'static str],
}

const AGENTS: &[Agent] = &[
    Agent {
        id: "pi",
        binary: "pi",
        adapter: "pi-acp",
        args: &[],
        packages: &["@mariozechner/pi-coding-agent", "pi-acp@0.0.34"],
    },
    Agent {
        id: "opencode",
        binary: "opencode",
        adapter: "opencode",
        args: &["acp"],
        packages: &["opencode-ai"],
    },
    Agent {
        id: "claude",
        binary: "claude",
        adapter: "claude-agent-acp",
        args: &[],
        packages: &[
            "@anthropic-ai/claude-code",
            "@agentclientprotocol/claude-agent-acp@0.91.0",
        ],
    },
    Agent {
        id: "codex",
        binary: "codex",
        adapter: "codex-acp",
        args: &[],
        packages: &["@openai/codex", "@agentclientprotocol/codex-acp@2.2.2"],
    },
    Agent {
        id: "antigravity",
        binary: "agy",
        adapter: "agy_acp_server",
        args: if cfg!(target_os = "linux") {
            &["--uid="]
        } else {
            &[]
        },
        packages: &[],
    },
    Agent {
        id: "qoder",
        binary: "qodercli",
        adapter: "qodercli",
        args: &["--acp"],
        packages: &["@qoder-ai/qodercli@0.2.14"],
    },
    Agent {
        id: "grok",
        binary: "grok",
        adapter: "grok",
        args: &["agent", "stdio"],
        packages: &["@xai-official/grok@1.0.61"],
    },
    Agent {
        id: "deepseek",
        binary: "dsh",
        adapter: "dsh",
        args: &["--profile", "acp"],
        packages: &["@deepseek-ai/dsh@0.2.0-rc.2"],
    },
    Agent {
        id: "kimi",
        binary: "kimi",
        adapter: "kimi",
        args: &["acp"],
        packages: &[],
    },
    Agent {
        id: "zcode",
        binary: "zcode",
        adapter: "zcode-acp-server",
        args: &[],
        packages: &["zcode-acp-server@0.72.0"],
    },
];

fn agent(id: &str) -> Result<&'static Agent, String> {
    AGENTS
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Unknown agent.".into())
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("external-agents"))
}

struct AntigravityDistribution {
    archive: String,
    binary: &'static str,
}

fn antigravity_harness_binary(os: &str) -> &'static str {
    if os == "windows" {
        "localharness_external.exe"
    } else {
        "localharness_external"
    }
}

fn antigravity_harness_path(adapter: &Path, os: &str) -> Option<PathBuf> {
    Some(adapter.parent()?.join(antigravity_harness_binary(os)))
}

async fn antigravity_bundle_ready(adapter: &Path, os: &str) -> bool {
    let Some(harness) = antigravity_harness_path(adapter, os) else {
        return false;
    };
    let Ok(metadata) = tokio::fs::metadata(harness).await else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }
    true
}

fn antigravity_distribution(os: &str, arch: &str) -> Option<AntigravityDistribution> {
    let (folder, platform) = match (os, arch) {
        ("macos", "aarch64") => ("macos", "darwin-arm64"),
        ("macos", "x86_64") => ("macos", "darwin-x86_64"),
        ("linux", "aarch64") => ("linux", "linux-arm64"),
        ("linux", "x86_64") => ("linux", "linux-x86_64"),
        ("windows", "aarch64") => ("windows", "windows-arm64"),
        ("windows", "x86_64") => ("windows", "windows-x86_64"),
        _ => return None,
    };
    Some(AntigravityDistribution {
        archive: format!("https://dl.google.com/agy-extensions/releases/{folder}/agy-acp-server-1.4.0-{platform}.zip"),
        binary: if os == "windows" { "agy_acp_server.exe" } else { "agy_acp_server.par" },
    })
}

fn supports_installation(entry: &Agent, os: &str, arch: &str) -> bool {
    if entry.id == "antigravity" {
        return antigravity_distribution(os, arch).is_some();
    }
    !entry.packages.is_empty() || entry.id == "kimi"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn shutdown_is_idempotent_and_marks_completion_after_cleanup() {
        let state = ExternalAgentState::default();
        assert!(!state.shutdown_complete());
        assert!(state.begin_shutdown());
        assert!(!state.begin_shutdown());
        state.stop_all().await;
        assert!(state.shutdown_complete());
        assert!(state.runtimes.lock().await.is_empty());
    }

    #[test]
    fn antigravity_installation_supports_all_six_targets() {
        let entry = agent("antigravity").unwrap();
        assert!(entry.packages.is_empty());
        for os in ["windows", "macos", "linux"] {
            for arch in ["x86_64", "aarch64"] {
                assert!(supports_installation(entry, os, arch));
                let distribution = antigravity_distribution(os, arch).unwrap();
                assert!(distribution
                    .archive
                    .starts_with("https://dl.google.com/agy-extensions/releases/"));
                assert!(distribution.archive.ends_with(".zip"));
                assert_eq!(
                    distribution.binary,
                    if os == "windows" {
                        "agy_acp_server.exe"
                    } else {
                        "agy_acp_server.par"
                    }
                );
            }
        }
        assert!(!supports_installation(entry, "linux", "x86"));
        assert!(!supports_installation(entry, "freebsd", "x86_64"));
        assert!(supports_installation(
            agent("codex").unwrap(),
            "windows",
            "x86_64"
        ));
        assert!(supports_installation(
            agent("kimi").unwrap(),
            "linux",
            "aarch64"
        ));
    }

    #[test]
    fn cli_installers_keep_paths_as_separate_arguments() {
        let script = Path::new("folder with spaces/install.ps1");
        let bin = Path::new("folder with spaces/bin");
        for os in ["windows", "macos", "linux"] {
            let installer = antigravity_cli_installer(os, script, bin);
            let args: Vec<_> = installer.as_std().get_args().collect();
            assert_eq!(
                &args[args.len() - 3..],
                &[
                    script.as_os_str(),
                    std::ffi::OsStr::new("--dir"),
                    bin.as_os_str()
                ]
            );
        }
    }

    #[test]
    fn extraction_does_not_interpolate_paths_into_shell_code() {
        let archive = Path::new("folder with spaces/adapter.zip");
        let bin = Path::new("folder with spaces/bin");
        let unix = antigravity_archive_installer("linux", archive, bin, "agy_acp_server.par");
        let args: Vec<_> = unix.as_std().get_args().collect();
        assert_eq!(args.len(), 7);
        assert_eq!(args[2], archive.as_os_str());
        assert_eq!(args[3], "agy_acp_server.par");
        assert_eq!(args[4], "localharness_external");
        assert_eq!(args[6], bin.as_os_str());
        let windows = antigravity_archive_installer("windows", archive, bin, "agy_acp_server.exe");
        let env: HashMap<_, _> = windows.as_std().get_envs().collect();
        assert_eq!(
            env.get(std::ffi::OsStr::new("INKWELL_AGY_ARCHIVE")),
            Some(&Some(archive.as_os_str()))
        );
        assert_eq!(
            env.get(std::ffi::OsStr::new("INKWELL_AGY_BIN")),
            Some(&Some(bin.as_os_str()))
        );
        assert_eq!(
            env.get(std::ffi::OsStr::new("INKWELL_AGY_HARNESS")),
            Some(&Some(std::ffi::OsStr::new("localharness_external.exe")))
        );
        assert!(!windows
            .as_std()
            .get_args()
            .any(|arg| arg == archive.as_os_str()));
    }

    #[tokio::test]
    async fn adapter_without_companion_is_not_ready() {
        let directory =
            std::env::temp_dir().join(format!("inkwell-agy-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let adapter = directory.join("agy_acp_server.exe");
        tokio::fs::write(&adapter, b"test").await.unwrap();
        assert!(!antigravity_bundle_ready(&adapter, "windows").await);
        let harness = antigravity_harness_path(&adapter, "windows").unwrap();
        assert_eq!(harness, directory.join("localharness_external.exe"));
        tokio::fs::write(&harness, b"test").await.unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&harness, std::fs::Permissions::from_mode(0o755))
                .await
                .unwrap();
        }
        assert!(antigravity_bundle_ready(&adapter, "windows").await);
        assert_eq!(
            antigravity_harness_path(&directory.join("agy_acp_server.par"), "linux"),
            Some(directory.join("localharness_external"))
        );
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
}

fn antigravity_cli_installer(os: &str, script: &Path, bin: &Path) -> Command {
    if os == "windows" {
        let mut installer = command("powershell.exe");
        installer
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(script)
            .arg("--dir")
            .arg(bin);
        installer
    } else {
        let mut installer = command("bash");
        installer.arg(script).arg("--dir").arg(bin);
        installer
    }
}

fn antigravity_archive_installer(os: &str, archive: &Path, bin: &Path, binary: &str) -> Command {
    let harness = antigravity_harness_binary(os);
    if os == "windows" {
        let mut installer = command("powershell.exe");
        installer.args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead($env:INKWELL_AGY_ARCHIVE); try { $names = @($env:INKWELL_AGY_BINARY, $env:INKWELL_AGY_HARNESS); foreach ($name in $names) { if ($null -eq $zip.GetEntry($name)) { throw ('Required ACP bundle file is missing: ' + $name) } }; foreach ($name in $names) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry($name), (Join-Path $env:INKWELL_AGY_BIN $name), $true) } } finally { $zip.Dispose() }"])
            .env("INKWELL_AGY_ARCHIVE", archive).env("INKWELL_AGY_BIN", bin).env("INKWELL_AGY_BINARY", binary).env("INKWELL_AGY_HARNESS", harness);
        installer
    } else {
        let mut installer = command("unzip");
        installer
            .args(["-j", "-o"])
            .arg(archive)
            .arg(binary)
            .arg(harness)
            .arg("-d")
            .arg(bin);
        installer
    }
}

async fn download_antigravity_asset(
    app: &AppHandle,
    url: &str,
    destination: &Path,
    limit: usize,
) -> Result<(), String> {
    let _ = app.emit(
        "external-agent-install",
        json!({"agentId":"antigravity", "text":format!("Downloading {url}")}),
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5
                && attempt.url().scheme() == "https"
                && matches!(
                    attempt.url().host_str(),
                    Some("antigravity.google" | "dl.google.com")
                )
            {
                attempt.follow()
            } else {
                attempt.error("Installer redirect left the trusted Google download hosts.")
            }
        }))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("Official installer download exceeded the size limit.".into());
    }
    let temporary = destination.with_extension("download");
    let mut file = tokio::fs::File::create(&temporary)
        .await
        .map_err(|error| error.to_string())?;
    let mut size = 0;
    let mut reported = 0;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        size += chunk.len();
        if size > limit {
            return Err("Official installer download exceeded the size limit.".into());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        if size - reported >= 8 * 1024 * 1024 {
            reported = size;
            let _ = app.emit("external-agent-install", json!({"agentId":"antigravity", "text":format!("Downloaded {} MiB", size / (1024 * 1024))}));
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    if size == 0 {
        return Err("The official installer download was empty.".into());
    }
    tokio::fs::rename(temporary, destination)
        .await
        .map_err(|error| error.to_string())
}

async fn install_antigravity(app: &AppHandle, directory: &Path) -> Result<(), String> {
    let os = std::env::consts::OS;
    let distribution = antigravity_distribution(os, std::env::consts::ARCH).ok_or("Antigravity automatic installation requires 64-bit Windows, macOS or Linux (x86_64/ARM64).")?;
    let bin = directory.join("bin");
    tokio::fs::create_dir_all(&bin)
        .await
        .map_err(|error| error.to_string())?;
    if executable(app, "antigravity", "agy").await?.is_none() {
        let extension = if os == "windows" { "ps1" } else { "sh" };
        let script = directory.join(format!("install.{extension}"));
        download_antigravity_asset(
            app,
            &format!("https://antigravity.google/cli/install.{extension}"),
            &script,
            1024 * 1024,
        )
        .await?;
        run_installer(
            app,
            "antigravity",
            antigravity_cli_installer(os, &script, &bin),
            directory,
        )
        .await?;
        if executable(app, "antigravity", "agy").await?.is_none() {
            return Err(
                "The official installer exited without installing the Antigravity CLI.".into(),
            );
        }
    }
    let adapter = executable(app, "antigravity", "agy_acp_server").await?;
    let complete = match adapter {
        Some(adapter) => antigravity_bundle_ready(&adapter, os).await,
        None => false,
    };
    if !complete {
        let archive = directory.join("acp-adapter.zip");
        download_antigravity_asset(app, &distribution.archive, &archive, 512 * 1024 * 1024)
            .await
            .map_err(|error| {
                format!(
                    "Antigravity CLI is installed, but the ACP adapter download failed: {error}"
                )
            })?;
        run_installer(
            app,
            "antigravity",
            antigravity_archive_installer(os, &archive, &bin, distribution.binary),
            directory,
        )
        .await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for binary in [distribution.binary, antigravity_harness_binary(os)] {
                tokio::fs::set_permissions(
                    bin.join(binary),
                    std::fs::Permissions::from_mode(0o755),
                )
                .await
                .map_err(|error| error.to_string())?;
            }
        }
        if executable(app, "antigravity", "agy_acp_server")
            .await?
            .is_none()
        {
            return Err("The ACP executable was not found after extraction.".into());
        }
        if !antigravity_bundle_ready(&bin.join(distribution.binary), os).await {
            return Err("The Antigravity ACP bundle is incomplete: localharness is missing or not executable.".into());
        }
    }
    let _ = app.emit(
        "external-agent-install",
        json!({"agentId":"antigravity", "text":"Antigravity CLI and ACP adapter are installed."}),
    );
    Ok(())
}

async fn executable(app: &AppHandle, id: &str, name: &str) -> Result<Option<PathBuf>, String> {
    if name.is_empty() {
        return Ok(None);
    }
    let mut directories = vec![
        root(app)?.join(id).join("node_modules/.bin"),
        root(app)?.join(id).join("bin"),
    ];
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        directories.extend([
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join(".opencode/bin"),
        ]);
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    if id == "antigravity" {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local).join("agy/bin"));
        }
    }
    for directory in directories {
        for suffix in if cfg!(windows) {
            &[".exe", ".cmd", ".bat", ""][..]
        } else if name == "agy_acp_server" {
            &["", ".par"][..]
        } else {
            &[""][..]
        } {
            let candidate = directory.join(format!("{name}{suffix}"));
            if let Ok(metadata) = tokio::fs::metadata(&candidate).await {
                if !metadata.is_file() {
                    continue;
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if metadata.permissions().mode() & 0o111 == 0 {
                        continue;
                    }
                }
                return Ok(Some(candidate));
            }
        }
    }
    Ok(None)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    id: String,
    installed: bool,
    acp_ready: bool,
    path: Option<String>,
    adapter_path: Option<String>,
    installable: bool,
}

#[tauri::command]
pub async fn external_agent_detect(app: AppHandle) -> Result<Vec<AgentStatus>, String> {
    let mut statuses = Vec::new();
    for entry in AGENTS {
        let mut binary = executable(&app, entry.id, entry.binary).await?;
        if entry.id == "zcode" && binary.is_none() {
            let mut candidates = Vec::new();
            if let Some(path) = std::env::var_os("ZCODE_BIN") {
                candidates.push(PathBuf::from(path));
            }
            if cfg!(target_os = "macos") {
                candidates.push(PathBuf::from(
                    "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs",
                ));
            }
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                candidates
                    .push(PathBuf::from(local).join("Programs/ZCode/resources/glm/zcode.cjs"));
            }
            for path in candidates {
                if tokio::fs::metadata(&path)
                    .await
                    .is_ok_and(|metadata| metadata.is_file())
                {
                    binary = Some(path);
                    break;
                }
            }
        }
        let adapter = executable(&app, entry.id, entry.adapter).await?;
        let acp_ready = match &adapter {
            Some(path) if entry.id == "antigravity" => {
                antigravity_bundle_ready(path, std::env::consts::OS).await
            }
            Some(_) => true,
            None => false,
        };
        statuses.push(AgentStatus {
            id: entry.id.into(),
            installed: binary.is_some(),
            acp_ready,
            path: binary.map(|path| path.to_string_lossy().into_owned()),
            adapter_path: adapter.map(|path| path.to_string_lossy().into_owned()),
            installable: supports_installation(entry, std::env::consts::OS, std::env::consts::ARCH),
        });
    }
    Ok(statuses)
}

#[tauri::command]
pub async fn external_agent_install(
    app: AppHandle,
    state: tauri::State<'_, ExternalAgentState>,
    agent_id: String,
) -> Result<(), String> {
    let entry = agent(&agent_id)?;
    let _guard = state
        .install
        .try_lock()
        .map_err(|_| "Another agent installation is running.".to_string())?;
    let directory = root(&app)?.join(entry.id);
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| error.to_string())?;
    if entry.id == "antigravity" {
        return install_antigravity(&app, &directory).await;
    }
    let installer = if entry.id == "kimi" {
        let mut installer = command("uv");
        installer
            .args(["tool", "install", "kimi-cli==1.52.0"])
            .env("UV_TOOL_DIR", directory.join("tools"))
            .env("UV_TOOL_BIN_DIR", directory.join("bin"));
        installer
    } else {
        if entry.packages.is_empty() {
            return Err(
                "No verified automatic installer. Configure an existing ACP executable.".into(),
            );
        }
        let mut installer = command(if cfg!(windows) { "npm.cmd" } else { "npm" });
        installer
            .args(["install", "--no-audit", "--no-fund", "--prefix"])
            .arg(&directory)
            .args(entry.packages);
        installer
    };
    run_installer(&app, &agent_id, installer, &directory).await
}

async fn run_installer(
    app: &AppHandle,
    agent_id: &str,
    mut installer: Command,
    directory: &Path,
) -> Result<(), String> {
    #[cfg(unix)]
    installer.process_group(0);
    let mut child = installer
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            format!("Could not start installer (check npm/uv, bash, PowerShell or unzip availability): {error}")
        })?;
    let stdout = child.stdout.take().ok_or("Installer output unavailable.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Installer error output unavailable.")?;
    for stream in [
        Box::new(stdout) as Box<dyn tokio::io::AsyncRead + Send + Unpin>,
        Box::new(stderr),
    ] {
        let app = app.clone();
        let id = agent_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stream.take(1024 * 1024)).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit("external-agent-install", json!({"agentId":id,"text":line}));
            }
        });
    }
    let status = match tokio::time::timeout(Duration::from_secs(600), child.wait()).await {
        Ok(status) => status.map_err(|error| error.to_string())?,
        Err(_) => {
            stop_child(&mut child).await;
            return Err("Installation timed out.".into());
        }
    };
    if !status.success() {
        return Err(format!(
            "Installation failed ({status}). See installation output."
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct LaunchOverride {
    command: String,
    args: Vec<String>,
}

#[tauri::command]
pub async fn external_agent_start(
    app: AppHandle,
    state: tauri::State<'_, ExternalAgentState>,
    project: tauri::State<'_, Mutex<ProjectState>>,
    agent_id: String,
    launch: Option<LaunchOverride>,
) -> Result<String, String> {
    let entry = agent(&agent_id)?;
    let project_path = project
        .lock()
        .map_err(|_| "Project state unavailable.")?
        .project_path
        .clone()
        .ok_or("Open a project first.")?;
    let project_path = tokio::fs::canonicalize(project_path)
        .await
        .map_err(|error| error.to_string())?;
    let automatic = launch.is_none();
    let (program, args) = if let Some(launch) = launch {
        if launch.command.trim().is_empty()
            || launch.command.len() > 4096
            || launch.args.len() > 64
            || launch.args.iter().any(|arg| arg.len() > 4096)
        {
            return Err("Invalid ACP command.".into());
        }
        if !PathBuf::from(&launch.command).is_absolute() {
            return Err("Custom ACP executable must be an absolute path.".into());
        }
        (launch.command, launch.args)
    } else {
        let program = executable(&app, entry.id, entry.adapter).await?.ok_or(
            "ACP executable not found. Install the adapter or configure its absolute path.",
        )?;
        (
            program.to_string_lossy().into_owned(),
            entry.args.iter().map(|arg| (*arg).to_string()).collect(),
        )
    };
    if automatic
        && entry.id == "antigravity"
        && !antigravity_bundle_ready(Path::new(&program), std::env::consts::OS).await
    {
        return Err("Antigravity ACP installation is incomplete: localharness is missing. Open Settings > Agent and install / repair the ACP adapter. No additional login is needed to repair the bundle.".into());
    }
    let mut guard = state.runtimes.lock().await;
    if state.shutting_down.load(Ordering::SeqCst) {
        return Err("Inkwell is shutting down.".into());
    }
    for (_, mut runtime) in guard.drain() {
        let _ = runtime.stdin.shutdown().await;
        stop_child(&mut runtime.child).await;
    }
    let directory = root(&app)?.join(entry.id);
    let mut paths = vec![directory.join("node_modules/.bin"), directory.join("bin")];
    if entry.id == "antigravity" {
        if let Some(cli) = executable(&app, entry.id, entry.binary).await? {
            if let Some(parent) = cli.parent() {
                paths.push(parent.to_path_buf());
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path));
    }
    let mut launcher = command(&program);
    if automatic && entry.id == "antigravity" {
        if let Some(harness) = antigravity_harness_path(Path::new(&program), std::env::consts::OS) {
            launcher.env("ANTIGRAVITY_HARNESS_PATH", harness);
        }
    }
    #[cfg(unix)]
    launcher.process_group(0);
    let review_workspace = super::agent_review::workspace(&app, &project_path).await?;
    let mut child = launcher
        .args(args)
        .env(
            "PATH",
            std::env::join_paths(paths).map_err(|error| error.to_string())?,
        )
        .current_dir(&review_workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdin = child.stdin.take().ok_or("ACP stdin unavailable.")?;
    let stdout = child.stdout.take().ok_or("ACP stdout unavailable.")?;
    let stderr = child.stderr.take().ok_or("ACP stderr unavailable.")?;
    let id = uuid::Uuid::new_v4().to_string();
    let event_id = id.clone();
    let event_app = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            let result = (&mut reader)
                .take(4 * 1024 * 1024 + 1)
                .read_until(b'\n', &mut bytes)
                .await;
            match result {
                Ok(0) | Err(_) => break,
                Ok(_) if bytes.len() > 4 * 1024 * 1024 => break,
                Ok(_) => {
                    if let Ok(message) = serde_json::from_slice::<Value>(&bytes) {
                        let _ = event_app.emit(
                            "external-agent-event",
                            json!({"runtimeId":event_id,"message":message}),
                        );
                    }
                }
            }
        }
        let state = event_app.state::<ExternalAgentState>();
        let mut guard = state.runtimes.lock().await;
        if let Some(mut runtime) = guard.remove(&event_id) {
            stop_child(&mut runtime.child).await;
        }
        drop(guard);
        let _ = event_app.emit(
            "external-agent-event",
            json!({"runtimeId":event_id,"exit":true}),
        );
    });
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        loop {
            let mut bytes = Vec::new();
            match (&mut reader).take(8193).read_until(b'\n', &mut bytes).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });
    guard.insert(
        id.clone(),
        Runtime {
            child,
            stdin,
            project: project_path,
        },
    );
    Ok(id)
}

#[tauri::command]
pub async fn external_agent_send(
    app: AppHandle,
    state: tauri::State<'_, ExternalAgentState>,
    project: tauri::State<'_, Mutex<ProjectState>>,
    runtime_id: String,
    mut message: Value,
) -> Result<(), String> {
    let current = project
        .lock()
        .map_err(|_| "Project state unavailable.")?
        .project_path
        .clone()
        .ok_or("Open a project first.")?;
    let current = tokio::fs::canonicalize(current)
        .await
        .map_err(|error| error.to_string())?;
    let mut guard = state.runtimes.lock().await;
    let runtime = guard
        .get_mut(&runtime_id)
        .ok_or("External agent disconnected.")?;
    if runtime.project != current {
        return Err("ACP session belongs to another project.".into());
    }
    if message.get("method").and_then(Value::as_str) == Some("session/new") {
        let work = super::agent_review::workspace(&app, &current).await?;
        message["params"]["cwd"] = Value::String(work.to_string_lossy().into_owned());
    }
    let mut bytes = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("ACP request too large.".into());
    }
    bytes.push(b'\n');
    tokio::time::timeout(Duration::from_secs(10), runtime.stdin.write_all(&bytes))
        .await
        .map_err(|_| "ACP write timed out.".to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn external_agent_stop(
    state: tauri::State<'_, ExternalAgentState>,
    runtime_id: String,
) -> Result<(), String> {
    if let Some(mut runtime) = state.runtimes.lock().await.remove(&runtime_id) {
        let _ = runtime.stdin.shutdown().await;
        stop_child(&mut runtime.child).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_shared_skills(
    app: AppHandle,
    state: tauri::State<'_, ExternalAgentState>,
    request: Value,
) -> Result<Value, String> {
    let _guard = state.skills.lock().await;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("academic-agent");
    tokio::fs::create_dir_all(directory.join("skills"))
        .await
        .map_err(|error| error.to_string())?;
    for (name, content) in [
        ("storage.mjs", include_str!("../../../../../packages/academic-agent/src/storage.mjs")),
        (
            "library.mjs",
            include_str!("../../../../../packages/academic-agent/src/library.mjs"),
        ),
        (
            "market.mjs",
            include_str!("../../../../../packages/academic-agent/src/market.mjs"),
        ),
        (
            "shared-skills.mjs",
            include_str!("../../../../../packages/academic-agent/src/shared-skills.mjs"),
        ),
        (
            "format-review.mjs",
            include_str!("../../../../../packages/academic-agent/src/format-review.mjs"),
        ),
        (
            "github-skills.mjs",
            include_str!("../../../../../packages/academic-agent/src/github-skills.mjs"),
        ),
        (
            "zip-skills.mjs",
            include_str!("../../../../../packages/academic-agent/src/zip-skills.mjs"),
        ),
        (
            "skills/github-bundle.json",
            include_str!("../../../../../packages/academic-agent/skills/github-bundle.json"),
        ),
        (
            "skills/nature-bundle.json",
            include_str!("../../../../../packages/academic-agent/skills/nature-bundle.json"),
        ),
        (
            "skills/poster-bundle.json",
            include_str!("../../../../../packages/academic-agent/skills/poster-bundle.json"),
        ),
    ] {
        tokio::fs::write(directory.join(name), content)
            .await
            .map_err(|error| error.to_string())?;
    }
    if !tokio::fs::try_exists(directory.join("skills/registry.json"))
        .await
        .map_err(|error| error.to_string())?
    {
        tokio::fs::write(
            directory.join("skills/registry.json"),
            "{\"schemaVersion\":1,\"skills\":[]}",
        )
        .await
        .map_err(|error| error.to_string())?;
    }
    let max_request_bytes = if request.get("type").and_then(Value::as_str)
        == Some("format_requirements_zip")
    {
        17 * 1024 * 1024
    } else {
        512 * 1024
    };
    let request = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    if request.len() > max_request_bytes {
        return Err("Skill request too large.".into());
    }
    let node = super::agent_runtime::node_binary()?;
    let mut child = command(node.to_str().ok_or("Invalid Node.js executable path.")?)
        .arg(directory.join("shared-skills.mjs"))
        .arg(directory.join("skills"))
        .env("INKWELL_DATABASE_PATH", directory.join("inkwell.sqlite"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| error.to_string())?;
    let mut stdin = child.stdin.take().ok_or("Skill service unavailable.")?;
    stdin
        .write_all(&request)
        .await
        .map_err(|error| error.to_string())?;
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(30), child.wait_with_output())
        .await
        .map_err(|_| "Skill service timed out.".to_string())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(1500)
            .collect());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}
