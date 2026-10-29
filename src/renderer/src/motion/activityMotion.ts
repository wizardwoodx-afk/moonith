import type { OrbState } from 'thinking-orbs'
import type { StepRecord, Task } from '@shared/types'

export function orbStateForTool(tool: string | undefined): OrbState {
  const value = (tool ?? '').toLowerCase()
  if (/delegat|crew|team|parallel|orchestrat/.test(value)) return 'weaving'
  if (/search|browse|browser|fetch|crawl|research/.test(value)) return 'searching'
  if (/connect|mcp|provider|channel|gateway/.test(value)) return 'connecting'
  if (/plan|reason|analy|solv|evaluat/.test(value)) return 'solving'
  if (/document|write|report|present|compose|draft/.test(value)) return 'composing'
  if (/artifact|spreadsheet|workbook|code|build|shape|generate/.test(value)) return 'shaping'
  return 'working'
}

export function activeStep(task: Task): StepRecord | undefined {
  return (
    [...task.steps].reverse().find((step) => step.status === 'running' || step.status === 'waiting') ??
    task.steps[task.steps.length - 1]
  )
}

export function orbStateForTask(task: Task, crewActive = false, streaming = false): OrbState {
  if (crewActive) return 'weaving'
  if (streaming) return 'composing'
  if (task.status === 'paused' || task.status === 'waiting') return 'breathing'
  return orbStateForTool(activeStep(task)?.tool)
}
