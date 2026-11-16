# Windows Setup

> **Note:** We recommend developing natively on Windows. Do NOT use WSL.

## Dependencies

### Git

```powershell
winget install Git.Git
```

### GitHub CLI (optional)

```powershell
winget install --id GitHub.cli
```

Or install manually from https://cli.github.com/

Once installed, log in:

```powershell
gh auth login
```

### Node.js (via fnm)

Install fnm: https://github.com/schniz/fnm

```powershell
winget install Schniz.fnm
```

Add the following line to your PowerShell profile (`notepad $PROFILE`):

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

Then install Node 24:

```powershell
fnm install 24
fnm use 24
```

### pnpm

```powershell
Invoke-WebRequest https://get.pnpm.io/install.ps1 -UseBasicParsing | Invoke-Expression
```

Or see https://pnpm.io/installation for other options.

### Python (via uv)

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv python install 3.12 --default
```

The `--default` flag ensures Python executables are on PATH. See https://docs.astral.sh/uv/guides/install-python/ for more details.

### Visual Studio

Install Visual Studio from https://visualstudio.microsoft.com/

During installation the setup wizard will prompt you to select workloads. Check **Desktop development with C++** — this installs the MSVC compiler and Windows SDK needed to build native Node modules.

## Package Registry Access

`pnpm install` needs a GitHub token for the GitHub Packages registry. Follow the token step in the root [README](../README.md#getting-started), then restart your terminal.

## Running the App

Once everything is installed and your terminal is restarted:

```powershell
pnpm install
pnpm dev
```
