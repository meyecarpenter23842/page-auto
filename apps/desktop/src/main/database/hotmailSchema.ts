import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const accountEmailState = sqliteTable('account_email_state', {
  accountId: integer('account_id').primaryKey(),
  provider: text('provider').notNull().default('microsoft'),
  oauthStatus: text('oauth_status').notNull().default('missing'),
  refreshTokenSecret: text('refresh_token_secret'),
  mailStatus: text('mail_status').notNull().default('unknown'),
  lastCheckAt: integer('last_check_at'),
  lastCode: text('last_code'),
  lastCodeAt: integer('last_code_at'),
  lastError: text('last_error'),
  updatedAt: integer('updated_at').notNull()
})

export const emailSettings = sqliteTable('email_settings', {
  id: integer('id').primaryKey(),
  profileRoot: text('profile_root'),
  browserExecutablePath: text('browser_executable_path'),
  oauthClientId: text('oauth_client_id'),
  oauthTenant: text('oauth_tenant').notNull().default('consumers'),
  proxyMode: text('proxy_mode').notNull().default('direct'),
  proxyListJson: text('proxy_list_json').notNull().default('[]'),
  currentProxy: text('current_proxy'),
  updatedAt: integer('updated_at').notNull()
})
