use std::{ffi::OsString, path::PathBuf};
use tokio::process::Command as TokioCommand;

pub fn merge_search_paths(original: Option<OsString>, fallbacks: &[PathBuf]) -> Vec<PathBuf> {
    let mut paths: Vec<_> = original
        .as_deref()
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .collect();
    for directory in fallbacks {
        if !paths.contains(directory) {
            paths.push(directory.clone());
        }
    }
    paths
}

/// Desktop launches do not inherit Homebrew or user CLI directories from a terminal.
pub fn cli_search_paths() -> Vec<PathBuf> {
    let mut fallbacks = Vec::new();
    #[cfg(unix)]
    {
        fallbacks.extend(
            [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/opt/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
                "/home/linuxbrew/.linuxbrew/bin",
            ]
            .map(PathBuf::from),
        );
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            for directory in [
                ".local/bin",
                ".cargo/bin",
                ".opencode/bin",
                ".npm-global/bin",
                ".npm/bin",
                ".volta/bin",
                ".bun/bin",
                ".asdf/shims",
                ".local/share/mise/shims",
                ".linuxbrew/bin",
            ] {
                fallbacks.push(home.join(directory));
            }
        }
    }
    #[cfg(windows)]
    {
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(directory) = std::env::var_os(variable) {
                let directory = PathBuf::from(directory);
                fallbacks.extend([directory.join("GitHub CLI"), directory.join("nodejs")]);
            }
        }
        if let Some(directory) = std::env::var_os("APPDATA") {
            fallbacks.push(PathBuf::from(directory).join("npm"));
        }
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let home = PathBuf::from(home);
            for directory in [
                ".local/bin",
                ".cargo/bin",
                ".opencode/bin",
                ".volta/bin",
                ".bun/bin",
                "scoop/shims",
            ] {
                fallbacks.push(home.join(directory));
            }
        }
    }
    for variable in ["NVM_BIN", "PNPM_HOME"] {
        if let Some(directory) = std::env::var_os(variable) {
            fallbacks.push(PathBuf::from(directory));
        }
    }
    merge_search_paths(std::env::var_os("PATH"), &fallbacks)
}

pub fn cli_environment_path() -> OsString {
    std::env::join_paths(cli_search_paths())
        .unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

pub fn cli_command(program: &str) -> TokioCommand {
    let mut cmd = command(program);
    cmd.env("PATH", cli_environment_path());
    cmd
}

/// Windows CREATE_NO_WINDOW flag to hide console windows
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Extension trait for TokioCommand to hide console windows on Windows
pub trait CommandExt {
    /// Configure the command to hide console window on Windows
    fn hide_window(&mut self) -> &mut Self;
}

impl CommandExt for TokioCommand {
    #[cfg(target_os = "windows")]
    fn hide_window(&mut self) -> &mut Self {
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }

    #[cfg(not(target_os = "windows"))]
    fn hide_window(&mut self) -> &mut Self {
        self
    }
}

/// Create a new TokioCommand with hidden window on Windows
pub fn command(program: &str) -> TokioCommand {
    let mut cmd = TokioCommand::new(program);
    cmd.hide_window();
    cmd
}
