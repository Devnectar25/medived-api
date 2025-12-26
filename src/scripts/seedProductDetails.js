const pool = require('../config/db');

async function seedData() {
    try {
        console.log('Starting seeding...');

        // 1. Directions check (Skipped, verified manually)
        console.log('Directions column check skipped (verified).');

        // 2. Get all products (using correct column names: product_id, productname)
        console.log('Fetching products...');
        const productsResult = await pool.query('SELECT product_id, productname FROM products');
        const products = productsResult.rows;
        console.log(`Found ${products.length} products.`);

        // 3. Get all users (using correct column: username)
        console.log('Fetching users...');
        let usersResult = await pool.query('SELECT username FROM users WHERE username IS NOT NULL');
        let users = usersResult.rows;

        // Create a dummy user if none exist
        if (users.length === 0) {
            console.log('No users found. Creating a dummy user...');
            // Need to insert into users. Schema has many columns, we try minimal insert.
            // users table columns: emailid, password, username, active...
            // Note: id is uuid? No, schema dump said 'userid integer'.
            // But db_columns.txt for users showed 'id (uuid)'. 
            // This suggests the live DB is quite different from schema dump.
            // We'll try to insert username/email/password.
            const newUser = await pool.query(`
                INSERT INTO users (username, emailid, password, active) 
                VALUES ('dummy_user', 'dummy@example.com', 'dummy_pass', true) 
                RETURNING username
            `);
            users = newUser.rows;
        }

        const usernames = users.map(u => u.username);

        // 4. Update products with dummy data and add reviews
        for (const product of products) {
            console.log(`Processing product: ${product.productname} (ID: ${product.product_id})`);

            // Detailed dummy data
            const benefits = [
                "Supports immune system health",
                "Promotes overall wellness",
                "Natural ingredients for better absorption",
                "Clinically tested formula"
            ];

            const ingredients = [
                "Ashwagandha Root Extract",
                "Turmeric",
                "Ginger",
                "Black Pepper Extract"
            ];

            const directions = "Take 1-2 tablets daily with warm water or milk, preferably after meals. Consult your physician for dosage appropriate for your specific condition.";

            const usage = [
                "Take 1 tablet twice a day",
                "Best consumed with warm milk",
                "Use consistency for 3 months"
            ];

            // detailed dummy data for supports
            const supportsOptions = [
                "Immunity", "General Wellness", "Digestion", "Stress Relief",
                "Energy", "Joint Health", "Skin Care", "Hair Growth"
            ];
            // Pick 2-3 random supports
            const supports = [];
            while (supports.length < Math.floor(Math.random() * 2) + 2) {
                const s = supportsOptions[Math.floor(Math.random() * supportsOptions.length)];
                if (!supports.includes(s)) supports.push(s);
            }

            const stockQuantity = Math.floor(Math.random() * 50) + 1; // 1 to 50

            // Update product fields
            // Using correct column name: product_id
            await pool.query(`
                UPDATE products 
                SET 
                    benefits = $1, 
                    ingredients = $2, 
                    directions = $3,
                    usage = $4,
                    stock_quantity = $5,
                    supports = $6
                WHERE product_id = $7
            `, [benefits, ingredients, directions, usage, stockQuantity, supports, product.product_id]);

            // Add dummy reviews (3-5 per product)
            // Check if reviews already exist
            // review table uses productid (not product_id) per db_columns.txt
            const existingReviews = await pool.query('SELECT COUNT(*) FROM review WHERE productid = $1', [product.product_id]);

            if (parseInt(existingReviews.rows[0].count) === 0) {
                const numReviews = Math.floor(Math.random() * 3) + 3;
                for (let i = 0; i < numReviews; i++) {
                    const randomUser = usernames[Math.floor(Math.random() * usernames.length)];
                    const ratings = [3, 4, 4, 5, 5, 5]; // Skew towards positive
                    const rating = ratings[Math.floor(Math.random() * ratings.length)];
                    const reviewTexts = [
                        "Great product! Really helped me.",
                        "Good quality, fast delivery.",
                        "Effective and natural. Will buy again.",
                        "Decent, but took a while to see results.",
                        "Highly recommended for daily use."
                    ];
                    const reviewText = reviewTexts[Math.floor(Math.random() * reviewTexts.length)];
                    const randomDate = new Date(Date.now() - Math.floor(Math.random() * 10000000000));

                    // review table cols: username, productid, review, rating, date
                    await pool.query(`
                        INSERT INTO review (username, productid, review, rating, date)
                        VALUES ($1, $2, $3, $4, $5)
                    `, [randomUser, product.product_id, reviewText, rating, randomDate]);
                }
            } else {
                console.log(`Skipping reviews for ${product.productname}, already has ${existingReviews.rows[0].count}.`);
            }

            // Recalculate average rating for product
            // products table uses product_id
            // review table uses productid
            await pool.query(`
                UPDATE products 
                SET 
                    rating = (SELECT AVG(rating) FROM review WHERE productid = $1),
                    reviews = (SELECT COUNT(*)::text FROM review WHERE productid = $1)
                WHERE product_id = $1
            `, [product.product_id]);
        }

        console.log('Seeding completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

seedData();
