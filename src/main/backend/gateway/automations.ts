/**
 * Moon Gateway — automations.
 *
 * Ported from ExternalAgent's cron/store/row-codec.ts and cron/service. A job is a
 * row in the store: an agent, a session, a prompt and a schedule. Jobs can be
 * grouped into a family so the family can be replaced as a unit.
 */
import type { CronJob } from "./types";

export type CronStoreFile = {
  version: number;
  jobs: CronJob[];
};

/** A five-field cron expression: minute hour day-of-month month day-of-week. */
export function matchesCron(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, mon, dow] = fields;
  const n = (f: string, v: number) => {
    if (f === "*") return true;
    for (const part of f.split(",")) {
      const [range, stepRaw] = part.split("/");
      const step = stepRaw ? Number(stepRaw) : 1;
      if (range === "*") {
        if (v % step === 0) return true;
        continue;
      }
      if (range.includes("-")) {
        const [a, b] = range.split("-").map(Number);
        if (v >= a && v <= b && (v - a) % step === 0) return true;
        continue;
      }
      if (Number(range) === v) return true;
    }
    return false;
  };
  return n(min, date.getMinutes()) && n(hour, date.getHours()) && n(dom, date.getDate()) && n(mon, date.getMonth() + 1) && n(dow, date.getDay());
}

/** When a job should next fire. */
export function nextRunAt(job: CronJob, from = new Date()): number | undefined {
  if (!job.enabled) return undefined;
  const seconds = Number(job.schedule);
  if (Number.isFinite(seconds) && /^\d+$/.test(job.schedule.trim())) {
    return from.getTime() + seconds * 1000;
  }
  // scan the next 48 hours minute by minute for a cron match
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  for (let i = 0; i < 60 * 48; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    if (matchesCron(job.schedule, cursor)) return cursor.getTime();
  }
  return undefined;
}

/** Replace every job of a family with the given set. */
export function replaceCronRows(jobs: CronJob[], family: string, next: CronJob[]): CronJob[] {
  const kept = jobs.filter((j) => j.family !== family);
  return [...kept, ...next];
}

/** Insert or update one job. */
export function upsertCronJobRow(jobs: CronJob[], job: CronJob): CronJob[] {
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i === -1) return [...jobs, job];
  const copy = [...jobs];
  copy[i] = job;
  return copy;
}

/** Remove a job. */
export function deleteCronJobRow(jobs: CronJob[], id: string): CronJob[] {
  return jobs.filter((j) => j.id !== id);
}

/** A stable fingerprint of the job rows, used to detect drift. */
export function fingerprintCronJobRows(jobs: CronJob[]): string {
  return jobs
    .map((j) => `${j.id}:${j.agentId}:${j.sessionKey}:${j.schedule}:${j.enabled ? 1 : 0}`)
    .sort()
    .join("|");
}
