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
