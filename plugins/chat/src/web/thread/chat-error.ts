const KILO_SIGN_IN_ERROR = "You need to sign in to use this model";
const KILO_SIGN_UP_ERROR = "You need to sign up to keep going";
const KILO_SIGN_IN_TITLE = "You need to connect to Kilo to use this model";
const KILO_SIGN_UP_TITLE = "You need to sign up for Kilo to keep going";

const KILO_ERROR_TITLES: Readonly<Record<string, string>> = {
	PAID_MODEL_AUTH_REQUIRED: KILO_SIGN_IN_TITLE,
	PROMOTION_MODEL_LIMIT_REACHED: KILO_SIGN_UP_TITLE,
	paid_model_auth_required: KILO_SIGN_IN_TITLE,
	promotion_model_limit_reached: KILO_SIGN_UP_TITLE,
};

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function embeddedJson(message: string): JsonObject | undefined {
	const start = message.indexOf("{");
	const end = message.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		const parsed: unknown = JSON.parse(message.slice(start, end + 1));
		return isObject(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function kiloErrorTitle(message: string, body: JsonObject | undefined): string | undefined {
	const nested = isObject(body?.error) ? body.error : undefined;
	const code = nested?.code ?? body?.code ?? body?.error_type;
	if (typeof code === "string" && KILO_ERROR_TITLES[code]) return KILO_ERROR_TITLES[code];
	if (
		message.includes("PROMOTION_MODEL_LIMIT_REACHED") ||
		message.includes(KILO_SIGN_UP_ERROR) ||
		message.includes(KILO_SIGN_UP_TITLE)
	) {
		return KILO_SIGN_UP_TITLE;
	}
	if (
		message.includes("PAID_MODEL_AUTH_REQUIRED") ||
		message.includes(KILO_SIGN_IN_ERROR) ||
		message.includes(KILO_SIGN_IN_TITLE)
	) {
		return KILO_SIGN_IN_TITLE;
	}
	return undefined;
}

function embeddedMessage(body: JsonObject | undefined): string | undefined {
	const nested = isObject(body?.error) ? body.error : undefined;
	if (typeof nested?.message === "string" && nested.message.trim()) return nested.message;
	if (typeof body?.message === "string" && body.message.trim()) return body.message;
	return undefined;
}

/** User-facing chat error text: Gateway JSON dumps unwrapped into tidy titles. */
export function displayChatError(message: string | undefined): string {
	if (!message) return "";
	const body = embeddedJson(message);
	return kiloErrorTitle(message, body) ?? embeddedMessage(body) ?? message;
}

/** The error of a message that ended in one, as text. */
export function messageErrorText(
	status: { type?: string; reason?: string; error?: unknown } | undefined,
): string | undefined {
	if (status?.type !== "incomplete" || status.reason !== "error") return undefined;
	const error = status.error;
	if (typeof error === "string") return error;
	if (isObject(error) && typeof error.message === "string") return error.message;
	return error === undefined ? undefined : String(error);
}

const NO_MODEL_ERROR = "No model is available. Connect a provider in Settings to send messages.";
const NO_MODEL_CAUSES = ["ProviderNoProvidersError", "ProviderNoModelsError"];
const STACK_FRAME = /\n\s+at\s/;

function rawErrorText(error: unknown): string {
	if (typeof error === "string") return error;
	if (isObject(error) && isObject(error.data) && typeof error.data.message === "string") {
		return error.data.message;
	}
	if (error instanceof Error || (isObject(error) && typeof error.message === "string")) {
		return String(error.message);
	}
	return String(error);
}

/**
 * A failed turn's error as text: a `session.error` (Kilo's named error, whose
 * message for an unexpected failure carries a stack trace) or a refused prompt.
 */
export function turnErrorText(error: unknown): string {
	const text = rawErrorText(error);
	if (NO_MODEL_CAUSES.some((cause) => text.includes(cause))) return NO_MODEL_ERROR;
	return text.split(STACK_FRAME, 1)[0]!.trim();
}

/** Whether a turn failed because the Kilo Gateway wants the person signed in (or signed up). */
export function isKiloSignInError(message: string | undefined): boolean {
	if (!message) return false;
	return kiloErrorTitle(message, embeddedJson(message)) !== undefined;
}
