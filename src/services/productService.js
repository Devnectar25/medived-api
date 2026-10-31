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
    stockQuantity: p.stock_quantity !== undefined && p.stock_quantity !== null ? p.stock_quantity : (p.quantity || 0),
    benefits: p.benefits,
    ingredients: p.ingredients,
    usage: p.usage,
    directions: p.directions,
    storageInstructions: p.storage_instructions || p.storageinstructions || '',
    medicineSize: p.medicine_size || p.medicinesize || '',
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
         WHERE p.product_id = $1::integer`,
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
        WHERE p.product_id != $1::integer 
          AND p.active = true 
          AND p.instock = true 
          AND (COALESCE(p.stock_quantity, p.quantity, 1) > 0)
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
    let related = result.rows || [];

    // If we have fewer products than the limit, fill the rest with other active in-stock products
    if (related.length < limit) {
        const extraLimit = limit - related.length;
        const alreadyFetchedIds = related.map(p => parseInt(p.product_id)).concat(parseInt(productId));

        const extraQuery = `
            SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
            FROM products p
            LEFT JOIN category c ON p.category_id = c.category_id
            LEFT JOIN brand b ON p.brand = b.brand_id
            LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
            WHERE p.active = true 
              AND p.instock = true 
              AND (COALESCE(p.stock_quantity, p.quantity, 1) > 0)
              AND p.product_id NOT IN (${alreadyFetchedIds.map((_, i) => `$${i + 1}`).join(',')})
            ORDER BY p.promoted DESC, p.rating DESC NULLS LAST
            LIMIT $${alreadyFetchedIds.length + 1}
        `;

        try {
            const extraResult = await pool.query(extraQuery, [...alreadyFetchedIds, extraLimit]);
            related = related.concat(extraResult.rows || []);
        } catch (e) {
            console.error("Error fetching extra related products:", e);
        }
    }

    return related.map(mapProduct);
};

exports.createProduct = async (product) => {
    const {
        productname, description, shortdescription, price, originalprice,
        discount, category_id: category_id, brand, image, instock, promoted,
        benefits, ingredients, usage, directions, quantity, supports, images,
        expiryinfo, subcategory_id, specifications, active, storage_instructions, storageInstructions, medicine_size, medicineSize
    } = product;

    const result = await pool.query(
        `INSERT INTO products 
        (productname, description, shortdescription, price, originalprice, discount, category_id, brand, image, instock, promoted, benefits, ingredients, usage, directions, quantity, stock_quantity, supports, product_images, expiryinfo, subcategory_id, specifications, active, storage_instructions, medicine_size, createdate, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW()) 
        RETURNING *`,
        [productname, description, shortdescription, price, originalprice, discount, category_id, brand, image, instock, promoted, benefits, ingredients, usage, directions, quantity || 0, supports || [], images || [], expiryinfo, subcategory_id, specifications, active !== false, storage_instructions !== undefined ? storage_instructions : (storageInstructions || ''), medicine_size !== undefined ? medicine_size : (medicineSize || '')]
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
        expiryinfo, subcategory_id, specifications, active, storage_instructions, storageInstructions, medicine_size, medicineSize
    } = product;

    // 1. Get current product to check for removed images
    const currentRes = await pool.query("SELECT product_images FROM products WHERE product_id = $1::integer", [id]);
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
            quantity = COALESCE($17, quantity), 
            stock_quantity = COALESCE($17, stock_quantity),
            supports = COALESCE($18, supports),
            product_images = COALESCE($19, product_images),
            expiryinfo = $20, subcategory_id = $21, specifications = $22,
            active = COALESCE($23, active),
            storage_instructions = COALESCE($24, storage_instructions),
            medicine_size = COALESCE($25, medicine_size),
            updated_at = NOW()
        WHERE product_id = $1::integer 
        RETURNING *`,
        [id, productname, description, shortdescription, price, originalprice, discount, category_id, brand, image, instock, promoted, benefits, ingredients, usage, directions, quantity, supports, images, expiryinfo, subcategory_id, specifications, active, storage_instructions !== undefined ? storage_instructions : (storageInstructions !== undefined ? storageInstructions : null), medicine_size !== undefined ? medicine_size : (medicineSize !== undefined ? medicineSize : null)]
    );
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
};

exports.deleteProduct = async (id) => {
    // 1. Get product to find image folder
    const currentRes = await pool.query("SELECT product_images, image FROM products WHERE product_id = $1::integer", [id]);
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
            // console.log(`Deleting product folder: ${folderToDelete}`);
            await storageService.deleteFolder(folderToDelete).catch(e => console.error(`Failed to delete folder ${folderToDelete}:`, e.message));
        }
    }

    const result = await pool.query("DELETE FROM products WHERE product_id = $1::integer RETURNING *", [id]);
    return result.rows[0];
};

exports.toggleProductStatus = async (id) => {
    const result = await pool.query(`
        UPDATE products 
        SET active = NOT active, updated_at = NOW() 
        WHERE product_id = $1::integer 
        RETURNING *
    `, [id]);
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
};

/**
 * Simple chatbot product search (no NLP)
 */
exports.simpleChatbotSearch = async (query) => {
    if (!query) return [];

    const trimmed = query.trim();
    if (!trimmed) return [];

    const searchPattern = `%${trimmed}%`;
    const words = trimmed.split(/\s+/).filter(w => w.length > 1);

    // Build multi-word condition if multiple words exist
    let multiWordCondition = '';
    let multiWordParams = [];
    if (words.length > 1) {
        const wordConditions = words.map((_, i) => `(p.productname ILIKE $${i + 3} OR p.description ILIKE $${i + 3} OR c.name ILIKE $${i + 3})`);
        multiWordCondition = `OR (${wordConditions.join(' AND ')})`;
        multiWordParams = words.map(w => `%${w}%`);
    }

    const sql = `
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.active = true AND (
            p.productname ILIKE $1 OR 
            p.description ILIKE $1 OR
            c.name ILIKE $1 OR
            b.name ILIKE $1
            ${multiWordCondition}
        )
        ORDER BY 
            CASE 
                -- Exact full product name match
                WHEN LOWER(p.productname) = LOWER($2) THEN 1
                -- Product name starts with query
                WHEN LOWER(p.productname) ILIKE LOWER($2) || '%' THEN 2
                -- Full query appears in product name
                WHEN p.productname ILIKE $1 THEN 3
                ${words.length > 1 ? `WHEN (${words.map((_, i) => `p.productname ILIKE $${i + 3}`).join(' AND ')}) THEN 4` : ''}
                -- Category name matches
                WHEN c.name ILIKE $1 THEN 5
                -- Brand name matches
                WHEN b.name ILIKE $1 THEN 6
                ${words.length > 1 ? `WHEN (${words.map((_, i) => `(p.productname ILIKE $${i + 3} OR p.description ILIKE $${i + 3})`).join(' AND ')}) THEN 7` : ''}
                -- Short description matches
                WHEN p.shortdescription ILIKE $1 THEN 8
                -- General description matches
                WHEN p.description ILIKE $1 THEN 9
                ELSE 10
            END ASC,
            p.rating DESC NULLS LAST,
            p.productname ASC
        LIMIT 20
    `;

    const allParams = [searchPattern, trimmed, ...multiWordParams];
    const result = await pool.query(sql, allParams);
    return result.rows.map(mapProduct);
};

exports.chatbotSearchProducts = async (query) => {
    return this.simpleChatbotSearch(query);
};

/**
 * Chatbot search for products under a certain price
 */
exports.chatbotSearchByPrice = async (maxPrice) => {
    const sql = `
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.active = true AND p.price <= $1
        ORDER BY p.price DESC
        LIMIT 20
    `;

    const result = await pool.query(sql, [maxPrice]);
    return result.rows.map(mapProduct);
};

/**
 * Chatbot search for products above a certain price
 */
exports.chatbotSearchByPriceAbove = async (minPrice) => {
    const sql = `
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.active = true AND p.price >= $1
        ORDER BY p.price ASC
        LIMIT 20
    `;

    const result = await pool.query(sql, [minPrice]);
    return result.rows.map(mapProduct);
};

/**
 * Chatbot: get all available products sorted by popularity.
 * Used when user says "show me products" / "list all products" with no specific keyword.
 */
exports.chatbotGetProducts = async (limit = 10) => {
    const sql = `
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.active = true
        ORDER BY p.promoted DESC, p.rating DESC NULLS LAST, p.updated_at DESC
        LIMIT $1
    `;
    const result = await pool.query(sql, [limit]);
    return result.rows.map(mapProduct);
};

/**
 * Chatbot: search products by category name.
 * Used when user says "show me ayurvedic products" / "list herbal items".
 */
exports.chatbotSearchByCategory = async (categoryName, limit = 10) => {
    const searchPattern = `%${categoryName.trim()}%`;
    const sql = `
        SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
        FROM products p
        LEFT JOIN category c ON p.category_id = c.category_id
        LEFT JOIN brand b ON p.brand = b.brand_id
        LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
        WHERE p.active = true
          AND (
              c.name ILIKE $1
              OR p.productname ILIKE $1
              OR p.description ILIKE $1
              OR p.shortdescription ILIKE $1
              OR b.name ILIKE $1
              OR sc.name ILIKE $1
          )
        ORDER BY 
            CASE
                WHEN c.name ILIKE $1 THEN 1
                WHEN sc.name ILIKE $1 THEN 2
                WHEN p.productname ILIKE $1 THEN 3
                WHEN b.name ILIKE $1 THEN 4
                WHEN p.shortdescription ILIKE $1 THEN 5
                ELSE 6
            END ASC,
            p.promoted DESC, 
            p.rating DESC NULLS LAST,
            p.productname ASC
        LIMIT $2
    `;
    const result = await pool.query(sql, [searchPattern, limit]);
    return result.rows.map(mapProduct);
};


const XLSX = require('xlsx');

exports.importProductsFromExcelBuffer = async (buffer) => {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
        throw new Error('Excel file has no sheets');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    return exports.importProductsFromRows(rows);
};

exports.importProductsFromRows = async (rows, options = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { total: 0, imported: 0, updated: 0, errors: ['No data found in rows'] };
    }

    const catRes = await pool.query('SELECT category_id, name FROM category');
    const brandRes = await pool.query('SELECT brand_id, name FROM brand');
    const subRes = await pool.query('SELECT srno, category_id, name FROM subcategory');

    const categoryMap = new Map();
    catRes.rows.forEach(c => categoryMap.set(c.name.trim().toLowerCase(), c.category_id));

    const brandMap = new Map();
    brandRes.rows.forEach(b => brandMap.set(b.name.trim().toLowerCase(), b.brand_id));

    const subcategoryMap = new Map();
    subRes.rows.forEach(s => subcategoryMap.set(`${s.category_id}_${s.name.trim().toLowerCase()}`, s.srno));

    const getOrCreateCategory = async (catName) => {
        if (!catName || !catName.toString().trim()) {
            if (categoryMap.size > 0) return categoryMap.values().next().value;
            const ins = await pool.query("INSERT INTO category (name, active, createdate) VALUES ('General', true, NOW()) RETURNING category_id");
            categoryMap.set('general', ins.rows[0].category_id);
            return ins.rows[0].category_id;
        }
        const key = catName.toString().trim().toLowerCase();
        if (categoryMap.has(key)) return categoryMap.get(key);

        const ins = await pool.query("INSERT INTO category (name, active, createdate) VALUES ($1, true, NOW()) RETURNING category_id", [catName.toString().trim()]);
        const newId = ins.rows[0].category_id;
        categoryMap.set(key, newId);
        return newId;
    };

    const getOrCreateBrand = async (brandName) => {
        if (!brandName || !brandName.toString().trim()) {
            if (brandMap.size > 0) return brandMap.values().next().value;
            const ins = await pool.query("INSERT INTO brand (name, active, createdate) VALUES ('Generic', true, NOW()) RETURNING brand_id");
            brandMap.set('generic', ins.rows[0].brand_id);
            return ins.rows[0].brand_id;
        }
        const key = brandName.toString().trim().toLowerCase();
        if (brandMap.has(key)) return brandMap.get(key);

        const ins = await pool.query("INSERT INTO brand (name, active, createdate) VALUES ($1, true, NOW()) RETURNING brand_id", [brandName.toString().trim()]);
        const newId = ins.rows[0].brand_id;
        brandMap.set(key, newId);
        return newId;
    };

    const getOrCreateSubcategory = async (subName, catId) => {
        if (!subName || !subName.toString().trim() || !catId) return null;
        const key = `${catId}_${subName.toString().trim().toLowerCase()}`;
        if (subcategoryMap.has(key)) return subcategoryMap.get(key);

        const ins = await pool.query("INSERT INTO subcategory (category_id, name, active, createdate) VALUES ($1, $2, true, NOW()) RETURNING srno", [catId, subName.toString().trim()]);
        const newId = ins.rows[0].srno;
        subcategoryMap.set(key, newId);
        return newId;
    };

    let importedCount = 0;
    let updatedCount = 0;
    const errors = [];
    const affectedProductIds = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        const productName = (row['Product Name'] || row.Product || row.productname || row.name || row.Title || row.title || '').toString().trim();
        if (!productName) {
            errors.push(`Row ${rowNum}: Skipped because product name is missing.`);
            continue;
        }

        try {
            const catName = row.Category || row['Category Name'] || row.category_name || row.category || '';
            const brandName = row.Brand || row['Brand Name'] || row.brand_name || row.brand || '';
            const subName = row.Subcategory || row['Sub Category'] || row['Subcategory Name'] || row['Sub-Category'] || row['Sub-category'] || row.subcategory_name || row.subcategory || '';

            const categoryId = await getOrCreateCategory(catName);
            const brandId = await getOrCreateBrand(brandName);
            const subcategoryId = await getOrCreateSubcategory(subName, categoryId);

            const rawOriginalPrice = row['Original Price'] || row.originalprice || row['OriginalPrice'] || row['MRP (Rs)'] || row.MRP || row.Price || row.price || 0;
            const originalPrice = parseFloat(rawOriginalPrice) || 0;
            const discount = parseFloat(row['Discount %'] || row.Discount || row.discount || 0);
            const rawPrice = row.Price || row.price || row['Price (Current)'] || row['Current Price'] || (discount > 0 ? (originalPrice - (originalPrice * discount / 100)) : originalPrice);
            const price = parseFloat(rawPrice) || originalPrice;

            const description = (row.Description || row.description || row.Desc || `${productName} Ayurvedic formulation`).toString().trim();
            const shortDescription = (row['Short Description'] || row.shortdescription || row.short_description || '').toString().trim();

            const medicineSize = (row['Medicine Size'] || row.Size || row['Pack Size'] || row.medicinesize || row.medicine_size || row.size || '').toString().trim();
            const storageInstructions = (row['Storage Instructions'] || row['Storage Instructions '] || row['Storage'] || row.storage_instructions || row.storageInstructions || '').toString().trim();

            const directionParts = [
                row['Direction to use'],
                row['Direction to use_1'],
                row['Directions for Use'],
                row.Directions,
                row.directions,
                row.usage
            ].filter(Boolean).map(d => d.toString().trim());
            const directionsText = directionParts.join('\n');
            const usageArray = directionParts.flatMap(d => d.split('\n')).map(s => s.trim()).filter(Boolean);

            let benefits = [];
            const rawBenefits = row.Benefits || row.benefits || row['Key Benefits'];
            if (Array.isArray(rawBenefits)) {
                benefits = rawBenefits;
            } else if (typeof rawBenefits === 'string' && rawBenefits.trim()) {
                benefits = rawBenefits.split(/[;\n\u2022]/).map(b => b.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
            }

            let ingredients = [];
            const rawIngredients = row.Ingredients || row.ingredients || row['Key Ingredients'];
            if (Array.isArray(rawIngredients)) {
                ingredients = rawIngredients;
            } else if (typeof rawIngredients === 'string' && rawIngredients.trim()) {
                ingredients = rawIngredients.split(/[,;\n]/).map(ig => ig.trim()).filter(Boolean);
            }

            let supports = [];
            const rawSupports = row.Supports || row.supports || row['Health Concerns'] || row['Health Tags'];
            if (Array.isArray(rawSupports)) {
                supports = rawSupports;
            } else if (typeof rawSupports === 'string' && rawSupports.trim()) {
                supports = rawSupports.split(/[,;\n]/).map(sp => sp.trim()).filter(Boolean);
            }

            const quantity = parseInt(row.Quantity || row.Stock || row.stock_quantity || row.quantity || 100) || 100;
            const inStock = quantity > 0;
            const active = row.Active !== undefined ? (row.Active === true || row.Active === 'true' || row.Active === 1 || row.Active === '1') : true;

            const rawImage = row.Image || row['Image URL'] || row.image || row.Images || '';
            const image = (typeof rawImage === 'string' && rawImage.trim().startsWith('http')) ? rawImage.trim() : 'https://via.placeholder.com/300';
            const productImages = [image];

            const existing = await pool.query(
                "SELECT product_id FROM products WHERE TRIM(LOWER(productname)) = TRIM(LOWER($1)) LIMIT 1",
                [productName]
            );

            if (existing.rows.length > 0) {
                const prodId = existing.rows[0].product_id;
                await pool.query(
                    `UPDATE products 
                    SET description = $2, shortdescription = $3, price = $4, originalprice = $5,
                        discount = $6, category_id = $7, brand = $8, image = $9, instock = $10,
                        benefits = $11, ingredients = $12, usage = $13, directions = $14,
                        quantity = $15, stock_quantity = $15, supports = $16, product_images = $17,
                        subcategory_id = $18, active = $19, storage_instructions = $20, medicine_size = $21,
                        updated_at = NOW()
                    WHERE product_id = $1`,
                    [prodId, description, shortDescription, price, originalPrice, discount, categoryId, brandId, image, inStock, benefits, ingredients, usageArray, directionsText, quantity, supports, productImages, subcategoryId, active, storageInstructions, medicineSize]
                );
                affectedProductIds.push(prodId);
                updatedCount++;
            } else {
                const insRes = await pool.query(
                    `INSERT INTO products 
                    (productname, description, shortdescription, price, originalprice, discount, category_id, brand, image, instock, promoted, benefits, ingredients, usage, directions, quantity, stock_quantity, supports, product_images, subcategory_id, active, storage_instructions, medicine_size, createdate, updated_at) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12, $13, $14, $15, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW()) RETURNING product_id`,
                    [productName, description, shortDescription, price, originalPrice, discount, categoryId, brandId, image, inStock, benefits, ingredients, usageArray, directionsText, quantity, supports, productImages, subcategoryId, active, storageInstructions, medicineSize]
                );
                if (insRes.rows[0]) {
                    affectedProductIds.push(insRes.rows[0].product_id);
                }
                importedCount++;
            }
        } catch (rowErr) {
            console.error(`Error importing row ${rowNum} (${productName}):`, rowErr.message);
            errors.push(`Row ${rowNum} (${productName}): ${rowErr.message}`);
        }
    }

    if (affectedProductIds.length > 0) {
        try {
            await pool.query(
                `INSERT INTO product_sheet_imports 
                (sheet_name, file_name, total_products, imported_count, updated_count, product_ids, status, uploaded_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW())`,
                [
                    options.sheetName || 'Imported Sheet',
                    options.fileName || 'Excel Import',
                    rows.length,
                    importedCount,
                    updatedCount,
                    affectedProductIds
                ]
            );
        } catch (histErr) {
            console.error('Failed to record sheet import history:', histErr);
        }
    }

    return {
        total: rows.length,
        imported: importedCount,
        updated: updatedCount,
        errors
    };
};

exports.getImportHistory = async () => {
    const res = await pool.query(`
        SELECT id, sheet_name, file_name, total_products, imported_count, updated_count,
               COALESCE(array_length(product_ids, 1), 0) as live_count,
               status, uploaded_at, created_by
        FROM product_sheet_imports
        ORDER BY uploaded_at DESC
    `);
    return res.rows;
};

exports.deleteImportHistory = async (id) => {
    const res = await pool.query("SELECT * FROM product_sheet_imports WHERE id = $1", [id]);
    if (res.rows.length === 0) {
        throw new Error("Sheet import history record not found");
    }
    const importRecord = res.rows[0];
    const productIds = importRecord.product_ids || [];

    let deletedCount = 0;
    if (productIds.length > 0) {
        // 1. Clean up references in all related tables to guarantee complete deletion and prevent foreign key blocks
        await pool.query("DELETE FROM wishlist WHERE product_id = ANY($1::integer[])", [productIds]).catch(() => {});
        await pool.query("DELETE FROM review WHERE productid = ANY($1::integer[])", [productIds]).catch(() => {});
        await pool.query("DELETE FROM coupon_products WHERE product_id = ANY($1::integer[])", [productIds]).catch(() => {});
        await pool.query("DELETE FROM whatsapp_campaign_products WHERE product_id = ANY($1::integer[])", [productIds]).catch(() => {});
        await pool.query("DELETE FROM cart_items WHERE product_id = ANY($1::integer[])", [productIds]).catch(() => {});
        
        const stringIds = productIds.map(x => x.toString());
        await pool.query("DELETE FROM favorites WHERE productid = ANY($1::varchar[])", [stringIds]).catch(() => {});
        await pool.query("DELETE FROM chatbot_product_clicks WHERE product_id = ANY($1::varchar[])", [stringIds]).catch(() => {});

        // 2. Delete products from main products table
        const delRes = await pool.query(
            "DELETE FROM products WHERE product_id = ANY($1::integer[]) RETURNING product_id",
            [productIds]
        );
        deletedCount = delRes.rowCount;
    }

    // 3. Remove sheet record from product_sheet_imports
    await pool.query("DELETE FROM product_sheet_imports WHERE id = $1", [id]);

    return {
        success: true,
        deletedSheet: importRecord.sheet_name,
        deletedFile: importRecord.file_name,
        deletedProductsCount: deletedCount
    };
};
