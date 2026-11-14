declare global {
	interface Env {
		TELEGRAM_BOT_TOKEN: string;
		STEAM_API_KEY: string;
		DEEPSEEK_API_KEY: string;
		TELEGRAM_WEBHOOK_SECRET?: string;
		USERS: KVNamespace;
	}
}

export {};
