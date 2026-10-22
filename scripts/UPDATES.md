# In-app updates

Settings → General → Software updates supports checking, downloading, signature verification, installation, and restart. English, Chinese, and Korean are supported.

Automatic updates are off by default. Turning the switch on persists the preference and immediately checks for updates. Enabled applications check on startup and every six hours, downloading signed updates in the background. A persistent notice lets the user save work and confirm installation. Windows exits to run the installer; macOS and Linux require a restart. A single shared updater keeps downloads alive when settings close and prevents duplicate requests.

## One-time release configuration

Generate a Tauri signing key on a trusted machine:

```sh
pnpm --dir apps/desktop exec tauri signer generate -w /secure/location/inkwell-updater.key
```

Keep the private key and password outside this repository. Preserve the same key for subsequent releases; installed clients trust its public key.

Configure the GitHub repository:

- Actions variable `INKWELL_UPDATER_PUBLIC_KEY`: the complete public key string from the generated `.pub` file.
- Actions secret `TAURI_SIGNING_PRIVATE_KEY`: private key file contents.
- Actions secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: key password (empty if generated without one).

The tag workflow builds signed macOS ARM64, Windows x64, and Linux x64 update packages, uploads packages and signatures, and generates `latest.json`. Manifest generation fails if any expected signed platform package is missing. Builds with no public key retain manual installer distribution and show that in-app updates are unavailable. Forks should change `plugins.updater.endpoints` in `tauri.conf.json` to their release repository.

`latest.json` is fetched from the latest stable GitHub release. Prereleases do not become the stable update channel. Linux automatic installation uses AppImage; DEB users should use their package manager. macOS Intel update packages are supported by the manifest generator but are not currently built by CI.

## Local builds

Set `INKWELL_UPDATER_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the build environment before `pnpm tauri:build`. The public key is compiled into the application; private signing credentials are only used by the bundler. Use the tag workflow to publish the cross-platform update manifest. `scripts/upload-to-github-release.sh` distributes DMG/PKG installers only and does not publish updates.

Existing versions without the updater need one manual installation of an update-enabled release. Future versions can then be installed in the application. End-to-end installation requires two signed release versions and must be checked on each supported OS before distribution.
