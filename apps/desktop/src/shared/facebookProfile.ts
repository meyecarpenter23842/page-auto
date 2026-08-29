export const FACEBOOK_PROFILE_STORAGE_MODES = ['managed', 'external'] as const
export type FacebookProfileStorageMode = (typeof FACEBOOK_PROFILE_STORAGE_MODES)[number]

export const FACEBOOK_PROFILE_ERROR_CODES = [
  'external_root_not_configured',
  'external_root_invalid',
  'external_profile_missing',
  'external_profile_invalid',
  'account_uid_invalid',
  'managed_profile_create_failed'
] as const
export type FacebookProfileErrorCode = (typeof FACEBOOK_PROFILE_ERROR_CODES)[number]
