import React, { useState, useRef } from 'react';

interface VocabularyEntry {
  term: string;
  variants: string[];
}

interface Props {
  settings: Record<string, any>;
  updateSetting: (key: string, value: any) => void;
}

export default function VocabularySettings({ settings, updateSetting }: Props) {
  const [newTerm, setNewTerm] = useState('');
  const [editingVariantFor, setEditingVariantFor] = useState<string | null>(null);
  const [variantInput, setVariantInput] = useState('');
  const [editingTerm, setEditingTerm] = useState<string | null>(null);
  const [editTermValue, setEditTermValue] = useState('');
  const termInputRef = useRef<HTMLInputElement>(null);
  const variantInputRef = useRef<HTMLInputElement>(null);
  const editTermRef = useRef<HTMLInputElement>(null);

  const vocabList: VocabularyEntry[] = settings.customVocabulary || [];

  function addTerm() {
    const term = newTerm.trim();
    if (!term || vocabList.some(e => e.term === term)) return;
    updateSetting('customVocabulary', [...vocabList, { term, variants: [] }]);
    setNewTerm('');
    termInputRef.current?.focus();
  }

  function removeTerm(term: string) {
    updateSetting('customVocabulary', vocabList.filter(e => e.term !== term));
  }

  function startEditTerm(term: string) {
    setEditingTerm(term);
    setEditTermValue(term);
    setTimeout(() => editTermRef.current?.focus(), 0);
  }

  function commitEditTerm(oldTerm: string) {
    const newName = editTermValue.trim();
    setEditingTerm(null);
    if (!newName || newName === oldTerm || vocabList.some(e => e.term === newName)) return;
    updateSetting('customVocabulary', vocabList.map(e =>
      e.term === oldTerm ? { ...e, term: newName } : e
    ));
  }

  function addVariant(term: string) {
    const v = variantInput.trim();
    if (!v) return;
    const entry = vocabList.find(e => e.term === term);
    if (!entry || entry.variants.includes(v)) return;
    updateSetting('customVocabulary', vocabList.map(e =>
      e.term === term ? { ...e, variants: [...e.variants, v] } : e
    ));
    setVariantInput('');
    // Keep the input open for adding more
  }

  function removeVariant(term: string, variant: string) {
    updateSetting('customVocabulary', vocabList.map(e =>
      e.term === term ? { ...e, variants: e.variants.filter(v => v !== variant) } : e
    ));
  }

  return (
    <>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Add names, acronyms, or terms that transcription often misspells. Include known
        misspellings as variants so the AI can correct them when generating notes.
        You can also add corrections by selecting text in the notes view.
      </div>

      {/* Add new term */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          ref={termInputRef}
          type="text"
          className="form-input"
          placeholder="Add a term — e.g. Abhi, Kubernetes, JIRA"
          value={newTerm}
          onChange={e => setNewTerm(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTerm(); } }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-secondary" onClick={addTerm} disabled={!newTerm.trim()}>Add</button>
      </div>

      {/* Table */}
      {vocabList.length > 0 ? (
        <div style={{
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 36px',
            gap: 0,
            padding: '6px 12px',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            <div>Correct Term</div>
            <div>Known Misspellings</div>
            <div />
          </div>

          {/* Rows */}
          {vocabList.map((entry, i) => (
            <div
              key={entry.term}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr 36px',
                gap: 0,
                padding: '7px 12px',
                alignItems: 'center',
                borderBottom: i < vocabList.length - 1 ? '1px solid var(--border-color)' : 'none',
                fontSize: 13,
              }}
            >
              {/* Term cell */}
              <div>
                {editingTerm === entry.term ? (
                  <input
                    ref={editTermRef}
                    type="text"
                    className="form-input"
                    value={editTermValue}
                    onChange={e => setEditTermValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEditTerm(entry.term); }
                      if (e.key === 'Escape') setEditingTerm(null);
                    }}
                    onBlur={() => commitEditTerm(entry.term)}
                    style={{ fontSize: 13, fontWeight: 600, padding: '2px 6px', width: '100%' }}
                  />
                ) : (
                  <span
                    style={{ fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => startEditTerm(entry.term)}
                    title="Click to edit"
                  >
                    {entry.term}
                  </span>
                )}
              </div>

              {/* Variants cell */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {entry.variants.map(v => (
                  <span key={v} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '1px 7px',
                    background: 'var(--accent-red-subtle)',
                    borderRadius: 3,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}>
                    {v}
                    <button
                      onClick={() => removeVariant(entry.term, v)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1,
                      }}
                    >×</button>
                  </span>
                ))}
                {editingVariantFor === entry.term ? (
                  <input
                    ref={variantInputRef}
                    type="text"
                    className="form-input"
                    placeholder="misspelling..."
                    value={variantInput}
                    onChange={e => setVariantInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addVariant(entry.term); }
                      if (e.key === 'Escape') { setEditingVariantFor(null); setVariantInput(''); }
                    }}
                    onBlur={() => { if (!variantInput.trim()) { setEditingVariantFor(null); } }}
                    style={{ fontSize: 12, padding: '2px 6px', width: 110 }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditingVariantFor(entry.term);
                      setVariantInput('');
                      setTimeout(() => variantInputRef.current?.focus(), 0);
                    }}
                    style={{
                      background: 'none', border: '1px dashed var(--border-color)',
                      borderRadius: 3, cursor: 'pointer', padding: '1px 7px',
                      color: 'var(--text-muted)', fontSize: 11,
                    }}
                  >+</button>
                )}
              </div>

              {/* Delete cell */}
              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={() => removeTerm(entry.term)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '2px 4px', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1,
                  }}
                  title="Remove term"
                >×</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
          No vocabulary terms yet. Add one above, or select text in the notes view to create a correction.
        </div>
      )}
    </>
  );
}
