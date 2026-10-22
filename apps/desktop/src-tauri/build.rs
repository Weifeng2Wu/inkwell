fn main() {
    println!("cargo:rerun-if-env-changed=INKWELL_UPDATER_PUBLIC_KEY");
    let mut attributes = tauri_build::Attributes::new();
    if let Some(value) = std::env::var_os("STATIC_VCRUNTIME") {
        std::env::remove_var("STATIC_VCRUNTIME");
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new().static_vc_runtime(value != "false"),
        );
    }
    tauri_build::try_build(attributes).expect("Failed to build Tauri application");
}
