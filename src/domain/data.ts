import type { Place, RouteCache, Stop, TripDay } from './types'

export function createStop(placeId: string, stay = 60): Stop {
  return {
    uid: `s${Math.random().toString(36).slice(2, 9)}`,
    placeId,
    stay,
    pinned: null,
    transportMode: 'driving',
  }
}

export const basePlaces: Record<string, Place> = {
  cq: { id: 'cq', name: '重庆', type: '出发地', category: 'transport', priority: 'must', lng: 106.551556, lat: 29.563009, crs: 'GCJ02' },
  cd: { id: 'cd', name: '成都酒店', type: '住宿', category: 'lodging', priority: 'must', lng: 104.066541, lat: 30.572269, crs: 'GCJ02' },
  sig: { id: 'sig', name: '四姑娘山镇', type: '午餐 / 中转', category: 'food', priority: 'must', lng: 102.8398, lat: 31.0012, crs: 'GCJ02' },
  shuang: { id: 'shuang', name: '双桥沟', type: '自然景区', category: 'attraction', priority: 'must', lng: 102.8465, lat: 31.089, crs: 'GCJ02' },
  hotel: { id: 'hotel', name: '四姑娘山酒店', type: '住宿', category: 'lodging', priority: 'must', lng: 102.842, lat: 31.008, crs: 'GCJ02' },
  maobi: { id: 'maobi', name: '猫鼻梁', type: '观景点', category: 'viewpoint', priority: 'normal', lng: 102.832, lat: 31.0105, crs: 'GCJ02' },
  danba: { id: 'danba', name: '丹巴藏寨', type: '古镇', category: 'culture', priority: 'backup', lng: 101.8904, lat: 30.8786, crs: 'GCJ02' },
  xindu: { id: 'xindu', name: '新都桥', type: '摄影地', category: 'viewpoint', priority: 'normal', lng: 101.495, lat: 30.041, crs: 'GCJ02' },
  moxi: { id: 'moxi', name: '墨石公园', type: '自然景区', category: 'attraction', priority: 'normal', lng: 101.505, lat: 30.47, crs: 'GCJ02' },
  tagong: { id: 'tagong', name: '塔公草原', type: '草原', category: 'nature', priority: 'normal', lng: 101.536, lat: 30.322, crs: 'GCJ02' },
  yuzu: { id: 'yuzu', name: '鱼子西', type: '观景点', category: 'viewpoint', priority: 'backup', lng: 101.39, lat: 30.18, crs: 'GCJ02' },
}

export const seededRoutes: RouteCache = {
  'cq-cd': [300, 210], 'cd-cq': [300, 210], 'cd-sig': [220, 250], 'sig-cd': [220, 250],
  'sig-shuang': [18, 30], 'shuang-sig': [18, 30], 'shuang-hotel': [12, 20], 'hotel-shuang': [12, 20],
  'sig-hotel': [9, 15], 'hotel-sig': [9, 15], 'shuang-danba': [160, 225], 'danba-shuang': [160, 225],
  'danba-hotel': [145, 200], 'hotel-danba': [145, 200], 'danba-xindu': [150, 190], 'xindu-danba': [150, 190],
  'hotel-maobi': [15, 25], 'maobi-hotel': [15, 25], 'shuang-maobi': [10, 18], 'maobi-shuang': [10, 18],
  'danba-moxi': [115, 145], 'moxi-danba': [115, 145], 'moxi-tagong': [28, 38], 'tagong-moxi': [28, 38],
  'tagong-xindu': [40, 55], 'xindu-tagong': [40, 55],
}

export function createBaseDays(): TripDay[] {
  return [
    { id: 'd1', label: 'Day 1', date: '10/02', start: 480, end: 1200, maxDrive: 360, stops: [createStop('cq', 0), createStop('cd', 0)] },
    { id: 'd2', label: 'Day 2', date: '10/03', start: 480, end: 1140, maxDrive: 390, stops: [createStop('sig', 80), createStop('shuang', 180), createStop('hotel', 0)] },
    { id: 'd3', label: 'Day 3', date: '10/04', start: 510, end: 1140, maxDrive: 360, stops: [createStop('danba', 120)] },
    { id: 'd4', label: 'Day 4', date: '10/05', start: 510, end: 1140, maxDrive: 360, stops: [] },
    { id: 'd5', label: 'Day 5', date: '10/06', start: 510, end: 1140, maxDrive: 360, stops: [] },
    { id: 'd6', label: 'Day 6', date: '10/07', start: 510, end: 1140, maxDrive: 360, stops: [] },
  ]
}
