import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'

import { apiClient } from '@/api/client'
import type { LoanListResponse } from '@/api/queries/loans'
import { nextPageParam } from '@/lib/infinitePage'
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
  // Portfolio KPIs over the whole filtered set (not just this page). Money
  // fields are strings; status_counts is keyed by AssetStatus, zero-filled.
  total_vehicles: number
  total_market_value: string
  total_purchase_cost: string
  status_counts: Record<AssetStatus, number>
}

// Source of truth: the runtime array. The type is derived from it so the
// URL/state whitelist and the type system stay in lock-step. Must match the
// backend _SORTABLE_COLUMNS dict in services/vehicle.py.
export const VEHICLE_SORT_FIELDS = [
  'plate_number',
  'make',
  'year',
  'status',
  'market_value',
  'created_at',
] as const

export type VehicleSortField = (typeof VEHICLE_SORT_FIELDS)[number]

export type SortOrder = 'asc' | 'desc'

export interface VehicleListParams {
  page: number
  page_size?: number
  search?: string
  status?: AssetStatus
  type?: AssetType
  // Registration-date window (ISO yyyy-mm-dd), inclusive.
  created_after?: string
  created_before?: string
  sort_by?: VehicleSortField
  sort_order?: SortOrder
}

export type VehicleInfiniteParams = Omit<VehicleListParams, 'page'>

export const vehicleKeys = {
  all: ['vehicles'] as const,
  lists: () => [...vehicleKeys.all, 'list'] as const,
  list: (params: VehicleListParams) => [...vehicleKeys.lists(), params] as const,
  infiniteLists: () => [...vehicleKeys.all, 'infiniteList'] as const,
  infiniteList: (params: VehicleInfiniteParams) =>
    [...vehicleKeys.infiniteLists(), params] as const,
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

// Infinite (scroll) variant of the vehicles list. The KPI fields on the
// response cover the whole filtered set (identical across pages), so callers
// read them off the first page.
export function useInfiniteVehicles(params: VehicleInfiniteParams, enabled = true) {
  const pageSize = params.page_size ?? 50
  return useInfiniteQuery({
    queryKey: vehicleKeys.infiniteList({ ...params, page_size: pageSize }),
    queryFn: async ({ pageParam }) => {
      const { data } = await apiClient.get<VehicleListResponse>('/vehicles/', {
        params: { ...params, page_size: pageSize, page: pageParam },
      })
      return data
    },
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled,
    placeholderData: keepPreviousData,
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

// Mirror backend VehicleBase/VehicleCreate. Monetary values are strings.
// The New Finance wizard defaults type=COLLATERAL and status=WITH_CUSTOMER.
export interface VehicleCreate {
  type: AssetType
  plate_number: string
  make?: string | null
  model?: string | null
  year?: number | null
  color?: string | null
  chassis_number?: string | null
  engine_number?: string | null
  market_value?: string
  purchase_cost?: string
  status?: AssetStatus
}

export function useCreateVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: VehicleCreate) => {
      const { data } = await apiClient.post<VehicleResponse>('/vehicles/', payload, {
        headers: { 'Idempotency-Key': uuidv4() },
      })
      return data
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: vehicleKeys.lists() })
      qc.setQueryData(vehicleKeys.detail(created.id), created)
    },
  })
}

// Partial update — mirror backend VehicleUpdate (PATCH /vehicles/{id}). All
// fields optional; the backend uses model_dump(exclude_unset=True). Monetary
// values are strings. Plate edits cascade to any loan that embeds this vehicle,
// so we invalidate loan queries too.
export interface VehicleUpdate {
  plate_number?: string
  make?: string | null
  model?: string | null
  year?: number | null
  color?: string | null
  chassis_number?: string | null
  engine_number?: string | null
  market_value?: string
  purchase_cost?: string
  status?: AssetStatus
}

export function useUpdateVehicle(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: VehicleUpdate) => {
      const { data } = await apiClient.patch<VehicleResponse>(`/vehicles/${id}`, payload)
      return data
    },
    onSuccess: (updated) => {
      qc.setQueryData(vehicleKeys.detail(id), updated)
      qc.invalidateQueries({ queryKey: vehicleKeys.lists() })
      // Loan responses embed the vehicle (plate/make/model/year); refresh them
      // so detail/list cards reflect the change.
      qc.invalidateQueries({ queryKey: ['loans'] })
    },
  })
}

// Soft delete (DELETE /vehicles/{id} → 204). Blocked server-side when the
// vehicle is collateral on an active loan (400). We deliberately do NOT remove
// the detail cache: the detail page stays mounted afterwards so the user can
// Restore in place (GET /vehicles/{id} 404s on deleted rows, so navigating back
// to it would be impossible).
export function useDeleteVehicle(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/vehicles/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vehicleKeys.lists() })
    },
  })
}

// Reverse a soft delete (POST /vehicles/{id}/restore). Returns the restored
// vehicle; 409 if another active vehicle now holds the plate.
export function useRestoreVehicle(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<VehicleResponse>(`/vehicles/${id}/restore`)
      return data
    },
    onSuccess: (restored) => {
      qc.setQueryData(vehicleKeys.detail(id), restored)
      qc.invalidateQueries({ queryKey: vehicleKeys.lists() })
    },
  })
}

// Loans backed by this vehicle (GET /vehicles/{id}/loans). Returns the standard
// paginated loan list shape; we ask for the embedded customer so rows can show
// the borrower's name without an extra fetch.
export function useVehicleLoans(id: string | undefined) {
  return useQuery({
    queryKey: [...vehicleKeys.detail(id ?? ''), 'loans'] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<LoanListResponse>(`/vehicles/${id}/loans`, {
        params: { include: 'customer', page_size: 100 },
      })
      return data
    },
    enabled: !!id,
  })
}
