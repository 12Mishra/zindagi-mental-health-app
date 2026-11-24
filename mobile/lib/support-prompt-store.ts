/** What the student said to Lisa about the open prompt. It only pre-fills the sheet; sending still needs their tap. */
export type PromptHint = { intent: 'message' | 'call' | 'accept'; contactId?: string | null };
type Listener = (hint?: PromptHint) => void;
const listeners = new Set<Listener>();
/** Prompts the student turned down out loud: not popped again this app session (they stay in the server's normal flow). */
const dismissed = new Set<string>();

/** Anything that suspects a support prompt is waiting (app focus, a voice event) calls this; the host fetches and shows it. */
export const requestSupportPromptCheck = (hint?: PromptHint) => { listeners.forEach(listener => listener(hint)); };

export const onSupportPromptCheck = (listener: Listener) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const dismissSupportPrompt = (promptId: string) => { dismissed.add(promptId); };
export const isSupportPromptDismissed = (promptId: string) => dismissed.has(promptId);
