export interface LocalInferenceAuthCapabilities extends Record<string, unknown> {
	authGate: {
		requireSignIn(): Promise<boolean>;
		signIn(): Promise<boolean>;
		cancel(): void;
	};
}
