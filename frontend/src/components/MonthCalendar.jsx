import React, { useState, useEffect, useMemo } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { useTranslation } from 'react-i18next'
import './MonthCalendar.css'

dayjs.extend(isoWeek)

// Lịch tháng cho SidePanel (Dashboard + ProjectDetail) — tuần bắt đầu Thứ 2, cột
// đầu ghi số tuần ISO của năm (isoWeek — cùng cách tính với NavbarDate nên số
// tuần luôn khớp giữa 2 nơi). Tô "crosshair": cả hàng (tuần này) lẫn cột (thứ hôm
// nay) được tô nhạt, riêng ô hôm nay tô đậm + có vòng hiệu ứng lan toả.
// Dùng giờ máy client (không ép giờ Việt Nam) — xem ghi chú tương tự ở Navbar.jsx.
const WEEKDAY_SHORT_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const WEEKDAY_SHORT_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function buildMonthGrid(viewMonth) {
  const startOfMonth = viewMonth.startOf('month')
  const gridStart = startOfMonth.startOf('isoWeek')
  const gridEnd = viewMonth.endOf('month').endOf('isoWeek')

  const weeks = []
  let cursor = gridStart
  while (cursor.isBefore(gridEnd) || cursor.isSame(gridEnd, 'day')) {
    const days = []
    for (let i = 0; i < 7; i++) {
      days.push(cursor)
      cursor = cursor.add(1, 'day')
    }
    weeks.push(days)
  }
  return weeks
}

export default function MonthCalendar() {
  const { t, i18n } = useTranslation()
  const isEn = i18n.language === 'en'
  const [today, setToday] = useState(() => dayjs())
  const [viewMonth, setViewMonth] = useState(() => dayjs().startOf('month'))

  // Cập nhật mỗi phút để lịch tự nhảy sang ngày/tuần mới đúng lúc nửa đêm, không cần reload trang
  useEffect(() => {
    const timer = setInterval(() => setToday(dayjs()), 60000)
    return () => clearInterval(timer)
  }, [])

  const weeks = useMemo(() => buildMonthGrid(viewMonth), [viewMonth])
  const todayColIndex = today.isoWeekday() - 1 // Thứ 2 = 0 ... Chủ Nhật = 6
  const todayWeekStart = today.startOf('isoWeek')
  const weekdayLabels = isEn ? WEEKDAY_SHORT_EN : WEEKDAY_SHORT_VI
  const isViewingCurrentMonth = viewMonth.isSame(today, 'month')

  return (
    <div>
      {/* Tiêu đề — cùng kiểu (icon nhỏ + chữ hoa) với "Thời tiết"/"Tài nguyên hệ thống" */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', padding: '0 0.125rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <CalendarDays size="0.8125rem" style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            {t('projectDetail.monthCalendarTitle')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.125rem' }}>
          <Tooltip title={t('projectDetail.monthCalendarPrevMonth')}>
            <Button
              type="text"
              size="small"
              aria-label={t('projectDetail.monthCalendarPrevMonth')}
              icon={<ChevronLeft size="0.8125rem" />}
              onClick={() => setViewMonth((m) => m.subtract(1, 'month'))}
              style={{ color: 'var(--text-muted)', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            />
          </Tooltip>
          <Tooltip title={isViewingCurrentMonth ? '' : t('projectDetail.monthCalendarBackToToday')}>
            <span
              onClick={() => !isViewingCurrentMonth && setViewMonth(dayjs().startOf('month'))}
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                cursor: isViewingCurrentMonth ? 'default' : 'pointer',
                textDecoration: isViewingCurrentMonth ? 'none' : 'underline dotted',
                minWidth: '5.5rem',
                textAlign: 'center',
              }}
            >
              {viewMonth.format('MMMM YYYY')}
            </span>
          </Tooltip>
          <Tooltip title={t('projectDetail.monthCalendarNextMonth')}>
            <Button
              type="text"
              size="small"
              aria-label={t('projectDetail.monthCalendarNextMonth')}
              icon={<ChevronRight size="0.8125rem" />}
              onClick={() => setViewMonth((m) => m.add(1, 'month'))}
              style={{ color: 'var(--text-muted)', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            />
          </Tooltip>
        </div>
      </div>

      <div style={{
        padding: '0.625rem',
        background: 'var(--bg-surface)',
        borderRadius: 8,
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '26px repeat(7, 1fr)', gap: 2 }}>
          {/* Hàng tiêu đề: nhãn cột tuần + T2..CN, cột trùng thứ hôm nay tô đậm */}
          <div style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center', padding: '2px 0' }}>
            {t('projectDetail.monthCalendarWeekAbbrev')}
          </div>
          {weekdayLabels.map((label, colIndex) => (
            <div
              key={label}
              style={{
                fontSize: '0.625rem',
                fontWeight: 600,
                textAlign: 'center',
                padding: '2px 0',
                color: colIndex === todayColIndex ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            >
              {label}
            </div>
          ))}

          {/* Các hàng tuần */}
          {weeks.map((days) => {
            const isCurrentWeekRow = days[0].isSame(todayWeekStart, 'day')
            const weekNumber = days[0].isoWeek()
            return (
              <React.Fragment key={days[0].format('YYYY-MM-DD')}>
                <div style={{
                  fontSize: '0.625rem',
                  textAlign: 'center',
                  padding: '3px 0',
                  borderRadius: 4,
                  fontWeight: isCurrentWeekRow ? 700 : 400,
                  color: isCurrentWeekRow ? 'var(--accent-primary)' : 'var(--text-muted)',
                  background: isCurrentWeekRow ? 'var(--bg-hover)' : 'transparent',
                }}>
                  {weekNumber}
                </div>
                {days.map((day, colIndex) => {
                  const isToday = day.isSame(today, 'day')
                  const isCurrentMonth = day.month() === viewMonth.month() && day.year() === viewMonth.year()
                  const isCrosshair = isCurrentWeekRow || colIndex === todayColIndex

                  return (
                    <div
                      key={day.format('YYYY-MM-DD')}
                      title={isToday ? t('projectDetail.monthCalendarTodayTooltip') : undefined}
                      style={{
                        position: 'relative',
                        textAlign: 'center',
                        padding: '3px 0',
                        borderRadius: 6,
                        fontSize: '0.6875rem',
                        fontWeight: isToday ? 700 : 400,
                        color: isToday
                          ? '#fff'
                          : !isCurrentMonth
                            ? 'var(--text-muted)'
                            : 'var(--text-primary)',
                        opacity: isCurrentMonth ? 1 : 0.4,
                        background: !isToday && isCrosshair ? 'var(--bg-hover)' : 'transparent',
                      }}
                    >
                      {isToday && <span className="month-cal-today-ring" />}
                      <span style={{ position: 'relative', zIndex: 1 }}>{day.date()}</span>
                    </div>
                  )
                })}
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
