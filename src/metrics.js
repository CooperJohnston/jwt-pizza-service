const MetricBuilder = require('../src/metricBuilder.js');

const os = require('os');
// need total request count per endpoint and per minute, as well as overal
// active users
//pizzas purchased per minute, failures, how often a pizza is created
// revenue per minute
// metrics.add(httpMetrics);
//metrics.add(systemMetrics);
//metrics.add(userMetrics);
//metrics.add(purchaseMetrics);
//metrics.add(authMetrics);

// counter of how many usersr


const httpCounts = Object.create(null);
const httpLatencySumMs = Object.create(null);
const httpLatencyCount = Object.create(null);

// Auth attempts: key `${action}|${outcome}`
const authCounts = Object.create(null);
let ordersPlaced = 0;                         // count of orders
let itemsSold = 0;                            // sum of items across orders
let revenueMinor = 0;                         // integer cents (or minor units)
const orderFailures = Object.create(null);    // 'db_error' | 'factory_error'
let factoryLatencySumMs = 0;
let factoryLatencyCount = 0;
const lastSeen = new Map()
  ; // userId -> timestamp



// Small utilities
function inc(map, key, by = 1) {
  map[key] = (map[key] || 0) + by;
}

function statusClass(code) {
  const c = Number(code) || 0;
  return `${Math.floor(c / 100)}xx`;
}

function nowMs() {
  return Date.now();
}

// can give me my stem metrics
function getNormalizedLoad1m() {
  const cores = os.cpus()?.length || 1;
  const load = os.loadavg()[0] / cores; // 1m load / core count
  return Number.isFinite(load) ? load : 0;
}

function getMemoryUsedPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = total > 0 ? ((total - free) / total) * 100 : 0;
  return usedPct;
}

// this sends out our metrics


  function requestTracker(routeTemplate) {
    return function tracker(req, res, next) {
      const start = process.hrtime.bigint();
  
      res.on('finish', () => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
  
        const method = req.method || 'GET';
        const route = routeTemplate || req.path || 'unknown';
        const klass = statusClass(res.statusCode);
  
        const k = `${method}|${route}|${klass}`;
        inc(httpCounts, k, 1);
  
        httpLatencySumMs[k] = (httpLatencySumMs[k] || 0) + durationMs;
        httpLatencyCount[k] = (httpLatencyCount[k] || 0) + 1;
      });
  
      next();
    };
  }

  function recordAuthAttempt(action, outcome) {
    // action: "register" | "login" | "logout"
    // outcome: "success" | "validation_error" | "invalid_credentials" | "unauthorized" | "forbidden" | "db_error" | "unknown"
    const key = `${action}|${outcome}`;
    inc(authCounts, key, 1);
  }
  
  function markUserSeen(userId) {
    if (Number.isFinite(Number(userId))) {
      lastSeen.set(Number(userId), nowMs());
    }
  }
  
  function recordOrderPlaced({ itemsCount, revenueMinorUnits }) {
    ordersPlaced += 1;
    itemsSold += Number(itemsCount) || 0;
    revenueMinor += Number(revenueMinorUnits) || 0;
  }
  
  function recordOrderFailure(kind) {
    // kind: "db_error" | "factory_error" | "unknown"
    inc(orderFailures, kind || 'unknown', 1);
  }
  
  function recordFactoryLatency(durationMs) {
    factoryLatencySumMs += Number(durationMs) || 0;
    factoryLatencyCount += 1;
  }

  async function flushOnce() {
   console.log('Flushing metrics...');
    // Snapshot & reset to avoid races while requests are arriving
    const snap_httpCounts = { ...httpCounts };
    const snap_httpLatencySumMs = { ...httpLatencySumMs };
    const snap_httpLatencyCount = { ...httpLatencyCount };
    for (const k in httpCounts) delete httpCounts[k];
    for (const k in httpLatencySumMs) delete httpLatencySumMs[k];
    for (const k in httpLatencyCount) delete httpLatencyCount[k];
  
    const snap_authCounts = { ...authCounts };
    for (const k in authCounts) delete authCounts[k];
  
    const snap_ordersPlaced = ordersPlaced; ordersPlaced = 0;
    const snap_itemsSold = itemsSold; itemsSold = 0;
    const snap_revenueMinor = revenueMinor; revenueMinor = 0;
    const snap_orderFailures = { ...orderFailures };
    for (const k in orderFailures) delete orderFailures[k];
  
    const snap_factoryLatencySumMs = factoryLatencySumMs; factoryLatencySumMs = 0;
    const snap_factoryLatencyCount = factoryLatencyCount; factoryLatencyCount = 0;
  
    // Active users = number seen in last 5 minutes
    const cutoff = nowMs() - 5 * 60 * 1000;
    for (const [uid, ts] of lastSeen) {
      if (ts < cutoff) lastSeen.delete(uid);
    }
    const activeUsers = lastSeen.size;
  
    // Sample system gauges
    const load1mNorm = getNormalizedLoad1m();
    const memUsedPct = getMemoryUsedPercent();
  
    
    const mb = new MetricBuilder(); 
    
    // HTTP counters + avg latency
    for (const k of Object.keys(snap_httpCounts)) {
      const [method, route, klass] = k.split('|');
      const count = snap_httpCounts[k];
  
      // Counter: http.requests_total
      mb.add('http.requests_total', count, '', 'sum', 'asInt', { method, route, status_class: klass });
  
      // Gauge: average latency this flush (simple & cheap)
      const sum = snap_httpLatencySumMs[k] || 0;
      const c = snap_httpLatencyCount[k] || 1;
      const avg = sum / c;
      mb.add('http.request_duration_avg_ms', avg, 'ms', 'gauge', 'asDouble', { method, route, status_class: klass });
    }
  
    // Auth attempts
    for (const k of Object.keys(snap_authCounts)) {
      const [action, outcome] = k.split('|');
      mb.add('auth.attempts_total', snap_authCounts[k], '', 'sum', 'asInt', { action, outcome });
    }
 
    if (snap_ordersPlaced) {
      mb.add('orders.placed_total', snap_ordersPlaced, '', 'sum', 'asInt', {});
    }
    if (snap_itemsSold) {
      mb.add('pizza.items_sold_total', snap_itemsSold, '', 'sum', 'asInt', {});
    }
    if (snap_revenueMinor) {
      mb.add('revenue.total_minor_units', snap_revenueMinor, 'minor_unit', 'sum', 'asInt', { currency: 'USD' });
    }
    for (const kind of Object.keys(snap_orderFailures)) {
      mb.add('order.create_total', snap_orderFailures[kind], '', 'sum', 'asInt', { outcome: kind });
    }
    if (snap_factoryLatencyCount > 0) {
      mb.add('order.factory_latency_avg_ms', snap_factoryLatencySumMs / snap_factoryLatencyCount, 'ms', 'gauge', 'asDouble', {});
    }
  
   
    mb.add('users.active_gauge', activeUsers, 'users', 'gauge', 'asInt', { window: '5m' });
  
    // System
    mb.add('system.normalized_load1m', load1mNorm, '', 'gauge', 'asDouble', {});
    mb.add('system.memory_used_percent', memUsedPct, '%', 'gauge', 'asDouble', {});
  
    // Send
    await mb.sendMetricToGrafana(mb.metrics); 
  }
  
  function sendMetricsPeriodically(periodMs) {
   
    setInterval(() => {
      flushOnce().catch((e) => {
      
        console.error('Error sending metrics', e);
      });
    }, Math.max(1000, Number(periodMs) || 60000));
  }
  
 
  module.exports = {
    // middleware (pass the route template!)
    requestTracker,
  
    // auth hooks
    recordAuthAttempt,
    markUserSeen,
  
    // order hooks
    recordOrderPlaced,
    recordOrderFailure,
    recordFactoryLatency,
  
    // flushing
    sendMetricsPeriodically,
  };