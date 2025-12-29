-- Add active column to health_tips table
ALTER TABLE health_tips ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Update existing records to be active by default
UPDATE health_tips SET active = true WHERE active IS NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_health_tips_active ON health_tips(active);
CREATE INDEX IF NOT EXISTS idx_health_tips_created_at ON health_tips(created_at DESC);
