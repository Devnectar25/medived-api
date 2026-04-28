const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

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

exports.generateRefundReceiptHTML = async (order, refundId) => {
    let logoBase64 = '';
    const logoPath = path.join(__dirname, "../assets/Logo.png");
    try {
        if (fs.existsSync(logoPath)) {
            const logoBuffer = fs.readFileSync(logoPath);
            logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
        }
    } catch (e) { console.error("Logo load error", e); }

    const templateData = {
        currency: getCurrencySymbol(),
        logoBase64: logoBase64,
        refundId: refundId,
        orderNumber: order.order_number,
        paymentId: order.razorpay_payment_id || order.transaction_id || 'N/A',
        dateTime: new Date().toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        }),
        customerName: order.shippingAddress ? `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}` : 'Customer',
        customerPhone: order.shippingAddress?.phone || order.customerPhone || 'N/A',
        method: order.payment_method || 'Razorpay',
        amount: parseFloat(order.total || 0).toFixed(2)
    };

    const templatePath = path.join(__dirname, '../templates/refundReceiptTemplate.html');
    if (!fs.existsSync(templatePath)) throw new Error('Refund template not found');

    const source = fs.readFileSync(templatePath, 'utf-8');
    const template = handlebars.compile(source);
    return template(templateData);
};

exports.generateRefundReceiptPDF = async (order, refundId) => {
    const html = await exports.generateRefundReceiptHTML(order, refundId);
    let browser;
    try {
        const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
        browser = await puppeteer.launch({
            args: isProd ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: isProd ? await chromium.executablePath() : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: isProd ? chromium.headless : 'new',
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        // Quarter page dimensions roughly 105 x 148 mm (A6)
        return await page.pdf({
            width: '120mm', // Slightly wider for comfort
            height: '180mm',
            printBackground: true,
            margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
        });
    } catch (error) {
        console.error('Refund PDF Generation Error:', error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
};
