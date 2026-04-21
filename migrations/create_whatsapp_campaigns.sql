CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    festival_message TEXT,
    offer_details TEXT,
    image_url VARCHAR(1000),
    discount_type VARCHAR(50), 
    discount_value NUMERIC,
    status VARCHAR(50) DEFAULT 'DRAFT',
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp_campaign_audience (
    campaign_id UUID REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_campaign_products (
    campaign_id UUID REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, product_id)
);
