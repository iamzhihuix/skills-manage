# User Testing

## Validation Surface

**Primary surface:** Tauri v2 desktop app webview, accessible at `http://localhost:24200` during `pnpm tauri dev`.

**Testing tool:** `agent-browser` — connects to the Vite dev server URL to interact with the React UI.

**Setup requirements:**
1. `pnpm tauri dev` must be running (starts both Vite and Tauri)
2. Wait for the webview to load at localhost:24200
3. The scanner runs automatically on startup — wait for sidebar to populate before testing
4. If port `24200` is already occupied, start Tauri with a merged config override on another allowed port in `24200-24210` (for example `pnpm tauri dev -c '{"build":{"beforeDevCommand":"pnpm exec vite --port 24202","devUrl":"http://localhost:24202"}}'`) and point validators at that port.

**Known constraints:**
- Tauri file dialogs (import/export) cannot be tested via agent-browser; test the underlying logic via the UI state changes instead.
- Symlink creation requires actual filesystem access — tests should use a controlled test fixture directory.
- Opening the dev URL in a regular browser does **not** expose Tauri globals (`window.__TAURI__` / `window.__TAURI_INTERNALS__` stay undefined), so Tauri-backed state may appear incomplete there. For those cases, validate the native `skills-manage` window itself and capture evidence via macOS window screenshots.

## Validation Concurrency

**Machine:** macOS, 48 GB RAM, 12 CPU cores.

**agent-browser surface:**
- Tauri dev server: ~200 MB RAM
- Each agent-browser instance: ~300 MB RAM
- Available headroom (70% of free): ~29 GB
- **Max concurrent validators: 5**

## Flow Validator Guidance: agent-browser

- Use the shared dev server at `http://localhost:24200` unless the assigned isolation context specifies an alternate port.
- For user-testing validation, run the app with an assigned isolated `HOME` under `/tmp/skills-manage-test-fixtures/` so scanning uses fixture data instead of the real user home.
- Stay within that fixture home and the assigned evidence/output directories; do not inspect or modify real `~/.*skills/` directories.
- For milestone reruns that rely on native macOS Tauri window automation, use a single validator at a time because window focus and AX interactions are global shared state.
- Tauri `app.path().home_dir()` follows the launched process `HOME`, so validators can isolate both the scan roots and `~/.skillsmanage/` database by starting `pnpm tauri dev` with `HOME=/tmp/...`.
- The foundation and platform-views assertions each share one startup scan and one backing SQLite DB under the isolated HOME, so keep each milestone's assertion set serialized inside its assigned validator.
- If the browser preview does not reflect Tauri state, use the native `skills-manage` window as the real user surface and capture evidence with macOS `screencapture` (preferred over Quartz image capture when the latter skews the Tauri window).

## Native macOS Tauri Automation

- When the browser preview lacks Tauri globals and `System Events` AppleScript becomes unreliable, a dependable fallback is Python + PyObjC.
- Install user-local helpers with `python3 -m pip install --user pyobjc-framework-Quartz pyobjc-framework-ApplicationServices pillow`.
- Use `ApplicationServices.AXUIElementCopyAttributeValue` to locate sidebar `AXButton` elements such as `Claude Code 2` or `Central Skills 3`, then trigger navigation with `AXUIElementPerformAction(..., "AXPress")`.
- Directly setting `AXValue` on WKWebView-backed `AXTextField` elements may not trigger React `onChange`; when that happens, post keyboard events with `Quartz.CGEventPostToPid(...)` to the Tauri app PID (not the helper/webview PID) so the real user input path updates the field.
- Even when the `skills-manage` window refuses to become frontmost, keep probing the AX tree before declaring the run blocked: if the sidebar buttons or Settings flavor `AXCheckBox` controls are exposed, `AXUIElementPerformAction(..., "AXPress")` can still drive the native UI without foreground activation.
- Prefer macOS `screencapture` for evidence images; Quartz window APIs remain useful for window metadata/selection, but `CGWindowListCreateImage(...)` can skew the captured Tauri pixels for this app.
- In some sessions the Tauri window stays on-screen but never becomes frontmost: `CGWindowListCopyWindowInfo(...)` shows the `skills-manage` window, yet `AXFrontmost` stays false and the AX tree collapses to recursive `AXApplication`/`AXMenuBar` nodes. If `System Events`, `NSRunningApplication.activate`, `SetFrontProcess`, and synthetic `CGEvent` clicks all fail to foreground the window, capture evidence with `screencapture -l <window-id>` plus OCR/SQLite checks and treat interaction-dependent assertions as blocked.
- For native `NSOpenPanel` file pickers, the left sidebar locations can be changed reliably by setting the target `AXRow`'s `AXSelected` attribute to `true` and then performing `AXShowDefaultUI`; the `Where:` popup updates immediately (for example, to `Downloads`).
- In this environment, `NSOpenPanel` list-view file rows can report `AXSelected=true` while the `Open` button still stays disabled; `AXConfirm`, `AXOpen`, keyboard Enter/Return, and synthetic clicks were not sufficient to complete the file-pick action for collection import validation, so treat that step as a native-dialog automation blocker unless you have a proven real-click path.

## Milestone 8 GitHub Import Validation Inputs

- Public network access to GitHub endpoints used by the backend preview/import path must be available during validation.
- **Single-skill repo:** `https://github.com/dorukardahan/twitterapi-io-skill`
- **Default multi-skill repo:** `https://github.com/anthropics/skills`
- **Backup multi-skill repo:** `https://github.com/cloudflare/skills`
- Run Milestone 8 validation under an isolated `HOME` and verify that preview leaves the isolated `~/.agents/skills/` empty until the user confirms import.
- For duplicate-resolution validation, either pre-seed an isolated central skill with a matching imported skill name or repeat an import in the same isolated `HOME` so the second run hits the overwrite / skip / rename path.
- Validate both entry points: Marketplace as the primary launcher and Central as the secondary launcher for the exact same wizard flow.
- Execute the actual preview/import/install assertions on a real Tauri dev/native surface; use the plain Vite/browser surface only to verify the non-Tauri fallback message and that the shared launcher UI still opens.

## Rapid OCR-Based WKWebView Content Verification

When the AX tree doesn't expose WKWebView content (common after app restarts where the window doesn't become frontmost), use rapid `screencapture` + `tesseract` OCR to verify what's on screen:

1. Get the window ID: `python3 /tmp/skills-manage-test-fixtures/ax_skills_manage.py window-id`
2. Take rapid screenshots at 30-50ms intervals: `screencapture -l <wid> frame-NNN.png`
3. OCR each frame: `tesseract frame-NNN.png stdout --psm 6`
4. Parse OCR output for expected text (buttons, labels, progress indicators)

This approach was successfully used to verify the "Stop & Show Results" button visibility during a Discover scan at sub-100ms resolution. It works even when the AX tree collapses and is more reliable than AX tree polling for rapidly changing UI states.

**Tip:** The scan completes in ~100ms with typical fixture sizes (120 skills across 8 roots). To slow it down, create deeply nested noise directories (8+ levels deep with files at each level) in each scan root — 500+ per root adds ~45000 directories and noticeably slows the filesystem walk.
