-- QA inspection of returned / replacement parcels received at Homved warehouse
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_status VARCHAR(20);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_notes TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_checked_at TIMESTAMP;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_checked_by VARCHAR(100);
