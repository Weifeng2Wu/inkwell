use std::{
    ffi::{OsStr, OsString},
    path::PathBuf,
};
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

#[cfg(any(windows, test))]
fn windows_cli_fallbacks(environment: impl Fn(&str) -> Option<OsString>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for (variable, directories) in [
        (
            "ProgramW6432",
            &["GitHub CLI", "WinGet/Links", "nodejs"][..],
        ),
        (
            "ProgramFiles",
            &["GitHub CLI", "WinGet/Links", "nodejs"][..],
        ),
        ("ProgramFiles(x86)", &["GitHub CLI", "nodejs"][..]),
        (
            "LOCALAPPDATA",
            &[
                "GitHub CLI",
                "Programs/GitHub CLI",
                "Microsoft/WinGet/Links",
                "Microsoft/WindowsApps",
                "nodejs",
            ][..],
        ),
        ("APPDATA", &["npm"][..]),
        (
            "USERPROFILE",
            &[
                ".local/bin",
                ".cargo/bin",
                ".opencode/bin",
                ".volta/bin",
                ".bun/bin",
                "scoop/shims",
            ][..],
        ),
        ("SCOOP", &["shims"][..]),
        ("SCOOP_GLOBAL", &["shims"][..]),
        ("ChocolateyInstall", &["bin"][..]),
        ("ProgramData", &["chocolatey/bin", "scoop/shims"][..]),
    ] {
        if let Some(directory) = environment(variable).filter(|value| !value.is_empty()) {
            let directory = PathBuf::from(directory);
            paths.extend(directories.iter().map(|suffix| directory.join(suffix)));
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
    fallbacks.extend(windows_cli_fallbacks(|variable| std::env::var_os(variable)));
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

pub fn cli_command(program: impl AsRef<OsStr>) -> TokioCommand {
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
pub fn command(program: impl AsRef<OsStr>) -> TokioCommand {
    let mut cmd = TokioCommand::new(program);
    cmd.hide_window();
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_paths_include_user_installs_and_custom_package_managers() {
        let paths = windows_cli_fallbacks(|variable| match variable {
            "LOCALAPPDATA" => Some("local-app-data".into()),
            "ProgramW6432" => Some("program-files".into()),
            "SCOOP" => Some("custom-scoop".into()),
            "SCOOP_GLOBAL" => Some("global-scoop".into()),
            "ChocolateyInstall" => Some("custom-chocolatey".into()),
            "ProgramData" => Some("program-data".into()),
            _ => None,
        });
        for expected in [
            "local-app-data/Programs/GitHub CLI",
            "local-app-data/Microsoft/WinGet/Links",
            "program-files/GitHub CLI",
            "program-files/WinGet/Links",
            "custom-scoop/shims",
            "global-scoop/shims",
            "custom-chocolatey/bin",
            "program-data/chocolatey/bin",
        ] {
            assert!(paths.contains(&PathBuf::from(expected)), "{expected}");
        }
    }

    #[test]
    fn windows_paths_ignore_missing_or_empty_environment_values() {
        assert!(windows_cli_fallbacks(|_| None).is_empty());
        assert!(windows_cli_fallbacks(|_| Some(OsString::new())).is_empty());
    }
}
