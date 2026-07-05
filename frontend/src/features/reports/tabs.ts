// Report view keys, shared by the route's search schema and the page. Kept out
// of the route module so the page doesn't import back from routes (cycle).
// No `tab` in the URL renders the report-gallery landing grid.
export const REPORT_TABS = [
  'overview',
  'collections',
  'customers',
  'employees',
  'day',
  'multiday',
  'interest',
] as const
export type ReportTab = (typeof REPORT_TABS)[number]
