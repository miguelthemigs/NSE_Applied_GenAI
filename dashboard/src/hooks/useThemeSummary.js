import { useEffect, useState } from 'react'
import { filtersToApiParams } from '../utils/filters'
import { apiUrl } from '../services/api'

export function useThemeSummary(theme, filters = {}) {
  const [liveData, setLiveData] = useState(null)
  const [loadingLive, setLoadingLive] = useState(false)

  const filterKey = JSON.stringify(filtersToApiParams(filters))

  useEffect(() => {
    if (!theme) {
      setLiveData(null)
      setLoadingLive(false)
      return
    }

    let isMounted = true
    const hasActiveFilters = Object.keys(filtersToApiParams(filters)).length > 0
    if (!hasActiveFilters && theme.cachedInsight?.summary) {
      setLiveData(theme.cachedInsight)
      setLoadingLive(false)
      return () => {
        isMounted = false
      }
    }

    const fetchLiveSummary = async () => {
      setLoadingLive(true)
      if (theme.cachedInsight?.summary) {
        setLiveData(theme.cachedInsight)
      }
      try {
        const apiFilters = filtersToApiParams(filters)
        const res = await fetch(apiUrl('/api/theme-summary'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme: theme.name,
            query: theme.name,
            filters: Object.keys(apiFilters).length > 0 ? apiFilters : undefined,
            allow_model_download: true,
          }),
        })
        const data = await res.json()
        if (!isMounted) return

        if (data.status === 'success') {
          setLiveData(data)
        } else {
          // `code` lets the UI translate the reason (error.model_missing); `error` is the raw text for Details.
          setLiveData({ error: data.error || 'Failed to generate summary', code: data.code ?? null })
        }
      } catch (e) {
        if (isMounted) setLiveData({ error: 'Failed to connect to backend server.' })
      } finally {
        if (isMounted) setLoadingLive(false)
      }
    }

    fetchLiveSummary()

    return () => {
      isMounted = false
    }
  }, [theme?.id, theme?.name, theme?.cachedInsight, filterKey])

  return { liveData, loadingLive }
}
