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

export const pageTabs = sqliteTable('page_tabs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  pageUid: text('page_uid').notNull(),
  status: text('status').notNull().default('idle'),
  postsPerAccount: integer('posts_per_account').notNull().default(1),
  postDelayMinSeconds: integer('post_delay_min_seconds').notNull().default(180),
  postDelayMaxSeconds: integer('post_delay_max_seconds').notNull().default(300),
  accountDelayMinSeconds: integer('account_delay_min_seconds').notNull().default(600),
  accountDelayMaxSeconds: integer('account_delay_max_seconds').notNull().default(900),
  postSelectionMode: text('post_selection_mode').notNull().default('sequential'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const pageTabAccounts = sqliteTable('page_tab_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageTabId: integer('page_tab_id').notNull(),
  accountId: integer('account_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  enabled: integer('enabled').notNull().default(1),
  postsPerTurn: integer('posts_per_turn')
})

export const pageTabSchedules = sqliteTable('page_tab_schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageTabId: integer('page_tab_id').notNull(),
  dayOfWeek: integer('day_of_week').notNull(),
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  enabled: integer('enabled').notNull().default(1),
  sortOrder: integer('sort_order').notNull()
})

export const groupSets = sqliteTable('group_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageTabId: integer('page_tab_id').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const groupSetItems = sqliteTable('group_set_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupSetId: integer('group_set_id').notNull(),
  groupUid: text('group_uid').notNull(),
  sortOrder: integer('sort_order').notNull()
})

export const contentSets = sqliteTable('content_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageTabId: integer('page_tab_id').notNull().unique(),
  name: text('name').notNull(),
  mode: text('mode').notNull().default('sequential'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const contentItems = sqliteTable('content_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contentSetId: integer('content_set_id').notNull(),
  content: text('content').notNull(),
  sortOrder: integer('sort_order').notNull()
})

export const imageSources = sqliteTable('image_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageTabId: integer('page_tab_id').notNull().unique(),
  folderPath: text('folder_path').notNull().default(''),
  mode: text('mode').notNull().default('sequential'),
  imagesPerPost: integer('images_per_post').notNull().default(1),
  missingPolicy: text('missing_policy').notNull().default('text_only'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const pageTabPosts = sqliteTable('page_tab_posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageTabId: integer('page_tab_id').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled').notNull().default(1),
  variantsJson: text('variants_json').notNull(),
  imageFolderPath: text('image_folder_path').notNull().default(''),
  imageMode: text('image_mode').notNull().default('random'),
  imagesPerPost: integer('images_per_post').notNull().default(1),
  missingPolicy: text('missing_policy').notNull().default('text_only'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageTabId: integer('page_tab_id'),
  status: text('status').notNull().default('created'),
  tabName: text('tab_name').notNull(),
  pageUid: text('page_uid').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  pausedAt: integer('paused_at'),
  completedAt: integer('completed_at'),
  updatedAt: integer('updated_at').notNull()
})

export const runItems = sqliteTable('run_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull(),
  sourceGroupItemId: integer('source_group_item_id'),
  groupUid: text('group_uid').notNull(),
  sortOrder: integer('sort_order').notNull(),
  status: text('status').notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  updatedAt: integer('updated_at').notNull()
})

export const runEvents = sqliteTable('run_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull(),
  eventType: text('event_type').notNull(),
  payloadJson: text('payload_json'),
  createdAt: integer('created_at').notNull()
})

export const executionLogs = sqliteTable('execution_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp').notNull(),
  runId: integer('run_id'),
  runItemId: integer('run_item_id'),
  pageTabId: integer('page_tab_id'),
  accountId: integer('account_id'),
  pageUid: text('page_uid'),
  groupUid: text('group_uid'),
  contentIndex: integer('content_index'),
  imagePathsJson: text('image_paths_json'),
  action: text('action').notNull(),
  result: text('result').notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  screenshotPath: text('screenshot_path'),
  publishedUrl: text('published_url'),
  attemptCount: integer('attempt_count').notNull().default(0),
  retryDisposition: text('retry_disposition').notNull().default('not_applicable')
})
