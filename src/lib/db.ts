import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type CritGroup, type Exception, critGroups, exceptions, weeks } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

const DEFAULT_ROOM = "Marie Reay Building (155), Room 4.03";

// The real crit groups and 2026-S2 teaching weeks, as published by the
// course website's own api/crit-groups.json — the system this app models a
// slice of. Seeded once, on first boot against an empty database; a
// redeploy or a reload never re-runs this against real rows.
const SEED_GROUPS: Omit<CritGroup, "id">[] = [
  { agent: "shitao", name: "Shitao", tutorName: "Ushini Attanayake", day: "Mon", startTime: "14:00", endTime: "15:30", room: DEFAULT_ROOM },
  { agent: "bada", name: "Bada", tutorName: "Ushini Attanayake", day: "Mon", startTime: "15:30", endTime: "17:00", room: DEFAULT_ROOM },
  { agent: "baishi", name: "Baishi", tutorName: "Tom Griffiths", day: "Wed", startTime: "09:00", endTime: "10:30", room: DEFAULT_ROOM },
  { agent: "dachi", name: "Dachi", tutorName: "Tom Griffiths", day: "Wed", startTime: "10:30", endTime: "12:00", room: DEFAULT_ROOM },
  { agent: "yunlin", name: "Yunlin", tutorName: "Bill McAlister", day: "Wed", startTime: "14:00", endTime: "15:30", room: DEFAULT_ROOM },
  { agent: "liuru", name: "Liuru", tutorName: "Bill McAlister", day: "Wed", startTime: "15:30", endTime: "17:00", room: DEFAULT_ROOM },
];

const SEED_WEEKS: Omit<import("./schema").Week, never>[] = [
  { week: 1, monday: "2026-07-27" },
  { week: 2, monday: "2026-08-03" },
  { week: 3, monday: "2026-08-10" },
  { week: 4, monday: "2026-08-17" },
  { week: 5, monday: "2026-08-24" },
  { week: 6, monday: "2026-08-31" },
  { week: 7, monday: "2026-09-21" },
  { week: 8, monday: "2026-09-28" },
  { week: 9, monday: "2026-10-05" },
  { week: 10, monday: "2026-10-12" },
  { week: 11, monday: "2026-10-19" },
  { week: 12, monday: "2026-10-26" },
];

// Week 9's real, already-published exceptions (both groups sharing the
// 14:00 tutor's Monday slot, moved off the ACT Labour Day public holiday) —
// seeded so the roster starts from the schedule as it actually stands, not
// an empty one.
const SEED_EXCEPTIONS: Array<Omit<Exception, "id" | "createdAt" | "critGroupId"> & { agent: string }> = [
  {
    agent: "shitao",
    week: 9,
    day: "Tue",
    startTime: "14:00",
    endTime: "15:30",
    room: null,
    reason: "Monday 5 October is the ACT Labour Day public holiday",
  },
  {
    agent: "bada",
    week: 9,
    day: "Wed",
    startTime: "15:30",
    endTime: "17:00",
    room: "Marie Reay Building (155), Room 3.05",
    reason: "Monday 5 October is the ACT Labour Day public holiday",
  },
];

function seed(): void {
  if (db.select().from(critGroups).limit(1).all().length > 0) return;
  for (const group of SEED_GROUPS) db.insert(critGroups).values(group).run();
  for (const w of SEED_WEEKS) db.insert(weeks).values(w).run();
  for (const { agent, ...exception } of SEED_EXCEPTIONS) {
    const group = db.select().from(critGroups).where(eq(critGroups.agent, agent)).get();
    if (group) db.insert(exceptions).values({ ...exception, critGroupId: group.id }).run();
  }
}

seed();

const DAY_OFFSET: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4 };

// The real calendar date a (week, day) pair falls on, derived from the
// week's Monday rather than stored — the same relationship the source
// JSON's own comment describes ("the cutoff moves with the session").
export function sessionDate(monday: string, day: string): string {
  const date = new Date(`${monday}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (DAY_OFFSET[day] ?? 0));
  return date.toISOString().slice(0, 10);
}

export type RosterGroup = CritGroup & {
  sessions: Array<{
    week: number;
    date: string;
    day: string;
    startTime: string;
    endTime: string;
    room: string;
    reason: string | null;
    exceptionId: number | null;
  }>;
};

export function listWeeks() {
  return db.select().from(weeks).orderBy(asc(weeks.week)).all();
}

export function listRoster(): RosterGroup[] {
  const groups = db.select().from(critGroups).orderBy(asc(critGroups.day), asc(critGroups.startTime)).all();
  const allWeeks = listWeeks();
  const allExceptions = db.select().from(exceptions).all();

  return groups.map((group) => ({
    ...group,
    sessions: allWeeks.map((w) => {
      const exception = allExceptions.find((e) => e.critGroupId === group.id && e.week === w.week);
      if (exception) {
        return {
          week: w.week,
          date: sessionDate(w.monday, exception.day),
          day: exception.day,
          startTime: exception.startTime,
          endTime: exception.endTime,
          room: exception.room ?? group.room,
          reason: exception.reason,
          exceptionId: exception.id,
        };
      }
      return {
        week: w.week,
        date: sessionDate(w.monday, group.day),
        day: group.day,
        startTime: group.startTime,
        endTime: group.endTime,
        room: group.room,
        reason: null,
        exceptionId: null,
      };
    }),
  }));
}

const DAY_NAMES = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ValidationError extends Error {}

/** Every crit runs exactly this long, standing slot or one-week move. */
export const SESSION_MINUTES = 90;

/** The end of a session starting at `start` (HH:MM), or null past midnight. */
export function sessionEnd(start: string): string | null {
  const [h, m] = start.split(":").map(Number);
  const end = h * 60 + m + SESSION_MINUTES;
  if (end >= 24 * 60) return null;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

// Start is required; end may be left blank and is then derived. A given end
// has to agree with the fixed length -- it's accepted for clients that send
// it, never as a way to change how long a crit runs.
function resolveTimes(startTime: string, endTime: string): { startTime: string; endTime: string } {
  if (!TIME_RE.test(startTime)) throw new ValidationError("start must be a 24-hour time, e.g. 14:00");
  const derived = sessionEnd(startTime);
  if (!derived) throw new ValidationError("a 90-minute crit starting then would run past midnight");
  if (endTime === "") return { startTime, endTime: derived };
  if (!TIME_RE.test(endTime)) throw new ValidationError("end must be a 24-hour time, e.g. 15:30");
  if (startTime >= endTime) throw new ValidationError("end must be after start");
  if (endTime !== derived) {
    throw new ValidationError(`crits run ${SESSION_MINUTES} minutes, so one starting at ${startTime} ends at ${derived}`);
  }
  return { startTime, endTime };
}

export type AddExceptionInput = {
  critGroupId: number;
  week: number;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  reason: string;
};

// The one write this app makes to a group's schedule: reschedule a single
// week's session. Validated at this boundary — everything downstream (the
// roster view, the derived date) trusts what's in the table.
export function addException(input: AddExceptionInput): Exception {
  const group = db.select().from(critGroups).where(eq(critGroups.id, input.critGroupId)).get();
  if (!group) throw new ValidationError("unknown crit group");

  const week = db.select().from(weeks).where(eq(weeks.week, input.week)).get();
  if (!week) throw new ValidationError("not a teaching week this semester");

  if (!DAY_NAMES.has(input.day)) throw new ValidationError("day must be Mon–Fri");
  const { startTime, endTime } = resolveTimes(input.startTime, input.endTime);

  const reason = input.reason.trim();
  if (!reason) throw new ValidationError("a reason is required");

  const existing = db
    .select()
    .from(exceptions)
    .where(and(eq(exceptions.critGroupId, input.critGroupId), eq(exceptions.week, input.week)))
    .get();
  if (existing) {
    db.delete(exceptions).where(eq(exceptions.id, existing.id)).run();
  }

  return db
    .insert(exceptions)
    .values({
      critGroupId: input.critGroupId,
      week: input.week,
      day: input.day,
      startTime,
      endTime,
      room: input.room.trim() || null,
      reason,
    })
    .returning()
    .get();
}

export function cancelException(id: number): void {
  db.delete(exceptions).where(eq(exceptions.id, id)).run();
}

export function getCritGroup(id: number): CritGroup | undefined {
  return db.select().from(critGroups).where(eq(critGroups.id, id)).get();
}

export function getCritGroupByAgent(agent: string): CritGroup | undefined {
  return db.select().from(critGroups).where(eq(critGroups.agent, agent)).get();
}

export type UpdateCritGroupInput = {
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  tutorName: string;
};

// The other write this app makes: move a group's *standing* slot, which
// every week without an exception follows. Same boundary rules as
// addException, so everything downstream can trust the table.
export function updateCritGroup(id: number, input: UpdateCritGroupInput): CritGroup {
  const group = getCritGroup(id);
  if (!group) throw new ValidationError("unknown crit group");

  if (!DAY_NAMES.has(input.day)) throw new ValidationError("day must be Mon–Fri");
  const { startTime, endTime } = resolveTimes(input.startTime, input.endTime);

  const room = input.room.trim();
  if (!room) throw new ValidationError("a room is required");
  const tutorName = input.tutorName.trim();
  if (!tutorName) throw new ValidationError("a tutor name is required");

  return db
    .update(critGroups)
    .set({ day: input.day, startTime, endTime, room, tutorName })
    .where(eq(critGroups.id, id))
    .returning()
    .get();
}
