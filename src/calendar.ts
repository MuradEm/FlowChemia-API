import { Temporal } from '@js-temporal/polyfill';

export type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
export type CalendarSettings = {
  frequency: Frequency;
  timeZone: string;
  weekday: number;
  monthDay: number;
  generationHour: number;
  generationMinute: number;
  anchorDate: string | null;
};

function localDate(settings: CalendarSettings, instant: Date) {
  return Temporal.Instant.from(instant.toISOString()).toZonedDateTimeISO(settings.timeZone).toPlainDate();
}

function atTime(settings: CalendarSettings, date: Temporal.PlainDate) {
  // Temporal's compatible resolution shifts a nonexistent local time forward
  // through a DST gap and selects the earlier instance in a repeated hour.
  const zoned = date.toZonedDateTime({timeZone: settings.timeZone, plainTime: Temporal.PlainTime.from({hour: settings.generationHour, minute: settings.generationMinute})});
  return new Date(zoned.epochMilliseconds);
}

export function anchorFor(settings: CalendarSettings, now: Date): string {
  let date = localDate(settings, now);
  date = date.subtract({days: (date.dayOfWeek - settings.weekday + 7) % 7});
  if (atTime(settings, date) > now) date = date.subtract({days: 7});
  return date.toString();
}

export function calendarWindow(settings: CalendarSettings, now: Date): {opensAt: Date; closesAt: Date} {
  const today = localDate(settings, now);
  if (settings.frequency === 'MONTHLY') {
    let month = today.with({day: 1});
    const occurrence = (m: Temporal.PlainDate) => atTime(settings, m.with({day: Math.min(settings.monthDay, m.daysInMonth)}));
    if (occurrence(month) > now) month = month.subtract({months: 1});
    return {opensAt: occurrence(month), closesAt: occurrence(month.add({months: 1}))};
  }
  const days = settings.frequency === 'FORTNIGHTLY' ? 14 : 7;
  const anchor = Temporal.PlainDate.from(settings.anchorDate ?? anchorFor(settings, now));
  let date = anchor.add({days: Math.floor(anchor.until(today).days / days) * days});
  if (atTime(settings, date) > now) date = date.subtract({days});
  return {opensAt: atTime(settings, date), closesAt: atTime(settings, date.add({days}))};
}

export function firstBoundary(settings: CalendarSettings, at: Date): Date {
  const window = calendarWindow(settings, at);
  return window.opensAt.getTime() === at.getTime() ? window.opensAt : window.closesAt;
}
