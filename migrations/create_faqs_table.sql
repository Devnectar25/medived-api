CREATE TABLE IF NOT EXISTS faqs (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'General',
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO faqs (question, answer, category, display_order) VALUES
('What is Homved?', 'Homved is your trusted platform for authentic Ayurvedic, Homeopathic, and wellness products.', 'General', 1),
('How do I track my order?', 'You can track your order by clicking on "Track Order" in the footer or by visiting your Profile page.', 'Orders', 2),
('What payment methods do you accept?', 'We accept credit/debit cards, net banking, UPI, and cash on delivery.', 'Payments', 3),
('Do you ship internationally?', 'Currently, we only ship within India. We plan to expand internationally soon.', 'Shipping', 4),
('What is your return policy?', 'We offer a 7-day return policy for unused and unopened products. Please check our Return & Refund policy page for more details.', 'Returns', 5),
('Are your products authentic?', 'Yes, we source all our products directly from authorized manufacturers and distributors to ensure 100% authenticity.', 'Products', 6);
