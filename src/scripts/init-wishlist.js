const pool = require('../config/db');

const initWishlist = async () => {
    try {
        console.log('Creating wishlist table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.wishlist (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                product_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(username),
                CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES public.products(product_id),
                UNIQUE(user_id, product_id)
            );
        `);
        console.log('Wishlist table created successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error creating wishlist table:', err);
        process.exit(1);
    }
};

initWishlist();
