// 天气预报：Open-Meteo（免费、不用 Key、允许跨域），按经纬度查未来 16 天，带逐小时
export type HourWeather = { hour: number; temp: number; rain: number | null; code: number }
export type DayWeather = {
  date: string // YYYY-MM-DD
  code: number
  max: number
  min: number
  rain: number | null // 当天最大降雨概率 %
  sunrise: string // HH:MM
  sunset: string
  hours: HourWeather[]
}

type Raw = {
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: (number | null)[]
    sunrise: string[]
    sunset: string[]
  }
  hourly: { weather_code: number[]; temperature_2m: number[]; precipitation_probability: (number | null)[] }
}

const TTL = 30 * 60 * 1000
const cache = new Map<string, { at: number; days: Promise<DayWeather[]> }>()

export function getForecast(lat: number, lng: number): Promise<DayWeather[]> {
  // 精确到 0.1 度（约 10 公里），附近的机位共用一次查询
  const la = lat.toFixed(1)
  const lo = lng.toFixed(1)
  const key = `${la},${lo}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.days
  const days = load(la, lo)
  days.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), days })
  return days
}

async function load(lat: string, lng: string): Promise<DayWeather[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=Asia%2FShanghai&forecast_days=16` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
    '&hourly=weather_code,temperature_2m,precipitation_probability'
  const res = await fetch(url)
  if (!res.ok) throw new Error('天气加载失败')
  const { daily: d, hourly: h } = (await res.json()) as Raw
  // 上海没有夏令时，每天正好 24 个小时
  return d.time.map((date, i) => ({
    date,
    code: d.weather_code[i],
    max: Math.round(d.temperature_2m_max[i]),
    min: Math.round(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max[i],
    sunrise: d.sunrise[i].slice(11, 16),
    sunset: d.sunset[i].slice(11, 16),
    hours: Array.from({ length: 24 }, (_, k) => {
      const j = i * 24 + k
      return { hour: k, temp: Math.round(h.temperature_2m[j]), rain: h.precipitation_probability[j], code: h.weather_code[j] }
    }),
  }))
}

// WMO 天气代码 → 图标、文字
export function describe(code: number, night = false): [string, string] {
  if (code === 0) return [night ? '🌙' : '☀️', '晴']
  if (code === 1) return [night ? '🌙' : '🌤️', '晴间多云']
  if (code === 2) return [night ? '☁️' : '⛅', '多云']
  if (code === 3) return ['☁️', '阴']
  if (code === 45 || code === 48) return ['🌫️', '雾']
  if (code >= 51 && code <= 57) return ['🌦️', '毛毛雨']
  if (code === 61) return ['🌧️', '小雨']
  if (code === 63) return ['🌧️', '中雨']
  if (code === 65) return ['🌧️', '大雨']
  if (code === 66 || code === 67) return ['🌧️', '冻雨']
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['🌨️', '雪']
  if (code >= 80 && code <= 82) return ['🌦️', '阵雨']
  if (code >= 95) return ['⛈️', '雷阵雨']
  return ['☁️', '']
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const today = () => ymd(new Date())

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

// 「今天」「明天」「周三」
export function dayLabel(date: string) {
  const t = today()
  if (date === t) return '今天'
  if (date === addDays(t, 1)) return '明天'
  return '周' + '日一二三四五六'[new Date(`${date}T00:00`).getDay()]
}

export const monthDay = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
