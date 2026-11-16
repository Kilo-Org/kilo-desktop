export function presentEnvNames(
	names: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	return names.filter((name) => Boolean(env[name]?.trim()));
}
