import type { Recording, RecordingIndexEntry } from '../../types';
import SearchBar from '../../components/SearchBar';
import MonthCalendar from '../../components/MonthCalendar';
import { DayKey, countsByDay, dayKeyLocal, formatDayShort } from '../../meeting-dates';
import type { DateView } from './types';
import { formatDuration, formatFileSize, getDayLabel } from './format';
import StatusIcon from './StatusIcon';
import ImportedBadge from './ImportedBadge';

interface MeetingListProps {
  filteredMeetings: Recording[];
  selectedMeeting: Recording | null;
  selectMeeting: (rec: Recording) => void;
  selectMeetingById: (id: string) => void;
  allTags: string[];
  filterTag: string | null;
  setFilterTag: (tag: string | null) => void;
  recIndex: RecordingIndexEntry[];
  activeNotebook?: string;
  activeProjectFilter?: string | null;
  defaultNotebook: string;
  dateView: DateView;
  calendarOpen: boolean;
  toggleCalendar: () => void;
  calMonth: { year: number; month: number };
  setCalMonth: (m: { year: number; month: number }) => void;
  showDay: (day: DayKey) => void;
  backToRecent: () => void;
}

export default function MeetingList({
  filteredMeetings,
  selectedMeeting,
  selectMeeting,
  selectMeetingById,
  allTags,
  filterTag,
  setFilterTag,
  recIndex,
  activeNotebook,
  activeProjectFilter,
  defaultNotebook,
  dateView,
  calendarOpen,
  toggleCalendar,
  calMonth,
  setCalMonth,
  showDay,
  backToRecent,
}: MeetingListProps) {
  // Run the index through the same notebook -> project -> tag chain as the list,
  // so a calendar dot never promises a day that would render empty.
  const indexEntries = recIndex.filter(e => {
    if (activeNotebook && (e.notebook || defaultNotebook) !== activeNotebook) return false;
    if (activeProjectFilter && e.project !== activeProjectFilter) return false;
    if (filterTag && !e.tags?.includes(filterTag)) return false;
    return true;
  });
  const dayCounts = countsByDay(indexEntries);
  const todayKey = dayKeyLocal(Date.now());
  const minDay = indexEntries.length
    ? dayKeyLocal(indexEntries.reduce((min, e) => Math.min(min, e.ms), Infinity))
    : null;
  const selectedDay = dateView.mode === 'day' ? dateView.day : null;

  const dayGroups: { label: string; meetings: typeof filteredMeetings }[] = [];
  for (const rec of filteredMeetings) {
    const label = getDayLabel(rec.date);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.label === label) {
      last.meetings.push(rec);
    } else {
      dayGroups.push({ label, meetings: [rec] });
    }
  }

  return (
    <div style={{ flex: '0 0 340px', width: 340, maxWidth: 340, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Fixed toolbar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SearchBar onSelectResult={(id) => { selectMeetingById(id); }} />
        </div>
        <button
          className="btn btn-secondary"
          onClick={toggleCalendar}
          title="Browse meetings by date"
          aria-pressed={calendarOpen}
          style={{ fontSize: 11, padding: '6px 8px', flexShrink: 0 }}
        >
          &#128197;
        </button>
        {allTags.length > 0 && (
          <select
            value={filterTag || ''}
            onChange={e => setFilterTag(e.target.value || null)}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              padding: '6px 8px',
              flexShrink: 0,
            }}
          >
            <option value="">All tags</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      {calendarOpen && (
        <MonthCalendar
          year={calMonth.year}
          month={calMonth.month}
          countsByDay={dayCounts}
          selectedDay={selectedDay}
          todayKey={todayKey}
          minDay={minDay}
          onMonthChange={(year, month) => setCalMonth({ year, month })}
          onSelectDay={showDay}
        />
      )}

      {dateView.mode === 'day' && (
        <div className="mm-date-chip">
          <span className="mm-date-chip-label">Showing {formatDayShort(dateView.day)}</span>
          <button className="mm-date-chip-clear" onClick={backToRecent}>Back to recent</button>
        </div>
      )}

      {/* Scrollable meetings list */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
      {filteredMeetings.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {dateView.mode === 'day'
            ? (filterTag
                ? `No meetings on ${formatDayShort(dateView.day)} matching your filters.`
                : `No meetings on ${formatDayShort(dateView.day)}.`)
            : (filterTag
                ? 'No meetings with this tag.'
                : 'No meetings in the last two weeks. Use the calendar to browse further back.')}
        </div>
      )}

      {dayGroups.map(group => (
        <div key={group.label}>
          <div style={{
            padding: '12px 4px 6px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {group.label}
          </div>
          <div className="meeting-list">
            {group.meetings.map(rec => (
              <div
                key={rec.id}
                className="meeting-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/recording-id', rec.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => selectMeeting(rec)}
                style={{
                  borderColor: selectedMeeting?.id === rec.id ? 'var(--accent-blue)' : undefined,
                  position: 'relative',
                }}
              >
                <div className="meeting-item-info">
                  <div className="meeting-item-title">{rec.title || 'Untitled Meeting'}</div>
                  <div className="meeting-item-meta">
                    {new Date(rec.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot; {formatDuration(rec.duration)} &middot; {formatFileSize(rec.fileSize)}
                    {rec.source === 'import' && <ImportedBadge />}
                  </div>
                  {rec.tags && rec.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                      {rec.tags.map(t => (
                        <span key={t} style={{
                          padding: '1px 6px',
                          background: 'var(--accent-blue-tint)',
                          color: 'var(--accent-blue)',
                          borderRadius: 8,
                          fontSize: 10,
                        }}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', gap: 5, alignItems: 'center' }}>
                  {/* Transcript icon */}
                  <StatusIcon
                    ready={['transcribed', 'generating', 'complete'].includes(rec.status)}
                    activeColor="var(--accent-blue)"
                    tooltip={
                      rec.status === 'transcribing' ? 'Transcribing...'
                      : ['transcribed', 'generating', 'complete'].includes(rec.status) ? 'Transcript ready'
                      : 'Not yet transcribed'
                    }
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </StatusIcon>
                  {/* Notes icon */}
                  <StatusIcon
                    ready={rec.status === 'complete'}
                    activeColor="var(--accent-green)"
                    tooltip={
                      rec.status === 'generating' ? 'Generating notes...'
                      : rec.status === 'complete' ? 'Notes ready'
                      : 'Notes not generated'
                    }
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </StatusIcon>
                  {(rec.status === 'transcribing' || rec.status === 'generating') && (
                    <div className="pipeline-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}
