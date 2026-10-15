export interface EnsureEnvironmentInput {
	readonly name: string;
	readonly packages: readonly string[];
	/**
	 * Exact channel list for the solve, in priority order. When omitted,
	 * channels named by `channel::` package prefixes are used, then `anaconda`
	 * and `defaults`.
	 */
	readonly channels?: readonly string[];
}

export interface EnsureEnvironmentResult {
	readonly condaBinPath: string;
	readonly prefixPath: string;
}

export interface CondaEnvironmentRuntime {
	ensureEnvironment(input: EnsureEnvironmentInput): Promise<EnsureEnvironmentResult>;
	executable(prefixPath: string, name: string): string;
}

export interface EnvironmentsCapabilities extends Record<string, unknown> {
	readonly condaRuntime: CondaEnvironmentRuntime;
}
