-- Update refund columns in orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_method VARCHAR(50);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_txn_id VARCHAR(100);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_receipt_url TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_notification_sent BOOLEAN DEFAULT FALSE;

-- Ensure refund_status is updated for advanced workflow
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'refund_status_type') THEN
        -- Using simple varchar but documenting intended statuses:
        -- Pending, In-Review, Processing, Completed, Failed/Rejected
    END IF;
END $$;
