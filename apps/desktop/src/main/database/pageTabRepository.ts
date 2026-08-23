import type Database from 'better-sqlite3'
import {
  CONTENT_MODES,
  DEFAULT_PAGE_TAB_IMAGE,
  DEFAULT_PAGE_TAB_ROTATION,
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  type ContentMode,
  type CreatePageTabInput,
  type ImageMode,
  type MissingImagePolicy,
  type PageTabAccountRef,
  type PageTabConfig,
  type PageTabImageConfig,
  type PageTabSaveInput,
  type PageTabSchedule,
  type PageTabStatus,
  type PageTabSummary
} from '../../shared/pageTabs'

interface PageTabRow {
  id: number
  name: string
  pageUid: string
  status: string
  postsPerAccount: number
  postDelayMinSeconds: number
  postDelayMaxSeconds: number
  accountDelayMinSeconds: number
  accountDelayMaxSeconds: number
  createdAt: number
  updatedAt: number
}

interface SourceRow {
  id: number
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} là bắt buộc.`)
  }
  return normalized
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} phải là số nguyên không âm.`)
  }
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} phải lớn hơn 0.`)
  }
  return value
}

function normalizeGroupUids(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function normalizeContents(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function normalizeConfig(input: PageTabSaveInput): PageTabSaveInput {
  const name = requiredText(input.name, 'Tên tab')
  const pageUid = requiredText(input.pageUid, 'Page UID')
  const postsPerAccount = positiveInteger(input.rotation.postsPerAccount, 'Số bài/account')
  const postDelayMinSeconds = nonNegativeInteger(input.rotation.postDelayMinSeconds, 'Delay bài tối thiểu')
  const postDelayMaxSeconds = nonNegativeInteger(input.rotation.postDelayMaxSeconds, 'Delay bài tối đa')
  const accountDelayMinSeconds = nonNegativeInteger(input.rotation.accountDelayMinSeconds, 'Delay account tối thiểu')
  const accountDelayMaxSeconds = nonNegativeInteger(input.rotation.accountDelayMaxSeconds, 'Delay account tối đa')

  if (postDelayMinSeconds > postDelayMaxSeconds) {
    throw new Error('Delay bài tối thiểu không được lớn hơn tối đa.')
  }
  if (accountDelayMinSeconds > accountDelayMaxSeconds) {
    throw new Error('Delay account tối thiểu không được lớn hơn tối đa.')
  }

  const seenAccountIds = new Set<number>()
  const accounts = input.accounts.map((item, index) => {
    positiveInteger(item.accountId, 'Account ID')
    if (seenAccountIds.has(item.accountId)) {
      throw new Error(`Account #${item.accountId} bị trùng trong Page Tab.`)
    }
    seenAccountIds.add(item.accountId)
    return {
      accountId: item.accountId,
      enabled: item.enabled,
      sortOrder: index,
      postsPerTurn: item.postsPerTurn === null ? null : positiveInteger(item.postsPerTurn, 'Số bài riêng/account')
    }
  })

  const schedules = input.schedules.map((item, index) => {
    if (item.enabled) {
      if (!Number.isInteger(item.dayOfWeek) || item.dayOfWeek < 0 || item.dayOfWeek > 6) {
        throw new Error('Ngày chạy không hợp lệ.')
      }
      if (!Number.isInteger(item.startMinute) || item.startMinute < 0 || item.startMinute >= 1440) {
        throw new Error('Giờ bắt đầu không hợp lệ.')
      }
      if (!Number.isInteger(item.endMinute) || item.endMinute <= 0 || item.endMinute > 1440) {
        throw new Error('Giờ kết thúc không hợp lệ.')
      }
      if (item.startMinute >= item.endMinute) {
        throw new Error('Khung giờ phải có giờ kết thúc sau giờ bắt đầu.')
      }
    }
    return {
      dayOfWeek: item.dayOfWeek,
      startMinute: item.startMinute,
      endMinute: item.endMinute,
      enabled: item.enabled,
      sortOrder: index
    }
  })

  if (!CONTENT_MODES.includes(input.contentMode)) {
    throw new Error('Content mode không hợp lệ.')
  }
  if (!IMAGE_MODES.includes(input.image.mode)) {
    throw new Error('Image mode không hợp lệ.')
  }
  if (!MISSING_IMAGE_POLICIES.includes(input.image.missingPolicy)) {
    throw new Error('Missing image policy không hợp lệ.')
  }

  return {
    name,
    pageUid,
    rotation: {
      postsPerAccount,
      postDelayMinSeconds,
      postDelayMaxSeconds,
      accountDelayMinSeconds,
      accountDelayMaxSeconds
    },
    accounts,
    schedules,
    groupUids: normalizeGroupUids(input.groupUids),
    contentMode: input.contentMode,
    contents: normalizeContents(input.contents),
    image: {
      folderPath: input.image.folderPath.trim(),
      mode: input.image.mode,
      imagesPerPost: positiveInteger(input.image.imagesPerPost, 'Số ảnh/bài'),
      missingPolicy: input.image.missingPolicy
    }
  }
}

function toPageTabRow(row: Record<string, unknown>): PageTabRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    pageUid: String(row.pageUid),
    status: String(row.status),
    postsPerAccount: Number(row.postsPerAccount),
    postDelayMinSeconds: Number(row.postDelayMinSeconds),
    postDelayMaxSeconds: Number(row.postDelayMaxSeconds),
    accountDelayMinSeconds: Number(row.accountDelayMinSeconds),
    accountDelayMaxSeconds: Number(row.accountDelayMaxSeconds),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

export class PageTabRepository {
  constructor(private readonly client: Database.Database) {}

  list(): PageTabSummary[] {
    const rows = this.client.prepare(`
      SELECT
        t.id,
        t.name,
        t.page_uid AS pageUid,
        t.status,
        t.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM page_tab_accounts a WHERE a.page_tab_id = t.id) AS accountCount,
        (SELECT COUNT(*) FROM page_tab_schedules s WHERE s.page_tab_id = t.id) AS scheduleCount,
        (SELECT COUNT(*) FROM group_set_items gi JOIN group_sets gs ON gs.id = gi.group_set_id WHERE gs.page_tab_id = t.id) AS groupCount,
        (SELECT COUNT(*) FROM content_items ci JOIN content_sets cs ON cs.id = ci.content_set_id WHERE cs.page_tab_id = t.id) AS contentCount,
        COALESCE((SELECT folder_path FROM image_sources i WHERE i.page_tab_id = t.id), '') AS imageFolder
      FROM page_tabs t
      ORDER BY t.id
    `).all() as Array<Record<string, unknown>>

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      pageUid: String(row.pageUid),
      status: String(row.status) as PageTabStatus,
      accountCount: Number(row.accountCount),
      scheduleCount: Number(row.scheduleCount),
      groupCount: Number(row.groupCount),
      contentCount: Number(row.contentCount),
      imageFolder: String(row.imageFolder),
      updatedAt: Number(row.updatedAt)
    }))
  }

  get(id: number): PageTabConfig | null {
    const row = this.client.prepare(`
      SELECT
        id,
        name,
        page_uid AS pageUid,
        status,
        posts_per_account AS postsPerAccount,
        post_delay_min_seconds AS postDelayMinSeconds,
        post_delay_max_seconds AS postDelayMaxSeconds,
        account_delay_min_seconds AS accountDelayMinSeconds,
        account_delay_max_seconds AS accountDelayMaxSeconds,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM page_tabs
      WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined

    if (!row) return null
    const tab = toPageTabRow(row)

    const accounts = this.client.prepare(`
      SELECT
        pta.account_id AS accountId,
        pta.enabled,
        pta.sort_order AS sortOrder,
        pta.posts_per_turn AS postsPerTurn,
        a.uid,
        a.name,
        a.status,
        a.category
      FROM page_tab_accounts pta
      JOIN accounts a ON a.id = pta.account_id
      WHERE pta.page_tab_id = ?
      ORDER BY pta.sort_order, pta.id
    `).all(id) as Array<Record<string, unknown>>

    const schedules = this.client.prepare(`
      SELECT
        id,
        day_of_week AS dayOfWeek,
        start_minute AS startMinute,
        end_minute AS endMinute,
        enabled,
        sort_order AS sortOrder
      FROM page_tab_schedules
      WHERE page_tab_id = ?
      ORDER BY sort_order, id
    `).all(id) as Array<Record<string, unknown>>

    const groupRows = this.client.prepare(`
      SELECT gi.group_uid AS groupUid
      FROM group_set_items gi
      JOIN group_sets gs ON gs.id = gi.group_set_id
      WHERE gs.page_tab_id = ?
      ORDER BY gi.sort_order, gi.id
    `).all(id) as Array<Record<string, unknown>>

    const contentSet = this.client.prepare(`
      SELECT id, mode
      FROM content_sets
      WHERE page_tab_id = ?
    `).get(id) as Record<string, unknown> | undefined

    const contents = contentSet
      ? this.client.prepare(`
          SELECT content
          FROM content_items
          WHERE content_set_id = ?
          ORDER BY sort_order, id
        `).all(Number(contentSet.id)) as Array<Record<string, unknown>>
      : []

    const imageRow = this.client.prepare(`
      SELECT
        folder_path AS folderPath,
        mode,
        images_per_post AS imagesPerPost,
        missing_policy AS missingPolicy
      FROM image_sources
      WHERE page_tab_id = ?
    `).get(id) as Record<string, unknown> | undefined

    const image: PageTabImageConfig = imageRow
      ? {
          folderPath: String(imageRow.folderPath),
          mode: String(imageRow.mode) as ImageMode,
          imagesPerPost: Number(imageRow.imagesPerPost),
          missingPolicy: String(imageRow.missingPolicy) as MissingImagePolicy
        }
      : { ...DEFAULT_PAGE_TAB_IMAGE }

    return {
      id: tab.id,
      name: tab.name,
      pageUid: tab.pageUid,
      status: tab.status as PageTabStatus,
      rotation: {
        postsPerAccount: tab.postsPerAccount,
        postDelayMinSeconds: tab.postDelayMinSeconds,
        postDelayMaxSeconds: tab.postDelayMaxSeconds,
        accountDelayMinSeconds: tab.accountDelayMinSeconds,
        accountDelayMaxSeconds: tab.accountDelayMaxSeconds
      },
      accounts: accounts.map((item): PageTabAccountRef => ({
        accountId: Number(item.accountId),
        enabled: Number(item.enabled) === 1,
        sortOrder: Number(item.sortOrder),
        postsPerTurn: item.postsPerTurn === null ? null : Number(item.postsPerTurn),
        uid: String(item.uid),
        name: item.name === null ? null : String(item.name),
        status: String(item.status),
        category: item.category === null ? null : String(item.category)
      })),
      schedules: schedules.map((item): PageTabSchedule => ({
        id: Number(item.id),
        dayOfWeek: Number(item.dayOfWeek),
        startMinute: Number(item.startMinute),
        endMinute: Number(item.endMinute),
        enabled: Number(item.enabled) === 1,
        sortOrder: Number(item.sortOrder)
      })),
      groupUids: groupRows.map((item) => String(item.groupUid)),
      contentMode: (contentSet ? String(contentSet.mode) : 'sequential') as ContentMode,
      contents: contents.map((item) => String(item.content)),
      image,
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt
    }
  }

  create(input: CreatePageTabInput): PageTabConfig {
    const name = requiredText(input.name, 'Tên tab')
    const pageUid = requiredText(input.pageUid, 'Page UID')
    const now = Date.now()

    const create = this.client.transaction(() => {
      const result = this.client.prepare(`
        INSERT INTO page_tabs (
          name, page_uid, status, posts_per_account,
          post_delay_min_seconds, post_delay_max_seconds,
          account_delay_min_seconds, account_delay_max_seconds,
          created_at, updated_at
        ) VALUES (?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        pageUid,
        DEFAULT_PAGE_TAB_ROTATION.postsPerAccount,
        DEFAULT_PAGE_TAB_ROTATION.postDelayMinSeconds,
        DEFAULT_PAGE_TAB_ROTATION.postDelayMaxSeconds,
        DEFAULT_PAGE_TAB_ROTATION.accountDelayMinSeconds,
        DEFAULT_PAGE_TAB_ROTATION.accountDelayMaxSeconds,
        now,
        now
      )
      const id = Number(result.lastInsertRowid)

      this.client.prepare(`
        INSERT INTO group_sets (page_tab_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(id, `${name} Groups`, now, now)
      this.client.prepare(`
        INSERT INTO content_sets (page_tab_id, name, mode, created_at, updated_at)
        VALUES (?, ?, 'sequential', ?, ?)
      `).run(id, `${name} Content`, now, now)
      this.client.prepare(`
        INSERT INTO image_sources (page_tab_id, folder_path, mode, images_per_post, missing_policy, created_at, updated_at)
        VALUES (?, '', 'sequential', 1, 'text_only', ?, ?)
      `).run(id, now, now)

      return id
    })

    const created = this.get(create())
    if (!created) throw new Error('Không thể đọc lại Page Tab vừa tạo.')
    return created
  }

  update(id: number, input: PageTabSaveInput): PageTabConfig {
    if (!this.get(id)) {
      throw new Error(`Không tìm thấy Page Tab #${id}.`)
    }

    const config = normalizeConfig(input)
    this.validateAccountsExist(config.accounts.map((item) => item.accountId))
    const now = Date.now()

    const save = this.client.transaction(() => {
      this.client.prepare(`
        UPDATE page_tabs SET
          name = ?,
          page_uid = ?,
          posts_per_account = ?,
          post_delay_min_seconds = ?,
          post_delay_max_seconds = ?,
          account_delay_min_seconds = ?,
          account_delay_max_seconds = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        config.name,
        config.pageUid,
        config.rotation.postsPerAccount,
        config.rotation.postDelayMinSeconds,
        config.rotation.postDelayMaxSeconds,
        config.rotation.accountDelayMinSeconds,
        config.rotation.accountDelayMaxSeconds,
        now,
        id
      )

      this.client.prepare('DELETE FROM page_tab_accounts WHERE page_tab_id = ?').run(id)
      const insertAccount = this.client.prepare(`
        INSERT INTO page_tab_accounts (page_tab_id, account_id, sort_order, enabled, posts_per_turn)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const account of config.accounts) {
        insertAccount.run(id, account.accountId, account.sortOrder, account.enabled ? 1 : 0, account.postsPerTurn)
      }

      this.client.prepare('DELETE FROM page_tab_schedules WHERE page_tab_id = ?').run(id)
      const insertSchedule = this.client.prepare(`
        INSERT INTO page_tab_schedules (page_tab_id, day_of_week, start_minute, end_minute, enabled, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const schedule of config.schedules) {
        insertSchedule.run(
          id,
          schedule.dayOfWeek,
          schedule.startMinute,
          schedule.endMinute,
          schedule.enabled ? 1 : 0,
          schedule.sortOrder
        )
      }

      const groupSet = this.ensureGroupSet(id, config.name, now)
      this.client.prepare('DELETE FROM group_set_items WHERE group_set_id = ?').run(groupSet.id)
      const insertGroup = this.client.prepare(`
        INSERT INTO group_set_items (group_set_id, group_uid, sort_order)
        VALUES (?, ?, ?)
      `)
      config.groupUids.forEach((groupUid, index) => insertGroup.run(groupSet.id, groupUid, index))
      this.client.prepare('UPDATE group_sets SET name = ?, updated_at = ? WHERE id = ?')
        .run(`${config.name} Groups`, now, groupSet.id)

      const contentSet = this.ensureContentSet(id, config.name, now)
      this.client.prepare('DELETE FROM content_items WHERE content_set_id = ?').run(contentSet.id)
      const insertContent = this.client.prepare(`
        INSERT INTO content_items (content_set_id, content, sort_order)
        VALUES (?, ?, ?)
      `)
      config.contents.forEach((content, index) => insertContent.run(contentSet.id, content, index))
      this.client.prepare('UPDATE content_sets SET name = ?, mode = ?, updated_at = ? WHERE id = ?')
        .run(`${config.name} Content`, config.contentMode, now, contentSet.id)

      const imageSource = this.ensureImageSource(id, now)
      this.client.prepare(`
        UPDATE image_sources SET
          folder_path = ?, mode = ?, images_per_post = ?, missing_policy = ?, updated_at = ?
        WHERE id = ?
      `).run(
        config.image.folderPath,
        config.image.mode,
        config.image.imagesPerPost,
        config.image.missingPolicy,
        now,
        imageSource.id
      )
    })

    save()
    const updated = this.get(id)
    if (!updated) throw new Error('Không thể đọc lại Page Tab vừa cập nhật.')
    return updated
  }

  duplicate(id: number): PageTabConfig {
    const source = this.get(id)
    if (!source) throw new Error(`Không tìm thấy Page Tab #${id}.`)

    const copy = this.create({
      name: `${source.name} Copy`,
      pageUid: source.pageUid
    })

    return this.update(copy.id, {
      name: copy.name,
      pageUid: source.pageUid,
      rotation: { ...source.rotation },
      accounts: source.accounts.map((item) => ({
        accountId: item.accountId,
        enabled: item.enabled,
        sortOrder: item.sortOrder,
        postsPerTurn: item.postsPerTurn
      })),
      schedules: source.schedules.map((item) => ({
        dayOfWeek: item.dayOfWeek,
        startMinute: item.startMinute,
        endMinute: item.endMinute,
        enabled: item.enabled,
        sortOrder: item.sortOrder
      })),
      groupUids: [...source.groupUids],
      contentMode: source.contentMode,
      contents: [...source.contents],
      image: { ...source.image }
    })
  }

  delete(id: number): boolean {
    return this.client.prepare('DELETE FROM page_tabs WHERE id = ?').run(id).changes > 0
  }

  private validateAccountsExist(accountIds: number[]): void {
    if (accountIds.length === 0) return
    const placeholders = accountIds.map(() => '?').join(', ')
    const row = this.client.prepare(`SELECT COUNT(*) AS count FROM accounts WHERE id IN (${placeholders})`)
      .get(...accountIds) as { count: number }
    if (row.count !== accountIds.length) {
      throw new Error('Có account đã bị xóa hoặc không còn tồn tại.')
    }
  }

  private ensureGroupSet(pageTabId: number, name: string, now: number): SourceRow {
    const existing = this.client.prepare('SELECT id FROM group_sets WHERE page_tab_id = ?').get(pageTabId) as SourceRow | undefined
    if (existing) return existing
    const result = this.client.prepare(`
      INSERT INTO group_sets (page_tab_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(pageTabId, `${name} Groups`, now, now)
    return { id: Number(result.lastInsertRowid) }
  }

  private ensureContentSet(pageTabId: number, name: string, now: number): SourceRow {
    const existing = this.client.prepare('SELECT id FROM content_sets WHERE page_tab_id = ?').get(pageTabId) as SourceRow | undefined
    if (existing) return existing
    const result = this.client.prepare(`
      INSERT INTO content_sets (page_tab_id, name, mode, created_at, updated_at)
      VALUES (?, ?, 'sequential', ?, ?)
    `).run(pageTabId, `${name} Content`, now, now)
    return { id: Number(result.lastInsertRowid) }
  }

  private ensureImageSource(pageTabId: number, now: number): SourceRow {
    const existing = this.client.prepare('SELECT id FROM image_sources WHERE page_tab_id = ?').get(pageTabId) as SourceRow | undefined
    if (existing) return existing
    const result = this.client.prepare(`
      INSERT INTO image_sources (page_tab_id, folder_path, mode, images_per_post, missing_policy, created_at, updated_at)
      VALUES (?, '', 'sequential', 1, 'text_only', ?, ?)
    `).run(pageTabId, now, now)
    return { id: Number(result.lastInsertRowid) }
  }
}
