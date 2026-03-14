const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const orderService = require('./orderService');
const pool = require('../config/db');

/**
 * Reads the currency symbol from the frontend configuration file.
 */
const getCurrencySymbol = () => {
    try {
        const configPath = path.join(__dirname, '../../../reactshop-home/src/config/currencyConfig.ts');
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf-8');
            const match = content.match(/CURRENCY_SYMBOL\s*=\s*["']([^"']+)["']/);
            return match ? match[1] : '₹';
        }
    } catch (error) {
        console.error('Error reading currency config:', error);
    }
    return '₹'; // Fallback
};

/**
 * Generates the HTML content for an invoice based on order ID.
 * @param {string|number} orderId - The database ID of the order.
 * @returns {Promise<string>} - Compiled HTML string.
 */
exports.generateInvoiceHTML = async (orderId) => {
    // 1. Fetch order details with joined address info
    const order = await orderService.getOrderById(orderId);
    if (!order) throw new Error('Order not found');

    // 2. Fetch user details for contact info
    const userResult = await pool.query(
        'SELECT username, emailid, contactno FROM users WHERE username = $1', 
        [order.user_id]
    );
    const user = userResult.rows[0] || {};

    // 3. Prepare data for Handlebars mapping
    const subtotal = parseFloat(order.subtotal || 0);
    const discountAmount = parseFloat(order.discount_amount || 0);
    const taxRate = 18; // Standard GST
    const total = parseFloat(order.total || 0);
    
    // Calculate tax-inclusive subtotal if needed or just use as is
    // For this template, we'll follow the provided subtotal - discount = total logic
    
    const createdAt = new Date(order.created_at);
    const dueDate = new Date(createdAt);
    dueDate.setDate(createdAt.getDate() + 15);

    const taxAmount = (subtotal * (taxRate / 100));
    
    // 4. Load the logo and convert to base64
    let logoBase64 = '';
    const possibleLogoPaths = [
        "C:\\workspace\\homved\\reactshop-home\\src\\assets\\Logo - Copy.png",
        "C:\\workspace\\homved\\reactshop-home\\src\\assets\\Logo.png",
        path.join(__dirname, "../../../reactshop-home/src/assets/Logo - Copy.png"),
        path.join(__dirname, "../../../reactshop-home/src/assets/Logo.png")
    ];

    for (const logoPath of possibleLogoPaths) {
        try {
            if (fs.existsSync(logoPath)) {
                const logoBuffer = fs.readFileSync(logoPath);
                logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
                console.log(`✅ Logo loaded successfully from: ${logoPath}`);
                break; // Stop after first successful load
            }
        } catch (error) {
            console.error(`Error reading logo from ${logoPath}:`, error);
        }
    }

    if (!logoBase64) {
        console.warn('⚠️ No logo found in any of the expected locations.');
    }

    const templateData = {
        currencySymbol: getCurrencySymbol(),
        logoBase64: logoBase64,
        orderId: order.order_number,
        issueDate: createdAt.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }),
        userName: order.shippingAddress ? `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}` : (user.username || 'Customer'),
        userAddress: order.full_address || `${order.shippingAddress?.address || ''}, ${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} - ${order.shippingAddress?.pincode || ''}`,
        userPhone: order.shippingAddress?.phone || user.contactno || 'N/A',
        paymentMethod: order.payment_method ? order.payment_method.toUpperCase() : 'N/A',
        items: order.items.map(item => ({
            name: item.name,
            price: parseFloat(item.price).toFixed(2),
            quantity: item.quantity,
            total: (parseFloat(item.price) * item.quantity).toFixed(2)
        })),
        subtotal: subtotal.toFixed(2),
        shippingFee: parseFloat(order.shipping || 0).toFixed(2),
        hasDiscount: discountAmount > 0,
        couponCode: order.coupon_code || '',
        discount: (discountAmount > 0 && subtotal > 0) ? ((discountAmount / subtotal) * 100).toFixed(0) : 0,
        discountAmount: discountAmount.toFixed(2),
        taxRate: taxRate,
        taxAmount: (total - subtotal - parseFloat(order.shipping || 0) + discountAmount).toFixed(2),
        grandTotal: total.toFixed(2),
        dueDate: dueDate.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        })
    };

    // 4. Load and compile the Handlebars template
    const templatePath = path.join(__dirname, '../templates/invoiceTemplate.html');
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Invoice template not found at ${templatePath}`);
    }

    const source = fs.readFileSync(templatePath, 'utf-8');
    const template = handlebars.compile(source);
    const html = template(templateData);

    return html;
};

/**
 * Generates a PDF buffer from an order ID.
 * @param {string|number} orderId - The database ID of the order.
 * @returns {Promise<Buffer>} - PDF binary data.
 */
exports.generateInvoicePDF = async (orderId) => {
    const html = await exports.generateInvoiceHTML(orderId);
    
    // Launch puppeteer to render the HTML into a PDF
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Set the HTML content
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        // Generate PDF buffer
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '10mm',
                bottom: '10mm',
                left: '10mm',
                right: '10mm'
            }
        });

        return pdfBuffer;
    } finally {
        await browser.close();
    }
};
