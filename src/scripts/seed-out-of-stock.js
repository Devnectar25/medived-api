const pool = require('../config/db');

const seedOutOfStock = async () => {
    try {
        console.log('Marking 3 products as out of stock...');
        await pool.query('UPDATE products SET instock = false, quantity = 0, stock_quantity = 0 WHERE product_id IN (356, 357, 358)');
        console.log('Successfully updated 3 products.');
        process.exit(0);
    } catch (err) {
        console.error('Error seeding data:', err);
        process.exit(1);
    }
};

seedOutOfStock();
