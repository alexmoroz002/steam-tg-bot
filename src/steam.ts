interface ResolveVanityResponse {
	response?: {
		steamid?: string;
		success?: number;
		message?: string;
	};
}

interface OwnedGamesResponse {
	response?: {
		game_count?: number;
		games?: OwnedGame[];
	};
}

export interface OwnedGame {
	appid: number;
	name: string;
	playtime_forever?: number;
}

export async function resolveVanityUrl(
	env: Env,
	vanityUrl: string,
): Promise<string | null> {
	const url = new URL(
		"https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/",
	);
	url.searchParams.set("key", env.STEAM_API_KEY);
	url.searchParams.set("vanityurl", vanityUrl);

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Steam ResolveVanityURL failed: ${response.status}`);
	}

	const data = (await response.json()) as ResolveVanityResponse;

	if (data.response?.success !== 1 || !data.response.steamid) {
		return null;
	}

	return data.response.steamid;
}

export async function getOwnedGames(
	env: Env,
	steamId: string,
): Promise<OwnedGame[]> {
	const url = new URL(
		"https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
	);
	url.searchParams.set("key", env.STEAM_API_KEY);
	url.searchParams.set("steamid", steamId);
	url.searchParams.set("format", "json");
	url.searchParams.set("include_appinfo", "1");
	url.searchParams.set("include_played_free_games", "1");

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Steam GetOwnedGames failed: ${response.status}`);
	}

	const data = (await response.json()) as OwnedGamesResponse;

	return (data.response?.games ?? []).filter(
		(game): game is OwnedGame =>
			typeof game.appid === "number" &&
			typeof game.name === "string" &&
			game.name.length > 0,
	);
}
