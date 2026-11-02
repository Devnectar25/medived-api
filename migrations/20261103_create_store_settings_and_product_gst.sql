-- Create store_settings table for dynamic configuration (GST, Card surcharge, COD fee, etc.)
CREATE TABLE IF NOT EXISTS store_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add gst_rate to products table if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'gst_rate'
    ) THEN 
        ALTER TABLE products ADD COLUMN gst_rate NUMERIC(5, 2) DEFAULT 0;
    END IF;
END $$;

-- Add gst_amount, card_surcharge, cod_charge to orders table if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'gst_amount'
    ) THEN 
        ALTER TABLE orders ADD COLUMN gst_amount NUMERIC(10, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'card_surcharge'
    ) THEN 
        ALTER TABLE orders ADD COLUMN card_surcharge NUMERIC(10, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'cod_charge'
    ) THEN 
        ALTER TABLE orders ADD COLUMN cod_charge NUMERIC(10, 2) DEFAULT 0;
    END IF;
END $$;

