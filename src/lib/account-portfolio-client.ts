import type { PortfolioNormalizedItem } from './workflow-types'

type AccountPortfolioApiResponse = {
  ok?: boolean
  items?: PortfolioNormalizedItem[]
}

export async function fetchAccountPortfolioItems(fetcher: typeof fetch = fetch): Promise<PortfolioNormalizedItem[]> {
  try {
    const response = await fetcher('/api/portfolio', { cache: 'no-store' })

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as AccountPortfolioApiResponse
    return Array.isArray(payload.items) ? payload.items : []
  } catch {
    return []
  }
}

export async function saveAccountPortfolioItems(items: PortfolioNormalizedItem[], fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher('/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })

    return response.ok
  } catch {
    return false
  }
}
