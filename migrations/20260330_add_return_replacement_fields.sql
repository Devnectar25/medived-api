-- Migration: 20260330_add_return_replacement_fields.sql
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS return_type VARCHAR(20),
ADD COLUMN IF NOT EXISTS return_reason TEXT,
ADD COLUMN IF NOT EXISTS return_images JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS return_request_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_returned_order BOOLEAN DEFAULT FALSE;
