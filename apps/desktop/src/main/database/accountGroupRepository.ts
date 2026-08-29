import type Database from 'better-sqlite3'
import type {
  AccountGroupOverview,
  AccountGroupRecord,
  AssignAccountsToGroupInput,
  CreateAccountGroupInput,
  RenameAccountGroupInput
} from '../../shared/accountGroups'

interface AccountGroupRow {
  id: number
  name: string
  accountCount: number
  createdAt: number
  updatedAt: number
}

function normalizeName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên nhóm là bắt buộc.')
  if (name.length > 120) throw new Error('Tên nhóm tối đa 120 ký tự.')
  return name
}

function normalizeAccountIds(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))]
}

export class AccountGroupRepository {
  constructor(private readonly client: Database.Database) {}

  private syncLegacyCategories(): void {
    const names = this.client.prepare(`
      SELECT DISTINCT TRIM(category) AS name
      FROM accounts
      WHERE TRIM(COALESCE(category, '')) <> ''
      ORDER BY name COLLATE NOCASE
    `).all() as Array<{ name: string }>
    if (names.length === 0) return

    const now = Date.now()
    const find = this.client.prepare('SELECT id FROM account_groups WHERE name = ? COLLATE NOCASE')
    const insert = this.client.prepare(`
      INSERT INTO account_groups (name, created_at, updated_at)
      VALUES (?, ?, ?)
    `)

    const sync = this.client.transaction(() => {
      for (const row of names) {
        if (!find.get(row.name)) insert.run(row.name, now, now)
      }
      this.client.exec(`
        UPDATE accounts
        SET category = (
          SELECT g.name
          FROM account_groups g
          WHERE g.name = TRIM(accounts.category) COLLATE NOCASE
          LIMIT 1
        )
        WHERE TRIM(COALESCE(category, '')) <> ''
          AND category <> (
            SELECT g.name
            FROM account_groups g
            WHERE g.name = TRIM(accounts.category) COLLATE NOCASE
            LIMIT 1
          );
      `)
    })
    sync()
  }

  private getRow(id: number): AccountGroupRow | null {
    const row = this.client.prepare(`
      SELECT
        g.id,
        g.name,
        COUNT(a.id) AS accountCount,
        g.created_at AS createdAt,
        g.updated_at AS updatedAt
      FROM account_groups g
      LEFT JOIN accounts a ON TRIM(COALESCE(a.category, '')) = g.name COLLATE NOCASE
      WHERE g.id = ?
      GROUP BY g.id
    `).get(id) as AccountGroupRow | undefined
    return row ?? null
  }

  overview(): AccountGroupOverview {
    this.syncLegacyCategories()
    const groups = this.client.prepare(`
      SELECT
        g.id,
        g.name,
        COUNT(a.id) AS accountCount,
        g.created_at AS createdAt,
        g.updated_at AS updatedAt
      FROM account_groups g
      LEFT JOIN accounts a ON TRIM(COALESCE(a.category, '')) = g.name COLLATE NOCASE
      GROUP BY g.id
      ORDER BY g.name COLLATE NOCASE, g.id
    `).all() as AccountGroupRow[]
    const stats = this.client.prepare(`
      SELECT
        COUNT(*) AS totalAccounts,
        SUM(CASE WHEN TRIM(COALESCE(category, '')) = '' THEN 1 ELSE 0 END) AS ungroupedCount
      FROM accounts
    `).get() as { totalAccounts: number; ungroupedCount: number | null }

    return {
      groups: groups.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        accountCount: Number(row.accountCount),
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt)
      })),
      totalAccounts: Number(stats.totalAccounts),
      ungroupedCount: Number(stats.ungroupedCount ?? 0)
    }
  }

  create(input: CreateAccountGroupInput): AccountGroupRecord {
    this.syncLegacyCategories()
    const name = normalizeName(input.name)
    const existing = this.client.prepare('SELECT id FROM account_groups WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined
    if (existing) throw new Error(`Nhóm “${name}” đã tồn tại.`)

    const now = Date.now()
    const result = this.client.prepare(`
      INSERT INTO account_groups (name, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(name, now, now)
    const created = this.getRow(Number(result.lastInsertRowid))
    if (!created) throw new Error('Không thể đọc lại nhóm vừa tạo.')
    return created
  }

  rename(input: RenameAccountGroupInput): AccountGroupRecord {
    const name = normalizeName(input.name)
    const rename = this.client.transaction(() => {
      const current = this.getRow(input.id)
      if (!current) throw new Error('Không tìm thấy nhóm tài khoản.')
      const conflict = this.client.prepare(`
        SELECT id FROM account_groups
        WHERE name = ? COLLATE NOCASE AND id <> ?
      `).get(name, input.id) as { id: number } | undefined
      if (conflict) throw new Error(`Nhóm “${name}” đã tồn tại.`)

      const now = Date.now()
      this.client.prepare('UPDATE account_groups SET name = ?, updated_at = ? WHERE id = ?').run(name, now, input.id)
      this.client.prepare(`
        UPDATE accounts
        SET category = ?, updated_at = ?
        WHERE TRIM(COALESCE(category, '')) = ? COLLATE NOCASE
      `).run(name, now, current.name)

      const updated = this.getRow(input.id)
      if (!updated) throw new Error('Không thể đọc lại nhóm vừa đổi tên.')
      return updated
    })
    return rename()
  }

  delete(id: number): boolean {
    const remove = this.client.transaction(() => {
      const current = this.getRow(id)
      if (!current) return false
      const now = Date.now()
      this.client.prepare(`
        UPDATE accounts
        SET category = NULL, updated_at = ?
        WHERE TRIM(COALESCE(category, '')) = ? COLLATE NOCASE
      `).run(now, current.name)
      return this.client.prepare('DELETE FROM account_groups WHERE id = ?').run(id).changes > 0
    })
    return remove()
  }

  assign(input: AssignAccountsToGroupInput): number {
    const accountIds = normalizeAccountIds(input.accountIds)
    if (accountIds.length === 0) return 0

    const group = input.groupId === null ? null : this.getRow(input.groupId)
    if (input.groupId !== null && !group) throw new Error('Nhóm được chọn không còn tồn tại.')

    const placeholders = accountIds.map(() => '?').join(', ')
    return this.client.prepare(`
      UPDATE accounts
      SET category = ?, updated_at = ?
      WHERE id IN (${placeholders})
    `).run(group?.name ?? null, Date.now(), ...accountIds).changes
  }
}
