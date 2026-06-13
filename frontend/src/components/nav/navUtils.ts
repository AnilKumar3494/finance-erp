import { useRouterState } from '@tanstack/react-router'

import { useAuth } from '@/app/auth-context'
import { NAV_ITEMS, type NavItem } from './navConfig'

export function isActive(currentPath: string, itemPath: NavItem['path']): boolean {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`)
}

// NAV_ITEMS filtered by the current user's role: `adminOnly` items are hidden
// from non-admins. Shared by every nav surface (sidebar, mobile drawer, bottom
// bar) so visibility stays consistent.
export function useVisibleNavItems(): readonly NavItem[] {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)
}

export function getInitials(source: string | null | undefined, fallback: string): string {
  const name = (source ?? '').trim()
  if (!name) return fallback.slice(0, 2).toUpperCase()
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function usePageTitle(): string {
  return useRouterState({
    select: (s) => {
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const t = s.matches[i]?.staticData?.title
        if (t) return t
      }
      return ''
    },
  })
}

export function useCurrentPath(): string {
  return useRouterState({ select: (s) => s.location.pathname })
}
