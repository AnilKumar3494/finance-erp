import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import { brandingStorage } from '@/lib/storage'

// --------------------------------------------------
// Types — mirror backend/app/schemas/org_settings.py.
// GET /settings/branding is public (the login page shows the name before
// sign-in); PATCH is SUPER_ADMIN only.
// --------------------------------------------------

export interface Branding {
  display_name: string
  short_name: string
}

export type BrandingUpdate = Partial<Branding>

export const DEFAULT_BRANDING: Branding = {
  display_name: 'Sri Adithya Finance',
  short_name: 'Sri',
}

export const settingsKeys = {
  all: ['settings'] as const,
  branding: () => [...settingsKeys.all, 'branding'] as const,
}

function isBranding(v: unknown): v is Branding {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Branding).display_name === 'string' &&
    typeof (v as Branding).short_name === 'string'
  )
}

function cachedBranding(): Branding | undefined {
  try {
    const parsed: unknown = JSON.parse(brandingStorage.get() ?? 'null')
    return isBranding(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

// Never errors: an older backend without the endpoint (404), or any failure,
// yields the defaults. The last good value is kept in localStorage so a
// franchise's own name shows on first paint instead of flashing the default.
export function useBranding(): Branding {
  const { data } = useQuery({
    queryKey: settingsKeys.branding(),
    queryFn: async (): Promise<Branding> => {
      try {
        const { data } = await apiClient.get<Branding>('/settings/branding')
        if (!isBranding(data)) return DEFAULT_BRANDING
        brandingStorage.set(JSON.stringify(data))
        return data
      } catch {
        return cachedBranding() ?? DEFAULT_BRANDING
      }
    },
    placeholderData: cachedBranding,
    staleTime: 30 * 60_000,
    retry: false,
  })
  return data ?? DEFAULT_BRANDING
}

export function useUpdateBranding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: BrandingUpdate) => {
      const { data } = await apiClient.patch<Branding>('/settings/branding', payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.branding() }),
  })
}
