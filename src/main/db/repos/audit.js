export function createAuditRepo(db) {
  const insert = db.prepare(`
    INSERT INTO audit_log (entity, entity_id, action, before_json, after_json, user_id)
    VALUES (@entity, @entityId, @action, @before, @after, @userId)
  `)

  return {
    log({ entity, entityId = null, action, before = null, after = null, userId = null }) {
      insert.run({
        entity,
        entityId,
        action,
        before: before && JSON.stringify(before),
        after: after && JSON.stringify(after),
        userId
      })
    },

    list({ entity, entityId, limit = 100 } = {}) {
      return db
        .prepare(
          `SELECT * FROM audit_log
           WHERE (@entity IS NULL OR entity = @entity) AND (@entityId IS NULL OR entity_id = @entityId)
           ORDER BY id DESC LIMIT @limit`
        )
        .all({ entity: entity ?? null, entityId: entityId ?? null, limit })
    }
  }
}
