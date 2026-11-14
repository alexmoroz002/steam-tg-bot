export interface UserState {
	steamId: string;
	nickname?: string;
}

function stateKey(chatId: number): string {
	return `user:${chatId}`;
}

export async function getUserState(
	env: Env,
	chatId: number,
): Promise<UserState | null> {
	return env.USERS.get<UserState>(stateKey(chatId), "json");
}

export async function saveUserState(
	env: Env,
	chatId: number,
	state: UserState,
): Promise<void> {
	await env.USERS.put(stateKey(chatId), JSON.stringify(state));
}

export async function clearUserState(
	env: Env,
	chatId: number,
): Promise<void> {
	await env.USERS.delete(stateKey(chatId));
}
