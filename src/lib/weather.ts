import { createLogger } from '@/lib/logger'

const log = createLogger('weather')

export interface WeatherConditions {
  temperatureC:       number
  precipitationMm:    number
  windSpeedKmh:       number
  weatherCode:        number
  isAdverse:          boolean
  description:        string
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Ciel clair',
  1: 'Principalement clair', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine modérée', 55: 'Bruine dense',
  61: 'Pluie légère', 63: 'Pluie modérée', 65: 'Pluie forte',
  71: 'Neige légère', 73: 'Neige modérée', 75: 'Neige dense',
  77: 'Grains de neige', 80: 'Averses légères', 81: 'Averses modérées', 82: 'Averses violentes',
  95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage avec forte grêle',
}

function isAdverseWeather(code: number): boolean {
  return code >= 65 || (code >= 61 && code <= 67) || code >= 71
}

export async function fetchWeatherAt(
  lat:      number,
  lng:      number,
  datetime: Date,
): Promise<WeatherConditions | null> {
  const date    = datetime.toISOString().split('T')[0]
  const hour    = datetime.getUTCHours()
  const url     = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation,windspeed_10m,weathercode&start_date=${date}&end_date=${date}&timezone=UTC`

  try {
    const res  = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) { log.warn('OpenMeteo non-ok', { status: res.status }); return null }

    const data = await res.json() as {
      hourly: {
        time:            string[]
        temperature_2m:  number[]
        precipitation:   number[]
        windspeed_10m:   number[]
        weathercode:     number[]
      }
    }

    const h    = Math.max(0, Math.min(23, hour))
    const code = data.hourly.weathercode[h] ?? 0

    return {
      temperatureC:    data.hourly.temperature_2m[h] ?? 0,
      precipitationMm: data.hourly.precipitation[h] ?? 0,
      windSpeedKmh:    data.hourly.windspeed_10m[h] ?? 0,
      weatherCode:     code,
      isAdverse:       isAdverseWeather(code),
      description:     WMO_DESCRIPTIONS[code] ?? 'Inconnu',
    }
  } catch (err) {
    log.warn('OpenMeteo fetch failed', { err: String(err) })
    return null
  }
}

export async function enrichMetricWithWeather(
  metricId: string,
  lat:      number,
  lng:      number,
  at:       Date,
): Promise<void> {
  const wx = await fetchWeatherAt(lat, lng, at)
  if (!wx) return

  const { default: prisma } = await import('@/lib/db')
  await prisma.interventionMetric.update({
    where: { id: metricId },
    data:  { rejectReason: `weather:${JSON.stringify(wx)}` },
  }).catch(() => {  })
}
