const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
// const puppeteer = require('puppeteer'); // Commented out for Vercel fix
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const orderService = require('./orderService');
const settingsService = require('./settingsService');
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
 * Invoice is issued only for orders delivered successfully:
 *  - regular orders with status "Delivered"
 *  - replacement shipments (-REP orders) with status "Delivered"
 *  - legacy in-order replacements that reached the customer ("Replaced" / "Replacement Delivered")
 */
const INVOICE_ELIGIBLE_STATUSES = ['Delivered', 'Replaced', 'Replacement Delivered', 'Return Rejected', 'Replace Rejected'];

const isItemCancelled = (item) => {
    if (!item) return false;
    const status = typeof item === 'string' ? item : (item.status || '');
    const s = String(status).trim().toLowerCase();
    if (s.includes('reject') || s.includes('denied')) return false;
    if (s.includes('cancel')) return true;
    if (typeof item === 'object' && item.cancel_reason && item.cancel_reason !== 'Not specified' && item.cancel_reason.trim() !== '') {
        return true;
    }
    return false;
};

const isItemReturned = (item) => {
    if (!item) return false;
    const status = typeof item === 'string' ? item : (item.status || '');
    const s = String(status).trim().toLowerCase();
    if (s.includes('reject') || s.includes('denied')) return false;
    return s.includes('return') ||
           s.includes('refund') ||
           s === 'received at homved' ||
           s === 'restocked';
};

const isItemReturnedOrCancelled = (item) => {
    return isItemCancelled(item) || isItemReturned(item);
};
exports.isInvoiceEligible = (order) => {
    if (!order) return false;
    let items = order.items || [];
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }

    const wasDelivered = Boolean(order.delivered_at) || 
                         INVOICE_ELIGIBLE_STATUSES.includes(order.status) || 
                         order.is_replacement === true ||
                         items.some(i => INVOICE_ELIGIBLE_STATUSES.includes(i.status));
    if (!wasDelivered) return false;

    // Multi-item orders: if one item is returned, other delivered items stay with the customer.
    // An invoice is issued only if there is at least one active (kept) item that has NOT been returned or cancelled.
    const hasKeptItems = items.some(i => !isItemReturnedOrCancelled(i.status));
    return hasKeptItems;
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
    let rawItems = order.items || [];
    if (typeof rawItems === 'string') {
        try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; }
    }
    const activeItems = rawItems.filter(item => !isItemReturnedOrCancelled(item));

    if (activeItems.length === 0 && !order.is_replacement) {
        throw new Error(`Cannot generate invoice: All items in order #${order.order_number} have been returned or cancelled.`);
    }

    const cancelledItems = rawItems.filter(item => isItemCancelled(item));
    const returnedItems = rawItems.filter(item => isItemReturned(item));

    const activeItemsSum = activeItems.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1)), 0);
    const cancelledItemsSum = cancelledItems.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1)), 0);
    const returnedItemsSum = returnedItems.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1)), 0);

    const orderRefundEligible = parseFloat(order.refund_eligible_amount || 0);
    const orderInitialSubtotal = parseFloat(order.initial_subtotal || 0);
    const orderCurrentSubtotal = parseFloat(order.subtotal || 0);

    let effectiveCancellationSum = cancelledItemsSum;
    let effectiveReturnedSum = returnedItemsSum;

    if (effectiveCancellationSum === 0 && effectiveReturnedSum === 0) {
        if (orderInitialSubtotal > orderCurrentSubtotal && orderCurrentSubtotal > 0) {
            effectiveCancellationSum = Math.max(0, orderInitialSubtotal - orderCurrentSubtotal);
        } else if (orderRefundEligible > 0 && orderRefundEligible < (activeItemsSum + orderRefundEligible)) {
            effectiveCancellationSum = orderRefundEligible;
        }
    }

    const hasCancellationAdjustment = effectiveCancellationSum > 0;
    const hasReturnAdjustment = effectiveReturnedSum > 0;
    const hasAdjustments = hasCancellationAdjustment || hasReturnAdjustment;

    const originalSubtotal = (orderInitialSubtotal > 0)
        ? orderInitialSubtotal
        : (activeItemsSum + effectiveCancellationSum + effectiveReturnedSum);

    // Subtotal strictly reflects kept/active products
    const subtotal = activeItemsSum > 0 
        ? activeItemsSum 
        : (orderCurrentSubtotal > 0 ? orderCurrentSubtotal : originalSubtotal);

    const originalDiscount = parseFloat(order.discount_amount || 0);
    // Discount absorbed by remaining active items cannot exceed active subtotal
    const discountAmount = Math.min(originalDiscount, subtotal);
    const shippingFee = parseFloat(order.shipping || 0);
    const storeSettings = await settingsService.getSettings();
    const isGstEnabled = !!storeSettings.gst?.enabled || parseFloat(order.gst_amount || 0) > 0;
    const gstRate = parseFloat(storeSettings.gst?.defaultRate || 18);
    const orderGstAmount = parseFloat(order.gst_amount || 0);
    const taxAmount = orderGstAmount > 0 
        ? orderGstAmount 
        : (isGstEnabled ? (subtotal * (gstRate / 100)) : 0);

    const cardSurcharge = parseFloat(order.card_surcharge || 0);
    const codCharge = parseFloat(order.cod_charge || 0);
    const cardSurchargeRate = parseFloat(storeSettings.cardSurcharge?.rate || 2.0);
    const total = Math.max(0, subtotal + shippingFee - discountAmount);

    // Calculate tax-inclusive subtotal if needed or just use as is
    // For this template, we'll follow the provided subtotal - discount = total logic
    
    const createdAt = new Date(order.created_at);
    const dueDate = new Date(createdAt);
    dueDate.setDate(createdAt.getDate() + 15);



    // ── Replacement (-REP) orders: list the real product value, then deduct it as a free replacement ──
    const isReplacement = order.is_replacement === true;
    let replacementData = null;
    if (isReplacement) {
        let parentNumber = '';
        const priceByProduct = new Map();
        if (order.parent_order_id) {
            const parentRes = await pool.query(
                `SELECT o.order_number, oi.product_id, oi.price
                 FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
                 WHERE o.id = $1`,
                [order.parent_order_id]
            );
            parentNumber = parentRes.rows[0]?.order_number || '';
            parentRes.rows.forEach(r => {
                const key = String(r.product_id);
                const price = parseFloat(r.price) || 0;
                if (!priceByProduct.has(key) || price > priceByProduct.get(key)) priceByProduct.set(key, price);
            });
        }
        const items = (order.items || []).map(item => {
            const unit = parseFloat(item.price) || priceByProduct.get(String(item.product_id)) || 0;
            const qty = parseInt(item.quantity) || 1;
            return { name: item.name, price: unit.toFixed(2), quantity: qty, total: (unit * qty).toFixed(2), lineTotal: unit * qty };
        });
        const value = items.reduce((s, i) => s + i.lineTotal, 0);
        replacementData = { items, value, parentNumber };
    }
    
    // 4. Load the logo and convert to base64
    let logoBase64 = '';
    const possibleLogoPaths = [
        path.join(__dirname, "../assets/Logo.png"),
        path.join(__dirname, "../assets/Logo - Copy.png"),
        // Keeping these as fallback for local if needed, though the above should work now
        path.join(__dirname, "../../../reactshop-home/src/assets/Logo.png"),
        path.join(__dirname, "../../../reactshop-home/src/assets/Logo - Copy.png")
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

    // Extract recipient name and clean street address from order data
    let extractedRecipientName = '';
    let cleanStreetAddress = (order.full_address || '').trim();

    if (cleanStreetAddress.includes(',')) {
        const firstCommaIndex = cleanStreetAddress.indexOf(',');
        const potentialName = cleanStreetAddress.substring(0, firstCommaIndex).trim();
        const potentialAddr = cleanStreetAddress.substring(firstCommaIndex + 1).trim();

        const isAddressKeyword = /^(flat|plot|house|room|shop|building|bldg|sector|street|road|lane|opp|near|behind|at|post|door|no|apt|apartment)\b/i.test(potentialName);
        const hasDigits = /\d/.test(potentialName);

        if (!isAddressKeyword && !hasDigits && potentialName.length >= 2 && potentialName.length <= 50 && potentialAddr.length > 0) {
            extractedRecipientName = potentialName;
            cleanStreetAddress = potentialAddr;
        }
    }

    const formatTitleCase = (str) => {
        if (!str || typeof str !== 'string') return '';
        return str
            .toLowerCase()
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
            .trim();
    };

    let resolvedUserName = extractedRecipientName;
    if (!resolvedUserName && order.shippingAddress) {
        resolvedUserName = (order.shippingAddress.fullName || `${order.shippingAddress.firstName || ''} ${order.shippingAddress.lastName || ''}`).trim();
    }
    if (!resolvedUserName) {
        resolvedUserName = (order.customer_name || user.fullname || '').trim();
    }
    if (!resolvedUserName || resolvedUserName.includes('@') || resolvedUserName.toLowerCase() === 'customer') {
        const emailFallback = (user.emailid || order.customer_email || order.user_id || '').split('@')[0];
        resolvedUserName = emailFallback ? emailFallback.replace(/[._\d]+/g, ' ').trim() : 'Customer';
    }
    resolvedUserName = formatTitleCase(resolvedUserName) || 'Customer';

    // Strip recipient name if cleanStreetAddress still starts with it
    if (resolvedUserName && cleanStreetAddress.toLowerCase().startsWith(resolvedUserName.toLowerCase())) {
        cleanStreetAddress = cleanStreetAddress.substring(resolvedUserName.length).replace(/^[\s,]+/, '').trim() || cleanStreetAddress;
    }

    const cleanCity = formatTitleCase(order.shippingAddress?.city || order.city || '');
    const cleanState = formatTitleCase(order.shippingAddress?.state || order.state || '');
    const cleanPincode = (order.shippingAddress?.pincode || order.postal_code || '').toString().trim();
    const cityStatePin = [cleanCity, cleanState ? `${cleanState}${cleanPincode ? ` - ${cleanPincode}` : ''}` : cleanPincode].filter(Boolean).join(', ');
    const resolvedUserAddress = [cleanStreetAddress, cityStatePin].filter(Boolean).join(', ');
    const resolvedUserPhone = order.shippingAddress?.phone || order.customer_phone || user.contactno || 'N/A';

    const templateData = {
        currencySymbol: getCurrencySymbol(),
        logoBase64: logoBase64,
        orderId: order.order_number,
        issueDate: createdAt.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }),
        userName: resolvedUserName,
        userAddress: resolvedUserAddress || 'N/A',
        userPhone: resolvedUserPhone,
        paymentMethod: order.payment_method ? order.payment_method.toUpperCase() : 'N/A',
        items: rawItems.map(item => {
            const isCancelled = isItemCancelled(item);
            const isReturned = isItemReturned(item);
            const price = parseFloat(item.price) || 0;
            const qty = parseInt(item.quantity) || 1;
            return {
                name: item.name,
                price: price.toFixed(2),
                quantity: qty,
                total: (price * qty).toFixed(2),
                isCancelled,
                isReturned,
                isDelivered: !isCancelled && !isReturned,
                statusBadge: isCancelled ? 'CANCELLED' : (isReturned ? 'RETURNED' : 'DELIVERED')
            };
        }),
        originalSubtotal: originalSubtotal.toFixed(2),
        hasAdjustments,
        hasCancellationAdjustment,
        cancellationAdjustment: effectiveCancellationSum.toFixed(2),
        hasReturnAdjustment,
        returnAdjustment: effectiveReturnedSum.toFixed(2),
        subtotal: subtotal.toFixed(2),
        shippingFee: parseFloat(order.shipping || 0).toFixed(2),
        hasDiscount: discountAmount > 0,
        couponCode: order.coupon_code || '',
        discount: (discountAmount > 0 && subtotal > 0) ? ((discountAmount / subtotal) * 100).toFixed(0) : 0,
        discountLabel: (order.coupon_code && (order.coupon_code.toUpperCase().includes('BOGO') || order.coupon_code.toUpperCase().includes('FREE'))) 
            ? `BOGO Offer Applied`
            : `Discount (${(discountAmount > 0 && subtotal > 0) ? ((discountAmount / subtotal) * 100).toFixed(0) : 0}%)`,
        discountAmount: discountAmount.toFixed(2),
        hasTax: isGstEnabled && taxAmount > 0,
        taxRate: gstRate,
        taxAmount: taxAmount.toFixed(2),
        hasCardSurcharge: cardSurcharge > 0,
        cardSurchargeRate: cardSurchargeRate,
        cardSurchargeAmount: cardSurcharge.toFixed(2),
        hasCodCharge: codCharge > 0,
        codChargeAmount: codCharge.toFixed(2),
        grandTotal: total.toFixed(2),
        dueDate: dueDate.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        })
    };

    if (replacementData) {
        Object.assign(templateData, {
            paymentMethod: 'FREE REPLACEMENT',
            items: replacementData.items.map(({ lineTotal, ...rest }) => rest),
            subtotal: replacementData.value.toFixed(2),
            shippingFee: '0.00',
            hasDiscount: true,
            couponCode: '',
            discount: 100,
            discountLabel: `Free Replacement${replacementData.parentNumber ? ` (against #${replacementData.parentNumber})` : ''}`,
            discountAmount: replacementData.value.toFixed(2),
            taxAmount: '0.00',
            grandTotal: '0.00',
        });
    }

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
    
    /* 
    // OLD CODE - FAILS ON VERCEL
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    */

    // NEW CODE - RESILIENT LOCAL & VERCEL COMPATIBLE
    let browser;
    try {
        const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;

        // Dynamic executable detection
        let executablePath = null;
        if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
            executablePath = process.env.CHROME_BIN;
        } else if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        } else if (isProd) {
            executablePath = await chromium.executablePath();
        } else {
            const localCandidates = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
                process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : null,
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                '/usr/bin/google-chrome',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            ].filter(Boolean);

            for (const candidate of localCandidates) {
                if (fs.existsSync(candidate)) {
                    executablePath = candidate;
                    break;
                }
            }

            if (!executablePath) {
                try {
                    executablePath = await chromium.executablePath();
                } catch (e) {}
            }

            if (!executablePath) {
                executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
            }
        }
        
        browser = await puppeteer.launch({
            args: isProd ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath,
            headless: isProd ? chromium.headless : 'new',
        });

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
    } catch (error) {
        console.error('PDF Generation Error:', error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
};

