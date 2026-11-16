/**
 * Hosts the `gh` flow can target from a remote URL alone: github.com and
 * GitHub Enterprise Cloud data-residency tenants (`<tenant>.ghe.com`).
 * Self-hosted GitHub Enterprise Server uses arbitrary hostnames that cannot
 * be told apart from other forges by URL, so it is not recognized.
 */
const GITHUB_HOST = /^(?:www\.)?github\.com$|^[a-z0-9-]+\.ghe\.com$/i;

const SCP_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/;

function splitRemote(remote: string): { host: string; path: string } | null {
	const trimmed = remote.trim();
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		try {
			const url = new URL(trimmed);
			return { host: url.hostname, path: url.pathname };
		} catch {
			return null;
		}
	}
	const scp = trimmed.match(SCP_REMOTE);
	return scp?.[1] && scp[2] ? { host: scp[1], path: scp[2] } : null;
}

/**
 * The browsable `https://<host>/<owner>/<repo>` URL for a GitHub remote in
 * SCP (`git@github.com:o/r.git`), `ssh://`, `git://`, or `http(s)://` form
 * (credentials, ports, `.git`, and trailing slashes ignored); `null` for any
 * other forge or malformed remote.
 */
export function githubRepositoryUrl(remote: string): string | null {
	const parts = splitRemote(remote);
	if (!parts || !GITHUB_HOST.test(parts.host)) return null;
	const segments = parts.path
		.replace(/^\/+|\/+$/g, "")
		.replace(/\.git$/i, "")
		.split("/");
	const [owner, repository] = segments;
	if (segments.length !== 2 || !owner || !repository) return null;
	if (owner.includes(":") || repository.includes(":")) return null;
	return `https://${parts.host.toLowerCase()}/${owner}/${repository}`;
}
