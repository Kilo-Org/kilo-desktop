const KILO_SIGN_IN_ERROR = "You need to sign in to use this model";
const KILO_SIGN_UP_ERROR = "You need to sign up to keep going";
const KILO_SIGN_IN_TITLE = "You need to connect to Kilo to use this model";
const KILO_SIGN_UP_TITLE = "You need to sign up for Kilo to keep going";
/** The Gateway's message when it no longer accepts the sign-in (code INVALID_TOKEN). */
const KILO_SIGNED_OUT_ERROR = "Your authentication token is invalid";
const KILO_SIGNED_OUT_TITLE = "You've been signed out of Kilo";

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

function isSignedOutError(message: string, body: JsonObject | undefined): boolean {
	const nested = isObject(body?.error) ? body.error : undefined;
	return (
		(nested?.code ?? body?.code) === "INVALID_TOKEN" || message.includes(KILO_SIGNED_OUT_ERROR)
	);
}

/** User-facing chat error text: Gateway JSON dumps unwrapped into tidy titles. */
export function displayChatError(message: string | undefined): string {
	if (!message) return "";
	const body = embeddedJson(message);
	if (isSignedOutError(message, body)) return KILO_SIGNED_OUT_TITLE;
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

/** Whether a turn failed because the Kilo Gateway wants the person signed in (or signed up). */
export function isKiloSignInError(message: string | undefined): boolean {
	if (!message) return false;
	return kiloErrorTitle(message, embeddedJson(message)) !== undefined;
}
