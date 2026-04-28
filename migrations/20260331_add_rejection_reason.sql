-- Migration: 20260331_add_rejection_reason.sql
-- Adds missing columns for order rejection/approval tracking
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS refund_holder_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS refund_notification_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS refund_receipt_url TEXT,
ADD COLUMN IF NOT EXISTS refund_txn_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS refund_admin_note TEXT,
ADD COLUMN IF NOT EXISTS refund_method VARCHAR(100),
ADD COLUMN IF NOT EXISTS logistics_status VARCHAR(100),
ADD COLUMN IF NOT EXISTS is_product_received BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS original_status VARCHAR(100),
ADD COLUMN IF NOT EXISTS is_returned_order BOOLEAN DEFAULT FALSE;
