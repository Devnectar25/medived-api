-- Migration to add logistics status for refunds
ALTER TABLE orders ADD COLUMN IF NOT EXISTS logistics_status VARCHAR(50) DEFAULT 'Awaiting_Pickup';
-- Possible values: 'Awaiting_Pickup', 'In_Transit', 'Received', 'Restocked'

-- Add a flag for online refund eligibility
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_product_received BOOLEAN DEFAULT FALSE;
