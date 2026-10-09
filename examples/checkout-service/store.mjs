import { DatabaseSync } from 'node:sqlite'

/** Demo storage. Replace with your transactional production database when scaling. */
export class PurchaseStore {
  constructor(path) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS processed_events (id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchases (order_id TEXT PRIMARY KEY, user_id TEXT, item_code TEXT,
        quantity REAL, active INTEGER NOT NULL CHECK(active IN (0,1)));`)
  }
  apply({ eventId, orderId, userId = null, itemCode = null, quantity = null, revoke = false }) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const duplicate = this.db.prepare('SELECT 1 FROM processed_events WHERE id=?').get(eventId)
      if (!duplicate) {
        if (revoke) this.db.prepare(`INSERT INTO purchases(order_id,active) VALUES(?,0)
          ON CONFLICT(order_id) DO UPDATE SET active=0`).run(orderId)
        else this.db.prepare(`INSERT INTO purchases(order_id,user_id,item_code,quantity,active) VALUES(?,?,?,?,1)
          ON CONFLICT(order_id) DO NOTHING`).run(orderId, userId, itemCode, quantity)
        this.db.prepare('INSERT INTO processed_events VALUES(?,?)').run(eventId, new Date().toISOString())
      }
      this.db.exec('COMMIT')
      return { duplicate: !!duplicate, active: this.isActive(orderId) }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  isActive(orderId) { return this.db.prepare('SELECT active FROM purchases WHERE order_id=?').get(orderId)?.active === 1 }
  forUser(userId) { return this.db.prepare('SELECT order_id,item_code,quantity FROM purchases WHERE user_id=? AND active=1').all(userId) }
  close() { this.db.close() }
}
