import { useEffect, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import { getRouteApi } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import AddIcon from '@mui/icons-material/Add'

import { useInfiniteUsers, useUsers, type UserAccount } from '@/api/queries/users'
import { useAuth } from '@/app/auth-context'
import { Btn, Card, ErrorBanner, Input, Spinner } from '@/components/primitives'
import {
  LIST_MAX_HEIGHT,
  LIST_MIN_HEIGHT,
  stickyHeaderCellSx,
  useInfiniteRows,
} from '@/components/infinite/listScroll'
import { CountBar, LoadMoreFooter } from '@/components/infinite/InfiniteFooter'
import { TopScrollbar } from '@/components/infinite/TopScrollbar'
import type { UserRole } from '@/schemas/enums'
import { USER_ROLE_META, USER_ROLE_ORDER } from '../userRoleMeta'
import { RoleChip } from '../components/RoleChip'
import { CreateAccountDialog } from '../components/CreateAccountDialog'
import { RemoveAccountDialog } from '../components/RemoveAccountDialog'
import { ChangeRoleDialog } from '../components/ChangeRoleDialog'
import { ResetPasswordDialog } from '../components/ResetPasswordDialog'

const routeApi = getRouteApi('/_authed/team')

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

function mapListError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 403) return 'Team management is available to administrators only.'
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.'
  }
  return 'Something went wrong loading the team.'
}

// Permission helpers — mirror the backend route guards. The server is the real
// gate; these just hide actions the caller can't perform.
interface Perms {
  isSuperAdmin: boolean
  isAdmin: boolean
  currentUserId: string | undefined
}
function canChangeRole(target: UserAccount, p: Perms): boolean {
  return p.isSuperAdmin && target.role !== 'SUPER_ADMIN' && target.id !== p.currentUserId
}
function canRemove(target: UserAccount, p: Perms): boolean {
  if (target.role === 'SUPER_ADMIN' || target.id === p.currentUserId) return false
  return target.role === 'ADMIN' ? p.isSuperAdmin : p.isAdmin
}
// Admin/super-admin may set a new temp password for another user. Self is
// excluded (use the account-menu "Change password" instead). Resetting a
// SUPER_ADMIN is super-admin-only, mirroring the backend route guard — in
// practice SUPER_ADMIN rows aren't listed, so that clause is defense-in-depth.
function canResetPassword(target: UserAccount, p: Perms): boolean {
  if (target.id === p.currentUserId) return false
  if (target.role === 'SUPER_ADMIN') return p.isSuperAdmin
  return p.isAdmin
}

export function TeamPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const perms: Perms = {
    isSuperAdmin: user?.role === 'SUPER_ADMIN',
    isAdmin,
    currentUserId: user?.id,
  }

  const { search: searchTerm, role } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()

  const [draft, setDraft] = useState(() => searchTerm ?? '')
  const isFirstRun = useRef(true)
  const lastWrittenSearch = useRef<string | undefined>(searchTerm)

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    const t = setTimeout(() => {
      const next = draft.trim() || undefined
      lastWrittenSearch.current = next
      navigate({ search: (prev) => ({ ...prev, search: next }), replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [draft, navigate])

  useEffect(() => {
    if (searchTerm !== lastWrittenSearch.current) {
      lastWrittenSearch.current = searchTerm
      setDraft(searchTerm ?? '')
    }
  }, [searchTerm])

  // Dialog state.
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<UserAccount | null>(null)
  const [roleTarget, setRoleTarget] = useState<UserAccount | null>(null)
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null)

  const query = useInfiniteUsers({ page_size: PAGE_SIZE, search: searchTerm, role })

  // Super admins are hidden from the roster (they can't be managed here). We
  // filter them out of the rows, and subtract their count from the paginated
  // total so the "X members" count stays accurate. The count query is tiny
  // (page_size 1, we only read `total`) and cached. Skipped while a role filter
  // is active, since EMPLOYEE/ADMIN results never include them.
  const saCountQuery = useUsers({ role: 'SUPER_ADMIN', page: 1, page_size: 1 })
  const hiddenCount = role ? 0 : saCountQuery.data?.total ?? 0

  const total = Math.max(0, (query.data?.pages[0]?.total ?? 0) - hiddenCount)
  const rows = (query.data?.pages.flatMap((p) => p.results) ?? []).filter(
    (u) => u.role !== 'SUPER_ADMIN',
  )

  const resetKey = JSON.stringify([searchTerm, role])

  const setRole = (next: UserRole | undefined) =>
    navigate({ search: (prev) => ({ ...prev, role: next }) })

  if (!isAdmin) {
    return (
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
        <Typography variant="h2" sx={{ mb: 3 }}>
          Team
        </Typography>
        <Card>
          <Typography variant="h3">Restricted</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Team management is available to administrators only.
          </Typography>
        </Card>
      </Box>
    )
  }

  const tableProps: TableProps = {
    rows,
    perms,
    onChangeRole: setRoleTarget,
    onRemove: setRemoveTarget,
    onResetPassword: setResetTarget,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    resetKey,
  }

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
      <Box
        sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 2 }}
      >
        <Typography variant="h2" sx={{ order: 0, width: { xs: '100%', sm: 'auto' } }}>
          Team
        </Typography>

        <Box
          sx={{
            order: { xs: 1, sm: 1 },
            width: { xs: '100%', sm: 'auto' },
            flexGrow: { sm: 1 },
            minWidth: { sm: 220 },
          }}
        >
          <Input
            id="team-search"
            placeholder="Search by name, username, or email…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
        </Box>

        <Box sx={{ order: { xs: 2, sm: 2 }, width: { xs: '100%', sm: 'auto' } }}>
          <Btn
            variant="primary"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
            sx={{ whiteSpace: 'nowrap', width: { xs: '100%', sm: 'auto' } }}
          >
            Add account
          </Btn>
        </Box>

        <Box sx={{ order: 3, width: '100%' }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
              label="All roles"
              onClick={() => setRole(undefined)}
              color={role ? 'default' : 'primary'}
              variant={role ? 'outlined' : 'filled'}
              sx={{ height: 36 }}
            />
            {USER_ROLE_ORDER.map((r) => {
              const selected = role === r
              return (
                <Chip
                  key={r}
                  label={USER_ROLE_META[r].label}
                  onClick={() => setRole(selected ? undefined : r)}
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{ height: 36 }}
                />
              )
            })}
          </Stack>
        </Box>
      </Box>

      {query.isError && (
        <Box sx={{ mb: 2 }}>
          <ErrorBanner message={mapListError(query.error)} />
        </Box>
      )}

      {query.isLoading && !query.data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Spinner size={28} />
        </Box>
      ) : rows.length === 0 ? (
        <EmptyState filtered={!!searchTerm || !!role} onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <CountBar loaded={rows.length} total={total} noun="member" nounPlural="members" />
          <DesktopTable {...tableProps} />
          <MobileCards {...tableProps} />
        </>
      )}

      <CreateAccountDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {removeTarget && (
        <RemoveAccountDialog
          user={removeTarget}
          open
          onClose={() => setRemoveTarget(null)}
        />
      )}
      {roleTarget && (
        <ChangeRoleDialog user={roleTarget} open onClose={() => setRoleTarget(null)} />
      )}
      {resetTarget && (
        <ResetPasswordDialog user={resetTarget} open onClose={() => setResetTarget(null)} />
      )}
    </Box>
  )
}

interface TableProps {
  rows: UserAccount[]
  perms: Perms
  onChangeRole: (u: UserAccount) => void
  onRemove: (u: UserAccount) => void
  onResetPassword: (u: UserAccount) => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  resetKey: string
}

function RowActions({
  user,
  perms,
  onChangeRole,
  onRemove,
  onResetPassword,
}: {
  user: UserAccount
  perms: Perms
  onChangeRole: (u: UserAccount) => void
  onRemove: (u: UserAccount) => void
  onResetPassword: (u: UserAccount) => void
}) {
  const showRole = canChangeRole(user, perms)
  const showRemove = canRemove(user, perms)
  const showReset = canResetPassword(user, perms)
  if (!showRole && !showRemove && !showReset) {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        —
      </Typography>
    )
  }
  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
      {showReset && (
        <Btn variant="ghost" size="sm" onClick={() => onResetPassword(user)}>
          Reset password
        </Btn>
      )}
      {showRole && (
        <Btn variant="ghost" size="sm" onClick={() => onChangeRole(user)}>
          Change role
        </Btn>
      )}
      {showRemove && (
        <Btn variant="danger" size="sm" onClick={() => onRemove(user)}>
          Remove
        </Btn>
      )}
    </Stack>
  )
}

// --------------------------------------------------
// Desktop table — md and up (virtualized + infinite)
// --------------------------------------------------

function DesktopTable({
  rows,
  perms,
  onChangeRole,
  onRemove,
  onResetPassword,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  resetKey,
}: TableProps) {
  const { scrollRef, virtualizer, virtualRows, paddingTop, paddingBottom } = useInfiniteRows({
    count: rows.length,
    estimateSize: 57,
    overscan: 12,
    getItemKey: (i) => rows[i]!.id,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    resetKey,
  })

  const spacer = (height: number) =>
    height > 0 ? (
      <TableRow style={{ height }}>
        <TableCell colSpan={5} sx={{ p: 0, border: 0 }} />
      </TableRow>
    ) : null

  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <TopScrollbar targetRef={scrollRef} />
        <TableContainer
          ref={scrollRef}
          sx={{ maxHeight: LIST_MAX_HEIGHT, minHeight: LIST_MIN_HEIGHT, overflow: 'auto' }}
        >
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={stickyHeaderCellSx}>Name</TableCell>
                <TableCell sx={stickyHeaderCellSx}>Username</TableCell>
                <TableCell sx={stickyHeaderCellSx}>Email</TableCell>
                <TableCell sx={stickyHeaderCellSx}>Role</TableCell>
                <TableCell align="right" sx={stickyHeaderCellSx}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {spacer(paddingTop)}
              {virtualRows.map((vr) => {
                const u = rows[vr.index]!
                return (
                  <TableRow key={vr.key} data-index={vr.index} ref={virtualizer.measureElement}>
                    <TableCell>
                      {u.full_name?.trim() || (
                        <Typography component="span" variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)' }}>{u.username}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <RoleChip role={u.role} />
                    </TableCell>
                    <TableCell align="right">
                      <RowActions
                        user={u}
                        perms={perms}
                        onChangeRole={onChangeRole}
                        onRemove={onRemove}
                        onResetPassword={onResetPassword}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
              {spacer(paddingBottom)}
            </TableBody>
          </Table>
        </TableContainer>
        <LoadMoreFooter
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          count={rows.length}
        />
      </Card>
    </Box>
  )
}

// --------------------------------------------------
// Mobile cards — below md (virtualized + infinite)
// --------------------------------------------------

function MobileCards({
  rows,
  perms,
  onChangeRole,
  onRemove,
  onResetPassword,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  resetKey,
}: TableProps) {
  const { scrollRef, virtualizer, virtualRows, totalSize } = useInfiniteRows({
    count: rows.length,
    estimateSize: 150,
    overscan: 8,
    getItemKey: (i) => rows[i]!.id,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    resetKey,
  })

  return (
    <Box sx={{ display: { xs: 'block', md: 'none' } }}>
      <Box
        ref={scrollRef}
        sx={{ maxHeight: LIST_MAX_HEIGHT, minHeight: LIST_MIN_HEIGHT, overflow: 'auto' }}
      >
        <Box sx={{ height: totalSize, position: 'relative' }}>
          {virtualRows.map((vr) => {
            const u = rows[vr.index]!
            return (
              <Box
                key={vr.key}
                data-index={vr.index}
                ref={virtualizer.measureElement}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vr.start}px)`,
                  pb: 1.5,
                }}
              >
                <Card sx={{ p: 2 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h3" sx={{ fontSize: 15, fontWeight: 600 }}>
                      {u.full_name?.trim() || u.username}
                    </Typography>
                    <RoleChip role={u.role} />
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5, fontFamily: 'var(--font-mono)' }}>
                    {u.username}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: 'break-all' }}>
                    {u.email}
                  </Typography>
                  {(canChangeRole(u, perms) || canRemove(u, perms) || canResetPassword(u, perms)) && (
                    <Box sx={{ mt: 1.5 }}>
                      <RowActions
                        user={u}
                        perms={perms}
                        onChangeRole={onChangeRole}
                        onRemove={onRemove}
                        onResetPassword={onResetPassword}
                      />
                    </Box>
                  )}
                </Card>
              </Box>
            )
          })}
        </Box>
      </Box>
      <LoadMoreFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        count={rows.length}
      />
    </Box>
  )
}

// --------------------------------------------------
// Empty state
// --------------------------------------------------

function EmptyState({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  if (filtered) {
    return (
      <Card>
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h3">No matching members</Typography>
          <Typography variant="body2" color="text.secondary">
            No team members match the current filters. Clear them to see everyone.
          </Typography>
        </Stack>
      </Card>
    )
  }
  return (
    <Card>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h3">No team members yet</Typography>
        <Typography variant="body2" color="text.secondary">
          Add an account to give a colleague access to the system.
        </Typography>
        <Btn variant="primary" startIcon={<AddIcon />} onClick={onCreate} sx={{ mt: 1 }}>
          Add account
        </Btn>
      </Stack>
    </Card>
  )
}
