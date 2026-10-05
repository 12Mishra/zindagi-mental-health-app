export type VoiceEvent = {
  type: string;
  text?: string;
  code?: string;
  level?: string;
  summaryStatus?: string;
  generationId?: string;
  segmentIndex?: number;
  serviceMessage?: boolean;
};

export type VoiceClient = {
  start(ticket: string): Promise<void>;
  end(): void;
  mute(value: boolean): void;
};

export type VoiceClientOptions = { onEvent: (event: VoiceEvent) => void; onError: (message: string) => void };
