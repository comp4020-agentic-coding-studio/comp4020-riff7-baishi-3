import type { APIRoute } from "astro";
import { ValidationError, getCritGroup, updateCritGroup } from "../../../lib/db";
import { bus } from "../../../lib/events";

// Edit a crit group's standing slot from its /crit/[agent] page. Thin by
// design: parse the form, let updateCritGroup validate, 303 back to the
// group's page (with ?error= on a validation failure), and ping the SSE bus
// so every other open tab reloads.
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const group = getCritGroup(Number(params.id));
  if (!group) return new Response("unknown crit group", { status: 404 });

  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const back = `/crit/${encodeURIComponent(group.agent)}`;

  try {
    updateCritGroup(group.id, {
      day: field("day"),
      startTime: field("startTime"),
      endTime: field("endTime"),
      room: field("room"),
      tutorName: field("tutorName"),
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return redirect(`${back}?error=${encodeURIComponent(error.message)}`, 303);
    }
    throw error;
  }

  bus.emit("changed");
  return redirect(back, 303);
};
