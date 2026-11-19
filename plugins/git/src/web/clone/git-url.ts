const URL_FORM = /^(?:https?|ssh|git):\/\/[^\s/]+\/\S+$/i;
/** scp-like SSH form, e.g. `git@gitlab.com:group/project.git`. */
const SCP_FORM = /^[\w.-]+@[\w.-]+:[^\s/]\S*$/;

/** The remote forms main accepts; main checks again before cloning. */
export function isGitUrl(input: string): boolean {
	const url = input.trim();
	return URL_FORM.test(url) || SCP_FORM.test(url);
}

/** `project` for `https://host/group/project.git` or `git@host:group/project.git`. */
export function repositoryNameFromGitUrl(input: string): string {
	if (!isGitUrl(input)) return "";
	const last =
		input
			.trim()
			.replace(/[\\/]+$/, "")
			.split(/[/:]/)
			.pop() ?? "";
	return last.replace(/\.git$/i, "");
}
