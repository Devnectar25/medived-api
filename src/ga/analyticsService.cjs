// src/ga/analyticsService.cjs

const { ga4Client, propertyId } = require("./ga4Client.cjs");

/**
 * Fetch high-level analytics summary for Admin Dashboard
 */
async function getAdminAnalyticsSummary(period = "7d") {
  const fallbackTrend = { value: 0, trend: null };
  const fallback = {
    view_item: 0,
    add_to_cart: 0,
    begin_checkout: 0,
    purchase: 0,

    totalUsers: fallbackTrend,
    activeUsers: fallbackTrend,
    totalOrders: fallbackTrend,
    conversionRate: fallbackTrend,
    totalRevenue: fallbackTrend,
    averageOrderValue: fallbackTrend,

    funnel: {
      viewItem: 0,
      addToCart: 0,
      beginCheckout: 0,
      purchase: 0,
      dropOffs: { viewToCart: 0, cartToCheckout: 0, checkoutToPurchase: 0 },
    },

    topProducts: [],
    topCategories: [],
  };

  try {
    let currentStart = "7daysAgo";
    let currentEnd = "today";
    let prevStart = "14daysAgo";
    let prevEnd = "8daysAgo";

    if (period === "today") {
      currentStart = "today";
      prevStart = "yesterday";
      prevEnd = "yesterday";
    } else if (period === "30d") {
      currentStart = "30daysAgo";
      prevStart = "60daysAgo";
      prevEnd = "31daysAgo";
    }

    // Helper to fetch core metrics for a given range
    const fetchCoreMetrics = async (startDate, endDate) => {
      const dateRanges = [{ startDate, endDate }];

      const [events, users, revenue] = await Promise.all([
        // 1. Events
        ga4Client.runReport({
          property: `properties/${propertyId}`,
          dateRanges,
          dimensions: [{ name: "eventName" }],
          metrics: [{ name: "eventCount" }],
        }).then(([res]) => {
          const stats = { view_item: 0, add_to_cart: 0, begin_checkout: 0, purchase: 0 };
          (res?.rows || []).forEach(row => {
            const name = row?.dimensionValues?.[0]?.value;
            const val = Number(row?.metricValues?.[0]?.value || 0);
            if (stats[name] !== undefined) stats[name] = val;
          });
          return stats;
        }),

        // 2. Users (GA4 - Total Users, Active Users)
        // NOTE: We will override these with DB values for consistency with drill-down tables.
        // Keeping GA4 call to maintain original structure/metrics availability if needed.
        ga4Client.runReport({
          property: `properties/${propertyId}`,
          dateRanges,
          metrics: [{ name: "totalUsers" }, { name: "activeUsers" }],
        }).then(([res]) => ({
          totalUsers: Number(res?.rows?.[0]?.metricValues?.[0]?.value || 0),
          activeUsers: Number(res?.rows?.[0]?.metricValues?.[1]?.value || 0),
        })),

        // 3. Revenue
        ga4Client.runReport({
          property: `properties/${propertyId}`,
          dateRanges,
          metrics: [{ name: "grossPurchaseRevenue" }],
        }).then(([res]) => Number(res?.rows?.[0]?.metricValues?.[0]?.value || 0)),
      ]);

      return { ...events, ...users, totalRevenue: revenue };
    };

    // Parallel fetch current & previous core stats
    const [current, previous] = await Promise.all([
      fetchCoreMetrics(currentStart, currentEnd),
      fetchCoreMetrics(prevStart, prevEnd)
    ]);

    // --- DB OVERRIDE FOR TOTAL USERS ---
    // Total Users KPI must come from DB (createdate) as requested
    const pool = require('../config/db');

    // Helper: Total Registered Users
    const getDbUserCount = async (endDate) => {
      try {
        const res = await pool.query('SELECT COUNT(*) as count FROM users WHERE createdate <= $1', [endDate.toISOString()]);
        return parseInt(res.rows[0].count);
      } catch (e) { return 0; }
    };

    let dbCurrentDate = new Date(); // End of current
    let dbPrevDate = new Date(); // End of previous
    // Adjust dates for DB
    if (period === 'today') {
      dbPrevDate.setDate(dbPrevDate.getDate() - 1);
    } else if (period === '7d') {
      dbPrevDate.setDate(dbPrevDate.getDate() - 7);
    } else if (period === '30d') {
      dbPrevDate.setDate(dbPrevDate.getDate() - 30);
    }

    // We only need Total Users from DB now
    const [dbTotalUsersCurr, dbTotalUsersPrev] = await Promise.all([
      getDbUserCount(dbCurrentDate),
      getDbUserCount(dbPrevDate)
    ]);
    // -----------------------------------

    // Calculate Trend
    const getTrend = (curr, prev) => {
      if (prev === 0) return null;
      return parseFloat((((curr - prev) / prev) * 100).toFixed(1));
    };

    // Helper to build KPI object
    const buildKPI = (val, prevVal) => ({
      value: val,
      trend: getTrend(val, prevVal)
    });

    // Derived Metrics Current
    const currOrders = current.purchase;
    const currConv = current.view_item > 0 ? (current.purchase / current.view_item) * 100 : 0;
    const currAOV = currOrders > 0 ? (current.totalRevenue / currOrders) : 0;

    // Derived Metrics Previous
    const prevOrders = previous.purchase;
    const prevConv = previous.view_item > 0 ? (previous.purchase / previous.view_item) * 100 : 0;
    const prevAOV = prevOrders > 0 ? (previous.totalRevenue / prevOrders) : 0;

    // Funnel Logic (Current Only needed for display)
    const calculateDropOff = (prev, curr) => {
      if (prev === 0) return null;
      return parseFloat((((prev - curr) / prev) * 100).toFixed(2));
    };

    // Top Products/Categories (Current Only)
    const dateRanges = [{ startDate: currentStart, endDate: currentEnd }];

    // Fetch Top Lists parallely
    const [productsRes, categoriesRes] = await Promise.all([
      ga4Client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        dimensions: [{ name: "itemName" }],
        metrics: [{ name: "itemRevenue" }, { name: "itemsPurchased" }],
        limit: 5,
        orderBys: [{ desc: true, metric: { metricName: "itemRevenue" } }],
      }),
      ga4Client.runReport({
        property: `properties/${propertyId}`,
        dateRanges,
        dimensions: [{ name: "itemCategory" }],
        metrics: [{ name: "itemRevenue" }, { name: "itemsPurchased" }],
        limit: 5,
        orderBys: [{ desc: true, metric: { metricName: "itemRevenue" } }],
      })
    ]);

    return {
      // Raw Counts for Chart
      view_item: current.view_item,
      add_to_cart: current.add_to_cart,
      begin_checkout: current.begin_checkout,
      purchase: current.purchase,

      // KPIs with Trends
      totalUsers: buildKPI(dbTotalUsersCurr, dbTotalUsersPrev), // DB Source
      activeUsers: buildKPI(current.activeUsers, previous.activeUsers), // GA4 Source
      totalOrders: buildKPI(currOrders, prevOrders),
      conversionRate: {
        value: parseFloat(currConv.toFixed(2)),
        trend: getTrend(currConv, prevConv)
      },
      totalRevenue: buildKPI(current.totalRevenue, previous.totalRevenue),
      averageOrderValue: {
        value: parseFloat(currAOV.toFixed(2)),
        trend: getTrend(currAOV, prevAOV)
      },

      funnel: {
        viewItem: current.view_item,
        addToCart: current.add_to_cart,
        beginCheckout: current.begin_checkout,
        purchase: current.purchase,
        dropOffs: {
          viewToCart: calculateDropOff(current.view_item, current.add_to_cart),
          cartToCheckout: calculateDropOff(current.add_to_cart, current.begin_checkout),
          checkoutToPurchase: calculateDropOff(current.begin_checkout, current.purchase),
        },
      },

      topProducts: (productsRes[0]?.rows || []).map(row => ({
        name: row?.dimensionValues?.[0]?.value || 'Unknown',
        revenue: Number(row?.metricValues?.[0]?.value || 0),
        purchases: Number(row?.metricValues?.[1]?.value || 0),
      })),

      topCategories: (categoriesRes[0]?.rows || []).map(row => ({
        name: row?.dimensionValues?.[0]?.value || 'Unknown',
        revenue: Number(row?.metricValues?.[0]?.value || 0),
        purchases: Number(row?.metricValues?.[1]?.value || 0),
      })),
    };

  } catch (error) {
    console.error('[GA4 ANALYTICS ERROR]', error.message);
    return fallback;
  }
}

/**
 * Get Top Active Users (Hybrid: GA4 + DB)
 * 1. Checks GA4 User Attributes (unifiedScreenName)
 * 2. Checks GA4 Transactions (extracts user from DB Orders with matching Transaction IDs)
 * 3. Returns combined confirmed users.
 */
async function getTopActiveUsers(period = '7d', limit = 15) {
  const pool = require('../config/db');

  try {
    let startDate = "7daysAgo";
    let endDate = "today";
    if (period === "today") { startDate = "today"; endDate = "today"; }
    else if (period === "30d") { startDate = "30daysAgo"; }

    // 1. Fetch Direct User IDs from GA4
    const [userResponse] = await ga4Client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "activeUsers" }],
      limit: limit
    });

    const directUserIds = [];
    (userResponse.rows || []).forEach(row => {
      const id = row.dimensionValues[0].value;
      if (id && id !== '(not set)') directUserIds.push(id.trim());
    });

    // 2. Fetch Transaction IDs from GA4 (To infer users who purchased)
    const [transactionResponse] = await ga4Client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "transactionId" }],
      metrics: [{ name: "grossPurchaseRevenue" }],
      limit: 100
    });

    const transactionIds = [];
    (transactionResponse.rows || []).forEach(row => {
      const tid = row.dimensionValues[0].value;
      if (tid && tid !== '(not set)') transactionIds.push(tid);
    });

    // If no data in GA4 at all, return empty
    if (directUserIds.length === 0 && transactionIds.length === 0) {
      return [];
    }

    // Calculate DB start date for filtering revenue/orders to the period
    let dbStartDate = new Date();
    if (period === 'today') dbStartDate.setHours(0, 0, 0, 0);
    else if (period === '7d') dbStartDate.setDate(dbStartDate.getDate() - 7);
    else if (period === '30d') dbStartDate.setDate(dbStartDate.getDate() - 30);

    // 3. Query DB: Union of Direct Matches and Transaction Owners
    const query = `
      WITH identified_users AS (
        SELECT username FROM users WHERE username = ANY($1) OR emailid = ANY($1)
        UNION
        SELECT user_id AS username FROM orders WHERE order_number = ANY($2) OR CAST(id as TEXT) = ANY($2)
      )
      SELECT 
        u.username,
        u.emailid as email,
        u.contactno as phone,
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(o.total), 0) as total_revenue,
        MAX(o.created_at) as last_active_date
      FROM users u
      JOIN identified_users iu ON u.username = iu.username
      LEFT JOIN orders o ON u.username = o.user_id AND o.created_at >= $3
      GROUP BY u.username, u.emailid, u.contactno
      ORDER BY total_revenue DESC
      LIMIT $4
    `;

    const dbResult = await pool.query(query, [directUserIds, transactionIds, dbStartDate.toISOString(), limit]);

    return dbResult.rows.map(row => {
      // Name Logic: Prettify username
      let display = row.username;
      if (display && display.includes('@')) {
        display = display.split('@')[0];
      }
      if (display) {
        display = display.replace(/[._]/g, ' ');
        display = display.replace(/\b\w/g, c => c.toUpperCase());
      } else {
        display = 'Guest';
      }

      // Date Logic: Custom Format (DD/MM/YYYY hh.mm.ss pm)
      let lastActive = 'N/A';
      if (row.last_active_date) {
        const d = new Date(row.last_active_date);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();

        let hr = d.getHours();
        const ampm = hr >= 12 ? 'pm' : 'am';
        hr = hr % 12 || 12;
        const hrStr = String(hr).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const sec = String(d.getSeconds()).padStart(2, '0');

        lastActive = `${dd}/${mm}/${yyyy} ${hrStr}.${min}.${sec}${ampm}`;
      }

      return {
        userId: row.username,
        name: display, // Formatted Name
        email: row.email || 'No email',
        phone: row.phone || 'No phone',
        totalOrders: parseInt(row.total_orders) || 0,
        totalRevenue: parseFloat(row.total_revenue) || 0,
        lastActiveDate: lastActive, // Formatted Date

        userName: row.username,
        userEmail: row.email,
        displayName: display,
        sessions: 0,
        purchases: parseInt(row.total_orders) || 0,
        revenue: parseFloat(row.total_revenue) || 0
      };
    });

  } catch (error) {
    console.error('[TOP ACTIVE USERS HYBRID ERROR]', error);
    return [];
  }
}

/**
 * Fetch most viewed products (Top Products)
 * Used independently or as helper
 */
async function getTopViewedProducts(limit = 5) {
  const [response] = await ga4Client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [
      {
        startDate: "7daysAgo",
        endDate: "today",
      },
    ],
    dimensions: [{ name: "itemName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: {
          matchType: "EXACT",
          value: "view_item",
        },
      },
    },
    limit,
  });

  return (
    (response?.rows || []).map((row) => ({
      productName: row?.dimensionValues?.[0]?.value || 'Unknown',
      views: Number(row?.metricValues?.[0]?.value || 0),
    }))
  );
}

/**
 * Get Top Products (GA4 Primary + DB Metadata)
 * @param {string} period - 'today', '7d', '30d'
 * @param {number} limit - Default 5
 * @param {string} sortBy - 'revenue' or 'orders'
 */
async function getTopProducts(period = '7d', limit = 5, sortBy = 'revenue') {
  const pool = require('../config/db');

  // 1. Determine Date Range for GA4
  let startDate = "7daysAgo";
  let endDate = "today";

  if (period === "today") {
    startDate = "today";
    endDate = "today";
  } else if (period === "30d") {
    startDate = "30daysAgo";
  }

  // 2. Fetch Top Products from GA4 (Source of Truth for Activity)
  try {
    const [response] = await ga4Client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: "itemName" }
      ],
      metrics: [
        { name: "itemsPurchased" },
        { name: "itemRevenue" }
      ],
      limit: limit,
      orderBys: [
        {
          desc: true,
          metric: { metricName: sortBy === 'revenue' ? 'itemRevenue' : 'itemsPurchased' }
        }
      ]
    });

    const rows = response.rows || [];
    if (rows.length === 0) {
      // console.log('[GA4 TOP PRODUCTS] No result rows for period:', period);
      return [];
    }

    // 3. Extract Names to query DB for Stock & Category
    const productNames = rows.map(row => row.dimensionValues[0].value);

    let dbMetaMap = new Map();
    if (productNames.length > 0) {
      try {
        const query = `
          SELECT p.productname, p.stock_quantity, c.name as category_name
          FROM products p
          LEFT JOIN category c ON p.category_id = c.category_id
          WHERE p.productname = ANY($1)
        `;
        const dbResult = await pool.query(query, [productNames]);
        dbResult.rows.forEach(row => {
          dbMetaMap.set(row.productname, {
            stock: row.stock_quantity,
            category: row.category_name
          });
        });
      } catch (dbError) {
        console.error('[TOP PRODUCTS DB LOOKUP ERROR]', dbError);
        // Continue without DB metadata if DB fails
      }
    }

    // 4. Merge Data
    return rows.map(row => {
      const name = row.dimensionValues[0].value;
      const orders = parseInt(row.metricValues[0].value);
      const revenue = parseFloat(row.metricValues[1].value);

      const meta = dbMetaMap.get(name);
      const stock = meta ? parseInt(meta.stock) : null;
      const categoryName = meta?.category || 'Uncategorized';

      return {
        productName: name,
        categoryName: categoryName,
        totalOrders: orders,
        totalRevenue: revenue,
        stock: stock
      };
    });

  } catch (error) {
    console.error('[TOP PRODUCTS ERROR]', error);
    if (error.response) {
      console.error('[GA4 RAW ERROR]', JSON.stringify(error.response, null, 2));
    }
    return [];
  }
}


/**
 * Get Top Categories (Hybrid: GA4 Items + DB Category Lookup)
 * Fixes "(not set)" by using DB categories for products
 */
async function getTopCategories(period = '7d', limit = 5, sortBy = 'revenue') {
  const pool = require('../config/db');

  // 1. Determine Date Range
  let startDate = "7daysAgo";
  let endDate = "today";
  if (period === "today") {
    startDate = "today";
    endDate = "today";
  } else if (period === "30d") {
    startDate = "30daysAgo";
  }

  try {
    // 2. Fetch ALL relevant products (up to 100 to get good category spread)
    const [response] = await ga4Client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "itemName" }],
      metrics: [
        { name: "itemsPurchased" },
        { name: "itemRevenue" }
      ],
      limit: 100, // Fetch top 100 products to aggregate categories
      orderBys: [{ desc: true, metric: { metricName: 'itemRevenue' } }]
    });

    const rows = response.rows || [];
    if (rows.length === 0) return [];

    // 3. Extract Names to query DB for Categories
    const productNames = rows.map(row => row.dimensionValues[0].value);
    let dbCategoryMap = new Map();

    if (productNames.length > 0) {
      try {
        // Query DB for category names of these products
        const query = `
          SELECT p.productname, c.name as category_name
          FROM products p
          LEFT JOIN category c ON p.category_id = c.category_id
          WHERE p.productname = ANY($1)
        `;
        const dbResult = await pool.query(query, [productNames]);
        dbResult.rows.forEach(row => {
          if (row.category_name) {
            dbCategoryMap.set(row.productname, row.category_name);
          }
        });
      } catch (dbError) {
        console.error('[TOP CATEGORIES DB LOOKUP ERROR]', dbError);
      }
    }

    // 4. Aggregate by Category
    const categoryStats = {};

    rows.forEach(row => {
      const productName = row.dimensionValues[0].value;
      const orders = parseInt(row.metricValues[0].value);
      const revenue = parseFloat(row.metricValues[1].value);

      // Use DB category if available, else fallback to 'Uncategorized'
      const category = dbCategoryMap.get(productName) || 'Uncategorized';

      if (!categoryStats[category]) {
        categoryStats[category] = { categoryName: category, totalOrders: 0, totalRevenue: 0 };
      }
      categoryStats[category].totalOrders += orders;
      categoryStats[category].totalRevenue += revenue;
    });

    // 5. Convert to Array and Sort
    let results = Object.values(categoryStats);

    // Sort according to requested metric
    results.sort((a, b) => {
      if (sortBy === 'revenue') return b.totalRevenue - a.totalRevenue;
      return b.totalOrders - a.totalOrders;
    });

    return results.slice(0, limit);

  } catch (error) {
    console.error('[TOP CATEGORIES HYBRID ERROR]', error);
    return [];
  }
}

/**
 * Get All Analytics Users (for Total Users Drilldown)
 * Database Only
 */
async function getAllAnalyticsUsers(limit = 100) {
  const pool = require('../config/db');
  try {
    // Basic user info - fixed column names based on schema inspection
    const query = `
      SELECT username, emailid as email, contactno as phone, createdate as created_at, 'Active' as status
      FROM users
      ORDER BY createdate DESC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows.map(row => ({
      userId: row.username,
      name: row.username,
      email: row.email,
      phone: row.phone,
      memberSince: row.created_at ? new Date(row.created_at).toISOString() : null,
      status: row.status
    }));
  } catch (error) {
    console.error('[ALL USERS ERROR]', error);
    return [];
  }
}

/**
 * Get Analytics Orders (for Revenue/Orders Drilldown)
 * Hybrid: GA4 Transaction IDs -> DB Order Details
 * Fallback: If ID match fails, use GA4 Count -> DB Recent Orders
 */
async function getAnalyticsOrders(period = '7d', limit = 100) {
  const pool = require('../config/db');

  try {
    // 1. Determine Date Range
    let startDate = "7daysAgo";
    let endDate = "today";
    if (period === "today") { startDate = "today"; endDate = "today"; }
    else if (period === "30d") { startDate = "30daysAgo"; }

    // 2. Fetch Transactions & Count from GA4
    const [response] = await ga4Client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "transactionId" }],
      metrics: [{ name: "grossPurchaseRevenue" }],
      limit: limit,
      orderBys: [{ desc: true, metric: { metricName: "grossPurchaseRevenue" } }]
    });

    // Also need total count of purchases to use as limit if ID match fails
    const [countResponse] = await ga4Client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: "ecommercePurchases" }]
    });
    const gaPurchaseCount = parseInt(countResponse.rows?.[0]?.metricValues?.[0]?.value || 0);

    const gaRows = response.rows || [];
    const transactionIds = [];
    gaRows.forEach(row => {
      const tid = row.dimensionValues[0].value;
      if (tid && tid !== '(not set)') transactionIds.push(tid);
    });

    let dbResult;

    // STRATEGY A: ID Match (Preferred)
    if (transactionIds.length > 0) {
      const query = `
        SELECT o.order_number, o.id, u.emailid as customer_email, o.created_at, o.status, o.total, o.payment_method
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.username
        WHERE o.order_number = ANY($1) OR CAST(o.id AS TEXT) = ANY($1)
        ORDER BY o.created_at DESC
      `;
      dbResult = await pool.query(query, [transactionIds]);
    }

    // STRATEGY B: Fallback to Recent Orders (Count Limit)
    if ((!dbResult || dbResult.rows.length === 0) && gaPurchaseCount > 0) {
      const effectiveLimit = Math.min(gaPurchaseCount, limit);

      let dbStartDate = new Date();
      if (period === 'today') dbStartDate.setHours(0, 0, 0, 0);
      else if (period === '7d') dbStartDate.setDate(dbStartDate.getDate() - 7);
      else if (period === '30d') dbStartDate.setDate(dbStartDate.getDate() - 30);

      const query = `
        SELECT o.order_number, o.id, u.emailid as customer_email, o.created_at, o.status, o.total, o.payment_method
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.username
        WHERE o.created_at >= $1
        ORDER BY o.created_at DESC
        LIMIT $2
      `;
      dbResult = await pool.query(query, [dbStartDate.toISOString(), effectiveLimit]);
    }

    if (!dbResult || dbResult.rows.length === 0) return [];

    return dbResult.rows.map(row => ({
      orderId: row.order_number || row.id,
      customerEmail: row.customer_email || 'Guest',
      orderDate: row.created_at ? new Date(row.created_at).toISOString() : null,
      status: row.status,
      orderTotal: parseFloat(row.total),
      paymentMethod: row.payment_method || 'N/A'
    }));

  } catch (error) {
    console.error('[ANALYTICS ORDERS HYBRID ERROR]', error);
    return [];
  }
}


module.exports = {
  getAdminAnalyticsSummary,
  getTopViewedProducts,
  getTopActiveUsers,
  getTopProducts,
  getTopCategories,
  getAllAnalyticsUsers,
  getAnalyticsOrders
};
