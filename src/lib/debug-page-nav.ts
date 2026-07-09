export const DEBUG_PAGE_NAV_DESKTOP_MEDIA_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)'

export function shouldShowDebugPageNav({
  isDevelopment,
  matchesDesktopPointer,
  pathname,
}: {
  isDevelopment: boolean
  matchesDesktopPointer: boolean
  pathname?: string | null
}): boolean {
  return Boolean(
    isDevelopment
      && matchesDesktopPointer
      && pathname !== '/screenshot'
      && pathname !== '/ocr',
  )
}
