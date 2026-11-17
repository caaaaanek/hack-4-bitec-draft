/** Ініціали ролі для аватара: перші літери перших двох слів (або дві літери одного слова). */
export function roleInitials(label: string): string {
  const w = label.split(/[\s(]+/).filter(Boolean)
  const t = w.length > 1 ? w[0]![0]! + w[1]![0]! : label.slice(0, 2)
  return t.toUpperCase()
}
