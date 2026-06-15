// Time-of-day greeting for the dashboard header. Uses the browser's local
// clock (operations staff run in IST).
export function greetingForNow(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
