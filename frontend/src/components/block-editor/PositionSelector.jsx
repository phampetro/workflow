import React from 'react'
import { useTranslation } from 'react-i18next'

export default function PositionSelector({ value, onChange }) {
  const { t } = useTranslation()
  const btnStyle = (pos) => ({
    width: 48,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: value === pos ? 'var(--accent-primary)' : 'transparent',
    color: value === pos ? '#fff' : 'var(--text-secondary)',
    border: `1px solid ${value === pos ? 'var(--accent-primary)' : 'var(--border-default)'}`,
    borderRadius: 6,
    transition: 'all 0.2s',
    fontSize: '0.75rem',
    userSelect: 'none'
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '48px 48px 48px', gridTemplateRows: '28px 28px 28px', gap: '4px' }}>
      <div style={{ gridColumn: 2, gridRow: 1 }} onClick={() => onChange('top')}>
        <div style={btnStyle('top')}>{t('browserStep.posTop')}</div>
      </div>
      <div style={{ gridColumn: 1, gridRow: 2 }} onClick={() => onChange('left')}>
        <div style={btnStyle('left')}>{t('browserStep.posLeft')}</div>
      </div>
      <div style={{ gridColumn: 3, gridRow: 2 }} onClick={() => onChange('right')}>
        <div style={btnStyle('right')}>{t('browserStep.posRight')}</div>
      </div>
      <div style={{ gridColumn: 2, gridRow: 3 }} onClick={() => onChange('bottom')}>
        <div style={btnStyle('bottom')}>{t('browserStep.posBottom')}</div>
      </div>
    </div>
  );
};
