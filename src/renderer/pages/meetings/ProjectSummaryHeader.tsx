import React from 'react';
import type { Project } from '../../types';
import MarkdownRenderer from '../../components/MarkdownRenderer';

interface ProjectSummaryHeaderProps {
  activeProject: Project | null | undefined;
  showProjectSummary: boolean;
  setShowProjectSummary: (show: boolean) => void;
  isGeneratingProjectSummary: boolean;
  setIsGeneratingProjectSummary: (generating: boolean) => void;
  projectSummary: string | null;
  setProjectSummary: (summary: string | null) => void;
  projectSummaryStreaming: string;
  setProjectSummaryStreaming: React.Dispatch<React.SetStateAction<string>>;
  showToast: (msg: string) => void;
}

/** The page title, plus the project summary controls and panel when a project is active. */
export default function ProjectSummaryHeader({
  activeProject,
  showProjectSummary,
  setShowProjectSummary,
  isGeneratingProjectSummary,
  setIsGeneratingProjectSummary,
  projectSummary,
  setProjectSummary,
  projectSummaryStreaming,
  setProjectSummaryStreaming,
  showToast,
}: ProjectSummaryHeaderProps) {
  return (
    <>
      <div className="page-header">
        <h1>{activeProject ? activeProject.name : 'Meetings'}</h1>
        {activeProject && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setShowProjectSummary(!showProjectSummary)}
            >
              {showProjectSummary ? 'Hide Summary' : 'Summary'}
            </button>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              disabled={isGeneratingProjectSummary}
              onClick={async () => {
                setIsGeneratingProjectSummary(true);
                setShowProjectSummary(true);
                setProjectSummaryStreaming('');
                const unsub = window.meetingMind.on('project-summary:stream', (chunk: unknown) => {
                  setProjectSummaryStreaming(prev => prev + (chunk as string));
                });
                const result = await (window.meetingMind as any).generateProjectSummary(activeProject.id);
                unsub();
                setIsGeneratingProjectSummary(false);
                if (result.success) {
                  setProjectSummary(result.summary);
                  setProjectSummaryStreaming('');
                } else {
                  showToast(`Summary failed: ${result.error}`);
                }
              }}
            >
              {isGeneratingProjectSummary ? 'Generating...' : (projectSummary ? 'Update Summary' : 'Generate Summary')}
            </button>
          </div>
        )}
      </div>
      {/* Project Summary Panel */}
      {activeProject && showProjectSummary && (
        <div style={{ padding: '0 20px 12px', maxHeight: 300, overflowY: 'auto' }}>
          <div className="card" style={{ padding: 16 }}>
            {isGeneratingProjectSummary && projectSummaryStreaming ? (
              <MarkdownRenderer content={projectSummaryStreaming} />
            ) : isGeneratingProjectSummary ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <div className="pipeline-spinner" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Generating project summary...</div>
              </div>
            ) : projectSummary ? (
              <MarkdownRenderer content={projectSummary} />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>
                No summary yet. Click "Generate Summary" to create one.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
