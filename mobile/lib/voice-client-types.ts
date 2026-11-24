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
};

export type VoiceClientOptions = { onEvent: (event: VoiceEvent) => void; onError: (message: string) => void };
