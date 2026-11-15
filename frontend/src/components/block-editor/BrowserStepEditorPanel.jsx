import React, { useState, useEffect } from 'react'
import { startBrowserRecording, stopBrowserRecording, createRecordingStream } from '../../api/client'
import { Globe, Plus, Trash2, GripVertical, Square, Circle, Video, ShieldAlert } from 'lucide-react'
import { Typography, Alert } from 'antd'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

const { Text } = Typography

// ─── Action definitions ──────────────────────────────────────────────────────

const getBrowserActions = (t) => [
  { group: t('browserStep.groupNav'), actions: [
    { value: 'navigate',      label: t('browserStep.actionNavigate'),     params: ['url'], needsSelector: false },
    { value: 'go_back',       label: t('browserStep.actionGoBack'),       params: [], needsSelector: false },
    { value: 'go_forward',    label: t('browserStep.actionGoForward'),    params: [], needsSelector: false },
    { value: 'reload',        label: t('browserStep.actionReload'),       params: [], needsSelector: false },
    { value: 'wait_for_load', label: t('browserStep.actionWaitForLoad'),  params: [], needsSelector: false },
  ]},
  { group: t('browserStep.groupInteract'), actions: [
    { value: 'click',         label: t('browserStep.actionClick'),        params: [], needsSelector: true },
    { value: 'double_click',  label: t('browserStep.actionDoubleClick'),  params: [], needsSelector: true },
    { value: 'right_click',   label: t('browserStep.actionRightClick'),   params: [], needsSelector: true },
    { value: 'hover',         label: t('browserStep.actionHover'),        params: [], needsSelector: true },
    { value: 'scroll_to',     label: t('browserStep.actionScrollTo'),     params: [], needsSelector: true },
    { value: 'scroll_page',   label: t('browserStep.actionScrollPage'),   params: ['direction'], needsSelector: false },
  ]},
  { group: t('browserStep.groupInput'), actions: [
    { value: 'fill',          label: t('browserStep.actionFill'),         params: ['text'], needsSelector: true },
    { value: 'type_slowly',   label: t('browserStep.actionTypeSlowly'),   params: ['text'], needsSelector: true },
    { value: 'clear',         label: t('browserStep.actionClear'),        params: [], needsSelector: true },
    { value: 'press_key',     label: t('browserStep.actionPressKey'),     params: ['key'], needsSelector: true },
  ]},
  { group: t('browserStep.groupFormSelect'), actions: [
    { value: 'select_option', label: t('browserStep.actionSelectOption'), params: ['option'], needsSelector: true },
    { value: 'check',         label: t('browserStep.actionCheck'),        params: [], needsSelector: true },
    { value: 'uncheck',       label: t('browserStep.actionUncheck'),      params: [], needsSelector: true },
  ]},
  { group: t('browserStep.groupDownload'), actions: [
    { value: 'click_and_download', label: t('browserStep.actionClickAndDownload'), params: ['key_name'], needsSelector: true },
    { value: 'click_and_upload',   label: t('browserStep.actionClickAndUpload'),   params: ['file'], needsSelector: true },
  ]},
  { group: t('browserStep.groupModalDialog'), actions: [
    { value: 'wait_for_selector', label: t('browserStep.actionWaitForSelector'), params: [], needsSelector: true },
    { value: 'accept_dialog', label: t('browserStep.actionAcceptDialog'), params: [], needsSelector: false },
    { value: 'dismiss_dialog',label: t('browserStep.actionDismissDialog'), params: [], needsSelector: false },
  ]},
  { group: t('browserStep.groupGetData'), actions: [
    { value: 'get_text',      label: t('browserStep.actionGetText'),      params: ['key_name'], needsSelector: true },
    { value: 'get_attribute', label: t('browserStep.actionGetAttribute'), params: ['attribute', 'key_name'], needsSelector: true },
    { value: 'get_all_text',  label: t('browserStep.actionGetAllText'),   params: ['key_name'], needsSelector: true },
    { value: 'get_url',       label: t('browserStep.actionGetUrl'),       params: ['key_name'], needsSelector: false },
    { value: 'screenshot',    label: t('browserStep.actionScreenshot'),   params: ['key_name'], needsSelector: false },
    { value: 'evaluate_js',   label: t('browserStep.actionEvaluateJs'),   params: ['js_code', 'key_name'], needsSelector: false },
  ]},
  { group: t('browserStep.groupWait'), actions: [
    { value: 'wait',          label: t('browserStep.actionWait'),         params: ['seconds'], needsSelector: false },
    { value: 'wait_for_url',  label: t('browserStep.actionWaitForUrl'),   params: ['url_pattern'], needsSelector: false },
  ]},
]

const SCROLL_DIR_OPTIONS = ['down', 'up', 'bottom', 'top']
// Chỉ là GỢI Ý — ô nhập tự do, backend đưa thẳng vào Playwright press() nên gõ tổ hợp bất kỳ
// (VD: Control+A, Shift+End) đều chạy được.
const KEY_OPTIONS = ['Enter', 'Tab', 'Escape', 'Space', 'Backspace', 'Delete', 'Control+A', 'Home', 'End', 'Shift+Home', 'Shift+End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2', 'F5']

const STEP_COLORS = {
  navigate: '#0ea5e9', go_back: '#0ea5e9', go_forward: '#0ea5e9', reload: '#0ea5e9', wait_for_load: '#0ea5e9',
  click: '#8b5cf6', double_click: '#8b5cf6', right_click: '#8b5cf6', hover: '#8b5cf6', scroll_to: '#8b5cf6', scroll_page: '#8b5cf6',
  fill: '#10b981', type_slowly: '#10b981', clear: '#10b981', press_key: '#10b981',
  select_option: '#f59e0b', check: '#f59e0b', uncheck: '#f59e0b',
  click_and_download: '#0ea5e9', click_and_upload: '#0ea5e9',
  wait_for_selector: '#ec4899', accept_dialog: '#ec4899', dismiss_dialog: '#ec4899',
  get_text: '#06b6d4', get_attribute: '#06b6d4', get_all_text: '#06b6d4', get_url: '#06b6d4', screenshot: '#06b6d4', evaluate_js: '#06b6d4',
  wait: '#f97316', wait_for_url: '#f97316',
}

export default function BrowserStepEditorPanel({ steps, onChange, workflowId }) {
  const { t } = useTranslation()
  const BROWSER_ACTIONS = getBrowserActions(t)
  const ACTION_MAP = {}
  BROWSER_ACTIONS.forEach(g => g.actions.forEach(a => { ACTION_MAP[a.value] = a }))
  const [expandedIdx, setExpandedIdx] = useState(null)

  const dragItem = React.useRef(null)
  const dragOverItem = React.useRef(null)

  // ── Ghi thao tác (Recorder) ──
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showUrlPrompt, setShowUrlPrompt] = useState(false)
  const [recUrl, setRecUrl] = useState('')
  const [recCount, setRecCount] = useState(0)
  const stepsBeforeRef = React.useRef([])
  const liveRef = React.useRef([])
  const stopStreamRef = React.useRef(null)
  const recordingRef = React.useRef(false)

  const finishRecordingUI = () => {
    recordingRef.current = false
    setRecording(false)
    setStarting(false)
    if (stopStreamRef.current) { stopStreamRef.current(); stopStreamRef.current = null }
  }

  const applyLive = () => onChange([...stepsBeforeRef.current, ...liveRef.current])

  const beginRecording = async () => {
    if (!workflowId) { toast.error(t('browserStep.saveBeforeRecord')); return }
    let url = recUrl.trim()
    if (!url) { toast.error(t('browserStep.enterUrlToRecord')); return }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url

    setStarting(true)
    try {
      // Tạo phiên ghi trước (mở trình duyệt), rồi mới mở SSE để nhận step.
      await startBrowserRecording(workflowId, url)
      stepsBeforeRef.current = Array.isArray(steps) ? steps : []
      liveRef.current = []
      recordingRef.current = true
      setRecCount(0)
      setRecording(true)
      setShowUrlPrompt(false)
      stopStreamRef.current = createRecordingStream(workflowId, {
        onStep: (s) => { liveRef.current = [...liveRef.current, s]; setRecCount(liveRef.current.length); applyLive() },
        onReplaceLast: (s) => { liveRef.current = [...liveRef.current.slice(0, -1), s]; setRecCount(liveRef.current.length); applyLive() },
        onDone: (finalSteps) => {
          if (Array.isArray(finalSteps)) onChange([...stepsBeforeRef.current, ...finalSteps])
          finishRecordingUI()
          toast.success(t('browserStep.recordStoppedToast'))
        },
        onError: (e) => { toast.error(t('browserStep.recordErrorToast', { message: e.message })); finishRecordingUI() },
      })
      toast.success(t('browserStep.recordOpenedToast'))
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || t('browserStep.recordOpenFailedToast'))
      finishRecordingUI()
    } finally {
      setStarting(false)
    }
  }

  const stopRecording = async () => {
    try { await stopBrowserRecording(workflowId) } catch {}
    // onDone từ SSE sẽ dọn UI; phòng khi SSE lỗi, dọn sau 2s.
    setTimeout(() => { if (recordingRef.current) finishRecordingUI() }, 2500)
  }

  // Dọn dẹp khi đóng panel/modal: dừng phiên ghi nếu còn.
  useEffect(() => () => {
    if (recordingRef.current) {
      if (stopStreamRef.current) { try { stopStreamRef.current() } catch {} }
      if (workflowId) stopBrowserRecording(workflowId).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dọn khi unmount với workflowId của panel (không đổi trong vòng đời panel)
  }, [])

  const addStep = () => {
    const newStep = { action: 'navigate', selector: '', value: '', key_name: 'result', note: '', continue_on_error: false }
    onChange([...steps, newStep])
    setExpandedIdx(steps.length)
  }

  const removeStep = (i) => {
    const newSteps = steps.filter((_, idx) => idx !== i)
    onChange(newSteps)
    if (expandedIdx === i) setExpandedIdx(null)
  }

  const updateStep = (i, field, val) => {
    const newSteps = steps.map((s, idx) => {
      if (idx !== i) return s
      const next = { ...s, [field]: val }
      // Sửa tay sang selector khác các selector dự phòng do recorder ghi (selectors[])
      // thì chuỗi dự phòng cũ không còn hợp lệ nữa — xoá để backend dùng đúng giá trị
      // vừa sửa (khớp với điều kiện ở browser_executor.py: chỉ dùng fallback nếu
      // selector hiện tại vẫn nằm trong danh sách đã ghi).
      if (field === 'selector' && Array.isArray(s.selectors) && !s.selectors.includes(val)) {
        delete next.selectors
      }
      return next
    })
    onChange(newSteps)
  }

  const handleDragStart = (e, index) => {
    dragItem.current = index
    e.dataTransfer.effectAllowed = 'move'
    // Ẩn nội dung khi đang kéo cho gọn
    if (expandedIdx === index) setExpandedIdx(null)
  }

  const handleDragEnter = (e, index) => {
    e.preventDefault()
    dragOverItem.current = index
  }

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return
    if (dragItem.current !== dragOverItem.current) {
      const newSteps = [...steps]
      const draggedContent = newSteps[dragItem.current]
      newSteps.splice(dragItem.current, 1)
      newSteps.splice(dragOverItem.current, 0, draggedContent)
      onChange(newSteps)
      setExpandedIdx(null)
    }
    dragItem.current = null
    dragOverItem.current = null
  }

  const inputStyle = { width: '100%', fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-mono)' }
  const labelStyle = { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2, display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', overflow: 'hidden', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe size={16} color="#0ea5e9" />
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            {t('browserStep.stepListTitle', { count: steps.length })}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!recording ? (
            <button
              type="button"
              onClick={() => setShowUrlPrompt(v => !v)}
              disabled={starting}
              aria-label={t('browserStep.recordAria')}
              title={t('browserStep.recordTooltip')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-default)', background: showUrlPrompt ? 'var(--bg-hover)' : 'var(--bg-surface)', color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.82rem', cursor: starting ? 'wait' : 'pointer', opacity: starting ? 0.6 : 1 }}
            >
              <Circle size={13} fill="#ef4444" color="#ef4444" /> {t('browserStep.recordBtn')}
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              aria-label={t('browserStep.stopRecordAria')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}
            >
              <Square size={13} fill="#fff" /> {t('browserStep.stopRecordBtn')}
            </button>
          )}
          <button
            type="button"
            onClick={addStep}
            aria-label={t('browserStep.addStepAria')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}
          >
            <Plus size={14} /> {t('browserStep.addStepBtn')}
          </button>
        </div>
      </div>

      {/* Ô nhập URL để bắt đầu ghi */}
      {showUrlPrompt && !recording && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder={t('browserStep.urlPromptPlaceholder')}
            value={recUrl}
            autoFocus
            onChange={e => setRecUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') beginRecording() }}
          />
          <button
            type="button"
            onClick={beginRecording}
            disabled={starting}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: starting ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: starting ? 0.7 : 1 }}
          >
            <Video size={14} /> {starting ? t('browserStep.startingRecord') : t('browserStep.startRecordBtn')}
          </button>
        </div>
      )}

      {/* Banner khi đang ghi */}
      {recording && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'color-mix(in srgb, #ef4444 12%, transparent)', borderBottom: '1px solid #ef444455', flexShrink: 0 }}>
          <span className="pyflow-rec-dot" style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('browserStep.recordingBanner', { count: recCount })}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {t('browserStep.recordingHint')}
          </span>
        </div>
      )}

      {/* Steps list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
            <Globe size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: '0.9rem', marginBottom: 6 }}>{t('browserStep.noStepsTitle')}</div>
            <div style={{ fontSize: '0.8rem' }}>{t('browserStep.noStepsHintPrefix')} <strong>+ {t('browserStep.addStepBtn')}</strong> {t('browserStep.noStepsHintSuffix')}</div>
          </div>
        )}

        {steps.map((step, i) => {
          const actionDef = ACTION_MAP[step.action] || {}
          const isExpanded = expandedIdx === i
          const accentColor = STEP_COLORS[step.action] || '#6c63ff'
          const actionLabel = actionDef.label || step.action

          return (
            <div
              key={i}
              // Thu gọn: kéo cả thẻ. Đang mở: CHỈ thanh tiêu đề kéo được (xem header bên
              // dưới) — để cả thẻ draggable thì bôi đen chữ / bấm đúp trong ô nhập bị
              // trình duyệt hiểu thành kéo thẻ, bước nhảy chỗ khác.
              draggable={!isExpanded}
              onDragStart={(e) => handleDragStart(e, i)}
              onDragEnter={(e) => handleDragEnter(e, i)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
              style={{ flexShrink: 0, borderRadius: 10, border: `1px solid ${isExpanded ? accentColor : 'var(--border-default)'}`, background: 'var(--bg-surface)', overflow: 'hidden', transition: 'border-color 0.2s', boxShadow: isExpanded ? `0 0 0 2px ${accentColor}22` : 'none', cursor: isExpanded ? 'default' : 'grab' }}
            >
              {/* Step header — lúc thẻ đang mở, đây là chỗ DUY NHẤT kéo được */}
              <div
                draggable={isExpanded}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', background: isExpanded ? `color-mix(in srgb, ${accentColor} 8%, transparent)` : 'transparent', userSelect: 'none' }}
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
              >
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: accentColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: accentColor }}>{actionLabel}</span>
                    {step.selector && <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.72rem', background: 'var(--bg-base)', padding: '1px 5px', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{step.selector}</span>}
                    {(step.value || (step.action === 'press_key' ? 'Enter' : '')) && <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>= "{step.value || (step.action === 'press_key' ? 'Enter' : '')}"</span>}
                  </div>
                  {step.note && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{step.note}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeStep(i) }} style={{ width: 22, height: 22, border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title={t('browserStep.deleteStepAria')}><Trash2 size={12} /></button>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, cursor: 'grab', color: 'var(--text-muted)' }} title={t('browserStep.dragToReorder')}><GripVertical size={14} /></div>
                </div>
              </div>

              {/* Step body */}
              {isExpanded && (
                <div style={{ padding: '12px', borderTop: `1px solid ${accentColor}33`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Action type */}
                  <div>
                    <label style={labelStyle}>{t('browserStep.actionTypeLabel')}</label>
                    <select value={step.action} onChange={e => updateStep(i, 'action', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      {BROWSER_ACTIONS.map(g => (
                        <optgroup key={g.group} label={g.group}>
                          {g.actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* Selector */}
                  {actionDef.needsSelector && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.selectorLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.selectorPlaceholder')} value={step.selector || ''} onChange={e => updateStep(i, 'selector', e.target.value)} />
                      {Array.isArray(step.selectors) && step.selectors.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: '0.7rem', color: 'var(--accent-success)' }} title={step.selectors.join('\n')}>
                          <ShieldAlert size={12} /> {t('browserStep.fallbackSelectors', { count: step.selectors.length })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Value / URL / Text */}
                  {['navigate', 'go_to', 'wait_for_url'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.urlLabel')}</label>
                      <input style={inputStyle} placeholder="https://example.com" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {['fill', 'type_slowly'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.fillContentLabel')} {'{{key}}'})</label>
                      <input style={inputStyle} placeholder={`${t('browserStep.fillPlaceholderPrefix')} {{username}}`} value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                      {step.is_password && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: '0.7rem', color: 'var(--accent-warning)' }}>
                          <ShieldAlert size={12} /> {t('browserStep.passwordFieldHint')} {'{{biến}}'}.
                        </div>
                      )}
                    </div>
                  )}

                  {step.action === 'press_key' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.keyLabel')}</label>
                      <input list={`pw-keys-${i}`} style={inputStyle} placeholder="Enter" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                      <datalist id={`pw-keys-${i}`}>
                        {KEY_OPTIONS.map(k => <option key={k} value={k} />)}
                      </datalist>
                      <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('browserStep.keyHint')}</div>
                    </div>
                  )}

                  {step.action === 'select_option' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.optionValueLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.optionValuePlaceholder')} value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'scroll_page' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.scrollDirLabel')}</label>
                      <select value={step.value || 'down'} onChange={e => updateStep(i, 'value', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        {SCROLL_DIR_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        <option value="500">500px</option>
                        <option value="1000">1000px</option>
                      </select>
                    </div>
                  )}

                  {step.action === 'wait' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.waitSecondsLabel')}</label>
                      <input type="number" style={inputStyle} placeholder="VD: 2" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} min="0.1" step="0.5" />
                    </div>
                  )}

                  {step.action === 'wait_for_selector' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.waitForLabel')}</label>
                      <select value={step.state || 'visible'} onChange={e => updateStep(i, 'state', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="visible">{t('browserStep.stateVisible')}</option>
                        <option value="hidden">{t('browserStep.stateHidden')}</option>
                        <option value="attached">{t('browserStep.stateAttached')}</option>
                        <option value="detached">{t('browserStep.stateDetached')}</option>
                      </select>
                    </div>
                  )}

                  {step.action === 'get_attribute' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.attributeNameLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.attributePlaceholder')} value={step.attribute || ''} onChange={e => updateStep(i, 'attribute', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'evaluate_js' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.jsExprLabel')}</label>
                      <textarea style={{ ...inputStyle, height: 64, resize: 'vertical', fontFamily: 'monospace' }} placeholder={t('browserStep.jsExprPlaceholder')} value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'click_and_upload' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.uploadFileNameLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.uploadFileNamePlaceholder')} value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                      <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('browserStep.uploadFileHint')}</div>
                    </div>
                  )}

                  {step.action === 'click_and_download' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.downloadFileNameLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.downloadFileNamePlaceholder')} value={step.file_name || ''} onChange={e => updateStep(i, 'file_name', e.target.value)} />
                    </div>
                  )}

                  {/* Key name for data collection */}
                  {['get_text', 'get_attribute', 'get_all_text', 'get_url', 'screenshot', 'evaluate_js', 'click_and_download'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.keyNameLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.keyNamePlaceholder')} value={step.key_name || 'result'} onChange={e => updateStep(i, 'key_name', e.target.value)} />
                    </div>
                  )}

                  {/* Timeout */}
                  {actionDef.needsSelector && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.timeoutLabel')}</label>
                      <input type="number" style={inputStyle} placeholder="20000" value={step.timeout || ''} onChange={e => updateStep(i, 'timeout', e.target.value)} min="1000" step="1000" />
                    </div>
                  )}

                  {/* Note */}
                  <div>
                    <label style={labelStyle}>{t('browserStep.noteLabel')}</label>
                    <input style={inputStyle} placeholder={t('browserStep.notePlaceholder')} value={step.note || ''} onChange={e => updateStep(i, 'note', e.target.value)} />
                  </div>

                  {/* Continue on error */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" id={`coe-${i}`} checked={step.continue_on_error || false} onChange={e => updateStep(i, 'continue_on_error', e.target.checked)} style={{ cursor: 'pointer' }} />
                    <label htmlFor={`coe-${i}`} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>{t('browserStep.continueOnError')}</label>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <Alert title={<span>{t('browserStep.footerHintPrefix')} <Text code>{'{{key}}'}</Text> {t('browserStep.footerHintSuffix')} <Text code>input_data</Text></span>}
        type="info"
        showIcon
        style={{ margin: '8px 16px', borderRadius: 8 }}
      />
    </div>
  )
}
