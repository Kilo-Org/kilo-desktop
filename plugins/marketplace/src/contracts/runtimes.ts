/**
 * Runtimes that provide the launch commands catalog MCPs use, with the
 * official way to install each. Shared by main (which picks the commands that
 * apply to this OS) and web (which names the runtime and links its
 * installation guide). Install commands only use official installers or a
 * package manager that is already present, so Desktop never suggests
 * bootstrapping one.
 */

export interface McpRuntime {
	readonly name: string;
	readonly installUrl: string;
}

type InstallStep = { readonly command: string; readonly requires?: string };

type RuntimeEntry = McpRuntime & {
	readonly install?: Partial<Record<string, InstallStep>>;
};

const UV_UNIX: InstallStep = { command: "curl -LsSf https://astral.sh/uv/install.sh | sh" };

const NODE: RuntimeEntry = {
	name: "Node.js",
	installUrl: "https://nodejs.org/en/download",
	install: {
		darwin: { command: "brew install node", requires: "brew" },
		win32: { command: "winget install OpenJS.NodeJS.LTS", requires: "winget" },
	},
};

const UV: RuntimeEntry = {
	name: "uv",
	installUrl: "https://docs.astral.sh/uv/getting-started/installation/",
	install: {
		darwin: UV_UNIX,
		linux: UV_UNIX,
		win32: {
			command: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
		},
	},
};

const RUNTIMES: Readonly<Record<string, RuntimeEntry>> = {
	node: NODE,
	npm: NODE,
	npx: NODE,
	uv: UV,
	uvx: UV,
	docker: { name: "Docker", installUrl: "https://docs.docker.com/get-started/get-docker/" },
	python: { name: "Python", installUrl: "https://www.python.org/downloads/" },
	python3: { name: "Python", installUrl: "https://www.python.org/downloads/" },
};

export function mcpRuntime(command: string): McpRuntime | undefined {
	const entry = Object.hasOwn(RUNTIMES, command) ? RUNTIMES[command] : undefined;
	return entry ? { name: entry.name, installUrl: entry.installUrl } : undefined;
}

/** Install commands for the runtime behind `command` on `platform`, given which tools resolve. */
export function installCommands(
	command: string,
	platform: string,
	isInstalled: (tool: string) => boolean,
): string[] {
	const step = Object.hasOwn(RUNTIMES, command)
		? RUNTIMES[command]?.install?.[platform]
		: undefined;
	if (!step || (step.requires && !isInstalled(step.requires))) return [];
	return [step.command];
}
