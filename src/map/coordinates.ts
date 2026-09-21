import { decodeRoutePath, encodeRoutePath } from '../domain/polyline'
import type { CoordinateReferenceSystem, MapScene, Place, RouteOption, SelectedRouteSnapshot, TripDay } from '../domain/types'

export type Coordinate = [number, number]

const PI = 3.1415926535897932384626
const X_PI = PI * 3000.0 / 180.0
const AXIS = 6378245.0
const EE = 0.00669342162296594323

/** Java reference-compatible signature: latitude first, longitude second. */
export function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

/** Coordinate tuple-friendly alias: longitude first, latitude second. */
export function isOutsideMainlandChina(lng: number, lat: number): boolean {
  return outOfChina(lat, lng)
}

function transformLat(x: number, y: number): number {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3
  result += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3
  result += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3
  return result
}

function transformLng(x: number, y: number): number {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  result += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3
  result += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3
  result += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3
  return result
}

function delta(lat: number, lng: number): Coordinate {
  let deltaLat = transformLat(lng - 105, lat - 35)
  let deltaLng = transformLng(lng - 105, lat - 35)
  const radLat = lat / 180 * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  deltaLat = deltaLat * 180 / ((AXIS * (1 - EE)) / (magic * sqrtMagic) * PI)
  deltaLng = deltaLng * 180 / (AXIS / sqrtMagic * Math.cos(radLat) * PI)
  return [deltaLng, deltaLat]
}

/** WGS-84 -> GCJ-02. Tuple order is [longitude, latitude]. */
export function wgs84ToGcj02(coordinate: Coordinate): Coordinate {
  const [lng, lat] = coordinate
  if (outOfChina(lat, lng)) return [lng, lat]
  const [deltaLng, deltaLat] = delta(lat, lng)
  return [lng + deltaLng, lat + deltaLat]
}

/** Fast GCJ-02 -> WGS-84 approximation, matching the supplied Java implementation. */
export function gcj02ToWgs84(coordinate: Coordinate): Coordinate {
  const [lng, lat] = coordinate
  if (outOfChina(lat, lng)) return [lng, lat]
  const [deltaLng, deltaLat] = delta(lat, lng)
  return [lng - deltaLng, lat - deltaLat]
}

/** Exact GCJ-02 -> WGS-84 binary-search inverse used for Cesium rendering. */
export function gcj02ToWgs84Exact(coordinate: Coordinate): Coordinate {
  const [lng, lat] = coordinate
  if (outOfChina(lat, lng)) return [lng, lat]
  const initDelta = 0.01
  const threshold = 0.000001
  let minLat = lat - initDelta
  let minLng = lng - initDelta
  let maxLat = lat + initDelta
  let maxLng = lng + initDelta
  let wgsLat = lat
  let wgsLng = lng
  let index = 0
  do {
    wgsLat = (minLat + maxLat) / 2
    wgsLng = (minLng + maxLng) / 2
    const projected = wgs84ToGcj02([wgsLng, wgsLat])
    const differenceLat = projected[1] - lat
    const differenceLng = projected[0] - lng
    if (Math.abs(differenceLat) < threshold && Math.abs(differenceLng) < threshold) break
    if (differenceLat > 0) maxLat = wgsLat
    else minLat = wgsLat
    if (differenceLng > 0) maxLng = wgsLng
    else minLng = wgsLng
  } while (++index <= 30)
  return [wgsLng, wgsLat]
}

export function bd09ToGcj02(coordinate: Coordinate): Coordinate {
  const x = coordinate[0] - 0.0065
  const y = coordinate[1] - 0.006
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI)
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI)
  return [z * Math.cos(theta), z * Math.sin(theta)]
}

export function gcj02ToBd09(coordinate: Coordinate): Coordinate {
  const [lng, lat] = coordinate
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI)
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI)
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006]
}

export function wgs84ToBd09(coordinate: Coordinate): Coordinate {
  return gcj02ToBd09(wgs84ToGcj02(coordinate))
}

export function bd09ToWgs84(coordinate: Coordinate): Coordinate {
  return gcj02ToWgs84(bd09ToGcj02(coordinate))
}

export function bd09ToWgs84Exact(coordinate: Coordinate): Coordinate {
  return gcj02ToWgs84Exact(bd09ToGcj02(coordinate))
}

export function bd09ToWgs84WithOffset(coordinate: Coordinate, latOffset = -0.000005, lngOffset = -0.000005): Coordinate {
  const [lng, lat] = bd09ToWgs84(coordinate)
  return [lng + lngOffset, lat + latOffset]
}

export function coordinateDistance(first: Coordinate, second: Coordinate): number {
  const earthRadius = 6371000
  const [lngA, latA] = first
  const [lngB, latB] = second
  const x = Math.cos(latA * PI / 180) * Math.cos(latB * PI / 180) * Math.cos((lngA - lngB) * PI / 180)
  const y = Math.sin(latA * PI / 180) * Math.sin(latB * PI / 180)
  const cosine = Math.max(-1, Math.min(1, x + y))
  return Math.acos(cosine) * earthRadius
}

export function convertCoordinate(coordinate: Coordinate, from: CoordinateReferenceSystem, to: CoordinateReferenceSystem): Coordinate {
  if (from === to) return [...coordinate]
  if (from === 'WGS84') return to === 'GCJ02' ? wgs84ToGcj02(coordinate) : wgs84ToBd09(coordinate)
  if (from === 'GCJ02') return to === 'WGS84' ? gcj02ToWgs84Exact(coordinate) : gcj02ToBd09(coordinate)
  const gcj = bd09ToGcj02(coordinate)
  return to === 'GCJ02' ? gcj : gcj02ToWgs84Exact(gcj)
}

export function convertPathCoordinates(path: Coordinate[], from: CoordinateReferenceSystem, to: CoordinateReferenceSystem): Coordinate[] {
  return path.map((coordinate) => convertCoordinate(coordinate, from, to))
}

export function projectPlaceCoordinates(place: Place, target: CoordinateReferenceSystem): Place {
  const [lng, lat] = convertCoordinate([place.lng, place.lat], place.crs, target)
  return { ...place, lng, lat, crs: target }
}

export function projectRouteOptionCoordinates(option: RouteOption, target: CoordinateReferenceSystem): RouteOption {
  const source = option.crs ?? 'GCJ02'
  return { ...option, path: convertPathCoordinates(option.path, source, target), crs: target }
}

function projectSelectedRoute(snapshot: SelectedRouteSnapshot, target: CoordinateReferenceSystem): SelectedRouteSnapshot {
  const source = snapshot.crs ?? 'GCJ02'
  if (source === target) return { ...snapshot }
  const path = convertPathCoordinates(decodeRoutePath(snapshot.encodedPath), source, target)
  return { ...snapshot, encodedPath: encodeRoutePath(path), crs: target }
}

function projectDays(days: TripDay[], target: CoordinateReferenceSystem): TripDay[] {
  return days.map((day) => ({
    ...day,
    stops: day.stops.map((stop) => ({ ...stop, selectedRoute: stop.selectedRoute ? projectSelectedRoute(stop.selectedRoute, target) : undefined })),
  }))
}

/** Creates a renderer-specific scene without mutating persisted business data. */
export function projectMapSceneCoordinates(scene: MapScene, target: CoordinateReferenceSystem): MapScene {
  return {
    ...scene,
    places: scene.places.map((place) => projectPlaceCoordinates(place, target)),
    days: projectDays(scene.days, target),
    routeCache: { ...scene.routeCache },
    routeDayIds: [...scene.routeDayIds],
    routeWarningDayIds: [...scene.routeWarningDayIds],
    conflictPlaceIds: [...scene.conflictPlaceIds],
  }
}

export const CoordinateConverter = {
  outOfChina,
  wgs84ToGcj02,
  gcj02ToWgs84,
  gcj02ToWgs84Exact,
  bd09ToGcj02,
  gcj02ToBd09,
  wgs84ToBd09,
  bd09ToWgs84,
  bd09ToWgs84Exact,
  bd09ToWgs84WithOffset,
  distance: coordinateDistance,
}
