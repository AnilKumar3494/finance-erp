import { createFileRoute } from '@tanstack/react-router'

import { VehiclesListPage } from '@/features/vehicles/pages/VehiclesListPage'
import {
  VEHICLE_SORT_FIELDS,
  type VehicleSortField,
  type SortOrder,
} from '@/api/queries/vehicles'
import { AssetStatus, AssetType } from '@/schemas/enums'

export interface VehiclesListSearch {
  page: number
  search?: string
  status?: AssetStatus
  type?: AssetType
  // Registration-date window (ISO yyyy-mm-dd), scoping the list + KPIs.
  date_from?: string
  date_to?: string
  sort_by?: VehicleSortField
  sort_order?: SortOrder
}

export const Route = createFileRoute('/_authed/vehicles/')({
  staticData: { title: 'Vehicles' },
  validateSearch: (raw: Record<string, unknown>): VehiclesListSearch => {
    const page = Number(raw.page)
    const search =
      typeof raw.search === 'string' && raw.search.length > 0 ? raw.search : undefined
    const status =
      typeof raw.status === 'string' && AssetStatus.options.includes(raw.status as AssetStatus)
        ? (raw.status as AssetStatus)
        : undefined
    const type =
      typeof raw.type === 'string' && AssetType.options.includes(raw.type as AssetType)
        ? (raw.type as AssetType)
        : undefined
    const sort_by =
      typeof raw.sort_by === 'string' &&
      (VEHICLE_SORT_FIELDS as readonly string[]).includes(raw.sort_by)
        ? (raw.sort_by as VehicleSortField)
        : undefined
    const sort_order =
      raw.sort_order === 'asc' || raw.sort_order === 'desc'
        ? (raw.sort_order as SortOrder)
        : undefined
    const date_from =
      typeof raw.date_from === 'string' && raw.date_from.length > 0 ? raw.date_from : undefined
    const date_to =
      typeof raw.date_to === 'string' && raw.date_to.length > 0 ? raw.date_to : undefined
    return {
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      search,
      status,
      type,
      date_from,
      date_to,
      sort_by,
      sort_order,
    }
  },
  component: VehiclesListPage,
})
