import React from 'react';
import {
  DayKey,
  addMonths,
  formatDayShort,
  monthGrid,
  monthLabel,
  monthOfDay,
  monthOrdinal,
} from '../meeting-dates';

interface MonthCalendarProps {
  year: number;
  /** 1-12. */
  month: number;
  /** Already narrowed by the same notebook/project/tag filters as the list. */
  countsByDay: Record<DayKey, number>;
  selectedDay: DayKey | null;
  todayKey: DayKey;
  /** Earliest day that has a meeting; null when there are none at all. */
  minDay: DayKey | null;
  onMonthChange: (year: number, month: number) => void;
  onSelectDay: (day: DayKey) => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function MonthCalendar({
  year,
  month,
  countsByDay,
  selectedDay,
  todayKey,
  minDay,
  onMonthChange,
  onSelectDay,
}: MonthCalendarProps) {
  const cells = monthGrid(year, month);
  const current = monthOrdinal(year, month);

  const today = monthOfDay(todayKey);
  // Nothing is ever recorded in the future, and nothing predates the first meeting.
  const canGoBack = minDay !== null && current > monthOrdinal(monthOfDay(minDay).year, monthOfDay(minDay).month);
  const canGoForward = current < monthOrdinal(today.year, today.month);

  function step(delta: number) {
    const next = addMonths(year, month, delta);
    onMonthChange(next.year, next.month);
  }

  const monthHasMeetings = cells.some(day => day && countsByDay[day]);

  return (
    <div className="mm-cal">
      <div className="mm-cal-header">
        <button
          className="mm-cal-nav"
          onClick={() => step(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="mm-cal-title">{monthLabel(year, month)}</span>
        <button
          className="mm-cal-nav"
          onClick={() => step(1)}
          disabled={!canGoForward}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="mm-cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="mm-cal-weekday">{d}</span>
        ))}
      </div>

      <div className="mm-cal-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={`b${i}`} className="mm-cal-cell is-blank" aria-hidden="true" />;

          const count = countsByDay[day] || 0;
          const classes = ['mm-cal-cell', 'mm-cal-day'];
          if (day === todayKey) classes.push('is-today');
          if (day === selectedDay) classes.push('is-selected');
          if (count > 0) classes.push('has-meetings');

          return (
            <button
              key={day}
              className={classes.join(' ')}
              onClick={() => onSelectDay(day)}
              disabled={day > todayKey}
              aria-pressed={day === selectedDay}
              title={
                count === 0
                  ? `No meetings on ${formatDayShort(day)}`
                  : `${count} meeting${count === 1 ? '' : 's'} on ${formatDayShort(day)}`
              }
            >
              <span className="mm-cal-day-num">{Number(day.slice(8))}</span>
              {count === 1 && <span className="mm-cal-dot" />}
              {count > 1 && <span className="mm-cal-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {!monthHasMeetings && <div className="mm-cal-empty">No meetings this month</div>}
    </div>
  );
}
