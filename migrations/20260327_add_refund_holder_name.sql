-- Add refund_holder_name to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_holder_name VARCHAR(150);
