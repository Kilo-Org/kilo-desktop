/** Error thrown when OIDC discovery fails (network error or invalid response). */
export class OAuthDiscoveryError extends Error {
	override readonly name = "OAuthDiscoveryError" as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
	}
}

/** Error thrown when the callback URL contains an OAuth error response. */
export class OAuthCallbackError extends Error {
	override readonly name = "OAuthCallbackError" as const;

	constructor(
		public readonly errorCode: string,
		public readonly errorDescription?: string,
	) {
		super(errorDescription ?? `OAuth callback error: ${errorCode}`);
	}
}

/** Error thrown when the token exchange request fails. */
export class OAuthTokenError extends Error {
	override readonly name = "OAuthTokenError" as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
	}
}

/** Error the pending OAuth wait rejects with when the user cancels the sign-in. */
export class OAuthCancelledError extends Error {
	override readonly name = "OAuthCancelledError" as const;

	constructor() {
		super("Sign-in was cancelled.");
	}
}
