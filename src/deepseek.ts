import type { OwnedGame } from "./steam";

export interface MatchedGame {
	appid: number;
	name: string;
}

interface DeepSeekResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
	error?: {
		message?: string;
	};
}

const SYSTEM_PROMPT = `Ты — помощник по подбору игр из личной библиотеки пользователя Steam.
Пользователь присылает список своих игр в формате "appid|название" (по одной на строку) и запрос на естественном языке.
Выбери только те игры из списка, которые соответствуют запросу: жанр, длина, сложность, требования, настроение и т.п. Опирайся на свои знания об играх.
Не добавляй игры, которых нет в списке. Не изменяй appid.
Ответ верни строго в виде JSON-объекта: {"games":[{"appid":123,"name":"Название"}]}.
Если подходящих игр нет, верни {"games":[]}. Без markdown, пояснений и лишнего текста.`;

export async function filterGames(
	env: Env,
	query: string,
	games: OwnedGame[],
): Promise<MatchedGame[]> {
	const catalog = games
		.map((game) => `${game.appid}|${game.name.replace(/\n/g, " ")}`)
		.join("\n");

	const response = await fetch("https://api.deepseek.com/chat/completions", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
		},
		body: JSON.stringify({
			model: "deepseek-chat",
			temperature: 0.2,
			max_tokens: 8192,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{
					role: "user",
					content: `Список игр (appid|название):\n${catalog}\n\nЗапрос пользователя: ${query}`,
				},
			],
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`DeepSeek request failed: ${response.status} ${body}`);
	}

	const data = (await response.json()) as DeepSeekResponse;

	if (data.error) {
		throw new Error(`DeepSeek error: ${data.error.message ?? "unknown"}`);
	}

	const content = data.choices?.[0]?.message?.content;

	if (!content) {
		throw new Error("DeepSeek returned an empty response");
	}

	return parseMatches(content, games);
}

function parseMatches(content: string, games: OwnedGame[]): MatchedGame[] {
	const parsed = parseJson(content);

	if (!parsed || typeof parsed !== "object" || !("games" in parsed)) {
		throw new Error("DeepSeek returned an unexpected JSON structure");
	}

	const rawGames = (parsed as { games?: unknown }).games;

	if (!Array.isArray(rawGames)) {
		throw new Error("DeepSeek returned an unexpected games value");
	}

	const catalog = new Map(games.map((game) => [game.appid, game.name]));
	const result = new Map<number, MatchedGame>();

	for (const item of rawGames) {
		if (!item || typeof item !== "object") {
			continue;
		}

		const rawAppid = (item as { appid?: unknown }).appid;
		const appid =
			typeof rawAppid === "number"
				? rawAppid
				: typeof rawAppid === "string" && /^\d+$/.test(rawAppid)
					? Number(rawAppid)
					: Number.NaN;

		if (!Number.isInteger(appid) || !catalog.has(appid)) {
			continue;
		}

		result.set(appid, { appid, name: catalog.get(appid) as string });
	}

	return [...result.values()];
}

function parseJson(content: string): unknown {
	const cleaned = content
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");

	try {
		return JSON.parse(cleaned);
	} catch {
		const start = cleaned.indexOf("{");
		const end = cleaned.lastIndexOf("}");

		if (start === -1 || end <= start) {
			throw new Error("DeepSeek returned invalid JSON");
		}

		return JSON.parse(cleaned.slice(start, end + 1));
	}
}
