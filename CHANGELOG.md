## [2.5.2](https://github.com/Ddiidev/recordsaas/compare/v2.5.1...v2.5.2) (2026-03-12)


### Bug Fixes

* **release:** publish public Linux installers and portable assets ([1064cec](https://github.com/Ddiidev/recordsaas/commit/1064cec68e131cbf1f48b8d34a52752fb17815ec))

## [2.5.1](https://github.com/Ddiidev/recordsaas/compare/v2.5.0...v2.5.1) (2026-03-10)


### Bug Fixes

* **release:** add @semantic-release/github plugin to create GitHub Releases ([#15](https://github.com/Ddiidev/recordsaas/issues/15)) ([d67c87e](https://github.com/Ddiidev/recordsaas/commit/d67c87e5db6553e6282b17bacbd1bdda329ae099))

# [2.5.0](https://github.com/Ddiidev/recordsaas/compare/v2.4.2...v2.5.0) (2026-03-10)


### Features

* refactor recorder page and fix cut region drag behavior ([525acc9](https://github.com/Ddiidev/recordsaas/commit/525acc937e59a64e5ba77d698e76d9371abb7468))

## [2.4.2](https://github.com/Ddiidev/recordsaas/compare/v2.4.1...v2.4.2) (2026-03-06)


### Bug Fixes

* **release:** trigger semantic-release build ([d3813b2](https://github.com/Ddiidev/recordsaas/commit/d3813b29912e9fc93e43110af8a2f20a7f2b3d95))

## [2.4.1](https://github.com/Ddiidev/recordsaas/compare/v2.4.0...v2.4.1) (2026-03-02)


### Bug Fixes

* **editor:** correct blur layering and stabilize webcam playback/export sync ([#13](https://github.com/Ddiidev/recordsaas/issues/13)) ([ad3cafc](https://github.com/Ddiidev/recordsaas/commit/ad3cafc472436a22cbe9eefa04b81fd4427e2ea2))

# [2.4.0](https://github.com/Ddiidev/recordsaas/compare/v2.3.0...v2.4.0) (2026-03-01)


### Features

* **export-progress:** align compact widget with system theme and primary pulse border ([435869c](https://github.com/Ddiidev/recordsaas/commit/435869ca2788ab224f6a5d89e236ed8ac95e9fc0))

# [2.3.0](https://github.com/Ddiidev/recordsaas/compare/v2.2.0...v2.3.0) (2026-02-26)


### Features

* save and import projects using `.rsproj` extension ([#10](https://github.com/Ddiidev/recordsaas/issues/10)) ([3b0e780](https://github.com/Ddiidev/recordsaas/commit/3b0e780612b194b2b68c44895475f35bbafc0630))

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
