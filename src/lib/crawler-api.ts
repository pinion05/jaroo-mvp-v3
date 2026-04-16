export const DEFAULT_CRAWLER_BASE_URL = 'http://127.0.0.1:3040'

export function getCrawlerBaseUrl() {
  const configuredBaseUrl = process.env.JAROO_CRAWLER_BASE_URL ?? process.env.CRAWLER_BASE_URL
  return (configuredBaseUrl || DEFAULT_CRAWLER_BASE_URL).replace(/\/+$/, '')
}

export function buildCrawlerUrl(baseUrl: string, pathWithSearch: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const normalizedPath = pathWithSearch.startsWith('/') ? pathWithSearch : `/${pathWithSearch}`
  return `${normalizedBaseUrl}${normalizedPath}`
}
