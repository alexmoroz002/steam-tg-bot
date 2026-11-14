import "./env";
import { filterGames, type MatchedGame } from "./deepseek";
import {
	clearUserState,
	getUserState,
	saveUserState,
} from "./state";
import { getOwnedGames, resolveVanityUrl } from "./steam";
import {
	sendChatAction,
	sendMessage,
	splitMessage,
	type TelegramUpdate,
} from "./telegram";

const WELCOME = `Привет! Я подбираю игры из вашей Steam-библиотеки по запросу на обычном языке.

Отправьте никнейм из вашей ссылки https://steamcommunity.com/id/NICKNAME (или полную ссылку на профиль).

После этого пишите запросы, например:
— «посоветуй длинные рпг»
— «короткие нетребовательные игры»

/help — помощь`;

const HELP = `Как пользоваться:
1. Отправьте никнейм из ссылки https://steamcommunity.com/id/NICKNAME.
2. Напишите, какие игры подобрать.

Примеры запросов:
— «посоветуй длинные рпг»
— «короткие нетребовательные игры»
— «во что поиграть вдвоём»

/start — указать никнейм заново`;

interface ParsedIdentifier {
	kind: "steamid" | "vanity";
	value: string;
}

function commandOf(text: string): string | null {
	if (!text.startsWith("/")) {
		return null;
	}

	return text.slice(1).split(/[\s@]/)[0].toLowerCase();
}

function parseIdentifier(input: string): ParsedIdentifier | null {
	const value = input.trim().replace(/^\/+|\/+$/g, "");

	if (!value) {
		return null;
	}

	const profileMatch = value.match(
		/(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/profiles\/(\d{17})/i,
	);

	if (profileMatch) {
		return { kind: "steamid", value: profileMatch[1] };
	}

	const vanityMatch = value.match(
		/(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/id\/([^/?#\s]+)/i,
	);

	if (vanityMatch) {
		return { kind: "vanity", value: decodeURIComponent(vanityMatch[1]) };
	}

	if (/^\d{17}$/.test(value)) {
		return { kind: "steamid", value };
	}

	if (value.startsWith("/") || /\s/.test(value) || value.length > 64) {
		return null;
	}

	return { kind: "vanity", value };
}

async function handleNickname(
	env: Env,
	chatId: number,
	input: string,
): Promise<void> {
	const identifier = parseIdentifier(input);

	if (!identifier) {
		await sendMessage(
			env,
			chatId,
			"Не похоже на никнейм Steam. Отправьте никнейм из ссылки https://steamcommunity.com/id/NICKNAME",
		);
		return;
	}

	let steamId: string;

	if (identifier.kind === "steamid") {
		steamId = identifier.value;
	} else {
		await sendChatAction(env, chatId);

		const resolved = await resolveVanityUrl(env, identifier.value);

		if (!resolved) {
			await sendMessage(
				env,
				chatId,
				"Не удалось найти такой профиль Steam. Проверьте никнейм и отправьте его ещё раз.",
			);
			return;
		}

		steamId = resolved;
	}

	await saveUserState(env, chatId, {
		steamId,
		nickname: identifier.kind === "vanity" ? identifier.value : undefined,
	});

	await sendMessage(
		env,
		chatId,
		`Профиль привязан: https://steamcommunity.com/profiles/${steamId}\n\nТеперь напишите, какие игры подобрать. Например: «короткие нетребовательные игры».`,
	);
}

function formatMatches(matches: MatchedGame[]): string {
	const entries = matches.map(
		(game, index) =>
			`${index + 1}. ${game.name} (appid: ${game.appid})\nhttps://store.steampowered.com/app/${game.appid}/`,
	);

	return `Подходящие игры (${matches.length}):\n\n${entries.join("\n\n")}`;
}

async function handleQuery(
	env: Env,
	chatId: number,
	steamId: string,
	query: string,
): Promise<void> {
	await sendChatAction(env, chatId);

	const games = await getOwnedGames(env, steamId);

	if (games.length === 0) {
		await sendMessage(
			env,
			chatId,
			"В вашем профиле не видно игр. Возможно, список игр скрыт настройками приватности Steam.",
		);
		return;
	}

	await sendMessage(
		env,
		chatId,
		`Смотрю вашу библиотеку (${games.length} игр)…`,
	);
	await sendChatAction(env, chatId);

	const matches = await filterGames(env, query, games);

	if (matches.length === 0) {
		await sendMessage(
			env,
			chatId,
			"Подходящих под запрос игр у вас не нашлось. Попробуйте сформулировать иначе.",
		);
		return;
	}

	for (const chunk of splitMessage(formatMatches(matches))) {
		await sendMessage(env, chatId, chunk);
	}
}

async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
	const message = update.message;
	const text = message?.text?.trim();

	if (!message || !text) {
		return;
	}

	const chatId = message.chat.id;

	try {
		const command = commandOf(text);

		if (command === "start" || command === "nickname" || command === "reset") {
			await clearUserState(env, chatId);
			await sendMessage(env, chatId, WELCOME);
			return;
		}

		if (command === "help") {
			await sendMessage(env, chatId, HELP);
			return;
		}

		const state = await getUserState(env, chatId);

		if (!state) {
			if (command) {
				await sendMessage(
					env,
					chatId,
					"Сначала привяжите Steam-профиль. Отправьте никнейм из ссылки https://steamcommunity.com/id/NICKNAME",
				);
				return;
			}

			await handleNickname(env, chatId, text);
			return;
		}

		if (command) {
			await sendMessage(
				env,
				chatId,
				"Неизвестная команда. Напишите запрос словами или отправьте /help.",
			);
			return;
		}

		await handleQuery(env, chatId, state.steamId, text);
	} catch (error) {
		console.error("Failed to handle Telegram update", error);

		try {
			await sendMessage(
				env,
				chatId,
				"Не удалось обработать запрос. Попробуйте позже.",
			);
		} catch (sendError) {
			console.error("Failed to send error message", sendError);
		}
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/") {
			return new Response("Steam Telegram bot is running");
		}

		if (request.method === "POST" && url.pathname === "/telegram/webhook") {
			if (
				env.TELEGRAM_WEBHOOK_SECRET &&
				request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
					env.TELEGRAM_WEBHOOK_SECRET
			) {
				return new Response("Unauthorized", { status: 401 });
			}

			let update: TelegramUpdate;

			try {
				update = await request.json<TelegramUpdate>();
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}

			ctx.waitUntil(handleUpdate(env, update));

			return new Response("OK");
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
