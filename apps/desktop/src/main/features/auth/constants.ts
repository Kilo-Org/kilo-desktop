// Keyring

export const KEYRING_NAME = "Anaconda Cloud";
export const TOKEN_INFO_VERSION = 2;
export const DEFAULT_KEYRING_PATH = "~/.anaconda/keyring";

// OAuth loopback callback server
//
// The client only allowlists the fixed `http://127.0.0.1:8000/auth/oidc`; any
// other port/scheme is rejected as an invalid redirect_uri. Fixed to match
// `anaconda-desktop`/`anaconda-auth`, which share this client id and single
// registered redirect.

export const REDIRECT_URI_HOST = "127.0.0.1";
export const REDIRECT_URI_PATH = "/auth/oidc";
export const REDIRECT_URI_PORT = 8000;

/** The single loopback redirect registered for the OAuth client. */
export const DEFAULT_REDIRECT_URL = `http://${REDIRECT_URI_HOST}:${REDIRECT_URI_PORT}${REDIRECT_URI_PATH}`;

/** How long to wait for the OAuth callback before giving up. */
export const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000;
