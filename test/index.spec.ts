import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { TelegramUpdate } from "../src/telegram";

const testEnv = {
	...env,
	TELEGRAM_BOT_TOKEN: "test-telegram-token",
	STEAM_API_KEY: "test-steam-key",
	DEEPSEEK_API_KEY: "test-deepseek-key",
} as Env;

const CHAT_ID = 123;
const STEAM_ID = "76561198000000000";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		headers: { "content-type": "application/json" },
	});
}

function telegramOk(): Response {
	return jsonResponse({ ok: true, result: { message_id: 1 } });
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}

	if (input instanceof URL) {
		return input.toString();
	}

	return input.url;
}

async function sendWebhook(update: Partial<TelegramUpdate>): Promise<void> {
	const request = new Request("http://example.com/telegram/webhook", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			update_id: 1,
			...update,
		}),
	});
	const ctx = createExecutionContext();

	await worker.fetch(request, testEnv, ctx);
	await waitOnExecutionContext(ctx);
}

function messageUpdate(text: string): Partial<TelegramUpdate> {
	return {
		message: {
			message_id: 1,
			chat: { id: CHAT_ID, type: "private" },
			text,
		},
	};
}

function sentMessages(): string[] {
	return fetchMock.mock.calls.flatMap(([input, init]) => {
		const url = requestUrl(input);

		if (!url.endsWith("/sendMessage") || typeof init?.body !== "string") {
			return [];
		}

		const body = JSON.parse(init.body) as { text?: string };
		return body.text ? [body.text] : [];
	});
}

beforeEach(async () => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	await env.USERS.delete(`user:${CHAT_ID}`);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Steam Telegram bot", () => {
	it("responds to the health check", async () => {
		const request = new Request("http://example.com/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, testEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("Steam Telegram bot is running");
	});

	it("asks for a Steam nickname on /start", async () => {
		fetchMock.mockResolvedValue(telegramOk());

		await sendWebhook(messageUpdate("/start"));

		expect(sentMessages().join("\n")).toContain(
			"https://steamcommunity.com/id/NICKNAME",
		);
		expect(await env.USERS.get(`user:${CHAT_ID}`)).toBeNull();
	});

	it("resolves a nickname and stores the Steam ID", async () => {
		fetchMock.mockImplementation(async (input) => {
			const url = requestUrl(input);

			if (url.includes("ResolveVanityURL")) {
				return jsonResponse({
					response: { success: 1, steamid: STEAM_ID },
				});
			}

			if (url.includes("api.telegram.org")) {
				return telegramOk();
			}

			throw new Error(`Unexpected request: ${url}`);
		});

		await sendWebhook(messageUpdate("gaben"));

		expect(await env.USERS.get(`user:${CHAT_ID}`, "json")).toEqual({
			steamId: STEAM_ID,
			nickname: "gaben",
		});
		expect(sentMessages().join("\n")).toContain(STEAM_ID);
	});

	it("filters owned games through DeepSeek and returns the matches", async () => {
		await env.USERS.put(
			`user:${CHAT_ID}`,
			JSON.stringify({ steamId: STEAM_ID }),
		);

		fetchMock.mockImplementation(async (input) => {
			const url = requestUrl(input);

			if (url.includes("GetOwnedGames")) {
				return jsonResponse({
					response: {
						game_count: 3,
						games: [
							{ appid: 10, name: "Counter-Strike" },
							{ appid: 20, name: "Portal 2" },
							{ appid: 30, name: "Elden Ring" },
						],
					},
				});
			}

			if (url.includes("api.deepseek.com")) {
				return jsonResponse({
					choices: [
						{
							message: {
								content: '{"games":[{"appid":30,"name":"Elden Ring"}]}',
							},
						},
					],
				});
			}

			if (url.includes("api.telegram.org")) {
				return telegramOk();
			}

			throw new Error(`Unexpected request: ${url}`);
		});

		await sendWebhook(messageUpdate("посоветуй длинные рпг"));

		const messages = sentMessages().join("\n");
		expect(messages).toContain("Elden Ring");
		expect(messages).toContain("appid: 30");
		expect(messages).not.toContain("Portal 2");
	});
});
