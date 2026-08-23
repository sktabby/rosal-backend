/**
 * v1.1: Orders with status DISPATCHED remain in "active" list views for 48
 * hours after completedAt, then are expected to fall out of those views and
 * only be reachable through History screens. This is a DISPLAY/GROUPING
 * rule only — it never changes SalesOrder.status itself (it stays
 * DISPATCHED, or becomes BILLED if billed within/after the window).
 *
 * Applies to:
 *  - Web Dispatcher Order Queue (Dispatched column)
 *  - App Seller Orders List
 *  - App Seller Billing List (actionable "Ready to bill" cards)
 *
 * It deliberately does NOT apply to dedicated History endpoints (Dispatcher
 * History already queries status: in:[DISPATCHED, REJECTED] and must keep
 * showing dispatched orders regardless of age — that's the whole point of
 * History). Callers building an "active" list pass this filter in;
 * History-style callers don't.
 */
export const DISPATCHED_ACTIVE_WINDOW_HOURS = 48;

export function dispatchedActiveWindowCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DISPATCHED_ACTIVE_WINDOW_HOURS * 60 * 60 * 1000);
}
