-- Add used_count column to coupons table if it does not already exist
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS used_count INT DEFAULT 0;

-- Sync used_count with existing active (non-cancelled) orders
UPDATE coupons c
SET used_count = (
    SELECT COUNT(*)::int
    FROM orders o
    WHERE o.coupon_code = c.code
      AND (o.status IS NULL OR o.status NOT IN ('Cancelled'))
);

