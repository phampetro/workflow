import React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Input, Button, Select, Switch, Row, Col } from 'antd'

/** Danh sách biến người dùng nhập giữa chừng của khối "Biến đầu vào" (input_vars). */
export default function InputFieldsEditor({ fields, setFields }) {
  const { t } = useTranslation()
  // Helpers cho danh sách biến của khối "Biến đầu vào"
  const updateInputField = (idx, key, val) =>
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f))
  const removeInputField = (idx) =>
    setFields(prev => prev.filter((_, i) => i !== idx))
  const addInputField = () =>
    setFields(prev => [...prev, { name: `bien_${prev.length + 1}`, label: '', type: 'text', required: false, defaultValue: '' }])


  return (
    <>
      {fields.map((f, idx) => (
        <div key={idx} style={{ border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, marginBottom: 10, background: 'var(--bg-surface)' }}>
          <Row gutter={8} align="middle">
            <Col span={8}>
              <Input
                placeholder={t('blockEditor.varNamePlaceholder')}
                value={f.name}
                onChange={(e) => updateInputField(idx, 'name', e.target.value.replace(/[^\w]/g, '_'))}
                addonBefore="{{ }}"
              />
            </Col>
            <Col span={9}>
              <Input
                placeholder={t('blockEditor.varLabelPlaceholder')}
                value={f.label}
                onChange={(e) => updateInputField(idx, 'label', e.target.value)}
              />
            </Col>
            <Col span={5}>
              <Select
                style={{ width: '100%' }}
                value={f.type || 'text'}
                onChange={(v) => updateInputField(idx, 'type', v)}
                options={[
                  { value: 'text', label: t('blockEditor.varTypeText') },
                  { value: 'number', label: t('blockEditor.varTypeNumber') },
                  { value: 'date', label: t('blockEditor.varTypeDate') },
                ]}
              />
            </Col>
            <Col span={2} style={{ textAlign: 'right' }}>
              <Button danger type="text" icon={<Trash2 size={16} />} aria-label={t('blockEditor.removeVarAria')}
                onClick={() => removeInputField(idx)} disabled={fields.length <= 1} />
            </Col>
          </Row>
          <Row gutter={8} align="middle" style={{ marginTop: 8 }}>
            <Col span={17}>
              <Input
                placeholder={t('blockEditor.defaultValuePlaceholder')}
                value={f.defaultValue}
                onChange={(e) => updateInputField(idx, 'defaultValue', e.target.value)}
              />
            </Col>
            <Col span={7} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={!!f.required} onChange={(v) => updateInputField(idx, 'required', v)} size="small" />
              <span className="text-secondary text-sm">{t('blockEditor.requiredLabel')}</span>
            </Col>
          </Row>
        </div>
      ))}

      <Button type="dashed" block icon={<Plus size={16} />} onClick={addInputField}>{t('blockEditor.addVarBtn')}</Button>
    </>
  )
}
