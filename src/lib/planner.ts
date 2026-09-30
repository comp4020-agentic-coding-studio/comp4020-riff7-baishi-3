// The visual half of rescheduling. Everything here only *fills in* the real
// form fields: the radios, time inputs and the drop dialog's hidden inputs
// are still what gets POSTed, so the page works the same with no script.

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const toHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Snap a minute-of-day to the nearest `step`, clamped to [lo, hi]. */
export const snap = (min: number, step = 15, lo = 0, hi = 24 * 60): number =>
  Math.min(hi, Math.max(lo, Math.round(min / step) * step));

/** Every crit runs this long; the server enforces it (SESSION_MINUTES in db.ts). */
export const SESSION_MINUTES = 90;

/** The latest start that still ends inside the day. */
export const clampStart = (min: number, lo = 0, hi = 24 * 60): number =>
  Math.min(hi - SESSION_MINUTES, Math.max(lo, min));

type Hooks = {
  /** Called whenever a gesture writes into the main form, so live-reload can
   *  treat it as a draft. */
  onDraft: () => void;
  onDialog: (open: boolean) => void;
};

const DAY_NAMES: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
};

export function initPlanner({ onDraft, onDialog }: Hooks): void {
  const form = document.querySelector<HTMLFormElement>("#move-form");
  const timetable = document.querySelector<HTMLElement>("#timetable");
  const grid = timetable?.querySelector<HTMLElement>(".tt-grid");
  if (!form || !timetable || !grid) return;
  const shownWeek = timetable.dataset.week ?? "";

  const startInput = form.querySelector<HTMLInputElement>("#startTime")!;
  const endOut = form.querySelector<HTMLOutputElement>("#endTime-display");
  const endValue = () => (startInput.value ? toHHMM(toMin(startInput.value) + SESSION_MINUTES) : "");
  const summary = document.querySelector<HTMLOutputElement>("#move-summary");

  const radio = (name: string, value: string) =>
    form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  const checked = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);


  // ---------- the time track ----------
  const track = form.querySelector<HTMLElement>(".time-track");
  const trackRange = track?.querySelector<HTMLElement>(".time-track-range");
  const trackFrom = toMin(track?.dataset.from ?? "08:00");
  const trackTo = toMin(track?.dataset.to ?? "19:00");

  const paintTrack = () => {
    if (!track || !trackRange) return;
    if (endOut) endOut.textContent = endValue() || "--:--";
    if (!startInput.value) {
      trackRange.hidden = true;
      return;
    }
    const span = trackTo - trackFrom;
    const s = (Math.max(trackFrom, toMin(startInput.value)) - trackFrom) / span;
    const e = (Math.min(trackTo, toMin(endValue())) - trackFrom) / span;
    trackRange.hidden = e <= s;
    trackRange.style.left = `${s * 100}%`;
    trackRange.style.width = `${(e - s) * 100}%`;
  };

  const paintSummary = () => {
    if (!summary) return;
    const group = checked("critGroupId")?.closest("label")?.querySelector(".chip-name")?.textContent;
    const day = checked("day")?.value;
    const week = checked("week")?.value;
    const bits = [
      group ?? "Pick a group",
      week ? `week ${week}` : null,
      day ? DAY_NAMES[day] : null,
      startInput.value ? `${startInput.value} to ${endValue()}` : null,
    ].filter(Boolean);
    summary.textContent = bits.join(" · ");
  };

  const repaint = () => {
    paintTrack();
    paintSummary();
  };

  const fill = (values: { group?: string; week?: string; day?: string; start?: number }) => {
    if (values.group) radio("critGroupId", values.group)!.checked = true;
    if (values.week) {
      const w = radio("week", values.week);
      if (w) w.checked = true;
    }
    if (values.day) radio("day", values.day)!.checked = true;
    if (values.start !== undefined) startInput.value = toHHMM(values.start);
    repaint();
    onDraft();
  };

  form.addEventListener("input", repaint);
  form.addEventListener("change", repaint);
  repaint();

  if (track) {
    const minuteAt = (clientX: number) => {
      const r = track.getBoundingClientRect();
      const frac = (clientX - r.left) / r.width;
      return snap(trackFrom + frac * (trackTo - trackFrom), 15, trackFrom, trackTo);
    };
    // the bar sets the start; the 90-minute block follows the pointer
    let dragging = false;
    const place = (clientX: number) => fill({ start: clampStart(minuteAt(clientX), trackFrom, trackTo) });
    track.addEventListener("pointerdown", (e) => {
      dragging = true;
      track.setPointerCapture(e.pointerId);
      place(e.clientX);
    });
    track.addEventListener("pointermove", (e) => {
      if (dragging) place(e.clientX);
    });
    const release = () => {
      dragging = false;
    };
    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);
  }

  // ---------- the timetable: geometry ----------
  // Cells are one hour tall and carry their day and start hour; a point's
  // minute is the cell's hour plus how far down the cell it is.
  const cellAt = (x: number, y: number) =>
    document.elementsFromPoint(x, y).find((el) => el.classList.contains("tt-cell")) as HTMLElement | undefined;

  const pointAt = (x: number, y: number) => {
    const cell = cellAt(x, y);
    if (!cell) return null;
    const r = cell.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (y - r.top) / r.height));
    return { day: cell.dataset.day!, minute: snap(toMin(cell.dataset.start!) + frac * 60, 15), cell };
  };

  const selection = grid.querySelector<HTMLElement>(".tt-selection");
  const showSelection = (day: string, start: number, end: number) => {
    if (!selection) return;
    const col = ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(day) + 2;
    const first = grid.querySelector<HTMLElement>(".tt-cell");
    const gridStart = first ? toMin(first.dataset.start!) : 9 * 60;
    selection.hidden = false;
    selection.style.gridColumn = String(col);
    selection.style.gridRow = `${(start - gridStart) / 15 + 2} / ${(end - gridStart) / 15 + 2}`;
  };
  const hideSelection = () => {
    if (selection) selection.hidden = true;
  };

  const scrollToForm = () => {
    form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    form.classList.add("is-primed");
    setTimeout(() => form.classList.remove("is-primed"), 1200);
  };

  // ---------- click an empty slot: prime the form there ----------
  // Mouse clicks land on the exact quarter hour under the pointer; touch
  // taps start on the hour, since a fingertip isn't that precise.
  let pending: { day: string; start: number } | null = null;
  grid.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".tt-block")) return;
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    const start = clampStart(e.pointerType === "mouse" ? p.minute : toMin(p.cell.dataset.start!));
    pending = { day: p.day, start };
    showSelection(p.day, start, start + SESSION_MINUTES);
  });
  grid.addEventListener("pointerup", () => {
    if (!pending) return;
    fill({ week: shownWeek, day: pending.day, start: pending.start });
    pending = null;
    setTimeout(hideSelection, 900);
    scrollToForm();
  });

  // ---------- drag a session block: move it, then ask why ----------
  const dialog = document.querySelector<HTMLDialogElement>("#move-dialog");
  const dialogForm = dialog?.querySelector<HTMLFormElement>("form");
  const setHidden = (name: string, value: string) => {
    const el = dialogForm?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (el) el.value = value;
  };

  const openDialog = (groupId: string, name: string, day: string, start: number, end: number) => {
    if (!dialog || !dialogForm) return;
    setHidden("critGroupId", groupId);
    setHidden("week", shownWeek);
    setHidden("day", day);
    setHidden("startTime", toHHMM(start));
    setHidden("endTime", toHHMM(end));
    const text = dialog.querySelector("#move-dialog-summary");
    if (text) {
      text.textContent = `${name}, week ${shownWeek}: ${DAY_NAMES[day]} ${toHHMM(start)} to ${toHHMM(end)}`;
    }
    onDialog(true);
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("#dialog-reason")?.focus();
  };

  dialog?.querySelector("#dialog-cancel")?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("close", () => {
    hideSelection();
    onDialog(false);
  });

  for (const block of grid.querySelectorAll<HTMLAnchorElement>("a.tt-block")) {
    let drag: { x: number; y: number; grabOffset: number; moved: boolean } | null = null;
    const duration = SESSION_MINUTES;

    block.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = block.getBoundingClientRect();
      // keep the block's top edge where it was relative to the grab point
      const minutesPerPx = duration / r.height;
      drag = { x: e.clientX, y: e.clientY, grabOffset: (e.clientY - r.top) * minutesPerPx, moved: false };
      block.setPointerCapture(e.pointerId);
    });

    block.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      block.classList.add("is-dragging");
      block.style.translate = `${dx}px ${dy}px`;
      const p = pointAt(e.clientX, e.clientY);
      if (p) {
        const start = clampStart(snap(p.minute - drag.grabOffset, 15));
        showSelection(p.day, start, start + duration);
      }
    });

    const finish = (e: PointerEvent, commit: boolean) => {
      if (!drag) return;
      const wasDrag = drag.moved;
      const grabOffset = drag.grabOffset;
      drag = null;
      block.classList.remove("is-dragging");
      block.style.translate = "";
      if (!wasDrag) return; // a plain click: let the link do its job
      // swallow the click that follows a drag
      block.addEventListener("click", (ev) => ev.preventDefault(), { once: true });
      const p = commit ? pointAt(e.clientX, e.clientY) : null;
      if (!p) {
        hideSelection();
        return;
      }
      const start = clampStart(snap(p.minute - grabOffset, 15));
      openDialog(block.dataset.groupId!, block.dataset.name!, p.day, start, start + duration);
    };
    block.addEventListener("pointerup", (e) => finish(e, true));
    block.addEventListener("pointercancel", (e) => finish(e, false));
  }
}
