type Listener = () => void;
const listeners = new Set<Listener>();

/** Anything that suspects a support prompt is waiting (app focus, a voice event) calls this; the host fetches and shows it. */
export const requestSupportPromptCheck = () => { listeners.forEach(listener => listener()); };

export const onSupportPromptCheck = (listener: Listener) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
