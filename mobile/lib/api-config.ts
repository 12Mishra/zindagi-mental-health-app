const HOST = process.env.EXPO_PUBLIC_API_HOST ?? "localhost";

export const AUTH_API_URL = `http://${HOST}:4000`;
export const VOICE_API_URL = `http://${HOST}:4001`;
export const VOICE_WS_URL = `ws://${HOST}:4001/voice/ws`;
