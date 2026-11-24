// TypeScript entrypoint. Metro selects voice-client.web.ts or voice-client.native.ts by platform.
export { createVoiceClient, isVoiceSupported, VOICE_UNSUPPORTED_MESSAGE } from './voice-client.web';
