import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const actionWorkspaces = sqliteTable('action_workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceType: text('workspace_type').notNull(),
  label: text('label').notNull(),
  configJson: text('config_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const actionWorkspaceAccounts = sqliteTable('action_workspace_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id').notNull(),
  accountId: integer('account_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  enabled: integer('enabled').notNull().default(1)
})
