// Backchannels never count toward barge-in, so "hmm", "haan haan" or "ok" while Lisa speaks do not cut her off.
const BACKCHANNEL = new Set(['hmm', 'hm', 'mm', 'mhm', 'uh', 'um', 'umm', 'haan', 'han', 'ha', 'haa', 'ok', 'okay',
  'accha', 'acha', 'achha', 'ji', 'yeah', 'yes', 'right', 'theek', 'thik', 'हाँ', 'हां', 'अच्छा', 'ठीक', 'जी', 'हम्म']);

const meaningfulWords = (text: string) =>
  text.toLowerCase().split(/[\s,.!?।;:—-]+/u).filter(word => word && !BACKCHANNEL.has(word)).length;

/**
 * Decides when the student is really talking over Lisa. VAD `SpeechStarted` alone never interrupts
 * (it fires on echo and noise); only partial transcripts with enough new, non-backchannel words do.
 */
export class BargeInDetector {
  private armed = false;
  constructor(private readonly minWords: number) {}

  /** Call when a Lisa generation starts; partials of the student's next utterance are counted from zero. */
  arm() { this.armed = true; }
  disarm() { this.armed = false; }

  speechStarted() { return false; }

  partial(text: string) {
    if (!this.armed || meaningfulWords(text) < this.minWords) return false;
    this.armed = false;
    return true;
  }
}
