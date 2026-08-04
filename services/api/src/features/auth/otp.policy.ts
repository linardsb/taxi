/**
 * OTP policy. Constants, not env vars — these are security limits, and the
 * <€100/mo budget guardrail makes unbounded SMS a real cost channel.
 */
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_SECONDS = 300; // 5 min
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_VERIFY_ATTEMPTS = 5; // then the code is burned
export const OTP_MAX_REQUESTS_PER_HOUR = 5; // per phone
export const OTP_RATE_WINDOW_SECONDS = 3600;
