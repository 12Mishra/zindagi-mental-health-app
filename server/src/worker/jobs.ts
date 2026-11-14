import { config } from '../config';
import { runAlertEngine } from './alert-engine';
import { rollupTick } from './rollup-job';
import { classifyPendingCheckins } from './severity-job';

/** Runs `task` now and then every `ms`, never overlapping itself, and never letting an error stop the schedule. */
function every(name: string, ms: number, task: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await task(); } catch (error) {
      // Message only (provider status, SQL error); never student text.
      console.warn(`[insights] ${name} failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`);
    } finally { running = false; }
  };
  void tick();
  setInterval(tick, ms);
}

export function startInsightJobs(): void {
  every('rollup', config.rollupIntervalMs, () => rollupTick());
  every('alerts', config.alertIntervalMs, () => runAlertEngine());
  every('severity', config.severityPollMs, () => classifyPendingCheckins());
  console.log('Insight jobs running: rollup, alerts, severity');
}
