import type { APIRoute } from "astro";
import { cancelException } from "../../../../lib/db";
import { bus } from "../../../../lib/events";

// Only ever redirect to a same-site crit page, never an arbitrary value a
// form (or an attacker) supplies. Anything else falls back to the roster.
const safeRedirect = (value: FormDataEntryValue | null | undefined): string => {
  const path = typeof value === "string" ? value : "";
  return /^\/crit\/[a-z0-9_-]+\/?$/i.test(path) ? path : "/";
};

// Reverting a reschedule: delete the one week's exception row, which drops
// that group's roster row back to its standing slot (listRoster falls back
// to the group's own day/time/room whenever no exception matches the week).
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const form = await request.formData().catch(() => null);
  const id = Number(params.id);
  if (Number.isInteger(id)) {
    cancelException(id);
    bus.emit("changed");
  }
  return redirect(safeRedirect(form?.get("redirect")), 303);
};
