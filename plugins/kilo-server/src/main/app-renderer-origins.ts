/**
 * Origins of Desktop's own renderer (stable/preview and development schemes).
 * The single kilo-server copy of the host's app origin: the Kilo CLI's CORS
 * allowlist and the WebMCP relay's tool-source allowlist must both match the
 * renderer exactly, and a mismatch fails silently (CORS errors, or the
 * renderer's tools never reaching the agent).
 */
export const APP_RENDERER_ORIGINS = ["kilo-desktop://app", "kilo-desktop-dev://app"] as const;
