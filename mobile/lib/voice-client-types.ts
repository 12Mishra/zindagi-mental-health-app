export type VoiceEvent = {
  type: string;
  text?: string;
  code?: string;
  level?: string;
  provisional?: boolean;
  stage?: string;
  summaryStatus?: string;
  generationId?: string;
  segmentIndex?: number;
  serviceMessage?: boolean;
  promptId?: string;
  intent?: 'message' | 'call' | 'accept' | 'decline';
  contactId?: string | null;
};

export type VoiceClient = {
  start(ticket: string): Promise<void>;
  end(): void;
  mute(value: boolean): void;
  /** Current loudness, 0..1, of the microphone and of Lisa's playback. Polled by the UI for animation only. */
  levels(): { mic: number; lisa: number };
};

export type VoiceClientOptions = { onEvent: (event: VoiceEvent) => void; onError: (message: string) => void };
