CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event_name VARCHAR(50) NOT NULL, -- 'view_item', 'add_to_cart', 'begin_checkout', 'purchase', 'login', etc.
  user_id VARCHAR(100), -- Nullable, for logged in users
  session_id VARCHAR(100), -- To group guest actions
  metadata JSONB, -- Store product details, value, currency, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created ON analytics_events(event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events(user_id);
