const SAFE_IDENT_RE = /^[A-Za-z0-9_]+$/

const assertSafeIdent = (value, label) => {
  const raw = String(value ?? "").trim()
  if (!raw || !SAFE_IDENT_RE.test(raw)) {
    throw new Error(`Unsafe SQL identifier for ${label}: "${raw}"`)
  }
  return raw
}

export const chunkArray = (items, chunkSize) => {
  const list = Array.isArray(items) ? items : []
  const size = Math.max(1, Math.floor(chunkSize ?? 1))
  const out = []
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size))
  }
  return out
}

export const groupByKey = (items, keyFn) => {
  const map = new Map()
  for (const item of items ?? []) {
    const key = keyFn(item)
    if (key === null || key === undefined || key === "") {
      continue
    }
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return map
}

const quoteIdent = (value) => `\`${assertSafeIdent(value, "identifier")}\``

const normalizeParamValue = (value, isJson) => {
  if (!isJson) {
    return value
  }
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === "string") {
    return value
  }
  return JSON.stringify(value)
}

const resolveRowsPerStatement = (columnCount) => {
  const cols = Math.max(1, Math.floor(Number(columnCount) || 1))
  const rowsOverride = Number(process.env.BATCH_UPSERT_ROWS)
  if (Number.isFinite(rowsOverride) && rowsOverride > 0) {
    return Math.max(1, Math.floor(rowsOverride))
  }
  const maxParamsEnv = Number(process.env.BATCH_UPSERT_MAX_PARAMS)
  const maxParams =
    Number.isFinite(maxParamsEnv) && maxParamsEnv > 0
      ? Math.floor(maxParamsEnv)
      : 1500
  return Math.max(1, Math.floor(maxParams / cols))
}

export const bulkUpsertOnDuplicate = async ({
  prisma,
  table,
  columns,
  rows,
  updateColumns,
  jsonColumns = [],
}) => {
  if (!prisma || typeof prisma.$executeRawUnsafe !== "function") {
    throw new Error("bulkUpsertOnDuplicate requires prisma")
  }
  const safeTable = assertSafeIdent(table, "table")
  const cols = (columns ?? []).map((col) => assertSafeIdent(col, "column"))
  if (!cols.length) {
    return { rows: 0 }
  }
  const updateColsRaw = (updateColumns ?? []).length ? updateColumns : cols
  const updateCols = updateColsRaw
    .map((col) => assertSafeIdent(col, "updateColumn"))
    .filter((col) => cols.includes(col))

  const jsonSet = new Set((jsonColumns ?? []).map((c) => String(c)))
  const valueRows = Array.isArray(rows) ? rows : []
  if (!valueRows.length) {
    return { rows: 0 }
  }

  const quotedCols = cols.map(quoteIdent).join(", ")
  const updateSql = updateCols.length
    ? ` ON DUPLICATE KEY UPDATE ${updateCols
        .map((col) => `${quoteIdent(col)}=VALUES(${quoteIdent(col)})`)
        .join(", ")}`
    : ""

  const rowsPerStatement = resolveRowsPerStatement(cols.length)
  for (const rowChunk of chunkArray(valueRows, rowsPerStatement)) {
    const bindParams = []
    const valuesSql = rowChunk.map((row) => {
      const values = Array.isArray(row)
        ? row
        : cols.map((col) => (row ? row[col] : null))
      const slots = cols.map((col, idx) => {
        bindParams.push(normalizeParamValue(values[idx], jsonSet.has(col)))
        return jsonSet.has(col) ? "CAST(? AS JSON)" : "?"
      })
      return `(${slots.join(", ")})`
    })
    const query = `INSERT INTO ${quoteIdent(
      safeTable,
    )} (${quotedCols}) VALUES ${valuesSql.join(", ")}${updateSql}`
    // $executeRawUnsafe returns affected rows count (dialect-specific); callers can track rows by input length.
    await prisma.$executeRawUnsafe(query, ...bindParams)
  }
  return { rows: valueRows.length }
}
