import React from 'react';
import { formatEventTime, groupEventsByDay, isEventNow, isEventPast } from './calendar-format';

interface CalendarSidebarProps {
  calendarEvents: any[];
  selectedEvent: any;
  /** Attached to the next upcoming meeting; the page scrolls it into view. */
  nextMeetingRef: React.RefObject<HTMLDivElement | null>;
  onSelectEvent: (event: any) => void;
  onRefresh: () => void;
}

/** The Meetings list beside the Record page, for staging a calendar event. */
export default function CalendarSidebar({ calendarEvents, selectedEvent, nextMeetingRef, onSelectEvent, onRefresh }: CalendarSidebarProps) {
  const now = Date.now();
  const nextEventIndex = calendarEvents.findIndex(e => new Date(e.startTime).getTime() > now);
  const dayGroups = groupEventsByDay(calendarEvents);

  return (
    <div className="rp-calendar">
      <div className="rp-cal-header">
        <span>Meetings</span>
        <button
          className="btn btn-ghost"
          onClick={onRefresh}
          style={{ fontSize: 11, padding: '2px 6px' }}
        >
          Refresh
        </button>
      </div>

      <div className="rp-cal-list">
        {dayGroups.map(group => (
          <div key={group.label}>
            <div className="rp-cal-day-label">{group.label}</div>

            {group.events.map((event) => {
              const globalIdx = calendarEvents.indexOf(event);
              const isNext = globalIdx === nextEventIndex;
              const isPast = isEventPast(event, now);
              const isCurrent = isEventNow(event, now);
              const isSelected = selectedEvent?.id === event.id;

              const classes = [
                'rp-cal-event',
                isNext && !isCurrent ? 'next' : '',
                isCurrent ? 'now' : '',
                isSelected ? 'selected' : '',
                isPast && !isCurrent ? 'past' : '',
              ].filter(Boolean).join(' ');

              return (
                <div
                  key={event.id}
                  ref={isNext ? nextMeetingRef : undefined}
                  onClick={() => onSelectEvent(event)}
                  className={classes}
                >
                  <div className="rp-cal-event-time">
                    {formatEventTime(event.startTime)}
                    {isCurrent && !isSelected && (
                      <span className="rp-cal-event-badge" style={{ color: 'var(--accent-green)' }}>NOW</span>
                    )}
                    {isNext && !isCurrent && !isSelected && (
                      <span className="rp-cal-event-badge" style={{ color: 'var(--accent-blue)' }}>NEXT</span>
                    )}
                  </div>
                  <div className="rp-cal-event-title">{event.title}</div>
                  <div className="rp-cal-event-detail">
                    {formatEventTime(event.startTime)} – {formatEventTime(event.endTime)}
                    {event.attendees?.length > 0 && (
                      <span> &middot; {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {calendarEvents.length === 0 && (
          <div className="rp-cal-empty">No meetings in the next 24 hours</div>
        )}
      </div>
    </div>
  );
}
