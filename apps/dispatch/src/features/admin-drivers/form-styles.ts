/** Control and feedback styles the driver screens share — 44px minimum targets. */

export const inputStyle: React.CSSProperties = {
  minHeight: 44,
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  fontSize: 'var(--font-size-md)',
};

export const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-xs)',
  fontSize: 'var(--font-size-sm)',
};

/** A checkbox row whose whole label is the 44px target. */
export const checkRowStyle: React.CSSProperties = {
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-sm)',
  fontSize: 'var(--font-size-md)',
};

export const fieldsetStyle: React.CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-sm)',
  margin: 0,
  padding: 'var(--spacing-md)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

export const alertStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
};

export const statusStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--font-size-sm)',
};
