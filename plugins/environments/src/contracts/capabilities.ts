export interface EnsureEnvironmentInput {
	readonly name: string;
	readonly packages: readonly string[];
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
