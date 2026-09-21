const HIGH_PRECISION_PREFIX = 'v2:'
const LEGACY_SCALE = 1e5
const HIGH_PRECISION_SCALE = 1e6

function encodeWithScale(path: Array<[number, number]>, scale: number): string {
  let previousLat = 0
  let previousLng = 0
  let output = ''
  const encodeValue = (value: number): string => {
    let current = value < 0 ? ~(value << 1) : value << 1
    let encoded = ''
    while (current >= 0x20) { encoded += String.fromCharCode((0x20 | (current & 0x1f)) + 63); current >>= 5 }
    return encoded + String.fromCharCode(current + 63)
  }
  path.forEach(([lng, lat]) => {
    const nextLat = Math.round(lat * scale)
    const nextLng = Math.round(lng * scale)
    output += encodeValue(nextLat - previousLat)
    output += encodeValue(nextLng - previousLng)
    previousLat = nextLat
    previousLng = nextLng
  })
  return output
}

/** New route snapshots use 1e-6 degree precision; legacy paths remain readable. */
export function encodeRoutePath(path: Array<[number, number]>): string {
  return `${HIGH_PRECISION_PREFIX}${encodeWithScale(path, HIGH_PRECISION_SCALE)}`
}

export function decodeRoutePath(value: string): Array<[number, number]> {
  const highPrecision = value.startsWith(HIGH_PRECISION_PREFIX)
  const encoded = highPrecision ? value.slice(HIGH_PRECISION_PREFIX.length) : value
  const scale = highPrecision ? HIGH_PRECISION_SCALE : LEGACY_SCALE
  const path: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0
  const decodeValue = (): number => {
    let result = 0
    let shift = 0
    let byte = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20 && index <= encoded.length)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    lat += decodeValue()
    lng += decodeValue()
    path.push([lng / scale, lat / scale])
  }
  return path
}
