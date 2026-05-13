-- Add refund details to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_status VARCHAR(50) DEFAULT 'Pending';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_bank_account VARCHAR(100);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_ifsc_code VARCHAR(20);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_phone_number VARCHAR(20);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_admin_note TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMP;

-- Update existing orders if needed
-- UPDATE public.orders SET refund_status = 'Pending' WHERE status IN ('Cancelled', 'Returned') AND refund_status IS NULL;
