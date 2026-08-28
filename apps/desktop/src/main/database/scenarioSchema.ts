import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const scenarios = sqliteTable('scenarios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  randomActionOrder: integer('random_action_order').notNull().default(0),
  runtimeLimitMinutes: integer('runtime_limit_minutes'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const scenarioActions = sqliteTable('scenario_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scenarioId: integer('scenario_id').notNull(),
  actionType: text('action_type').notNull(),
  label: text('label').notNull(),
  category: text('category').notNull().default('other'),
  orderIndex: integer('order_index').notNull(),
  configJson: text('config_json').notNull().default('{}'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})
