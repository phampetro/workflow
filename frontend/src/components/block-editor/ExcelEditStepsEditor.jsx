import React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { Input, Button, Space, Tag, Divider, Select, Switch, Alert, Row, Col } from 'antd'

/** Danh sách bước có THỨ TỰ của khối "Xử lý Excel" (xóa dòng / lọc theo cột / xóa cột). */
export default function ExcelEditStepsEditor({ steps, setSteps }) {
  const { t } = useTranslation()
  // Đổi loại bước thì tạo object mới sạch — không giữ field của loại cũ (tránh dữ liệu rác lẫn vào)
  const newExcelEditStep = (op) => (
    op === 'filter' ? { op, column: '', mode: 'keep', text: '', caseSensitive: false }
    : op === 'delete_cols' ? { op, cols: '' }
    : { op: 'delete_rows', rows: '' }
  )
  const updateExcelEditStep = (idx, patch) =>
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  const changeExcelEditOp = (idx, op) =>
    setSteps(prev => prev.map((s, i) => i === idx ? newExcelEditStep(op) : s))
  const removeExcelEditStep = (idx) =>
    setSteps(prev => prev.filter((_, i) => i !== idx))
  const moveExcelEditStep = (idx, dir) =>
    setSteps(prev => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })


  return (
    <>
      <Divider style={{ margin: '8px 0 16px' }}>{t('blockEditor.excelEditStepsTitle')}</Divider>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} description={t('blockEditor.excelEditStepsHint')} />

      {steps.length === 0 && (
        <div style={{ textAlign: 'center', padding: '16px 0', marginBottom: 10, color: 'var(--text-muted)', border: '1px dashed var(--border-default)', borderRadius: 8 }}>
          {t('blockEditor.excelEditNoSteps')}
        </div>
      )}

      {steps.map((s, idx) => (
        <div key={idx} style={{ border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, marginBottom: 10, background: 'var(--bg-surface)' }}>
          <Row gutter={8} align="middle">
            <Col flex="none"><Tag color="magenta" style={{ margin: 0 }}>{idx + 1}</Tag></Col>
            <Col flex="auto">
              <Select
                style={{ width: '100%' }}
                value={s.op}
                aria-label={t('blockEditor.excelEditOpLabel')}
                onChange={(v) => changeExcelEditOp(idx, v)}
                options={[
                  { value: 'delete_rows', label: t('blockEditor.excelEditOpDeleteRows') },
                  { value: 'filter', label: t('blockEditor.excelEditOpFilter') },
                  { value: 'delete_cols', label: t('blockEditor.excelEditOpDeleteCols') },
                ]}
              />
            </Col>
            <Col flex="none">
              <Space size={2}>
                <Button type="text" size="small" icon={<ArrowUp size={14} />} aria-label={t('blockEditor.excelEditMoveUpAria')} disabled={idx === 0} onClick={() => moveExcelEditStep(idx, -1)} />
                <Button type="text" size="small" icon={<ArrowDown size={14} />} aria-label={t('blockEditor.excelEditMoveDownAria')} disabled={idx === steps.length - 1} onClick={() => moveExcelEditStep(idx, 1)} />
                <Button danger type="text" size="small" icon={<Trash2 size={14} />} aria-label={t('blockEditor.excelEditRemoveStepAria')} onClick={() => removeExcelEditStep(idx)} />
              </Space>
            </Col>
          </Row>

          <div style={{ marginTop: 10 }}>
            {s.op === 'delete_rows' && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('blockEditor.excelEditRowsLabel')}</div>
                <Input
                  aria-label={t('blockEditor.excelEditRowsLabel')}
                  placeholder={t('blockEditor.excelEditRowsPlaceholder')}
                  value={s.rows}
                  onChange={(e) => updateExcelEditStep(idx, { rows: e.target.value })}
                />
              </>
            )}
            {s.op === 'delete_cols' && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('blockEditor.excelEditColsLabel')}</div>
                <Input
                  aria-label={t('blockEditor.excelEditColsLabel')}
                  placeholder={t('blockEditor.excelEditColsPlaceholder')}
                  value={s.cols}
                  onChange={(e) => updateExcelEditStep(idx, { cols: e.target.value })}
                />
              </>
            )}
            {s.op === 'filter' && (
              <>
                <Row gutter={8}>
                  <Col span={9}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('blockEditor.excelEditFilterColumn')}</div>
                    <Input
                      aria-label={t('blockEditor.excelEditFilterColumn')}
                      placeholder={t('blockEditor.excelEditFilterColumnPlaceholder')}
                      value={s.column}
                      onChange={(e) => updateExcelEditStep(idx, { column: e.target.value })}
                    />
                  </Col>
                  <Col span={15}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('blockEditor.excelEditFilterMode')}</div>
                    <Select
                      style={{ width: '100%' }}
                      value={s.mode}
                      aria-label={t('blockEditor.excelEditFilterMode')}
                      onChange={(v) => updateExcelEditStep(idx, { mode: v })}
                      options={[
                        { value: 'keep', label: t('blockEditor.excelEditModeKeep') },
                        { value: 'remove', label: t('blockEditor.excelEditModeRemove') },
                      ]}
                    />
                  </Col>
                </Row>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 4px' }}>{t('blockEditor.excelEditFilterText')}</div>
                <Input
                  aria-label={t('blockEditor.excelEditFilterText')}
                  placeholder={`${t('blockEditor.excelEditFilterTextPlaceholder')} {{ten_bien}}`}
                  value={s.text}
                  onChange={(e) => updateExcelEditStep(idx, { text: e.target.value })}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <Switch size="small" checked={!!s.caseSensitive} onChange={(v) => updateExcelEditStep(idx, { caseSensitive: v })} />
                  <span className="text-secondary text-sm">{t('blockEditor.excelEditCaseSensitive')}</span>
                </div>
              </>
            )}
          </div>
        </div>
      ))}

      <Button type="dashed" block icon={<Plus size={16} />} onClick={() => setSteps(prev => [...prev, newExcelEditStep('delete_rows')])}>
        {t('blockEditor.excelEditAddStep')}
      </Button>
    </>
  )
}
