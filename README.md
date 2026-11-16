# Kilo Desktop

Kilo Desktop is the desktop app for [Kilo](https://kilo.ai), the AI coding agent. It runs
the Kilo agent locally and brings work sessions, chat, file and git changes, terminals,
notebooks, Python environments, and local models together in one window.

Kilo Desktop is built with Electron and React, as plugins on a small kernel: every
feature, the shell included, is a plugin. It runs on macOS, Windows, and Linux.

This repository is public. You can read the code, build it, and report issues.

## Related projects

- [kilo.ai](https://kilo.ai): Kilo's home page, with [documentation](https://kilo.ai/docs).
- [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode): the Kilo CLI, VS Code
  extension, and JetBrains plugin. Kilo Desktop bundles the Kilo CLI and runs it as its
  agent server.
- [Kilo Discord](https://kilo.ai/discord): support, questions, and discussion.

## Updates

Official macOS and Windows builds update themselves. Linux builds ship as a DEB package
and never install updates: when a newer release is out, Settings → About offers a
download link, and you install the newer DEB over the existing one.

## Feedback and contributions

- **Found a bug or have an idea?** [Open an issue](https://github.com/Kilo-Org/kilo-desktop/issues/new/choose).
  The team reviews every issue.
- **Want to send a pull request?** Pull requests are welcome, but they might not be
  merged: community contributions are not our focus right now. Open an issue first to
  check whether we would take the change. [CONTRIBUTING.md](CONTRIBUTING.md) explains how
  we work.
- **Found a security vulnerability?** Don't open a public issue. Follow
  [SECURITY.md](SECURITY.md).

Everyone who takes part follows our [Code of Conduct](CODE_OF_CONDUCT.md).

## Building from source

[CONTRIBUTING.md](CONTRIBUTING.md) has the prerequisites and build steps. Install pulls
`@anaconda/playwright-utils` from GitHub Packages, which needs a GitHub token with
`read:packages` even for public packages. In short:

```bash
corepack enable
pnpm config set "//npm.pkg.github.com/:_authToken" <token-with-read:packages>
pnpm install --frozen-lockfile
pnpm dev
```

Builds from source are unsigned and don't update themselves.

To learn how the code is organized, start with [CONTEXT.md](CONTEXT.md) and
[docs/architecture.md](docs/architecture.md). [docs/plugins](docs/plugins/README.md)
explains how plugins work, with an [example plugin](examples/hello-plugin), and
[docs/releases.md](docs/releases.md) covers release tracks, signing, and CI.
