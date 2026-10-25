/** Product-native supervisor handoffs; see PROVENANCE.json for upstream authorship. */
export interface CrewJob {
  name: string
  instruction: string
  purpose?: string
}

export interface CrewDelegation {
  batchId: string
  batchSize: number
  jobIndex: number
  jobId: string
  depth: number
  agentPath: string[]
}

export interface CrewHandoffResult {
  content: string
  isError?: boolean
}

export interface CrewHandoffOptions {
  batchId: string
  signal?: AbortSignal
  /** Hard upper bound is four; the product currently admits at most four jobs per call. */
  maxConcurrency?: number
}

function stoppedResult(job: CrewJob): CrewHandoffResult {
  return { content: `${job.name} stopped because the parent task was stopped.`, isError: true }
}

/**
 * Execute independent handoffs concurrently while preserving input-order results.
 * Every job settles individually, so one failed specialist cannot cancel its siblings.
 */
export async function runCrewHandoffs(
  jobs: readonly CrewJob[],
  handoff: (job: CrewJob, delegation: CrewDelegation) => Promise<CrewHandoffResult>,
  options: CrewHandoffOptions
): Promise<CrewHandoffResult[]> {
  if (!jobs.length) return []
  const results = new Array<CrewHandoffResult>(jobs.length)
  const concurrency = Math.max(1, Math.min(options.maxConcurrency ?? 3, 4, jobs.length))
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < jobs.length) {
      const index = nextIndex++
      const job = jobs[index]
      if (options.signal?.aborted) {
        results[index] = stoppedResult(job)
        continue
      }
      const delegation: CrewDelegation = {
        batchId: options.batchId,
        batchSize: jobs.length,
        jobIndex: index,
        jobId: `${options.batchId}:job-${index + 1}`,
        depth: 1,
        agentPath: ['Captain', job.name]
      }
      try {
        results[index] = await handoff(job, delegation)
      } catch (error) {
        // A specialist failure is data for the supervisor, not a rejected batch.
        results[index] = {
          content: `Crew sub-agent ${job.name} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          isError: true
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return results
}
