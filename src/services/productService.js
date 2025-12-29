const pool = require("../config/db");

// Helper to map DB columns to camelCase frontend fields
const mapProduct = (p) => ({
    id: p.product_id?.toString() || '',
    name: p.productname || '',
    brand: p.brand_name || p.brand || 'Generic',
    category: p.category_name || 'Uncategorized',
    categoryId: p.category_id || '',
    shortDescription: p.shortdescription || '',
    description: p.description || '',
    price: parseFloat(p.price) || 0,
    originalPrice: parseFloat(p.originalprice) || 0,
    discount: parseFloat(p.discount) || 0,
    rating: parseFloat(p.rating) || 0,
    reviews: parseInt(p.reviews) || 0,
    image: p.image || 'https://via.placeholder.com/300',
    images: p.product_images || [p.image || 'https://via.placeholder.com/300'], // Fallback to main image
    inStock: p.instock,
    stockQuantity: p.stock_quantity || p.quantity || 0,
    benefits: p.benefits,
    ingredients: p.ingredients,
    usage: p.usage,
    directions: p.directions,
    supports: p.supports || [],
    expiryInfo: p.expiryinfo,
    subCategory: p.subcategory_name || '', // Use joined name
    subCategoryId: p.subcategory_id || '', // Keep ID for reference
    specifications: p.specifications,
    promoted: p.promoted || false,
    active: p.active !== false // Default true if null/undefined
});

exports.getAllProducts = async (page, limit, active, search, category_id, brand_id) => {
    let whereClauses = [];
    let params = [];
    let paramIdx = 1;

    if (active === 'true') {
        whereClauses.push(`p.active = true`);
    }

    if (search) {
        whereClauses.push(`p.productname ILIKE $${paramIdx}`);
        params.push(`%${search}%`);
        paramIdx++;
    }

    if (category_id) {
        whereClauses.push(`p.category_id = $${paramIdx}`);
        params.push(category_id);
        paramIdx++;
    }

    if (brand_id) {
        whereClauses.push(`p.brand = $${paramIdx}`);
        params.push(brand_id);
        paramIdx++;
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    if (page && limit) {
        const offset = (page - 1) * limit;
        const countQuery = `SELECT COUNT(*) FROM products p ${whereString}`;
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        const dataQuery = `
            SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
            FROM products p
            LEFT JOIN category c ON p.category_id = c.category_id
            LEFT JOIN brand b ON p.brand = b.brand_id
            LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
            ${whereString}
            ORDER BY p.updated_at DESC, p.product_id DESC
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `;

        const dataParams = [...params, limit, offset];
        const result = await pool.query(dataQuery, dataParams);

        return {
            data: result.rows.map(mapProduct),
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        };
    }

    const result = await pool.query(`
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        ${whereString}
        ORDER BY p.updated_at DESC, p.product_id DESC
    `, params);
    return result.rows.map(mapProduct);
};

exports.getProductById = async (id) => {
    // Check if ID is numeric to prevent PG error
    if (isNaN(id)) {
        return null;
    }
    const result = await pool.query(
        `SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
         FROM products p 
         LEFT JOIN category c ON p.category_id = c.category_id 
         LEFT JOIN brand b ON p.brand = b.brand_id
         LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
         WHERE p.product_id = $1`,
        [id]
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
};

exports.getActiveProducts = async () => {
    const result = await pool.query(`
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.active = true
        ORDER BY p.updated_at DESC, p.product_id DESC
    `);
    return result.rows.map(mapProduct);
};

exports.getFeaturedProducts = async (query) => {
    const result = await pool.query(`
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.promoted = true AND p.active = true 
        ORDER BY p.updated_at DESC, p.product_id DESC
        LIMIT 8
    `);
    return result.rows.map(mapProduct);
};

exports.getRelatedProducts = async (productId, category, limit = 4) => {
    // Fetch products from same category, excluding current product
    // Supports category being a name (string) because frontend passes name.

    let query = `
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.product_id != $1 AND p.active = true
    `;
    const params = [productId];

    if (category) {
        // Assume category is a name string like "Health"
        query += ` AND (c.name = $2 OR p.category_id::text = $2)`;
        params.push(category);
    }

    query += ` LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows.map(mapProduct);
};

exports.createProduct = async (product) => {
    const {
        productname, description, shortdescription, price, originalprice,
        discount, category_id: category_id, brand, image, instock, promoted,
        benefits, ingredients, usage, directions, quantity, supports, images,
        expiryinfo, subcategory_id, specifications, active
    } = product;

    const result = await pool.query(
        `INSERT INTO products 
        (productname, description, shortdescription, price, originalprice, discount, category_id, brand, image, instock, promoted, benefits, ingredients, usage, directions, quantity, supports, product_images, expiryinfo, subcategory_id, specifications, active, createdate, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW()) 
        RETURNING *`,
        [productname, description, shortdescription, price, originalprice, discount, category_id, brand, image, instock, promoted, benefits, ingredients, usage, directions, quantity || 0, supports || [], images || [], expiryinfo, subcategory_id, specifications, active !== false]
    );
    return mapProduct(result.rows[0]);
};

const storageService = require('./storageService');

// Helper to extract folder path from image URL
const getFolderFromUrl = (url) => {
    try {
        if (!url) return null;
        // URL format: .../mediveda/folder/filename
        // We need 'folder' or 'products/folder'
        // storageService.deleteFolder expects the path inside bucket, e.g. 'products/uuid'
        // existing deleteImage splits by `${BUCKET_NAME}/`

        // Example: https://xyz.supabase.co/.../mediveda/products/123/img.jpg
        const parts = url?.split('/mediveda/');
        if (!parts || parts.length < 2) return null;

        const path = parts[1]; // products/123/img.jpg
        if (!path) return null;
        const lastSlashIndex = path.lastIndexOf('/');
        if (lastSlashIndex === -1) return null;

        return path.substring(0, lastSlashIndex); // products/123
    } catch (e) {
        return null;
    }
};

exports.updateProduct = async (id, product) => {
    const {
        productname, description, shortdescription, price, originalprice,
        discount, category_id: category_id, brand, image, instock, promoted,
        benefits, ingredients, usage, directions, quantity, supports, images,
        expiryinfo, subcategory_id, specifications, active
    } = product;

    // 1. Get current product to check for removed images
    const currentRes = await pool.query("SELECT product_images FROM products WHERE product_id = $1", [id]);
    const currentImages = currentRes.rows[0]?.product_images || [];

    // 2. Identify removed images
    const newImages = images || [];
    const removedImages = currentImages.filter(img => !newImages.includes(img));

    // 3. Delete removed images from storage
    if (removedImages.length > 0) {
        console.log(`Deleting ${removedImages.length} removed images...`);
        for (const imgUrl of removedImages) {
            await storageService.deleteImage(imgUrl).catch(e => console.error(`Failed to delete image ${imgUrl}:`, e.message));
        }
    }

    const result = await pool.query(
        `UPDATE products 
        SET productname = $2, description = $3, shortdescription = $4, price = $5, originalprice = $6, 
            discount = $7, category_id = $8, brand = $9, image = $10, instock = $11, promoted = $12,
            benefits = COALESCE($13, benefits), ingredients = COALESCE($14, ingredients), 
            usage = COALESCE($15, usage), directions = COALESCE($16, directions),
            quantity = COALESCE($17, quantity), supports = COALESCE($18, supports),
            product_images = COALESCE($19, product_images),
            expiryinfo = $20, subcategory_id = $21, specifications = $22,
            active = COALESCE($23, active),
            updated_at = NOW()
        WHERE product_id = $1 
        RETURNING *`,
        [id, productname, description, shortdescription, price, originalprice, discount, category_id, brand, image, instock, promoted, benefits, ingredients, usage, directions, quantity, supports, images, expiryinfo, subcategory_id, specifications, active]
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
};

exports.deleteProduct = async (id) => {
    // 1. Get product to find image folder
    const currentRes = await pool.query("SELECT product_images, image FROM products WHERE product_id = $1", [id]);
    const product = currentRes.rows[0];

    if (product) {
        // Try to find folder from images array or main image
        const images = product.product_images || [];
        if (product.image) images.push(product.image);

        // Find a valid folder path from any image
        let folderToDelete = null;
        for (const img of images) {
            const folder = getFolderFromUrl(img);
            if (folder && folder.startsWith('products/')) {
                folderToDelete = folder;
                break;
            }
        }

        if (folderToDelete) {
            console.log(`Deleting product folder: ${folderToDelete}`);
            await storageService.deleteFolder(folderToDelete).catch(e => console.error(`Failed to delete folder ${folderToDelete}:`, e.message));
        }
    }

    const result = await pool.query("DELETE FROM products WHERE product_id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.toggleProductStatus = async (id) => {
    const result = await pool.query(`
        UPDATE products 
        SET active = NOT active, updated_at = NOW() 
        WHERE product_id = $1 
        RETURNING *
    `, [id]);
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
};
