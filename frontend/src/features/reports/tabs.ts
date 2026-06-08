// Report tab keys, shared by the route's search schema and the page. Kept out
// of the route module so the page doesn't import back from routes (cycle).
export const REPORT_TABS = ['overview', 'collections', 'customers', 'employees'] as const
export type ReportTab = (typeof REPORT_TABS)[number]
