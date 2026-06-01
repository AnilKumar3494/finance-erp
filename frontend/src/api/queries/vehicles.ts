import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/api/client'
import type { AssetStatus, AssetType } from '@/schemas/enums'

// --------------------------------------------------
// Types — mirror backend/app/schemas/vehicle.py. Read-only surface: the
// Loans module only needs to look vehicles up (picker + detail link). Full
// vehicle CRUD belongs to a dedicated Vehicles module, not here.
// Monetary fields (Numeric) arrive as strings.
// --------------------------------------------------

export interface VehicleResponse {
  id: string
  type: AssetType
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  chassis_number: string | null
  engine_number: string | null
  market_value: string
  purchase_cost: string
  status: AssetStatus
  is_deleted: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
  created_by_id: string | null
  updated_by_id: string | null
  deleted_by_id: string | null
}

export interface VehicleListResponse {
  total: number
  page: number
  page_size: number
  results: VehicleResponse[]
}

export interface VehicleListParams {
  page: number
  page_size?: number
  search?: string
  status?: AssetStatus
  type?: AssetType
}

export const vehicleKeys = {
  all: ['vehicles'] as const,
  lists: () => [...vehicleKeys.all, 'list'] as const,
  list: (params: VehicleListParams) => [...vehicleKeys.lists(), params] as const,
  details: () => [...vehicleKeys.all, 'detail'] as const,
  detail: (id: string) => [...vehicleKeys.details(), id] as const,
}

export function useVehicles(params: VehicleListParams) {
  return useQuery({
    queryKey: vehicleKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<VehicleListResponse>('/vehicles/', { params })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function useVehicle(id: string | undefined) {
  return useQuery({
    queryKey: vehicleKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<VehicleResponse>(`/vehicles/${id}`)
      return data
    },
    enabled: !!id,
  })
}
