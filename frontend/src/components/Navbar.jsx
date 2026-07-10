import React from 'react'
import { Settings, Zap, Plus, RefreshCw, FolderOpen, Workflow, Clock, CalendarCheck, Sun, Moon, User, UserCog } from 'lucide-react'
import { Button, Tooltip, Dropdown } from 'antd'
import useStore from '../store/useStore'

export default function Navbar({
  title,
  subtitle,
  onLogoClick,
  stats,
  loading,
  onRefresh,
  onCreateProject,
  isDashboard,
  onSwitchUser,
}) {
  const theme = useStore((state) => state.theme)
  const setTheme = useStore((state) => state.setTheme)
  const currentUser = useStore((state) => state.currentUser)

  const settingsItems = [
    // User section
    {
      key: 'current-user',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent-primary), #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0,
          }}>
            {currentUser?.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.2 }}>
              {currentUser?.name || 'Chưa chọn'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Người dùng hiện tại</div>
          </div>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'switch-user',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserCog size={14} />
          Chuyển người dùng
        </span>
      ),
      onClick: onSwitchUser,
    },
    { type: 'divider' },
    {
      key: 'theme',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          {theme === 'light' ? 'Giao diện Tối' : 'Giao diện Sáng'}
        </span>
      ),
      onClick: () => setTheme(theme === 'light' ? 'dark' : 'light'),
    },
  ]

  return (
    <header className="navbar">
      {/* LEFT: Logo + action buttons / breadcrumb */}
      <div className="navbar-left">
        <div
          className="navbar-brand"
          onClick={onLogoClick}
          style={{ cursor: onLogoClick ? 'pointer' : 'default' }}
        >
          <div className="brand-icon">
            <Zap size={18} strokeWidth={2.5} />
          </div>
          <span className="brand-name">
            PyFlow <span>Studio</span>
          </span>
        </div>

        {/* Dashboard action buttons right next to logo */}
        {isDashboard && (
          <>
            <div className="navbar-sep" />
            <div className="navbar-actions">
              <Button
                size="small"
                type="primary"
                onClick={onCreateProject}
                icon={<Plus size={14} />}
                className="nav-btn"
              >
                Tạo Project
              </Button>
              <Tooltip title="Làm mới danh sách">
                <button
                  onClick={onRefresh}
                  disabled={loading}
                  className="nav-btn-refresh"
                >
                  <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                  Làm mới
                </button>
              </Tooltip>
            </div>
          </>
        )}

        {/* Breadcrumb when inside a project */}
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

      {/* RIGHT: compact stats + settings */}
      <div className="navbar-right">
        {isDashboard && stats && (
          <div className="navbar-stats">
            <Tooltip title="Số dự án">
              <div className="stat-chip">
                <FolderOpen size={13} style={{ color: '#a78bfa' }} />
                <span className="stat-val">{stats.total_projects ?? 0}</span>
                <span className="stat-label">Dự án</span>
              </div>
            </Tooltip>
            <div className="stat-divider" />
            <Tooltip title="Tổng workflows">
              <div className="stat-chip">
                <Workflow size={13} style={{ color: '#2dd4bf' }} />
                <span className="stat-val">{stats.total_workflows ?? 0}</span>
                <span className="stat-label">Workflows</span>
              </div>
            </Tooltip>
            <div className="stat-divider" />
            <Tooltip title="Đang chạy">
              <div className={`stat-chip${stats.running > 0 ? ' stat-running' : ''}`}>
                <Clock size={13} className={stats.running > 0 ? 'spinning' : ''} style={{ color: stats.running > 0 ? '#3b82f6' : '#94a3b8' }} />
                <span className="stat-val" style={{ color: stats.running > 0 ? '#3b82f6' : undefined }}>{stats.running ?? 0}</span>
                <span className="stat-label">Đang chạy</span>
              </div>
            </Tooltip>
            <div className="stat-divider" />
            <Tooltip title="Lịch hẹn hôm nay (đã chạy / tổng)">
              <div className="stat-chip">
                <CalendarCheck size={13} style={{ color: '#f59e0b' }} />
                <span className="stat-val">
                  {stats.today_executed ?? 0}/{stats.today_total ?? 0}
                </span>
                <span className="stat-label">Lịch hôm nay</span>
              </div>
            </Tooltip>
            <div className="navbar-sep" style={{ margin: '0 6px' }} />
          </div>
        )}

        <Dropdown menu={{ items: settingsItems }} placement="bottomRight" trigger={['click']}>
          <Tooltip title="Cài đặt">
            <Button type="text" size="small" icon={<Settings size={15} />} />
          </Tooltip>
        </Dropdown>
      </div>

      <style>{`
        .navbar {
          height: var(--navbar-height);
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-default);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          flex-shrink: 0;
          position: relative;
          z-index: 100;
          gap: 12px;
        }

        .navbar-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .navbar-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .brand-icon {
          width: 30px;
          height: 30px;
          background: linear-gradient(135deg, var(--accent-primary), #8b5cf6);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: var(--shadow-accent);
          flex-shrink: 0;
        }

        .brand-name {
          font-size: 1rem;
          font-weight: 800;
          color: var(--text-primary);
          letter-spacing: -0.02em;
          white-space: nowrap;
        }
        .brand-name span { color: var(--accent-primary); }

        .navbar-sep {
          width: 1px;
          height: 18px;
          background: var(--border-default);
          flex-shrink: 0;
        }

        .navbar-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        /* Unified height + vertical centering for primary button */
        .nav-btn {
          height: 28px !important;
          line-height: 28px !important;
          padding: 0 10px !important;
          font-size: 0.82rem !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 5px !important;
        }
        .nav-btn .anticon,
        .nav-btn svg {
          vertical-align: middle !important;
          position: relative;
          top: 0 !important;
        }

        /* Plain button for Làm mới — avoids Ant Design line-height quirks */
        .nav-btn-refresh {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          height: 28px;
          padding: 0 10px;
          font-size: 0.82rem;
          font-family: var(--font-sans);
          color: var(--text-secondary);
          background: transparent;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
          outline: none;
          line-height: 28px;
          vertical-align: middle;
          box-sizing: border-box;
        }
        .nav-btn-refresh svg {
          display: block;
          flex-shrink: 0;
        }
        .nav-btn-refresh:hover:not(:disabled) {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }
        .nav-btn-refresh:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .navbar-breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .breadcrumb-title {
          font-weight: 600;
          font-size: 0.88rem;
          color: var(--text-primary);
          white-space: nowrap;
        }
        .breadcrumb-sub {
          font-size: 0.75rem;
          color: var(--text-muted);
          background: var(--bg-elevated);
          padding: 1px 8px;
          border-radius: var(--radius-full);
          border: 1px solid var(--border-default);
          white-space: nowrap;
        }

        .navbar-right {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* Compact stats */
        .navbar-stats {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .stat-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: var(--radius-md);
          font-size: 0.78rem;
          color: var(--text-secondary);
          cursor: default;
          transition: background 0.15s;
          white-space: nowrap;
          line-height: 1;
        }
        .stat-chip:hover { background: var(--bg-elevated); }
        .stat-chip svg { color: var(--text-muted); flex-shrink: 0; }
        .stat-val {
          font-weight: 700;
          font-size: 0.85rem;
          color: var(--text-primary);
        }
        .stat-label {
          font-size: 0.72rem;
          color: var(--text-muted);
          font-weight: 400;
        }
        .stat-running svg { color: #3b82f6 !important; }
        .stat-running .stat-val { color: #3b82f6 !important; }
        .stat-divider {
          width: 1px;
          height: 14px;
          background: var(--border-default);
          margin: 0 2px;
          flex-shrink: 0;
        }

        .spinning { animation: spin .9s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </header>
  )
}
