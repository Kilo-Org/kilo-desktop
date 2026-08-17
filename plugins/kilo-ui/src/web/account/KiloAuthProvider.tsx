import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloUiChatService } from "../../contracts/chat/schemas.js";
import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../chat/runtime/create-kilo-runtime-client.js";
import {
	errorMessage,
	parseDeviceCode,
	type DeviceAuthState,
	type KiloAuthStatus,
	type KiloOrgError,
	type KiloProfileData,
} from "./kilo-auth.js";
import { KiloAuthContext, type KiloAuthContextValue } from "./KiloAuthContext.js";

const IDLE_DEVICE_AUTH: DeviceAuthState = { status: "idle" };
const DEFAULT_EXPIRES_IN = 900;

const AUTH_STATUS_KEY = ["kilo-ui", "kilo.authStatus"] as const;
const PROFILE_KEY = ["kilo-ui", "kilo.profile"] as const;

function invalidateGatewayCatalogs(queryClient: ReturnType<typeof useQueryClient>): void {
	void queryClient.invalidateQueries({ queryKey: ["kilo-ui", "provider.list"] });
	void queryClient.invalidateQueries({ queryKey: ["kilo-ui", "app.agents"] });
}

/**
 * App-lifetime Kilo Gateway auth: device OAuth, profile, org switch, logout.
 * Lives under ChatConnectionProvider so login survives leaving Settings.
 * Login holds the device-auth panel in a "finishing" state until the profile
 * is cached, then clears it straight into the signed-in view — no interstitial
 * success card. Logout always lands on the signed-out view — auth.remove is
 * best-effort because the server may 401 when credentials are already gone.
 */
export function KiloAuthProvider({ children }: { children: ReactNode }) {
	const sdk = useSdk<KiloUiChatService>("kilo-ui");
	const queryClient = useQueryClient();
	const { isPending, isError, connection } = useChatConnection();
	const [deviceAuth, setDeviceAuth] = useState<DeviceAuthState>(IDLE_DEVICE_AUTH);
	const [orgError, setOrgError] = useState<KiloOrgError | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isSwitchingOrg, setIsSwitchingOrg] = useState(false);
	const attemptRef = useRef(0);

	const client = useMemo(() => {
		if (!connection) return null;
		return createKiloDirectoryClient(connection, connection.globalDirectory);
	}, [connection]);

	const directory = connection?.globalDirectory;

	const authStatusQuery = useQuery({
		queryKey: [...AUTH_STATUS_KEY, connection?.baseUrl, connection?.version],
		queryFn: async (): Promise<KiloAuthStatus> => {
			if (!client) throw new Error("Kilo is not connected");
			const { data } = await client.kilo.authStatus(directory ? { directory } : undefined, {
				throwOnError: true,
			});
			return data as KiloAuthStatus;
		},
		enabled: client !== null,
		retry: false,
		staleTime: 30_000,
	});

	const profileQueryKey = [...PROFILE_KEY, connection?.baseUrl, connection?.version];

	const fetchProfile = useCallback(async (): Promise<KiloProfileData> => {
		if (!client) throw new Error("Kilo is not connected");
		const { data } = await client.kilo.profile(directory ? { directory } : undefined, {
			throwOnError: true,
		});
		return data as KiloProfileData;
	}, [client, directory]);

	const profileQuery = useQuery({
		queryKey: profileQueryKey,
		queryFn: fetchProfile,
		enabled: client !== null && authStatusQuery.data?.authenticated === true,
		retry: false,
		staleTime: 30_000,
	});

	const rebootAndRefresh = useCallback(async () => {
		if (!client) return;
		await client.global.dispose().catch(() => undefined);
		await queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
		await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
		invalidateGatewayCatalogs(queryClient);
	}, [client, queryClient]);

	const openExternal = useCallback(
		(url: string) => {
			void sdk.shell.openExternal(url).catch(() => undefined);
		},
		[sdk.shell],
	);

	const login = useCallback(() => {
		if (!client || !directory) return;
		const attempt = ++attemptRef.current;
		setDeviceAuth({ status: "initiating" });

		void (async () => {
			try {
				const { data: auth } = await client.provider.oauth.authorize(
					{ providerID: "kilo", method: 0, directory },
					{ throwOnError: true },
				);
				if (attempt !== attemptRef.current) return;

				const code = parseDeviceCode(auth.instructions);
				const verificationUrl = auth.url;
				setDeviceAuth({
					status: "waiting",
					...(code !== undefined ? { code } : {}),
					verificationUrl,
					expiresIn: DEFAULT_EXPIRES_IN,
				});
				if (verificationUrl) {
					openExternal(verificationUrl);
				}

				await client.provider.oauth.callback(
					{ providerID: "kilo", method: 0, directory },
					{ throwOnError: true },
				);
				if (attempt !== attemptRef.current) return;

				setDeviceAuth({ status: "finishing" });
				await rebootAndRefresh();
				// Hold the finishing state until the profile is cached, so the panel
				// clears straight into the signed-in view instead of a loading skeleton.
				// fetchQuery works while the profile query is still disabled; a failure
				// here is left to the enabled query's own retry, not shown as a login error.
				await queryClient
					.fetchQuery({ queryKey: profileQueryKey, queryFn: fetchProfile, staleTime: 30_000 })
					.catch(() => undefined);
				if (attempt !== attemptRef.current) return;

				setDeviceAuth(IDLE_DEVICE_AUTH);
			} catch (error) {
				if (attempt !== attemptRef.current) return;
				setDeviceAuth({
					status: "error",
					error: errorMessage(error, "Sign-in failed"),
				});
			}
		})();
	}, [
		client,
		directory,
		fetchProfile,
		openExternal,
		profileQueryKey,
		queryClient,
		rebootAndRefresh,
	]);

	const cancelLogin = useCallback(() => {
		attemptRef.current += 1;
		setDeviceAuth(IDLE_DEVICE_AUTH);
	}, []);

	const applySignedOut = useCallback(() => {
		queryClient.setQueryData([...AUTH_STATUS_KEY, connection?.baseUrl, connection?.version], {
			authenticated: false,
		} satisfies KiloAuthStatus);
		queryClient.removeQueries({ queryKey: PROFILE_KEY });
		setDeviceAuth(IDLE_DEVICE_AUTH);
		setOrgError(null);
	}, [connection?.baseUrl, connection?.version, queryClient]);

	const logout = useCallback(() => {
		if (!client) return;
		attemptRef.current += 1;
		void (async () => {
			// Logout is idempotent: 401 / already-cleared credentials still mean signed out.
			await client.auth.remove({ providerID: "kilo" }).catch(() => undefined);
			await client.global.dispose().catch(() => undefined);
			applySignedOut();
			invalidateGatewayCatalogs(queryClient);
		})();
	}, [applySignedOut, client, queryClient]);

	const refreshProfile = useCallback(() => {
		if (!client) return;
		setIsRefreshing(true);
		void (async () => {
			try {
				await queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
				await queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
				await profileQuery.refetch();
			} finally {
				setIsRefreshing(false);
			}
		})();
	}, [client, profileQuery, queryClient]);

	const setOrganization = useCallback(
		(organizationId: string | null) => {
			if (!client) return;
			setIsSwitchingOrg(true);
			setOrgError(null);
			void (async () => {
				try {
					await client.kilo.organization.set(
						{ organizationId, ...(directory ? { directory } : {}) },
						{ throwOnError: true },
					);
					await rebootAndRefresh();
					await profileQuery.refetch();
				} catch (error) {
					setOrgError({
						message: errorMessage(error, "Failed to switch organization"),
						organizationId,
					});
					await profileQuery.refetch().catch(() => undefined);
				} finally {
					setIsSwitchingOrg(false);
				}
			})();
		},
		[client, directory, profileQuery, rebootAndRefresh],
	);

	const dismissOrgError = useCallback(() => {
		setOrgError(null);
	}, []);

	// Clear device-auth noise when connection drops.
	useEffect(() => {
		if (isError || !connection) {
			attemptRef.current += 1;
			setDeviceAuth(IDLE_DEVICE_AUTH);
			setOrgError(null);
		}
	}, [connection, isError]);

	const authenticated = useMemo(() => {
		if (client === null) return null;
		if (authStatusQuery.isPending) return null;
		if (authStatusQuery.isError) return false;
		return authStatusQuery.data?.authenticated === true;
	}, [
		authStatusQuery.data?.authenticated,
		authStatusQuery.isError,
		authStatusQuery.isPending,
		client,
	]);

	const isLoading =
		isPending ||
		(client !== null && authStatusQuery.isPending) ||
		(authenticated === true && profileQuery.isPending && !profileQuery.data);

	const profileError =
		authenticated === true && !profileQuery.data && profileQuery.isError
			? errorMessage(profileQuery.error, "Couldn't load your Kilo account")
			: null;

	const value = useMemo<KiloAuthContextValue>(
		() => ({
			isLoading,
			connectionUnavailable: isError,
			authenticated,
			profile: authenticated ? (profileQuery.data ?? null) : null,
			profileError,
			deviceAuth,
			orgError,
			isRefreshing,
			isSwitchingOrg,
			login,
			cancelLogin,
			logout,
			refreshProfile,
			setOrganization,
			dismissOrgError,
			openExternal,
		}),
		[
			authenticated,
			cancelLogin,
			deviceAuth,
			dismissOrgError,
			isError,
			isLoading,
			isRefreshing,
			isSwitchingOrg,
			login,
			logout,
			openExternal,
			orgError,
			profileError,
			profileQuery.data,
			refreshProfile,
			setOrganization,
		],
	);

	return <KiloAuthContext.Provider value={value}>{children}</KiloAuthContext.Provider>;
}
