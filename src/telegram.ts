export interface TelegramMessage {
	message_id: number;
	chat: {
		id: number;
		type: string;
	};
	from?: {
		id: number;
		username?: string;
		first_name?: string;
	};
	text?: string;
}

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
}

interface TelegramResponse<T> {
	ok: boolean;
	result?: T;
	description?: string;
}

const TELEGRAM_API = "https://api.telegram.org";

async function callTelegram<T>(
	env: Env,
	method: string,
	payload: Record<string, unknown>,
): Promise<T> {
	const response = await fetch(
		`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		},
	);

	const data = (await response.json()) as TelegramResponse<T>;

	if (!response.ok || !data.ok) {
		throw new Error(
			`Telegram ${method} failed: ${data.description ?? response.statusText}`,
		);
	}

	return data.result as T;
}

export async function sendMessage(
	env: Env,
	chatId: number,
	text: string,
): Promise<void> {
	await callTelegram(env, "sendMessage", {
		chat_id: chatId,
		text,
		link_preview_options: { is_disabled: true },
	});
}

export async function sendChatAction(
	env: Env,
	chatId: number,
	action = "typing",
): Promise<void> {
	await callTelegram(env, "sendChatAction", {
		chat_id: chatId,
		action,
	});
}

export function splitMessage(text: string, maxLength = 4000): string[] {
	const chunks: string[] = [];
	let current = "";

	for (const line of text.split("\n")) {
		const candidate = current ? `${current}\n${line}` : line;

		if (candidate.length <= maxLength) {
			current = candidate;
			continue;
		}

		if (current) {
			chunks.push(current);
			current = "";
		}

		if (line.length <= maxLength) {
			current = line;
			continue;
		}

		for (let index = 0; index < line.length; index += maxLength) {
			chunks.push(line.slice(index, index + maxLength));
		}
	}

	if (current) {
		chunks.push(current);
	}

	return chunks;
}
