# Agent Guidelines & Operational Rules

## 1. Automated Browser Testing & Telemetry
- **Pair-Programming Rule**: Never execute automated browser testing scripts during pair-programming sessions. Always present layout changes, UI enhancements, and functional updates directly for manual approval.
- **No External Browser/Puppeteer Spawning**: NEVER launch Puppeteer, Playwright, or separate headless browser instances to test web apps or inspect state. Spawning separate browser instances is slow, resource-heavy, and redundant when direct MCP tools exist.
- **Use MCP Endpoints First**: Always use direct MCP tools (e.g. `detect_apps`, `physics_get_state`, `physics_get_scene_summary`, `circuit_get_state`, `send_command`) to programmatically verify simulation state.
- **Use Viewport Screenshots**: To visually verify layout, alignment, or rendering, call `physics_get_screenshot` directly rather than taking screenshots via external browser controllers.
- **No Source Hacks for Debugging**: Do not modify application source code files simply to inject temporary telemetry or debug logs. Use the existing MCP protocol surface.

## 2. Shell Environment & Execution Rules (WSL on Windows Host)
- **PowerShell vs Bash Redirection**: When executing commands via `run_command` (default shell is PowerShell on Windows), NEVER use `> /dev/null` in top-level commands. PowerShell interprets `/dev/null` as a local Windows file `C:\dev\null`. Wrap bash redirections inside `wsl -e bash -c "..."` or use `| Out-Null` / `$null`.
- **Statement Separators**: NEVER use `&&` in top-level PowerShell command strings (which triggers syntax errors). Wrap chained bash commands in `wsl -e bash -c "cmd1 && cmd2"`.
- **WSL Path & Context**: Execute Linux/WSL operations through `wsl -e bash -c "..."` or target `/Ubuntu-20.04/home/boab/...` WSL paths cleanly.

## 3. Multi-Agent Scope Discipline & Task Boundaries
- **Do Not Touch Unrelated Broken Code during Builds / Multi-Agent Runs**: If a build command (e.g. `npm run build` or `tsc`) fails due to type or syntax errors in files unrelated to your assigned task scope, NEVER attempt to fix, modify, or patch those unrelated files.
- **Immediate Reversion**: If unrelated files are modified by accident, revert them immediately using `git checkout <file>`.
- **Scoped Verification**: Use targeted type checking (e.g. `npx tsc --noEmit`) and tests focused strictly on your assigned task files rather than modifying out-of-scope files to satisfy global build scripts.
