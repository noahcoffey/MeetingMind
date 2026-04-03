import React, { useState, useRef, useEffect } from 'react';
import PipelineWidget, { BackgroundJob } from './PipelineWidget';
import type { Project } from '../types';

type Page = 'record' | 'meetings' | 'settings' | 'analytics' | 'highlights';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  backgroundJobs: BackgroundJob[];
  onViewJobRecording: (recordingId: string) => void;
  onDismissJob: (recordingId: string) => void;
  notebooks: string[];
  activeNotebook: string;
  onNotebookChange: (notebook: string) => void;
  onNotebooksUpdate: (notebooks: string[]) => void;
  projects?: Project[];
  activeProjectFilter?: string | null;
  onProjectSelect?: (projectId: string | null) => void;
  onProjectCreate?: (name: string) => void;
  onProjectRename?: (id: string, name: string) => void;
  onProjectDelete?: (id: string) => void;
  onRecordingDroppedOnProject?: (recordingId: string, projectId: string) => void;
}

export default function Sidebar({
  currentPage, onNavigate, backgroundJobs, onViewJobRecording, onDismissJob,
  notebooks, activeNotebook, onNotebookChange, onNotebooksUpdate,
  projects = [], activeProjectFilter, onProjectSelect, onProjectCreate,
  onProjectRename, onProjectDelete, onRecordingDroppedOnProject,
}: SidebarProps) {
  const [showNotebookMenu, setShowNotebookMenu] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowNotebookMenu(false);
        setIsCreating(false);
        setEditingIndex(null);
      }
    }
    if (showNotebookMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showNotebookMenu]);

  useEffect(() => {
    if (isCreating && createInputRef.current) createInputRef.current.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) editInputRef.current.focus();
  }, [editingIndex]);

  function handleCreate() {
    const trimmed = newName.trim();
    if (trimmed && !notebooks.includes(trimmed)) {
      const updated = [...notebooks, trimmed];
      onNotebooksUpdate(updated);
      onNotebookChange(trimmed);
    }
    setNewName('');
    setIsCreating(false);
  }

  function handleRename(index: number) {
    const trimmed = editName.trim();
    const oldName = notebooks[index];
    if (trimmed && trimmed !== oldName && !notebooks.includes(trimmed)) {
      const updated = notebooks.map((n, i) => i === index ? trimmed : n);
      onNotebooksUpdate(updated);
      if (activeNotebook === oldName) onNotebookChange(trimmed);
      // Update manifests with old notebook name — fire and forget
      (async () => {
        const recordings = await window.meetingMind.getRecordings();
        for (const rec of recordings) {
          if (rec.notebook === oldName || (!rec.notebook && oldName === notebooks[0])) {
            await (window.meetingMind as any).moveToNotebook(rec.id, trimmed);
          }
        }
        // Update projects associated with the renamed notebook
        await (window.meetingMind as any).notebookRenamed(oldName, trimmed);
      })().catch(() => {});
    }
    setEditingIndex(null);
    setEditName('');
  }

  function handleDelete(index: number) {
    if (notebooks.length <= 1) return; // Keep at least one
    const name = notebooks[index];
    const updated = notebooks.filter((_, i) => i !== index);
    // Move recordings from deleted notebook to first remaining
    const fallback = updated[0];
    (async () => {
      const recordings = await window.meetingMind.getRecordings();
      for (const rec of recordings) {
        if (rec.notebook === name) {
          await (window.meetingMind as any).moveToNotebook(rec.id, fallback);
        }
      }
      // Delete projects associated with the deleted notebook
      await (window.meetingMind as any).notebookDeleted(name);
    })().catch(() => {});
    onNotebooksUpdate(updated);
  }

  return (
    <div className="sidebar">
      {/* Notebook selector */}
      <div ref={menuRef} style={{ padding: '12px 12px 4px', position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => setShowNotebookMenu(prev => !prev)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            background: 'var(--sidebar-hover-bg, var(--bg-input))',
            border: '1px solid var(--sidebar-border, var(--border-color))',
            borderRadius: 'var(--radius)',
            color: 'var(--sidebar-text, var(--text-primary))',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeNotebook}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showNotebookMenu && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 12,
            right: 12,
            marginTop: 4,
            background: 'var(--sidebar-hover-bg, var(--bg-secondary))',
            border: '1px solid var(--sidebar-border, var(--border-color))',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-dropdown)',
            zIndex: 100,
            overflow: 'hidden',
          }}>
            {notebooks.map((nb, i) => (
              <div key={nb} style={{ display: 'flex', alignItems: 'center' }}>
                {editingIndex === i ? (
                  <input
                    ref={editInputRef}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(i);
                      if (e.key === 'Escape') { setEditingIndex(null); setEditName(''); }
                    }}
                    onBlur={() => handleRename(i)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'var(--sidebar-active-bg, var(--bg-input))',
                      border: 'none',
                      color: 'var(--sidebar-text, var(--text-primary))',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      onNotebookChange(nb);
                      setShowNotebookMenu(false);
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: nb === activeNotebook ? 'var(--accent-blue-tint)' : 'none',
                      border: 'none',
                      color: nb === activeNotebook ? 'var(--accent-blue)' : 'var(--sidebar-text, var(--text-primary))',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontWeight: nb === activeNotebook ? 500 : 400,
                    }}
                  >
                    {nb}
                  </button>
                )}
                {editingIndex !== i && (
                  <div style={{ display: 'flex', gap: 2, paddingRight: 6 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingIndex(i);
                        setEditName(nb);
                      }}
                      style={{
                        background: 'none', border: 'none', color: 'var(--sidebar-text-muted, var(--text-muted))',
                        cursor: 'pointer', padding: '4px', fontSize: 11, lineHeight: 1,
                      }}
                      title="Rename"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                    {notebooks.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(i);
                        }}
                        style={{
                          background: 'none', border: 'none', color: 'var(--sidebar-text-muted, var(--text-muted))',
                          cursor: 'pointer', padding: '4px', fontSize: 11, lineHeight: 1,
                        }}
                        title="Delete notebook"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div style={{ borderTop: '1px solid var(--sidebar-border, var(--border-color))' }}>
              {isCreating ? (
                <div style={{ display: 'flex' }}>
                  <input
                    ref={createInputRef}
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setIsCreating(false); setNewName(''); }
                    }}
                    onBlur={handleCreate}
                    placeholder="Notebook name..."
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'var(--sidebar-active-bg, var(--bg-input))',
                      border: 'none',
                      color: 'var(--sidebar-text, var(--text-primary))',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setIsCreating(true)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--sidebar-text-muted, var(--text-muted))',
                    fontSize: 13,
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New Notebook
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">

        <button
          className={`sidebar-item ${currentPage === 'record' ? 'active' : ''}`}
          onClick={() => onNavigate('record')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" fill="currentColor" />
          </svg>
          Record
        </button>

        <button
          className={`sidebar-item ${currentPage === 'meetings' ? 'active' : ''}`}
          onClick={() => onNavigate('meetings')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l3-9 4 18 3-9h4" />
          </svg>
          Meetings
        </button>

        <button
          className={`sidebar-item ${currentPage === 'highlights' ? 'active' : ''}`}
          onClick={() => onNavigate('highlights')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          Highlights
        </button>

        <button
          className={`sidebar-item ${currentPage === 'analytics' ? 'active' : ''}`}
          onClick={() => onNavigate('analytics')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          Analytics
        </button>

        <button
          className={`sidebar-item ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
      </nav>

      <ProjectsSection
        projects={projects}
        activeNotebook={activeNotebook}
        activeProjectFilter={activeProjectFilter ?? null}
        onProjectSelect={onProjectSelect}
        onProjectCreate={onProjectCreate}
        onProjectRename={onProjectRename}
        onProjectDelete={onProjectDelete}
        onRecordingDroppedOnProject={onRecordingDroppedOnProject}
      />

      <PipelineWidget
        jobs={backgroundJobs}
        onViewRecording={onViewJobRecording}
        onDismiss={onDismissJob}
      />

      <div className="sidebar-version">
        MeetingMind v1.0.0
      </div>
    </div>
  );
}

// --- Projects Section ---

function ProjectsSection({
  projects, activeNotebook, activeProjectFilter, onProjectSelect,
  onProjectCreate, onProjectRename, onProjectDelete, onRecordingDroppedOnProject,
}: {
  projects: Project[];
  activeNotebook: string;
  activeProjectFilter: string | null;
  onProjectSelect?: (projectId: string | null) => void;
  onProjectCreate?: (name: string) => void;
  onProjectRename?: (id: string, name: string) => void;
  onProjectDelete?: (id: string) => void;
  onRecordingDroppedOnProject?: (recordingId: string, projectId: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const notebookProjects = projects.filter(p => p.notebook === activeNotebook);

  useEffect(() => {
    if (isCreating && createInputRef.current) createInputRef.current.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed || notebookProjects.some(p => p.name === trimmed)) return;
    onProjectCreate?.(trimmed);
    setNewName('');
    setIsCreating(false);
  }

  function handleRename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed || notebookProjects.some(p => p.id !== id && p.name === trimmed)) return;
    onProjectRename?.(id, trimmed);
    setEditingId(null);
  }

  function handleDragOver(e: React.DragEvent, projectId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(projectId);
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  function handleDrop(e: React.DragEvent, projectId: string) {
    e.preventDefault();
    setDragOverId(null);
    const recordingId = e.dataTransfer.getData('text/recording-id');
    if (recordingId) {
      onRecordingDroppedOnProject?.(recordingId, projectId);
    }
  }

  return (
    <div className="sidebar-projects-section">
      <div className="sidebar-section-header">
        <span>PROJECTS</span>
        <button
          className="sidebar-section-add-btn"
          onClick={() => { setIsCreating(true); setNewName(''); }}
          title="New Project"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <div className="sidebar-projects-list">
        {/* All Meetings */}
        <button
          className={`sidebar-project-item ${activeProjectFilter === null ? 'active' : ''}`}
          onClick={() => onProjectSelect?.(null)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l3-9 4 18 3-9h4" />
          </svg>
          All Meetings
        </button>

        {/* Project items */}
        {notebookProjects.map(project => (
          <div
            key={project.id}
            className={`sidebar-project-item ${activeProjectFilter === project.id ? 'active' : ''} ${dragOverId === project.id ? 'drag-over' : ''}`}
            onClick={() => { if (!editingId) onProjectSelect?.(project.id); }}
            onDragOver={(e) => handleDragOver(e, project.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, project.id)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {editingId === project.id ? (
              <input
                ref={editInputRef}
                className="sidebar-project-edit-input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRename(project.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onBlur={() => setEditingId(null)}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="sidebar-project-name">{project.name}</span>
                <span className="sidebar-project-actions">
                  <button
                    className="sidebar-project-action-btn"
                    title="Rename"
                    onClick={e => { e.stopPropagation(); setEditingId(project.id); setEditName(project.name); }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    className="sidebar-project-action-btn"
                    title="Delete"
                    onClick={e => { e.stopPropagation(); onProjectDelete?.(project.id); }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              </>
            )}
          </div>
        ))}

        {/* Create new project input */}
        {isCreating && (
          <div className="sidebar-project-item" style={{ padding: '4px 8px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <input
              ref={createInputRef}
              className="sidebar-project-edit-input"
              value={newName}
              placeholder="Project name..."
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              onBlur={() => { if (!newName.trim()) setIsCreating(false); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
