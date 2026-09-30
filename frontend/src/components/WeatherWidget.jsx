import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Tooltip } from 'antd'
import {
  RefreshCw, MapPin, MapPinOff,
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudRainWind, CloudSnow, CloudLightning,
  Droplets, Wind, Thermometer,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './WeatherWidget.css'

// Widget thời tiết realtime cho SidePanel (Dashboard + ProjectDetail dùng chung).
// Lấy toạ độ qua navigator.geolocation của trình duyệt, gọi thẳng Open-Meteo
// (miễn phí, KHÔNG cần API key — quan trọng vì app đóng gói giao cho nhiều khách
// hàng, không thể nhúng 1 key chung vào bản build). Tên địa danh (tuỳ chọn, không
// chặn hiển thị nếu lỗi) lấy qua BigDataCloud reverse-geocode-client, cũng miễn
// phí không cần key, thiết kế riêng cho gọi trực tiếp từ trình duyệt.
const GEO_CACHE_KEY = 'pyflow_weather_geo_v1'
const WEATHER_CACHE_KEY = 'pyflow_weather_data_v1'
const GEO_TTL_MS = 6 * 60 * 60 * 1000 // vị trí máy bàn hầu như không đổi trong 6 tiếng
const WEATHER_TTL_MS = 15 * 60 * 1000 // dùng lại cache nếu mở/đóng panel trong 15 phút
const REFRESH_INTERVAL_MS = 15 * 60 * 1000 // thời tiết không đổi nhanh, 15 phút/lần là đủ mượt

// Mã thời tiết chuẩn WMO (Open-Meteo trả trong current.weather_code) -> icon +
// key mô tả (dịch qua i18n) + nhóm hiệu ứng hoạt hình (`fx`, xem WeatherWidget.css):
// sun (nắng), partly (nắng có mây), cloud (nhiều mây/sương mù), rain (mưa),
// snow (tuyết), storm (giông bão — mưa + chớp).
const WEATHER_CODE_MAP = {
  0: { icon: Sun, key: 'weatherConditionClear', fx: 'sun' },
  1: { icon: CloudSun, key: 'weatherConditionMainlyClear', fx: 'partly' },
  2: { icon: CloudSun, key: 'weatherConditionPartlyCloudy', fx: 'partly' },
  3: { icon: Cloud, key: 'weatherConditionOvercast', fx: 'cloud' },
  45: { icon: CloudFog, key: 'weatherConditionFog', fx: 'cloud' },
  48: { icon: CloudFog, key: 'weatherConditionFog', fx: 'cloud' },
  51: { icon: CloudDrizzle, key: 'weatherConditionDrizzle', fx: 'rain' },
  53: { icon: CloudDrizzle, key: 'weatherConditionDrizzle', fx: 'rain' },
  55: { icon: CloudDrizzle, key: 'weatherConditionDrizzle', fx: 'rain' },
  56: { icon: CloudDrizzle, key: 'weatherConditionDrizzle', fx: 'rain' },
  57: { icon: CloudDrizzle, key: 'weatherConditionDrizzle', fx: 'rain' },
  61: { icon: CloudRain, key: 'weatherConditionRain', fx: 'rain' },
  63: { icon: CloudRain, key: 'weatherConditionRain', fx: 'rain' },
  65: { icon: CloudRainWind, key: 'weatherConditionHeavyRain', fx: 'rain' },
  66: { icon: CloudRain, key: 'weatherConditionRain', fx: 'rain' },
  67: { icon: CloudRainWind, key: 'weatherConditionHeavyRain', fx: 'rain' },
  71: { icon: CloudSnow, key: 'weatherConditionSnow', fx: 'snow' },
  73: { icon: CloudSnow, key: 'weatherConditionSnow', fx: 'snow' },
  75: { icon: CloudSnow, key: 'weatherConditionHeavySnow', fx: 'snow' },
  77: { icon: CloudSnow, key: 'weatherConditionSnow', fx: 'snow' },
  80: { icon: CloudRain, key: 'weatherConditionRainShowers', fx: 'rain' },
  81: { icon: CloudRain, key: 'weatherConditionRainShowers', fx: 'rain' },
  82: { icon: CloudRainWind, key: 'weatherConditionHeavyRainShowers', fx: 'rain' },
  85: { icon: CloudSnow, key: 'weatherConditionSnowShowers', fx: 'snow' },
  86: { icon: CloudSnow, key: 'weatherConditionSnowShowers', fx: 'snow' },
  95: { icon: CloudLightning, key: 'weatherConditionThunderstorm', fx: 'storm' },
  96: { icon: CloudLightning, key: 'weatherConditionThunderstorm', fx: 'storm' },
  99: { icon: CloudLightning, key: 'weatherConditionThunderstorm', fx: 'storm' },
}

// Icon thời tiết + hiệu ứng hoạt hình theo nhóm `fx` (mây trôi/mưa rơi/tuyết rơi/nắng toả/chớp)
function WeatherStage({ fx, icon: Icon }) {
  return (
    <div className={`weather-fx-stage weather-fx-${fx}`}>
      {(fx === 'sun' || fx === 'partly') && <span className="weather-fx-sunglow" />}
      {fx === 'cloud' && (
        <>
          <span className="weather-fx-cloud-layer is-back" />
          <span className="weather-fx-cloud-layer is-front" />
        </>
      )}
      {fx === 'partly' && <span className="weather-fx-cloud-layer is-front" />}
      {(fx === 'rain' || fx === 'storm') && (
        <>
          <span className="weather-fx-drop" />
          <span className="weather-fx-drop" />
          <span className="weather-fx-drop" />
          <span className="weather-fx-drop" />
        </>
      )}
      {fx === 'snow' && (
        <>
          <span className="weather-fx-flake" />
          <span className="weather-fx-flake" />
          <span className="weather-fx-flake" />
        </>
      )}
      <Icon
        size={38}
        className={`weather-fx-icon${fx === 'sun' ? ' weather-fx-icon--spin' : ''}${fx === 'storm' ? ' weather-fx-icon--flash' : ''}`}
        style={{ color: 'var(--accent-primary)' }}
      />
    </div>
  )
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage đầy hoặc bị chặn (private mode) — bỏ qua, không ảnh hưởng chức năng chính
  }
}

export default function WeatherWidget({ active }) {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState('loading') // loading | denied | unsupported | error | ready
  const [weather, setWeather] = useState(null)
  const [place, setPlace] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const placeRef = useRef(null)

  const fetchWeather = useCallback(async (lat, lon, showSpinner) => {
    if (showSpinner) setRefreshing(true)
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
      const res = await fetch(url)
      if (!res.ok) throw new Error('weather_fetch_failed')
      const data = await res.json()
      if (!data?.current) throw new Error('weather_bad_response')
      setWeather(data.current)
      setStatus('ready')
      writeCache(WEATHER_CACHE_KEY, { at: Date.now(), current: data.current })
    } catch (err) {
      console.error('[Weather]', err)
      setStatus((prev) => (prev === 'ready' ? 'ready' : 'error'))
    } finally {
      if (showSpinner) setRefreshing(false)
    }
  }, [])

  const fetchPlace = useCallback(async (lat, lon) => {
    if (placeRef.current) return
    try {
      const lang = i18n.language === 'en' ? 'en' : 'vi'
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`)
      if (!res.ok) return
      const data = await res.json()
      const name = data?.city || data?.locality || data?.principalSubdivision || null
      if (name) {
        placeRef.current = name
        setPlace(name)
        const geo = readCache(GEO_CACHE_KEY)
        if (geo) writeCache(GEO_CACHE_KEY, { ...geo, place: name })
      }
    } catch {
      // Không lấy được tên địa danh vẫn hiển thị được nhiệt độ — bỏ qua, không chặn UI
    }
  }, [i18n.language])

  const resolvePosition = useCallback(() => {
    const cachedGeo = readCache(GEO_CACHE_KEY)
    if (cachedGeo && Date.now() - cachedGeo.at < GEO_TTL_MS) {
      if (cachedGeo.place) {
        placeRef.current = cachedGeo.place
        setPlace(cachedGeo.place)
      }
      return Promise.resolve(cachedGeo)
    }
    if (!navigator.geolocation) {
      setStatus('unsupported')
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const geo = { at: Date.now(), lat: pos.coords.latitude, lon: pos.coords.longitude }
          writeCache(GEO_CACHE_KEY, geo)
          resolve(geo)
        },
        (err) => {
          console.warn('[Weather] geolocation error', err)
          setStatus(err.code === 1 ? 'denied' : 'error')
          resolve(null)
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: GEO_TTL_MS }
      )
    })
  }, [])

  const loadAll = useCallback(async (showSpinner) => {
    const geo = await resolvePosition()
    if (!geo) return
    await fetchWeather(geo.lat, geo.lon, showSpinner)
    fetchPlace(geo.lat, geo.lon)
  }, [resolvePosition, fetchWeather, fetchPlace])

  useEffect(() => {
    if (!active) return
    // Hiện cache cũ ngay lập tức (nếu còn hạn) trong lúc chờ dữ liệu mới, tránh nháy trắng mỗi lần mở panel
    const cachedWeather = readCache(WEATHER_CACHE_KEY)
    if (cachedWeather && Date.now() - cachedWeather.at < WEATHER_TTL_MS) {
      setWeather(cachedWeather.current)
      setStatus('ready')
    }
    loadAll(false)
    const timer = setInterval(() => loadAll(false), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const handleRetry = () => {
    setStatus('loading')
    loadAll(true)
  }

  // Kích thước/bố cục đồng bộ với thẻ "Tài nguyên hệ thống" bên dưới: tiêu đề viết
  // hoa + icon nằm ngoài, phía trên thẻ nội dung (padding/border/radius/shadow giống hệt nhau).
  const cardStyle = {
    padding: '0.75rem 0.875rem',
    background: 'var(--bg-surface)',
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    boxShadow: 'var(--shadow-sm)',
  }

  let body
  if (status === 'loading') {
    body = (
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
        <RefreshCw size={18} className="spinning" style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontSize: '0.8125rem' }}>{t('projectDetail.weatherLocating')}</span>
      </div>
    )
  } else if (status === 'denied' || status === 'unsupported' || status === 'error') {
    const message = status === 'denied' ? t('projectDetail.weatherDenied')
      : status === 'unsupported' ? t('projectDetail.weatherUnsupported')
        : t('projectDetail.weatherLoadError')
    body = (
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.625rem', textAlign: 'center' }}>
        <MapPinOff size={20} style={{ color: 'var(--text-muted)' }} />
        <div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{message}</div>
          {status === 'denied' && (
            <div style={{ fontSize: '0.7188rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{t('projectDetail.weatherDeniedHint')}</div>
          )}
        </div>
        <Button size="small" icon={<RefreshCw size={12} />} onClick={handleRetry}>
          {status === 'denied' ? t('projectDetail.weatherAllowLocation') : t('projectDetail.weatherRetry')}
        </Button>
      </div>
    )
  } else if (weather) {
    const code = weather.weather_code
    const condition = WEATHER_CODE_MAP[code] || { icon: Cloud, key: 'weatherConditionOvercast', fx: 'cloud' }
    const ConditionIcon = condition.icon
    const updatedAt = new Date().toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'vi-VN', { hour: '2-digit', minute: '2-digit' })

    body = (
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'stretch', gap: '0.75rem' }}>
        {/* Cột trái: vị trí + icon động + nhiệt độ */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0, color: 'var(--text-secondary)' }}>
            <MapPin size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.7188rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {place || t('projectDetail.weatherYourLocation')}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <WeatherStage fx={condition.fx} icon={ConditionIcon} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                {Math.round(weather.temperature_2m)}°C
              </div>
              <div style={{ fontSize: '0.7188rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t(`projectDetail.${condition.key}`)}
              </div>
            </div>
          </div>
        </div>

        {/* Vạch ngăn cách giữa 2 cột */}
        <div style={{ width: 1, background: 'var(--border-default)', alignSelf: 'stretch', margin: '2px 0' }} />

        {/* Cột phải: cảm giác như / độ ẩm / gió + giờ cập nhật */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7188rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-muted)' }}>
              <Thermometer size={12} /> {t('projectDetail.weatherFeelsLike')}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{Math.round(weather.apparent_temperature)}°C</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7188rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-muted)' }}>
              <Droplets size={12} /> {t('projectDetail.weatherHumidity')}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{weather.relative_humidity_2m}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7188rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-muted)' }}>
              <Wind size={12} /> {t('projectDetail.weatherWind')}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{Math.round(weather.wind_speed_10m)} km/h</span>
          </div>

          {/* Tiêu thụ giờ cập nhật, cùng vị trí với dòng "PyFlow" của thẻ tài nguyên */}
          <div style={{
            marginTop: '0.125rem',
            paddingTop: '0.25rem',
            borderTop: '1px dashed var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.6875rem',
            color: 'var(--text-muted)'
          }}>
            <span>{t('projectDetail.weatherUpdatedAt')}</span>
            <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{updatedAt}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Tiêu đề — cùng kiểu (icon nhỏ + chữ hoa + nút làm mới) với "Tài nguyên hệ thống" bên dưới */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', padding: '0 0.125rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <CloudSun size="0.8125rem" style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            {t('projectDetail.weatherTitle')}
          </span>
        </div>
        <Tooltip title={t('projectDetail.weatherRefresh')}>
          <Button
            type="text"
            size="small"
            aria-label={t('projectDetail.weatherRefresh')}
            icon={<RefreshCw size="0.75rem" className={refreshing || status === 'loading' ? 'spinning' : ''} />}
            onClick={handleRetry}
            disabled={refreshing || status === 'loading'}
            style={{ color: 'var(--text-muted)', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          />
        </Tooltip>
      </div>

      {body}
    </div>
  )
}
