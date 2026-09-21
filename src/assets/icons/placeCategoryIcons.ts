import { categoryMeta } from '../../domain/categories'
import type { PlaceCategory } from '../../domain/types'

export const categoryPaths: Record<string, string> = {
  mountain: '<path d="M3 17 9 7l3 5 2-3 7 8H3Z"/><path d="m7.2 10 1.8 2 1.5-1.8"/>',
  food: '<path d="M6 3v7M3.5 3v4.5A2.5 2.5 0 0 0 6 10v11M8.5 3v4.5A2.5 2.5 0 0 1 6 10"/><path d="M15 3v18M15 3c4 2 4 8 0 10"/>',
  bed: '<path d="M3 19v-8h18v8M3 15h18M6 11V7h5a3 3 0 0 1 3 3v1M3 7v12M21 11v8"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4v12H4V7Z"/><circle cx="12" cy="13" r="4"/>',
  temple: '<path d="m4 9 8-5 8 5M6 10h12M7 10v8M12 10v8M17 10v8M4 20h16"/>',
  leaf: '<path d="M20 4C10 4 5 9 5 15c0 3 2 5 5 5 6 0 10-6 10-16Z"/><path d="M4 21c3-7 8-10 13-13"/>',
  car: '<path d="m5 16-1-4 2-5h12l2 5-1 4H5Z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M6 12h12"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
}

export function categoryIconMarkup(category: PlaceCategory, size: 'small' | 'marker' = 'small'): string {
  const meta = categoryMeta[category]
  return `<span class="category-icon ${size}" style="--cat:${meta.color};--soft:${meta.soft}" title="${meta.label}"><svg viewBox="0 0 24 24" aria-hidden="true">${categoryPaths[meta.icon]}</svg></span>`
}
