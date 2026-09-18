import type { AuthUser } from "@kilo-desktop/feature-sdk";

/**
 * Derive display initials for an authenticated user, mirroring
 * `../anaconda-desktop`: `firstName[0]+lastName[0]` (uppercased), else the first
 * letter of the email. Wire values may be empty/whitespace strings; those are
 * treated as absent so we fall through. Returns `""` when no usable data exists,
 * signalling the caller to render a generic icon instead.
 */
export function getUserInitials(user: AuthUser): string {
	const first = user.firstName?.trim();
	const last = user.lastName?.trim();
	if (first && last) return (first.charAt(0) + last.charAt(0)).toUpperCase();

	const email = user.email?.trim();
	if (email) return email.charAt(0).toUpperCase();

	return "";
}
