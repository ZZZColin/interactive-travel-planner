import { describe, expect, it } from 'vitest'
import { decodeRoutePath, encodeRoutePath } from '../polyline'

describe('route polyline persistence', () => {
  it('round-trips new route coordinates at six-decimal precision', () => {
    const path: Array<[number, number]> = [[104.0665414, 30.5722694], [103.4567894, 30.9876544], [102.8398004, 31.0012004]]
    const encoded = encodeRoutePath(path)
    expect(encoded.startsWith('v2:')).toBe(true)
    expect(encoded.length).toBeLessThan(JSON.stringify(path).length)
    expect(decodeRoutePath(encoded)).toEqual([[104.066541, 30.572269], [103.456789, 30.987654], [102.8398, 31.0012]])
  })

  it('continues to decode legacy five-decimal route snapshots', () => {
    expect(decodeRoutePath('ucryD{ndzRccpA|avBusAdowB')).toEqual([[104.06654, 30.57227], [103.45679, 30.98765], [102.8398, 31.0012]])
  })
})
