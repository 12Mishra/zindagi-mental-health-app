import { performance } from 'node:perf_hooks';
import { config } from '../config';
import { turnLanguage } from '../voice/policy';
import { ContextAgent, PartialBriefer } from './context-agent';
import { getLongTerm } from './long-term';
import { buildPrompt, type PromptResult } from './prompt-builder';
import { expireSession, loadSession, saveSession, emptySession, type SessionState } from './session-memory';
import { embeddingsEnabled, search } from './vector';
import type { LongTermMemory, MemoryLanguage, Turn } from './types';
import { emptyLongTerm } from './types';

type Entry = { role: Turn['role']; text: () => string; turn: number };
export type SessionSnapshot = Pick<SessionState, 'rollingSummary' | 'notes' | 'language' | 'riskTimeline' | 'turnCount'>;
type Deps = { agent: ContextAgent; recall: typeof search };

const FALLBACK_FOLD_AFTER = 20;

/**
 * Per-voice-session memory. The prompt is built from an in-process mirror (no Redis/DB on the hot path); Redis holds
 * the durable copy. The context agent runs only through `onPartial` and `afterTurn` and is never awaited by a turn.
 */
export class SessionContext {
  private readonly working: Entry[] = [];
  private state: SessionState = emptySession();
  private turn = 0;
  private searched = false;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly briefer: PartialBriefer;

  constructor(readonly conversationId: string, readonly userId: string, private readonly systemPrompt: string,
    private longTerm: LongTermMemory = emptyLongTerm(), private readonly deps: Deps = { agent: new ContextAgent(null), recall: search }) {
    this.briefer = new PartialBriefer((text, signal, epoch) => this.runBrief(text, signal, epoch));
  }

  static async open(conversationId: string, userId: string, systemPrompt: string, deps: Deps) {
    const [longTerm, state] = await Promise.all([
      getLongTerm(conversationId, userId).catch(() => emptyLongTerm()), loadSession(conversationId),
    ]);
    const context = new SessionContext(conversationId, userId, systemPrompt, longTerm, deps);
    if (state) context.state = state;
    return context;
  }

  get preferences() { return this.longTerm.preferences; }
  get language(): MemoryLanguage { return this.state.language; }

  /** A student turn was finalised: new turn starts, in-flight partial briefs are invalidated. */
  addUser(text: string): number {
    this.briefer.cancel();
    this.searched = false;
    this.turn++;
    this.working.push({ role: 'user', text: () => text, turn: this.turn });
    this.state.language = this.rollingLanguage();
    return this.turn;
  }

  /**
   * `getText` is read lazily so the delivered text (what the student heard) is used. The entry is inserted right after
   * that turn's student entry, so a late reply of an interrupted turn cannot land after the next student turn.
   */
  addAssistant(turn: number, getText: () => string) {
    let at = this.working.length;
    for (let i = this.working.length - 1; i >= 0; i--) if (this.working[i].turn === turn) { at = i + 1; break; }
    this.working.splice(at, 0, { role: 'assistant', text: getText, turn });
  }

  /** Synchronous, in-memory. */
  build(): PromptResult & { promptBuildMs: number } {
    const started = performance.now();
    const brief = this.state.turnBrief && this.state.turnBrief.forTurn >= this.turn - 1 ? this.state.turnBrief : null;
    const turns = this.working.slice(-config.workingTurns).map(e => ({ role: e.role, content: e.text() }));
    const result = buildPrompt({
      systemPrompt: this.systemPrompt, longTerm: this.longTerm, session: { ...this.state, turnBrief: brief },
      turns, budgetTokens: config.promptTokenBudget,
    });
    return { ...result, promptBuildMs: Number((performance.now() - started).toFixed(2)) };
  }

  onPartial(text: string) {
    if (this.closed || !this.deps.agent.enabled) return;
    this.briefer.onPartial(text);
  }

  recordRisk(level: string) {
    this.state.riskTimeline = [...this.state.riskTimeline, { turn: this.turn, level, at: Date.now() }].slice(-50);
    void saveSession(this.conversationId, { riskTimeline: this.state.riskTimeline });
  }

  /** After a completed or interrupted turn: notes update and rolling-summary fold, serialised and non-blocking. */
  afterTurn() {
    if (this.closed) return this.chain;
    this.chain = this.chain.then(() => this.fold(false)).catch(() => {});
    return this.chain;
  }

  /** Session end: fold what is left into the summary (best effort), persist, start the TTL. */
  async close(): Promise<SessionSnapshot> {
    await this.chain.catch(() => {});
    this.briefer.cancel();
    if (this.deps.agent.enabled && this.working.length) await this.fold(true).catch(() => {});
    this.closed = true;
    await saveSession(this.conversationId, { ...this.snapshot() });
    await expireSession(this.conversationId);
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    const { rollingSummary, notes, language, riskTimeline } = this.state;
    return { rollingSummary, notes, language, riskTimeline, turnCount: this.turn };
  }

  private rollingLanguage(): MemoryLanguage {
    const recent = this.working.filter(e => e.role === 'user').slice(-5).map(e => turnLanguage(e.text()));
    if (!recent.length) return 'en';
    return recent.every(l => l === 'hi') ? 'hi' : recent.every(l => l === 'en') ? 'en' : 'mixed';
  }

  private async fold(all: boolean) {
    const keep = all ? 0 : config.workingTurns;
    const overflowCount = Math.max(0, this.working.length - keep);
    const overflow = this.working.slice(0, overflowCount).map(e => ({ role: e.role, content: e.text() })).filter(t => t.content.trim());
    const latest = this.working.slice(-2).map(e => ({ role: e.role, content: e.text() })).filter(t => t.content.trim());
    const update = this.deps.agent.enabled && (latest.length || overflow.length)
      ? await this.deps.agent.updateNotes({ notes: this.state.notes, rollingSummary: this.state.rollingSummary, latest: all ? [] : latest, overflow }).catch(() => null)
      : null;
    if (update) {
      this.state.notes = update.notes;
      if (update.rollingSummary !== null) this.state.rollingSummary = update.rollingSummary;
    }
    if (overflowCount) {
      const folded = !!update && update.rollingSummary !== null;
      // Without the agent (or after a failure) keep the raw overflow a while, then fall back to a truncated join.
      if (folded || !this.deps.agent.enabled || overflowCount > FALLBACK_FOLD_AFTER) {
        if (!folded) {
          const joined = `${this.state.rollingSummary} ${overflow.map(t => `${t.role === 'user' ? 'Student' : 'Lisa'}: ${t.content}`).join(' ')}`.trim();
          this.state.rollingSummary = joined.slice(-1500);
        }
        this.working.splice(0, overflowCount);
      }
    }
    this.state.turnCount = this.turn;
    await saveSession(this.conversationId, { notes: this.state.notes, rollingSummary: this.state.rollingSummary, language: this.state.language, turnCount: this.turn });
  }

  private async runBrief(partial: string, signal: AbortSignal, epoch: number) {
    let recalled = this.state.recalled;
    if (embeddingsEnabled() && !this.searched) {
      this.searched = true;
      const hits = await this.deps.recall(this.userId, partial, 3, config.contextRecallMinScore).catch(() => []);
      if (signal.aborted || epoch !== this.briefer.epoch) return;
      if (hits.length) recalled = hits.map(h => ({ memorySummaryId: h.id, text: h.summary.slice(0, 300) }));
    }
    const brief = await this.deps.agent.brief({
      partial, notes: this.state.notes, memoryCard: this.longTerm.memoryCard, recalled: recalled.map(r => r.text), forTurn: this.turn + 1,
    }, signal);
    // Stale (turn already finalised) or invalid output: keep the previous state.
    if (!brief || signal.aborted || epoch !== this.briefer.epoch || this.closed) return;
    this.state.turnBrief = brief;
    this.state.recalled = recalled;
    await saveSession(this.conversationId, { turnBrief: brief, recalled });
  }
}
