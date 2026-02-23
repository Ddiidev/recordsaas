## [2.0.4](https://github.com/Ddiidev/recordsaas/compare/v2.0.3...v2.0.4) (2026-02-23)


### Performance Improvements

* remove async/await from render pipeline and reduce webcam syncs ([#5](https://github.com/Ddiidev/recordsaas/issues/5)) ([c07765f](https://github.com/Ddiidev/recordsaas/commit/c07765f8ff39a14c9f9acafe0cd486df4aa1baf3))

## [2.0.3](https://github.com/Ddiidev/recordsaas/compare/v2.0.2...v2.0.3) (2026-02-22)


### Bug Fixes

* **build:** regenerate app icons with correct dimensions for electron-builder ([#4](https://github.com/Ddiidev/recordsaas/issues/4)) ([2796139](https://github.com/Ddiidev/recordsaas/commit/2796139b38127a23dc28721b950aa1573df954ea))

## [2.0.2](https://github.com/Ddiidev/recordsaas/compare/v2.0.1...v2.0.2) (2026-02-22)


### Performance Improvements

* optimize video rendering pipeline — 2x faster on CPU, ~1.7x on GPU ([#3](https://github.com/Ddiidev/recordsaas/issues/3)) ([a2142d5](https://github.com/Ddiidev/recordsaas/commit/a2142d5e5f2a5ebe1a1bde0e4defc99ddeb4eb5e))

## [2.0.1](https://github.com/Ddiidev/recordsaas/compare/v2.0.0...v2.0.1) (2026-02-21)


### Bug Fixes

* **ci:** fix artifact upload glob pattern for upload-artifact@v4 ([#2](https://github.com/Ddiidev/recordsaas/issues/2)) ([86fdffe](https://github.com/Ddiidev/recordsaas/commit/86fdffeaccd068e9e3e2fa2ddb6b2241c76346da))

# [2.0.0](https://github.com/Ddiidev/recordsaas/compare/v1.2.6...v2.0.0) (2026-02-21)


* feat!: redesign recorder and editor UI with tooltips, home button, and transparency tweaks ([#1](https://github.com/Ddiidev/recordsaas/issues/1)) ([79845e0](https://github.com/Ddiidev/recordsaas/commit/79845e03b0aad557676b08962b7fb4824f197552))


### BREAKING CHANGES

* EditorPage now includes a Home button that closes the editor window and reopens the RecorderPage. This changes the window lifecycle behavior of the application.

# Changelog

All notable changes to this project will be documented in this file.
