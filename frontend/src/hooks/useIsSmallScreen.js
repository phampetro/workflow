import { useState, useEffect } from 'react'

// Dùng cho panel 1/3 bên phải: màn hình < breakpoint chuyển sang Drawer trượt
// thay vì hiện inline (không đủ chỗ chia 2/3-1/3).
export default function useIsSmallScreen(breakpoint = 1200) {
  const [isSmallScreen, setIsSmallScreen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  useEffect(() => {
    const handleResize = () => setIsSmallScreen(window.innerWidth < breakpoint)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isSmallScreen
}
