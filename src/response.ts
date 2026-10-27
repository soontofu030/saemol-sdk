/** Validate permission decisions before returning a typed success to the caller. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const text = (value: unknown) => typeof value === 'string'
const nullableText = (value: unknown) => value === null || text(value)
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const nullableNumber = (value: unknown) => value === null || number(value)
const usage = (value: unknown) => isRecord(value) && nullableText(value.unit) && number(value.used) && nullableNumber(value.limit)

export function validApiResponse(path: string, value: unknown): boolean {
  if (!isRecord(value)) return false
  if (path.includes('/licenses/verify') || path.includes('/entitlements/verify')) {
    if (typeof value.valid !== 'boolean') return false
    if (!value.valid && text(value.reason)) return true
    if (!text(value.status) || !text(value.kind) || value.valid && value.status !== 'active'
      || !nullableText(value.plan_name) || !nullableText(value.expires_at) || typeof value.is_trial !== 'boolean') return false
    if (path.includes('/entitlements/verify')) return nullableText(value.current_period_end) && nullableNumber(value.rate_limit_per_min)
      && (value.usage === null || usage(value.usage))
      && (value.plan_features === null || Array.isArray(value.plan_features) && value.plan_features.every(text))
    return nullableText(value.sku) && isRecord(value.devices) && number(value.devices.registered) && nullableNumber(value.devices.limit)
      && (value.current_period_end === undefined || nullableText(value.current_period_end))
  }
  if (path.includes('/usage/report')) {
    if (value.accepted === false) return text(value.reason)
    return value.accepted === true && typeof value.allowed === 'boolean' && usage(value.usage) && isRecord(value.usage)
      && nullableNumber(value.usage.remaining) && typeof value.over_limit === 'boolean' && (value.overage_policy === 'block' || value.overage_policy === 'notify')
  }
  if (path.includes('/users/current')) return value.found === false ? text(value.reason)
    : value.found === true && isRecord(value.user) && text(value.user.id)
  if (path.includes('/commerce/policy')) return text(value.version) && value.provider === 'inicis'
    && ['live_checkout_ready','billing_ready','conditional_payout_ready'].every(key => typeof value[key] === 'boolean')
    && nullableText(value.reason) && ['terms_url','seller_terms_url','refund_url','notice'].every(key => text(value[key]))
  if (path.includes('/health')) return typeof value.ok === 'boolean'
  if (path.includes('/updates/check')) return typeof value.update_available === 'boolean' && typeof value.update_required === 'boolean'
  if (path.includes('/analytics/summary')) return Array.isArray(value.days) && isRecord(value.totals)
  if (path.endsWith('/acknowledge')) return value.recorded === true && text(value.session_id) && text(value.applied_at)
  if (path.includes('/customer-portal')) return text(value.url) && value.requires_login === true
  if (path.includes('/checkout/sessions/')) return text(value.session_id) && text(value.status)
  if (path.includes('/checkout/sessions')) return text(value.session_id) && text(value.url) && text(value.expires_at)
  return true
}

export function validOAuthTokens(value: unknown): boolean {
  return isRecord(value) && text(value.access_token) && !!value.access_token && text(value.refresh_token) && !!value.refresh_token
    && value.token_type === 'Bearer' && number(value.expires_in) && (value.expires_in as number) > 0
    && (value.scope === 'identity' || value.scope === 'entitlement')
}

export function validOAuthUser(value: unknown): boolean {
  if (!isRecord(value) || !text(value.sub) || !value.sub || !text(value.product_id) || !nullableText(value.name) || !nullableText(value.email)
    || (value.scope !== 'identity' && value.scope !== 'entitlement')) return false
  const ent = value.entitlement
  return ent == null || isRecord(ent) && typeof ent.valid === 'boolean' && text(ent.status) && text(ent.kind)
    && nullableText(ent.current_period_end) && nullableText(ent.expires_at) && nullableText(ent.plan_name) && typeof ent.is_trial === 'boolean'
    && (ent.plan_features === null || Array.isArray(ent.plan_features) && ent.plan_features.every(text))
}
