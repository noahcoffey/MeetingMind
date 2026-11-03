import React from 'react';

interface MeetingFieldsProps {
  meetingTitle: string;
  onMeetingTitleChange: (value: string) => void;
  userContext: string;
  onUserContextChange: (value: string) => void;
}

/** Title + context for Claude, editable before and during a recording. */
export default function MeetingFields({ meetingTitle, onMeetingTitleChange, userContext, onUserContextChange }: MeetingFieldsProps) {
  return (
    <div className="rp-fields">
      <div>
        <input
          type="text"
          className="form-input"
          placeholder="Meeting title (optional)"
          value={meetingTitle}
          onChange={e => onMeetingTitleChange(e.target.value)}
          style={{ fontSize: 14 }}
        />
      </div>
      <div>
        <textarea
          className="form-textarea"
          placeholder="Context for Claude (e.g. 'Sprint planning for Q2')"
          value={userContext}
          onChange={e => onUserContextChange(e.target.value)}
          rows={2}
          style={{ minHeight: 56, fontSize: 13 }}
        />
      </div>
    </div>
  );
}
