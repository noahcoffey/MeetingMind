export function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatEventTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function isEventPast(event: any, now: number): boolean {
  return new Date(event.endTime).getTime() < now;
}

export function isEventNow(event: any, now: number): boolean {
  const start = new Date(event.startTime).getTime();
  const end = new Date(event.endTime).getTime();
  return start <= now && end >= now;
}

/** Consecutive events that fall on the same day, in calendar order. */
export function groupEventsByDay(calendarEvents: any[]): { label: string; events: any[] }[] {
  const dayGroups: { label: string; events: any[] }[] = [];
  for (const event of calendarEvents) {
    const label = getDayLabel(event.startTime);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.label === label) {
      last.events.push(event);
    } else {
      dayGroups.push({ label, events: [event] });
    }
  }
  return dayGroups;
}
