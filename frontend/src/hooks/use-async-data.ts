import { useCallback, useEffect, useRef, useState, type DependencyList, type SetStateAction } from "react"

import { getErrorMessage } from "@/lib/error-message"

type UseAsyncDataOptions<T> = {
  enabled?: boolean
  initialData?: T | null
  keepPreviousData?: boolean
  loadOnMount?: boolean
  resetOnDisable?: boolean
  fallbackError?: string
}

type RefreshOptions = {
  background?: boolean
}

export type AsyncDataStatus = "idle" | "loading" | "refreshing" | "success" | "error"

export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: DependencyList,
  options: UseAsyncDataOptions<T> = {},
) {
  const {
    enabled = true,
    initialData = null,
    keepPreviousData = true,
    loadOnMount = true,
    resetOnDisable = true,
    fallbackError = "Не удалось загрузить данные",
  } = options

  const initialHasValue = initialData !== null && initialData !== undefined
  const loaderRef = useRef(loader)
  const requestIdRef = useRef(0)
  const dataRef = useRef<T | null>(initialData)

  const [dataState, setDataState] = useState<T | null>(initialData)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(enabled && loadOnMount && !initialHasValue)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(initialHasValue)

  useEffect(() => {
    loaderRef.current = loader
  }, [loader])

  useEffect(() => {
    dataRef.current = dataState
  }, [dataState])

  const setData = useCallback((next: SetStateAction<T | null>) => {
    setDataState((prev) => {
      const value = typeof next === "function" ? (next as (value: T | null) => T | null)(prev) : next
      dataRef.current = value
      return value
    })
  }, [])

  const refresh = useCallback(
    async (refreshOptions: RefreshOptions = {}) => {
      if (!enabled) return null

      const requestId = ++requestIdRef.current
      const hasExistingData = dataRef.current !== null && dataRef.current !== undefined
      const background = refreshOptions.background ?? (keepPreviousData && hasExistingData)

      setError(null)

      if (background) {
        setIsRefreshing(true)
      } else {
        setIsLoading(true)
      }

      try {
        const result = await loaderRef.current()
        if (requestIdRef.current !== requestId) return null
        setData(result)
        setHasLoaded(true)
        return result
      } catch (error) {
        if (requestIdRef.current !== requestId) return null
        setError(getErrorMessage(error, fallbackError))
        setHasLoaded(true)
        return null
      } finally {
        if (requestIdRef.current === requestId) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [enabled, fallbackError, keepPreviousData, setData],
  )

  const reset = useCallback(() => {
    requestIdRef.current += 1
    setError(null)
    setIsLoading(false)
    setIsRefreshing(false)
    setHasLoaded(initialHasValue)
    setData(initialData)
  }, [initialData, initialHasValue, setData])

  useEffect(() => {
    if (!enabled) {
      if (resetOnDisable) {
        reset()
      }
      return
    }

    if (!loadOnMount) return

    void refresh()
  }, [enabled, loadOnMount, refresh, reset, resetOnDisable, ...deps])

  const status: AsyncDataStatus = !enabled
    ? "idle"
    : isLoading
      ? "loading"
      : isRefreshing
        ? "refreshing"
        : error
          ? "error"
          : hasLoaded
            ? "success"
            : "idle"

  return {
    data: dataState,
    error,
    status,
    isLoading,
    isInitialLoading: isLoading && !hasLoaded,
    isRefreshing,
    isSettled: hasLoaded && !isLoading && !isRefreshing,
    hasLoaded,
    setData,
    refresh,
    reset,
  }
}
