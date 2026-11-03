// Marks a recording brought in from an audio file rather than recorded here.
export default function ImportedBadge() {
  return (
    <span
      title="Imported from an audio file"
      style={{
        marginLeft: 6,
        padding: '1px 6px',
        background: 'var(--bg-input)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 8,
        fontSize: 10,
        verticalAlign: 'middle',
      }}
    >
      Imported
    </span>
  );
}
