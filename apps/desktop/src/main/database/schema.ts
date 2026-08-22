import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(),
  username: text('username'),
  password: text('password'),
  name: text('name'),
  status: text('status').notNull().default('unknown'),
  category: text('category'),
  friendCount: integer('friend_count'),
  cookie: text('cookie'),
  cookieStatus: text('cookie_status'),
  lastCookieCheck: integer('last_cookie_check'),
  proxy: text('proxy'),
  proxyType: text('proxy_type'),
  proxyHost: text('proxy_host'),
  proxyPort: integer('proxy_port'),
  proxyUsername: text('proxy_username'),
  proxyPassword: text('proxy_password'),
  twoFactorSecret: text('two_factor_secret'),
  email: text('email'),
  emailPassword: text('email_password'),
  backupEmail: text('backup_email'),
  phone: text('phone'),
  userAgent: text('user_agent'),
  createdDate: text('created_date'),
  note: text('note'),
  lastUsedAt: integer('last_used_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const importPresets = sqliteTable('import_presets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  delimiter: text('delimiter').notNull().default('|'),
  mappingJson: text('mapping_json').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const columnLayouts = sqliteTable('column_layouts', {
  viewKey: text('view_key').primaryKey(),
  layoutJson: text('layout_json').notNull(),
  updatedAt: integer('updated_at').notNull()
})
