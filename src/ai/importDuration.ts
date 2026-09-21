const chineseDigits: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

function parseChineseDays(value: string): number | null {
  if (value === '十') return 10
  const [left, right] = value.split('十')
  if (right !== undefined) {
    const tens = left ? chineseDigits[left] : 1
    const ones = right ? chineseDigits[right] : 0
    return tens && ones !== undefined ? tens * 10 + ones : null
  }
  return chineseDigits[value] ?? null
}

export function durationDaysFromText(value: string): number | null {
  const arabic = value.match(/(?:^|[^第\d])(\d{1,3})\s*天(?:\s*\d{1,3}\s*晚)?/)
  if (arabic) return Math.max(1, Number(arabic[1]))
  const chinese = value.match(/(?:^|[^第])([一二两三四五六七八九十]{1,3})\s*天(?:\s*[一二两三四五六七八九十]{1,3}\s*晚)?/)
  return chinese ? parseChineseDays(chinese[1]) : null
}

export function normalizeImportDurationDays(durationDays: number | null | undefined, detailedDayCount: number, textHint = ''): number {
  const declared = Number(durationDays)
  const detailed = Number(detailedDayCount)
  return Math.max(
    1,
    Number.isFinite(declared) ? Math.round(declared) : 0,
    Number.isFinite(detailed) ? Math.round(detailed) : 0,
    durationDaysFromText(textHint) ?? 0,
  )
}
