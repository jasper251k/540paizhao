/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    AMap: any
    _AMapSecurityConfig: { securityJsCode: string }
  }
}

export type AMapNS = any

export const SHANGHAI: [number, number] = [121.4737, 31.2304]

let loading: Promise<AMapNS> | null = null

export function loadAMap(key: string, securityJsCode: string): Promise<AMapNS> {
  if (loading) return loading
  window._AMapSecurityConfig = { securityJsCode }
  const plugins = ['AMap.AutoComplete', 'AMap.Geocoder', 'AMap.Scale', 'AMap.Transfer', 'AMap.Walking', 'AMap.Riding'].join(',')
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=${plugins}`
    s.onload = () => resolve(window.AMap)
    s.onerror = () => {
      loading = null
      reject(new Error('高德地图加载失败，请检查网络'))
    }
    document.head.appendChild(s)
  })
  return loading
}

export function useAMap({ amapKey, amapSecurityCode }: { amapKey: string; amapSecurityCode: string }) {
  const [AMap, setAMap] = useState<AMapNS>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    loadAMap(amapKey, amapSecurityCode).then(setAMap, (e) => setError(e.message))
  }, [amapKey, amapSecurityCode])
  return [AMap, error] as const
}
