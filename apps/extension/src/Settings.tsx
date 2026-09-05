/**
 * Settings — grouped by risk (design "Settings").
 *
 * "Grouped by risk (Keys, Permissions, Spending, Networks, Feel) — not an
 * iOS Settings dump." Each risk group is a labeled plate with its rows;
 * the group order IS the risk order (keys first, feel last). Initial data
 * is the stub content the App carried, plus the Spending group (exact
 * approvals, the 0.25% wallet fee, send whitelist) that belongs here.
 */

export interface SettingsGroup {
  group: string
  rows: readonly string[]
}

export const DEFAULT_SETTINGS_GROUPS: SettingsGroup[] = [
  {
    group: 'Keys',
    rows: ['Vault · Argon2id + XChaCha20', 'Passkey · not enrolled'],
  },
  {
    group: 'Permissions',
    rows: ['Connected sites · 2'],
  },
  {
    group: 'Spending',
    rows: [
      'Exact approvals · on',
      'Wallet fee · 0.25% on in-wallet swaps',
      'Send whitelist · off',
    ],
  },
  {
    group: 'Networks',
    rows: ['ETN · 52014 (default)', 'Ethereum · 1', 'Base · 8453'],
  },
  {
    group: 'Feel',
    rows: ['Motion · full', 'Sound · off (extension)'],
  },
]

export function SettingsView({ groups = DEFAULT_SETTINGS_GROUPS }: { groups?: SettingsGroup[] }) {
  return (
    <div
      data-testid="settings"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {groups.map((g) => (
        <div
          key={g.group}
          data-testid={`settings-${g.group}`}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div
            style={{
              color: 'var(--bv-mute)',
              fontSize: '11px',
              textTransform: 'none',
              marginBottom: '4px',
            }}
          >
            {g.group}
          </div>
          {g.rows.map((r) => (
            <div
              key={r}
              style={{
                padding: '12px',
                background: 'var(--bv-glass)',
                borderRadius: '8px',
                color: 'var(--bv-ink)',
                fontSize: '13px',
                fontFamily: 'var(--bv-font-sora)',
                marginBottom: '4px',
              }}
            >
              {r}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
