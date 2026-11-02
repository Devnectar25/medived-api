-- Create verification_otps table to persist OTPs and registration data across server restarts
CREATE TABLE IF NOT EXISTS verification_otps (
    email VARCHAR(255) PRIMARY KEY,
    otp VARCHAR(10) NOT NULL,
    type VARCHAR(50) NOT NULL,
    expires_at BIGINT NOT NULL,
    registration_data JSONB,
    user_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_otps_email ON verification_otps(email);
