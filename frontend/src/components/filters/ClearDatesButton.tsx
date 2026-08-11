import ClearOutlinedIcon from '@mui/icons-material/ClearOutlined'

import { Btn } from '@/components/primitives'

interface ClearDatesButtonProps {
  onClick: () => void
  // What "clear" restores differs by surface: an optional-window filter goes
  // back to showing everything, a period report snaps back to its default
  // window. The label stays "Clear" everywhere so the affordance reads the
  // same; the tooltip carries the specific meaning.
  title?: string
}

/**
 * The single "Clear" affordance shared by every date-window control — the
 * optional-window filters (via DateRangeFilter) and the period reports that
 * reset to a default window. One component so the icon, label and styling
 * never drift between them.
 */
export function ClearDatesButton({
  onClick,
  title = 'Clear the date window and show the full period',
}: ClearDatesButtonProps) {
  return (
    <Btn variant="ghost" startIcon={<ClearOutlinedIcon />} onClick={onClick} title={title}>
      Clear
    </Btn>
  )
}
