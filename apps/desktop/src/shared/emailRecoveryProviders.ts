export type RecoveryMailProviderKind = 'standard' | 'temporary'

export interface RecoveryMailProviderDefinition {
  id: string
  label: string
  kind: RecoveryMailProviderKind
  domains: readonly string[]
  note: string
}

export interface RecoveryMailProviderMatch {
  id: string
  label: string
  kind: RecoveryMailProviderKind | 'unknown'
  domain: string | null
}

export const EMAIL_RECOVERY_PROVIDERS: readonly RecoveryMailProviderDefinition[] = [
  {
    id: 'fviainboxes',
    label: 'FviaInboxes',
    kind: 'temporary',
    domains: ['fviainboxes.com', 'fviadropinbox.com', 'fviamail.work', 'dropinboxes.com', 'titanads.email'],
    note: 'Nhóm domain dùng chung hạ tầng FviaInboxes; danh sách có thể mở rộng khi provider đổi domain.'
  },
  {
    id: 'inboxes',
    label: 'Inboxes / GetNada',
    kind: 'temporary',
    domains: [
      'getnada.com', 'getmule.com', 'tupmail.com', 'blondmail.com', 'spicysoda.com', 'replyloop.com',
      'chapsmail.com', 'guysmail.com', 'fivermail.com', 'clowmail.com', 'gimpmail.com', 'dropjar.com',
      'getairmail.com', 'givmail.com', 'inboxbear.com', 'robot-mail.com', 'tafmail.com', 'temptami.com', 'vomoto.com'
    ],
    note: 'Inboxes xoay vòng nhiều domain; getnada.com là domain ổn định hơn, các domain khác có thể thay đổi.'
  },
  {
    id: 'smvmail',
    label: 'SMVMail',
    kind: 'temporary',
    domains: ['smvmail.com'],
    note: 'Hiện chỉ xác nhận chắc domain smvmail.com; giữ provider riêng để bổ sung domain về sau.'
  },
  {
    id: 'microsoft',
    label: 'Microsoft',
    kind: 'standard',
    domains: ['hotmail.com', 'outlook.com', 'live.com', 'msn.com'],
    note: 'Mail Microsoft thông thường.'
  },
  {
    id: 'google',
    label: 'Google',
    kind: 'standard',
    domains: ['gmail.com', 'googlemail.com'],
    note: 'Mail Google thông thường.'
  }
] as const

export function getEmailDomain(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return null
  const at = normalized.lastIndexOf('@')
  if (at < 1 || at === normalized.length - 1) return null
  const domain = normalized.slice(at + 1).replace(/^www\./, '')
  return domain.includes('.') ? domain : null
}

export function detectRecoveryMailProvider(email: string | null | undefined): RecoveryMailProviderMatch {
  const domain = getEmailDomain(email)
  if (!domain) return { id: 'unknown', label: 'Chưa xác định', kind: 'unknown', domain: null }
  const provider = EMAIL_RECOVERY_PROVIDERS.find((item) => item.domains.includes(domain))
  return provider
    ? { id: provider.id, label: provider.label, kind: provider.kind, domain }
    : { id: 'unknown', label: 'Khác / chưa biết', kind: 'unknown', domain }
}
