-- Chatbot NLP Auto-Learning System Database Schema

-- Knowledge Base Table
CREATE TABLE IF NOT EXISTS chatbot_knowledge (
    id SERIAL PRIMARY KEY,
    query_pattern TEXT NOT NULL,
    intent VARCHAR(100),
    answer TEXT NOT NULL,
    confidence_score DECIMAL(3,2) DEFAULT 1.0,
    is_approved BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100),
    usage_count INTEGER DEFAULT 0,
    keywords TEXT[] -- Array of keywords for faster matching
);

-- Query Logs Table
CREATE TABLE IF NOT EXISTS chatbot_query_logs (
    id SERIAL PRIMARY KEY,
    user_query TEXT NOT NULL,
    matched_pattern TEXT,
    intent VARCHAR(100),
    response TEXT,
    confidence_score DECIMAL(3,2),
    was_successful BOOLEAN,
    needs_review BOOLEAN DEFAULT false,
    user_feedback VARCHAR(20), -- 'helpful', 'not_helpful', null
    session_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unanswered Queries Table (for admin review)
CREATE TABLE IF NOT EXISTS chatbot_unanswered_queries (
    id SERIAL PRIMARY KEY,
    query TEXT NOT NULL UNIQUE,
    suggested_intent VARCHAR(100),
    occurrence_count INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'answered', 'ignored'
    admin_answer TEXT,
    answered_by VARCHAR(100),
    answered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_knowledge_intent ON chatbot_knowledge(intent);
CREATE INDEX IF NOT EXISTS idx_knowledge_approved ON chatbot_knowledge(is_approved);
CREATE INDEX IF NOT EXISTS idx_knowledge_keywords ON chatbot_knowledge USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_logs_created ON chatbot_query_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_needs_review ON chatbot_query_logs(needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS idx_unanswered_status ON chatbot_unanswered_queries(status);
CREATE INDEX IF NOT EXISTS idx_unanswered_count ON chatbot_unanswered_queries(occurrence_count DESC);

-- Initial Knowledge Base Seeds
INSERT INTO chatbot_knowledge (query_pattern, intent, answer, keywords, confidence_score) VALUES
-- Greetings
('hello|hi|hey|greetings', 'greeting', 'Hello! I''m HealthBot, your Ayurvedic wellness assistant. How can I help you today? You can ask me about products, health benefits, or website information.', ARRAY['hello', 'hi', 'hey', 'greetings'], 1.0),
('how are you', 'greeting', 'I''m doing great, thank you for asking! I''m here to help you with your health and wellness questions. What can I assist you with?', ARRAY['how', 'are', 'you'], 1.0),
('help|assist', 'greeting', 'I can help you with:\n• Finding Ayurvedic products\n• Health benefits and uses\n• Order and shipping information\n• Return policies\n• General wellness advice\n\nWhat would you like to know?', ARRAY['help', 'assist', 'support'], 1.0),

-- Product Search Intent
('show products|list products|what products', 'product_search', 'I can help you find products! Please tell me what you''re looking for. For example: "ashwagandha", "stress relief", "immunity boosters", etc.', ARRAY['show', 'list', 'products', 'items'], 0.9),
('search|find|looking for', 'product_search', 'What product are you looking for? I can search by name, category, or health benefit!', ARRAY['search', 'find', 'looking'], 0.9),

-- Ashwagandha
('ashwagandha|ashwaganda', 'product_info', 'Ashwagandha is a powerful adaptogenic herb known for:\n• Reducing stress and anxiety\n• Improving sleep quality\n• Boosting energy and stamina\n• Supporting cognitive function\n• Enhancing immunity\n\nWould you like to see our Ashwagandha products?', ARRAY['ashwagandha', 'stress', 'anxiety', 'sleep', 'energy'], 1.0),

-- Turmeric
('turmeric|haldi|curcumin', 'product_info', 'Turmeric (Haldi) is renowned for:\n• Powerful anti-inflammatory properties\n• Supporting joint health\n• Boosting immunity\n• Aiding digestion\n• Antioxidant benefits\n\nWould you like to explore our Turmeric products?', ARRAY['turmeric', 'haldi', 'curcumin', 'inflammation', 'joints'], 1.0),

-- Triphala
('triphala', 'product_info', 'Triphala is a traditional Ayurvedic formula combining three fruits:\n• Supports digestive health\n• Natural detoxification\n• Promotes regular bowel movements\n• Rich in antioxidants\n• Supports eye health\n\nInterested in our Triphala products?', ARRAY['triphala', 'digestion', 'detox', 'digestive'], 1.0),

-- Brahmi
('brahmi|bacopa', 'product_info', 'Brahmi (Bacopa) is excellent for:\n• Enhancing memory and cognitive function\n• Reducing anxiety and stress\n• Improving concentration\n• Supporting brain health\n• Promoting mental clarity\n\nShall I show you our Brahmi products?', ARRAY['brahmi', 'bacopa', 'memory', 'brain', 'concentration'], 1.0),

-- Health Conditions
('stress|anxiety|tension', 'health_query', 'For stress and anxiety relief, I recommend:\n• Ashwagandha - Adaptogenic stress reliever\n• Brahmi - Calms the mind\n• Tulsi (Holy Basil) - Reduces cortisol\n\nWould you like to see these products?', ARRAY['stress', 'anxiety', 'tension', 'worried'], 1.0),
('sleep|insomnia|cant sleep', 'health_query', 'For better sleep, consider:\n• Ashwagandha - Promotes restful sleep\n• Brahmi - Calms the nervous system\n• Jatamansi - Natural sleep aid\n\nShall I find these products for you?', ARRAY['sleep', 'insomnia', 'rest', 'sleeping'], 1.0),
('immunity|immune|defense', 'health_query', 'To boost immunity, try:\n• Giloy - Powerful immunomodulator\n• Turmeric - Anti-inflammatory and immune support\n• Amla - Rich in Vitamin C\n• Tulsi - Adaptogenic immune booster\n\nWant to see our immunity products?', ARRAY['immunity', 'immune', 'defense', 'protection'], 1.0),
('digestion|stomach|acidity|gas', 'health_query', 'For digestive health:\n• Triphala - Supports healthy digestion\n• Ajwain - Relieves gas and bloating\n• Hingvastak - Digestive aid\n• Aloe Vera - Soothes the digestive tract\n\nInterested in digestive wellness products?', ARRAY['digestion', 'stomach', 'acidity', 'gas', 'bloating'], 1.0),
('joint|arthritis|pain|inflammation', 'health_query', 'For joint health and pain relief:\n• Turmeric - Anti-inflammatory\n• Guggul - Supports joint mobility\n• Shallaki (Boswellia) - Reduces inflammation\n• Ashwagandha - Reduces pain\n\nShall I show you these products?', ARRAY['joint', 'arthritis', 'pain', 'inflammation', 'ache'], 1.0),

-- Website Navigation
('how to order|place order|ordering', 'website_info', 'Ordering is easy!\n1. Browse our products\n2. Click "Add to Cart" on items you like\n3. Go to Cart and click "Checkout"\n4. Enter shipping details\n5. Complete payment\n\nNeed help with a specific step?', ARRAY['order', 'ordering', 'purchase', 'buy'], 1.0),
('shipping|delivery|ship', 'website_info', 'Shipping Information:\n• FREE delivery on all orders\n• Delivery within 5-7 business days\n• Track your order anytime\n• Authentic products guaranteed\n\nFor more details, visit our Shipping page.', ARRAY['shipping', 'delivery', 'ship', 'deliver'], 1.0),
('return|refund|exchange', 'website_info', 'Return Policy:\n• 7-day return window\n• Items must be unused and in original packaging\n• Contact support@mediveda.com to initiate\n• Full refund processed within 5-7 business days\n\nVisit our Returns page for complete details.', ARRAY['return', 'refund', 'exchange', 'money back'], 1.0),
('payment|pay|payment methods', 'website_info', 'We accept:\n• Credit/Debit Cards\n• UPI\n• Net Banking\n• Wallets\n\nAll payments are 100% secure and encrypted.', ARRAY['payment', 'pay', 'card', 'upi'], 1.0),

-- Contact Information
('contact|support|email|phone|call', 'contact_info', 'Contact Us:\n📧 Email: support@mediveda.com\n📞 Phone: +91 1800-123-4567\n⏰ Hours: Mon-Sat, 9 AM - 6 PM\n\nWe typically respond within 24 hours!', ARRAY['contact', 'support', 'email', 'phone', 'call', 'reach'], 1.0),

-- About Company
('about|company|who are you|mediveda', 'about_info', 'We are Mediveda - your trusted source for authentic Ayurvedic products. We offer:\n• 100% natural and authentic products\n• Traditional Ayurvedic formulations\n• Quality tested supplements\n• Expert wellness guidance\n\nVisit our About page to learn more!', ARRAY['about', 'company', 'mediveda', 'who'], 1.0),

-- Pricing
('price|cost|expensive|cheap|affordable', 'pricing_info', 'Our products are competitively priced with great value for authentic Ayurvedic quality. Prices vary by product. Would you like me to search for a specific product so you can see its price?', ARRAY['price', 'cost', 'expensive', 'cheap', 'affordable'], 0.9),

-- Goodbye
('bye|goodbye|thanks|thank you', 'farewell', 'You''re welcome! Feel free to ask if you need anything else. Stay healthy! 🌿', ARRAY['bye', 'goodbye', 'thanks', 'thank'], 1.0)

ON CONFLICT DO NOTHING;

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers
DROP TRIGGER IF EXISTS update_chatbot_knowledge_updated_at ON chatbot_knowledge;
CREATE TRIGGER update_chatbot_knowledge_updated_at
    BEFORE UPDATE ON chatbot_knowledge
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chatbot_unanswered_updated_at ON chatbot_unanswered_queries;
CREATE TRIGGER update_chatbot_unanswered_updated_at
    BEFORE UPDATE ON chatbot_unanswered_queries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
