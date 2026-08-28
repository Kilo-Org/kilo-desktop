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

## GitHub npm Registry Access

Private `@anaconda` packages are published on the GitHub npm registry. You need to configure npm to authenticate with it.

### 1. Authorize with Anaconda SSO

Any SSH keys or personal access tokens you use must be authorized for the Anaconda organization's SSO. Go to:

**GitHub > Settings > SSH and GPG keys** (for SSH) or **Developer Settings > Personal access tokens** (for PATs)

Click **Configure SSO** next to the relevant key/token and authorize it for the **anaconda** organization.

### 2. Create `~/.npmrc`

Create a file at `%USERPROFILE%\.npmrc` with the following content:

```ini
@anaconda:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${ANACONDA_NPM_TOKEN}
```

### 3. Generate a token

Generate a Personal Access Token (classic):

**GitHub > Settings > Developer Settings > Personal access tokens > Tokens (classic)**

Required scopes:

- `repo`
- `read:packages`

> **Alternative:** You can use the token from `gh auth token` if you have the GitHub CLI installed, but note this token typically has broader permissions than necessary. A dedicated PAT with minimal scopes is preferred.

### 4. Add the token to your PowerShell profile

Open your profile (`notepad $PROFILE`) and add:

```powershell
$env:ANACONDA_NPM_TOKEN = "<your-token>"
```

Restart your terminal for changes to take effect.

## Running the App

Once everything is installed and your terminal is restarted:

```powershell
pn install
pn dev
```
