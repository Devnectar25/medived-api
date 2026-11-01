-- Saved refund bank accounts per customer (entered once, reused for every refund)
CREATE TABLE IF NOT EXISTS public.user_bank_accounts (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    holder_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(32) NOT NULL,
    ifsc_code VARCHAR(11) NOT NULL,
    bank_name VARCHAR(100),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, account_number, ifsc_code)
);
CREATE INDEX IF NOT EXISTS idx_user_bank_accounts_user_id ON public.user_bank_accounts (user_id);
