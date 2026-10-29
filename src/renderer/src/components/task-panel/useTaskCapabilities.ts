import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { BuiltinToolSummary, McpServerConfig, McpServerStatus, SkillSummary } from '@shared/types'
import { errorMessage } from '../../lib/utils'
import { useApp } from '../../store'

export interface TaskCapabilities {
  skills: SkillSummary[]
  configs: McpServerConfig[]
  statuses: McpServerStatus[]
  /** Tools the agent ships with, read from the process that owns them. */
  builtinTools: BuiltinToolSummary[]
  loading: boolean
  refreshing: boolean
  error: string | null
  busyServer: string | null
  refresh: () => Promise<void>
  toggleServer: (config: McpServerConfig) => Promise<void>
  restartServer: (config: McpServerConfig) => Promise<void>
}

export function useTaskCapabilities(): TaskCapabilities {
  const refreshSettings = useApp((state) => state.refreshSettings)
  const mounted = useRef(false)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [configs, setConfigs] = useState<McpServerConfig[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyServer, setBusyServer] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const [nextSkills, nextStatuses, nextSettings, nextTools] = await Promise.all([
        window.knight.listSkills(),
        window.knight.listMcp(),
        window.knight.getSettings(),
        window.knight.listAgentTools()
      ])
      if (!mounted.current) return
      setSkills(nextSkills)
      setStatuses(nextStatuses)
      setConfigs(nextSettings.mcpServers)
      setBuiltinTools(nextTools)
      setError(null)
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
    } finally {
      if (mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  useEffect(() => {
    if (!statuses.some((status) => status.status === 'starting')) return
    const timer = window.setInterval(() => {
      void window.knight
        .listMcp()
        .then((next) => {
          if (mounted.current) setStatuses(next)
        })
        .catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [statuses])

  const finishMutation = useCallback(
    async (config: McpServerConfig, nextStatuses: McpServerStatus[], action: string): Promise<void> => {
      if (mounted.current) {
        setStatuses(nextStatuses)
        setConfigs((current) => current.map((item) => (item.id === config.id ? config : item)))
      }
      const settings = await refreshSettings()
      if (settings && mounted.current) setConfigs(settings.mcpServers)
      const status = nextStatuses.find((item) => item.id === config.id)
      if (status?.status === 'error') {
        toast.error(`${config.name}: ${status.error ?? 'MCP server failed to start.'}`)
      } else if (config.enabled && status?.status !== 'ready') {
        toast.error(`${config.name} did not become ready.`)
      } else {
        toast.success(`${config.name} ${action}.`)
      }
    },
    [refreshSettings]
  )

  const toggleServer = useCallback(
    async (config: McpServerConfig): Promise<void> => {
      if (busyServer) return
      const next = { ...config, enabled: !config.enabled }
      setBusyServer(config.id)
      try {
        const nextStatuses = await window.knight.upsertMcp(next)
        await finishMutation(next, nextStatuses, next.enabled ? 'enabled' : 'disabled')
      } catch (cause) {
        toast.error(errorMessage(cause))
      } finally {
        if (mounted.current) setBusyServer(null)
      }
    },
    [busyServer, finishMutation]
  )

  const restartServer = useCallback(
    async (config: McpServerConfig): Promise<void> => {
      if (busyServer || !config.enabled) return
      setBusyServer(config.id)
      try {
        const nextStatuses = await window.knight.restartMcp(config.id)
        await finishMutation(config, nextStatuses, 'restarted')
      } catch (cause) {
        toast.error(errorMessage(cause))
      } finally {
        if (mounted.current) setBusyServer(null)
      }
    },
    [busyServer, finishMutation]
  )

  return {
    skills,
    configs,
    statuses,
    builtinTools,
    loading,
    refreshing,
    error,
    busyServer,
    refresh,
    toggleServer,
    restartServer
  }
}
