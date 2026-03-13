import React, { useState, useRef } from 'react';

interface TagEditorProps {
  tags: string[];
  allTags: string[]; // for autocomplete suggestions
  onChange: (tags: string[]) => void;
  readOnly?: boolean;
}

export default function TagEditor({ tags, allTags, onChange, readOnly }: TagEditorProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = inputValue.trim()
    ? allTags
        .filter(t => t.toLowerCase().includes(inputValue.toLowerCase()) && !tags.includes(t))
        .slice(0, 5)
    : [];

  function addTag(tag: string) {
    const normalized = tag.toLowerCase().trim();
    if (normalized && !tags.includes(normalized)) {
      onChange([...tags, normalized]);
    }
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function removeTag(tag: string) {
    onChange(tags.filter(t => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        alignItems: 'center',
        padding: readOnly ? 0 : '4px 8px',
        background: readOnly ? 'transparent' : 'var(--bg-input)',
        border: readOnly ? 'none' : '1px solid var(--border-color)',
        borderRadius: 'var(--radius)',
        minHeight: readOnly ? undefined : 32,
      }}>
        {tags.map(tag => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              background: 'var(--accent-blue-tint)',
              color: 'var(--accent-blue)',
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {tag}
            {!readOnly && (
              <span
                onClick={() => removeTag(tag)}
                style={{ cursor: 'pointer', opacity: 0.7, fontSize: 13, lineHeight: 1 }}
              >
                &times;
              </span>
            )}
          </span>
        ))}

        {!readOnly && (
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => {
              setInputValue(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder={tags.length === 0 ? 'Add tags...' : ''}
            style={{
              flex: 1,
              minWidth: 60,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 12,
              padding: '2px 0',
            }}
          />
        )}
      </div>

      {/* Autocomplete suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 4,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          zIndex: 10,
          overflow: 'hidden',
        }}>
          {suggestions.map(s => (
            <div
              key={s}
              onMouseDown={() => addTag(s)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
