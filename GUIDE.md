# Circuit Expert Developer & Environment Guide

This document captures environment configurations, path resolutions, and workflow tips for developing Circuit Expert inside Windows Subsystem for Linux (WSL).

## 💻 WSL Development & Node Execution Workflow

### 1. 🖧 Windows/WSL Path Mappings & Command Execution
* **Path Resolution**: The workspace files are accessed in Windows via UNC paths (`\\wsl.localhost\Ubuntu-20.04\home\boab\circuit`). However, Windows-based `npm`/`npx` tools will fail with UNC path errors or `ERR_INVALID_URL` because standard Windows Node/npm cannot resolve UNC paths natively in CMD.
* **Avoid Host Leakage**: Calling `npm` directly on the Windows host inside a WSL workspace directory can default to running Windows `npm.cmd` via `cmd.exe`, resulting in errors like `'tsc' is not recognized as an internal or external command`.
* **WSL NVM Environment Execution**: Node/npm are managed via NVM inside WSL (e.g. `~/.nvm/`). Because NVM is initialized in `.bashrc` / `.bash_profile`, non-interactive shells cannot resolve node or npm commands. If standard commands fail, explicitly export the NVM Node path to your `PATH` or use an interactive/login bash shell:
  ```bash
  # Execute dev server using NVM path:
  wsl -d Ubuntu-20.04 -e bash -c "export PATH=/home/boab/.nvm/versions/node/v20.20.0/bin:/usr/local/bin:/usr/bin:/bin; cd /home/boab/circuit/frontend && npm run dev"

  # Run build using NVM path:
  wsl -d Ubuntu-20.04 -e bash -c "export PATH=/home/boab/.nvm/versions/node/v20.20.0/bin:/usr/local/bin:/usr/bin:/bin; cd /home/boab/circuit/frontend && npm run build"
  ```

## 🔌 CYD/Heltec HIL Debugging (`~/cyd-native`, Ubuntu-24.04 WSL distro)

* **Cross-distro access**: `~/cyd-native` lives in the `Ubuntu` (24.04) WSL distro, not this one (`Ubuntu-20.04`). Reach it from here via `wsl.exe -d Ubuntu -e bash -c "..."`. Expect a harmless `chdir(...)` error line on every invocation (interop quirk from the two distros' differing CWDs) — ignore it and read the real output below it. Prefer `/bin/cat`/explicit binary paths over bare `cat` if the target shell has custom aliases.
* **`print()` vs `sys.stdout.write()` in `lib/heltec.py` / `lib/webserver.py`**: only `print()` reaches the browser's REPL console. `builtins.print` is monkeypatched (`lib/webserver.py`, `builtins.print = web_repl_print`) to broadcast over the WebSocket; `sys.stdout.write()` bypasses that entirely and goes only to the CYD's physical serial console (invisible unless you have a serial monitor attached). When adding debug prints anywhere in these files, always use `print()`, never `sys.stdout.write()`.
* **`print()` only broadcasts *during* an active `execute_repl()` call**: `web_repl_print` checks `repl_buffer is not None` before broadcasting, and `execute_repl()` resets `repl_buffer = None` in its `finally` block right before returning. So `print()` calls in code that runs *after* `execute_repl()` returns (e.g. in `handle_request`'s dispatch loop, timing a whole `repl_input` round trip) will silently fall back to real-serial-only output too. For debug output outside the exec window, call `broadcast_ws(json.dumps({"type": "repl_output", "output": "...", "code": ""}))` directly instead — same mechanism `web_repl_print` uses internally, but without the `repl_buffer` gate.
* Net lesson: if a debug print you just added "isn't showing up" in the browser console, check both of the above before assuming the code path isn't executing at all.
