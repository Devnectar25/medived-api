-- Add payment_type column to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50);
-- Update existing orders to have a default value if needed (optional, but good for consistency)
UPDATE public.orders SET payment_type = 'Paid' WHERE payment_method != 'cod' AND payment_type IS NULL;
UPDATE public.orders SET payment_type = 'COD' WHERE payment_method = 'cod' AND payment_type IS NULL;
