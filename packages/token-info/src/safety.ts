/**
 * Safety chip (design T5.5). A safety score (0..100, higher = safer) maps to a
 * chip level + user-facing label shown on the token info screen.
 *
 * Thresholds:
 *   - score null/undefined        → 'unknown'  ("No data")
 *   - score >= 70                 → 'safe'     ("Verified")
 *   - score >= 40 and < 70        → 'medium'   ("Check contract")
 *   - score > 0 and < 40          → 'risky'    ("Unverified")
 *   - score <= 0 (incl. negative) → 'risky'    ("Unverified")
 */

export type SafetyLevel = 'safe' | 'medium' | 'risky' | 'unknown'

export function safetyLevel(score: number | null | undefined): SafetyLevel {
  if (score == null) return 'unknown'
  if (score >= 70) return 'safe'
  if (score >= 40) return 'medium'
  return 'risky'
}

const SAFETY_LABELS: Record<SafetyLevel, string> = {
  safe: 'Verified',
  medium: 'Check contract',
  risky: 'Unverified',
  unknown: 'No data',
}

export function safetyChip(score: number | null | undefined): { level: SafetyLevel; label: string } {
  const level = safetyLevel(score)
  return { level, label: SAFETY_LABELS[level] }
}
