// @saemol/sdk — Saemol 판매자 연동 SDK (Node.js 18+)
// 플랫폼 API 래퍼(라이선스 검증·권한 확인·사용량 리포팅·헬스체크) + 웹훅 서명 검증.

export { Saemol, SDK_VERSION } from './client.js'
export type { SaemolOptions } from './client.js'

export { verifyWebhook, isKnownWebhookEvent } from './webhooks.js'
export type { VerifyWebhookParams, WebhookHeaders } from './webhooks.js'

export {
  SaemolError,
  SaemolApiError,
  SaemolNetworkError,
  SaemolWebhookError,
} from './errors.js'

export type {
  HealthResponse,
  VerifyLicenseParams,
  VerifyLicenseResponse,
  VerifyLicenseOk,
  VerifyLicenseDenied,
  LicenseDeviceInfo,
  VerifyEntitlementParams,
  VerifyEntitlementResponse,
  VerifyEntitlementResult,
  VerifyEntitlementDenied,
  EntitlementUsageInfo,
  ReportUsageParams,
  ReportUsageResponse,
  ReportUsageAccepted,
  ReportUsageRejected,
  CheckUpdateParams,
  CheckUpdateResponse,
  CurrentUserParams,
  CurrentUserResponse,
  CurrentUserFound,
  CurrentUserNotFound,
  AnalyticsSummaryParams,
  AnalyticsSummaryResponse,
  AnalyticsDailyPoint,
  AnalyticsTotals,
  SaemolWebhookEvent,
  SaemolWebhookEventType,
  OrderPaidData,
  OrderRefundedData,
  OrderCancelledData,
  OrderDeliveredData,
  EntitlementActivatedData,
  EntitlementRevokedData,
  UsageThresholdExceededData,
  TenantProvisionRequestedData,
  SubscriptionCreatedData,
  SubscriptionCancelledData,
  UserUpdatedData,
  UserWithdrawnData,
  ProductApprovedData,
  ProductRejectedData,
  ProductUpdatedData,
  ReviewCreatedData,
  ReviewDeletedData,
  ProductFeaturedData,
  ProductFavoritedData,
  ApiKeyIssuedData,
  ApiKeyRevokedData,
  TeamEventData,
  PayoutEventData,
  AnalyticsSummaryData,
} from './types.js'
