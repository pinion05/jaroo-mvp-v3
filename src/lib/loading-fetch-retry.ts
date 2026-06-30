/**
 * Fetch helper for the DeepScan loading screen's proxy JSON endpoints.
 *
 * These endpoints (briefing snapshot, quick quote, US market indicators) are
 * backed by crawlers that can transiently return 5xx when an upstream such as
 * Polygon.io rate-limits (429) and exhausts its own internal retries. Without
 * client-side retries a single failed response leaves the loading cards stuck
 * in their "확인 중" fallback forever, because the loading state never resolves.
 *
 * This helper retries `{ ok, data }` responses with backoff until the data
 * arrives or the caller aborts (target change / unmount).
 */

const DEFAULT_LOADING_RETRY_DELAYS_MS = [4_000, 12_000, 30_000] as const

type LoadingProxyResponse<T> = { ok?: boolean; data?: T }

export type LoadingProxyResult<T> = { ok: true; data: T } | { ok: false }

/**
 * Fetch a `{ ok, data }` proxy endpoint, retrying on any non-ok response or
 * network error. Resolves with `{ ok: true, data }` once a valid payload lands,
 * or `{ ok: false }` if all attempts are exhausted or the signal aborts.
 */
export async function fetchLoadingProxyJson<T>(
  url: string,
  options: { signal?: AbortSignal; retryDelaysMs?: readonly number[] } = {},
): Promise<LoadingProxyResult<T>> {
  const { signal, retryDelaysMs = DEFAULT_LOADING_RETRY_DELAYS_MS } = options
  const attempts = 1 + retryDelaysMs.length

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) {
      return { ok: false }
    }

    try {
      const response = await fetch(url, { cache: 'no-store', signal })
      if (response.ok && !signal?.aborted) {
        const body = (await response.json()) as LoadingProxyResponse<T>
        if (body?.ok && body.data) {
          return { ok: true, data: body.data }
        }
      }
    } catch {
      if (signal?.aborted) {
        return { ok: false }
      }
      // network error or upstream timeout → fall through to backoff retry
    }

    if (attempt < attempts - 1) {
      await abortableDelay(retryDelaysMs[attempt], signal)
      if (signal?.aborted) {
        return { ok: false }
      }
    }
  }

  return { ok: false }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
