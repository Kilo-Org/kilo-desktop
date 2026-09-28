/** True when the email's domain is `anaconda.com` (case-insensitive). */
export function isAnacondaEmployee(email?: string): boolean {
	return email?.split("@")[1]?.toLowerCase() === "anaconda.com";
}
