import { useEffect, useState } from 'react'
import { dayLabel, describe, getForecast, monthDay, today, type DayWeather } from '../weather'

function useForecast(lat: number, lng: number) {
  const [days, setDays] = useState<DayWeather[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    getForecast(lat, lng).then(
      (d) => {
        if (!alive) return
        setDays(d)
        setFailed(false)
      },
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [lat, lng])
  return [days, failed] as const
}

const isNight = (hour: number, d: DayWeather) => hour < parseInt(d.sunrise) || hour > parseInt(d.sunset)

// 一排日期 + 选中那天的逐小时。
// 给了 onPick：点日期就是「选这天去」，再点一下取消；没给：只是切换着看，默认看 date 或今天
export default function Weather({
  lat,
  lng,
  date,
  onPick,
}: {
  lat: number
  lng: number
  date?: string
  onPick?: (date: string | undefined) => void
}) {
  const [days, failed] = useForecast(lat, lng)
  const [own, setOwn] = useState<string>()
  const sel = onPick ? date : (own ?? date ?? today())

  if (failed && !days) return <div className="tip-sub wx-msg">天气加载失败，检查一下网络</div>
  if (!days) return <div className="tip-sub wx-msg">天气加载中…</div>

  const cur = days.find((d) => d.date === sel)
  const t = today()
  const nowHour = new Date().getHours()

  return (
    <div className="weather">
      <div className="wx-days">
        {days.map((d) => (
          <button
            key={d.date}
            className={d.date === sel ? 'on' : ''}
            onClick={() => (onPick ? onPick(d.date === date ? undefined : d.date) : setOwn(d.date))}
          >
            <span className="wx-wd">{dayLabel(d.date)}</span>
            <span className="wx-md">{Number(d.date.slice(5, 7))}/{Number(d.date.slice(8, 10))}</span>
            <span className="wx-ic">{describe(d.code)[0]}</span>
            <span className="wx-t">
              {d.min}~{d.max}°
            </span>
            {d.rain != null && <span className="wx-rain">{d.rain}%</span>}
          </button>
        ))}
      </div>

      {cur ? (
        <>
          <div className="wx-sun">
            {monthDay(cur.date)} {describe(cur.code)[1]} {cur.min}~{cur.max}° · 日出 {cur.sunrise} · 日落 {cur.sunset}
          </div>
          <div className="wx-hours">
            {cur.hours
              .filter((h) => h.hour >= (cur.date === t ? nowHour : 5))
              .map((h) => (
                <div key={h.hour} className="wx-h">
                  <span className="wx-wd">{cur.date === t && h.hour === nowHour ? '现在' : `${h.hour}时`}</span>
                  <span className="wx-ic">{describe(h.code, isNight(h.hour, cur))[0]}</span>
                  <span className="wx-t">{h.temp}°</span>
                  <span className="wx-rain">{h.rain != null ? `${h.rain}%` : ''}</span>
                </div>
              ))}
          </div>
          {days.indexOf(cur) >= 7 && <div className="tip-sub wx-msg">一周以后的预报不太准，临近再看一眼</div>}
        </>
      ) : (
        sel && (
          <div className="tip-sub wx-msg">
            {sel < t ? `${monthDay(sel)}已经过去了` : `${monthDay(sel)}还太远，提前两周内才有预报`}
          </div>
        )
      )}
    </div>
  )
}

// 一行摘要：☀️ 晴 18~24° · 降雨 10% · 日落 17:12
export function WeatherLine({ lat, lng, date }: { lat: number; lng: number; date: string }) {
  const [days] = useForecast(lat, lng)
  const d = days?.find((x) => x.date === date)
  if (!d) return null
  const [ic, text] = describe(d.code)
  return (
    <div className="tip-sub wx-line">
      {ic} {text} {d.min}~{d.max}°{d.rain != null && ` · 降雨 ${d.rain}%`} · 日落 {d.sunset}
    </div>
  )
}
