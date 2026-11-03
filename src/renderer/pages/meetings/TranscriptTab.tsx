import type { Recording } from '../../types';
import TranscriptViewer from '../../components/TranscriptViewer';

interface TranscriptTabProps {
  selectedMeeting: Recording;
  utterances: any[];
  currentTime: number;
  onSeek: (time: number) => void;
  handleRenameSpeaker: (oldName: string, newName: string) => void;
}

export default function TranscriptTab({ selectedMeeting, utterances, currentTime, onSeek, handleRenameSpeaker }: TranscriptTabProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {utterances.length > 0 ? (
        <TranscriptViewer
          utterances={utterances}
          currentTime={currentTime}
          speakerNames={selectedMeeting.speakerNames || {}}
          onSeek={onSeek}
          onRenameSpeaker={handleRenameSpeaker}
        />
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 13 }}>
            Transcript viewer requires utterance-level data from AssemblyAI.
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            The raw transcript text is available in the Notes tab after generation.
          </div>
        </div>
      )}
    </div>
  );
}
