// Config

export class ConfigParseError extends Error {
	override name = "ConfigParseError" as const;
	constructor(
		public readonly filePath: string,
		cause: unknown,
	) {
		super(`Failed to parse TOML config at ${filePath}`, { cause });
	}
}

export class ConfigValidationError extends Error {
	override name = "ConfigValidationError" as const;
	constructor(
		public readonly filePath: string,
		public readonly issues: unknown,
	) {
		super(`Config validation failed for ${filePath}`);
	}
}

// Keyring

export class TokenPayloadParseError extends Error {
	override name = "TokenPayloadParseError" as const;
	constructor(cause: unknown) {
		super("Failed to parse token payload from base64", { cause });
	}
}

export class TokenPayloadValidationError extends Error {
	override name = "TokenPayloadValidationError" as const;
	constructor(public readonly issues: unknown) {
		super("Token payload validation failed");
	}
}

export class AnacondaKeyringWriteError extends Error {
	override name = "AnacondaKeyringWriteError" as const;
	readonly path: string;
	readonly errnoCode: string | undefined;

	constructor(keyringPath: string, cause: unknown) {
		super(`Failed to write keyring file at ${keyringPath}`, { cause });
		this.path = keyringPath;
		this.errnoCode = cause instanceof Error && "code" in cause ? (cause.code as string) : undefined;
	}
}

export class SystemKeyringError extends Error {
	override name = "SystemKeyringError" as const;
	constructor(cause: unknown) {
		const message =
			process.platform === "linux"
				? "System keyring unavailable — is libsecret installed and running?"
				: "System keyring unavailable";
		super(message, { cause });
	}
}
