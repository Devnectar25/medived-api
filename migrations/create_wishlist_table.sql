-- Create wishlist table
CREATE TABLE IF NOT EXISTS public.wishlist (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    product_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(username),
    CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES public.product(id),
    UNIQUE(user_id, product_id)
);
