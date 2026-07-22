import React, { useState, useEffect } from 'react'
import { Settings, Zap, Plus, RefreshCw, FolderOpen, Workflow, Clock, CalendarCheck, CalendarDays, Sun, Moon, UserCog, Upload, Sparkles, Info } from 'lucide-react'
import { Button, Tooltip, Dropdown } from 'antd'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import isoWeek from 'dayjs/plugin/isoWeek'
import useStore from '../store/useStore'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)

const VN_TZ = 'Asia/Ho_Chi_Minh'
const WEEKDAY_VI = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

function getVnTodayInfo() {
  const now = dayjs().tz(VN_TZ)
  return {
    label: `${WEEKDAY_VI[now.day()]} ${now.format('DD/MM/YYYY')} - Tuần ${now.isoWeek()}`,
    full: `${WEEKDAY_VI[now.day()]}, ngày ${now.format('DD/MM/YYYY')} · Tuần thứ ${now.isoWeek()} năm ${now.isoWeekYear()} (giờ Việt Nam)`,
  }
}

/** Pill hiển thị thứ/ngày/tuần lịch hiện tại, luôn tính theo giờ Việt Nam
 *  (Asia/Ho_Chi_Minh) bất kể múi giờ hệ điều hành client. */
function NavbarDate() {
  const [info, setInfo] = useState(getVnTodayInfo)

  useEffect(() => {
    const timer = setInterval(() => setInfo(getVnTodayInfo()), 60000)
    return () => clearInterval(timer)
  }, [])

  return (
    <Tooltip title={info.full}>
      <div className="navbar-date">
        <CalendarDays size={14} />
        <span>{info.label}</span>
      </div>
    </Tooltip>
  )
}

export default function Navbar({
  title,
  subtitle,
  onLogoClick,
  stats,
  loading,
  onRefresh,
  onCreateProject,
  onImport,
  isDashboard,
  onSwitchUser,
  onOpenAiSettings,
  onOpenAbout,
}) {
  const theme = useStore((state) => state.theme)
  const setTheme = useStore((state) => state.setTheme)
  const currentUser = useStore((state) => state.currentUser)

  const settingsItems = [
    {
      key: 'switch-user',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserCog size="0.875rem" />
          Chuyển người dùng
        </span>
      ),
      onClick: onSwitchUser,
    },
    { type: 'divider' },
    {
      key: 'ai-settings',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size="0.875rem" />
          Cài đặt AI
        </span>
      ),
      onClick: onOpenAiSettings,
    },
    { type: 'divider' },
    {
      key: 'theme',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {theme === 'light' ? <Moon size="0.875rem" /> : <Sun size="0.875rem" />}
          {theme === 'light' ? 'Giao diện Tối' : 'Giao diện Sáng'}
        </span>
      ),
      onClick: () => setTheme(theme === 'light' ? 'dark' : 'light'),
    },
    { type: 'divider' },
    {
      key: 'about',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size="0.875rem" />
          Thông tin
        </span>
      ),
      onClick: onOpenAbout,
    },
  ]

  return (
    <header className="navbar">
      {/* LEFT: Logo + actions / breadcrumb */}
      <div className="navbar-left">
        <div
          className="navbar-brand"
          onClick={onLogoClick}
          style={{ cursor: onLogoClick ? 'pointer' : 'default' }}
        >
          <div className="brand-icon">
            <Zap size="1.125rem" strokeWidth={2.5} />
          </div>
          <span className="brand-name">
            PyFlow <span className="brand-highlight">Studio</span>
          </span>
        </div>

        <div className="navbar-sep" />
        <NavbarDate />

        {isDashboard && (
          <>
            <div className="navbar-sep" />
            <div className="navbar-actions">
              <Button
                type="primary"
                onClick={onCreateProject}
                icon={<Plus size="0.875rem" />}
                className="nav-btn-create"
              >
                Tạo Project
              </Button>
              <Tooltip title="Import project từ file ZIP">
                <Button
                  type="default"
                  onClick={onImport}
                  icon={<Upload size="0.875rem" />}
                  style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                >
                  Import
                </Button>
              </Tooltip>
              <Tooltip title="Làm mới dữ liệu">
                <Button
                  type="text"
                  onClick={onRefresh}
                  disabled={loading}
                  icon={<RefreshCw size="0.875rem" className={loading ? 'spinning' : ''} />}
                  className="nav-btn-ghost"
                />
              </Tooltip>
            </div>
          </>
        )}

        {title && (
          <>
            <div className="navbar-sep" />
            <div className="navbar-breadcrumb">
              <span className="breadcrumb-title">{title}</span>
              {subtitle && <span className="breadcrumb-sub">{subtitle}</span>}
            </div>
          </>
        )}
      </div>

      {/* RIGHT: Stats + Settings */}
      <div className="navbar-right">
        {stats && (
          <div className="navbar-stats">
            <Tooltip title="Số dự án">
              <div className="stat-chip">
                <FolderOpen size="0.875rem" style={{ color: '#f97316' }} />
                <span className="stat-val" style={{ color: '#f97316' }}>{stats.total_projects ?? 0}</span>
              </div>
            </Tooltip>
            <div className="stat-divider" />
            <Tooltip title="Tổng workflows">
              <div className="stat-chip">
                <Workflow size="0.875rem" style={{ color: 'var(--accent-secondary)' }} />
                <span className="stat-val" style={{ color: 'var(--accent-secondary)' }}>{stats.total_workflows ?? 0}</span>
              </div>
            </Tooltip>
            <div className="stat-divider" />
            <Tooltip title="Đang chạy">
              <div className={`stat-chip ${stats.running > 0 ? 'stat-running' : ''}`}>
                <Clock size="0.875rem" className={stats.running > 0 ? 'spinning' : ''} style={{ color: '#52c41a' }} />
                <span className="stat-val" style={{ color: '#52c41a' }}>
                  {stats.running ?? 0}
                </span>
              </div>
            </Tooltip>
            <div className="stat-divider" />
            <Tooltip title="Hôm nay (của bạn): Lỗi + Dừng / Thành công / Tất cả">
              <div className="stat-chip">
                <CalendarCheck size="0.875rem" style={{ color: '#eab308' }} />
                <span className="stat-val" style={{ color: '#ff4d4f' }}>{(stats.failed_today || 0) + (stats.stopped_today || 0)}</span>
                <span style={{ color: 'var(--text-muted)' }}>/</span>
                <span className="stat-val" style={{ color: '#52c41a' }}>{stats.success_today ?? 0}</span>
                <span style={{ color: 'var(--text-muted)' }}>/</span>
                <span className="stat-val" style={{ color: '#1890ff' }}>{stats.total_today ?? 0}</span>
              </div>
            </Tooltip>
          </div>
        )}
        {stats && <div className="navbar-sep" />}

        {/* User name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem' }}>
          <div style={{
            width: '1.75rem', height: '1.75rem', borderRadius: '50%',
            background: 'var(--premium-gradient-1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 600, fontSize: '0.75rem', flexShrink: 0,
          }}>
            {currentUser?.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{currentUser?.name}</span>
        </div>

        <Dropdown menu={{ items: settingsItems }} placement="bottomRight" trigger={['click']}>
          <Tooltip title="Cài đặt hệ thống">
            <Button type="text" icon={<Settings size="1rem" />} className="nav-btn-ghost" aria-label="Cài đặt" />
          </Tooltip>
        </Dropdown>
      </div>

      <style>{`
        .navbar {
          height: var(--navbar-height);
          /* Dùng --bg-elevated để nav có tone hơi khác body (dark: đậm hơn; light: teal-elevated
             hơi tối hơn body). Nếu dùng overlay = body color thì nav "chìm" vào page,
             không phân biệt được vùng toolbar với vùng nội dung. */
          background: var(--bg-elevated);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--border-default);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 var(--space-6);
          position: sticky;
          top: 0;
          z-index: 1000;
          box-shadow: var(--shadow-sm);
        }

        .navbar-left, .navbar-right {
          display: flex;
          align-items: center;
        }

        .navbar-brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          user-select: none;
          transition: opacity var(--transition-fast);
        }
        .navbar-brand:hover {
          opacity: 0.9;
        }
        
        .brand-icon {
          width: 2rem;
          height: 2rem;
          border-radius: 0.5rem;
          background: linear-gradient(135deg, var(--accent-primary), #3b82f6);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }

        .brand-name {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.02em;
        }
        .brand-highlight {
          color: var(--text-secondary);
          font-weight: 500;
        }

        .navbar-sep {
          width: 1px;
          height: 1.25rem;
          background: var(--border-default);
          margin: 0 1rem;
        }

        .navbar-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .nav-btn-create {
          box-shadow: 0 2px 8px rgba(139, 92, 246, 0.2) !important;
        }

        .nav-btn-ghost {
          color: var(--text-secondary) !important;
        }
        .nav-btn-ghost:hover {
          background: var(--bg-hover) !important;
          color: var(--text-primary) !important;
        }

        .navbar-date {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-secondary);
          background: var(--bg-hover);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          white-space: nowrap;
          user-select: none;
        }
        .navbar-date svg {
          color: var(--accent-primary);
          flex-shrink: 0;
        }

        .navbar-breadcrumb {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .breadcrumb-title {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--text-primary);
        }
        .breadcrumb-sub {
          font-size: 0.8rem;
          color: var(--text-muted);
          background: var(--bg-hover);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          border: 1px solid var(--border-subtle);
        }

        .navbar-stats {
          display: flex;
          align-items: center;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-full);
          padding: 4px 12px;
          box-shadow: var(--shadow-sm);
        }

        .stat-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          transition: all var(--transition-fast);
          border-radius: var(--radius-sm);
        }
        .stat-chip:hover {
          background: var(--bg-hover);
        }

        .stat-divider {
          width: 1px;
          height: 14px;
          background: var(--border-default);
          margin: 0 4px;
        }


        .spinning {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </header>
  )
}
