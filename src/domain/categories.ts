import type { PlaceCategory } from './types'

export interface CategoryMeta {
  label: string
  color: string
  soft: string
  icon: string
}

export const categoryMeta: Record<PlaceCategory, CategoryMeta> = {
  attraction: { label: '景点', color: '#536fda', soft: '#edf1ff', icon: 'mountain' },
  food: { label: '美食', color: '#ed7b4a', soft: '#fff1eb', icon: 'food' },
  lodging: { label: '住宿', color: '#8b63d7', soft: '#f2edff', icon: 'bed' },
  viewpoint: { label: '观景', color: '#e5a02f', soft: '#fff6df', icon: 'camera' },
  culture: { label: '人文', color: '#d65e7a', soft: '#fff0f4', icon: 'temple' },
  nature: { label: '自然', color: '#20a578', soft: '#e8f7f1', icon: 'leaf' },
  transport: { label: '交通', color: '#60798b', soft: '#edf2f5', icon: 'car' },
  shopping: { label: '购物', color: '#c568b5', soft: '#faeff8', icon: 'bag' },
  other: { label: '其他', color: '#77849a', soft: '#f0f2f5', icon: 'pin' },
}

export function categoryFromPoi(type = ''): PlaceCategory {
  if (/餐饮|美食|餐厅|咖啡|甜品|小吃/.test(type)) return 'food'
  if (/住宿|酒店|宾馆|民宿/.test(type)) return 'lodging'
  if (/购物|商场|市场|商店/.test(type)) return 'shopping'
  if (/交通|机场|火车|汽车|停车|加油/.test(type)) return 'transport'
  if (/博物馆|纪念馆|寺庙|古镇|历史|文化/.test(type)) return 'culture'
  if (/观景|摄影/.test(type)) return 'viewpoint'
  if (/公园|景区|风景|旅游|名胜/.test(type)) return 'attraction'
  if (/草原|自然|森林|山/.test(type)) return 'nature'
  return 'other'
}
