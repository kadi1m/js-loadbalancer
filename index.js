import http from "http";
import https from "https";
import httpProxy from "http-proxy";
import { config } from "./config.js";

const proxy = httpProxy.createProxyServer({});
const targets = [
  "https://ha.screenshare.lol",
  "https://ha2.screenshare.lol",
];

const sessionMap = new Map();
let current = 0;

const targetHealth = new Map();
const healthCheckIntervals = new Map();
const activeHealthCheckRequests = new Set();
let isShuttingDown = false;

targets.forEach((target) => {
  targetHealth.set(target, {
    isHealthy: true,
    failures: 0,
    successes: 0,
  });
});

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
}

function getHealthyTargets() {
  return targets.filter((target) => {
    const health = targetHealth.get(target);
    return health && health.isHealthy;
  });
}

function getTargetForIp(ip) {
  if (config.stickySession.enabled && sessionMap.has(ip)) {
    const cachedTarget = sessionMap.get(ip);
    const health = targetHealth.get(cachedTarget);
    if (health && health.isHealthy) {
      return cachedTarget;
    }
    sessionMap.delete(ip);
  }

  // Failover mode: if service 1 is down, forward all traffic to service 2
  if (config.failover.enabled && targets.length >= 2) {
    const service1 = targets[0];
    const service2 = targets[1];
    const service1Health = targetHealth.get(service1);
    const service2Health = targetHealth.get(service2);

    // If service 1 is down and service 2 is healthy, route to service 2
    if (service1Health && !service1Health.isHealthy && service2Health && service2Health.isHealthy) {
      const target = service2;
      if (config.stickySession.enabled) {
        sessionMap.set(ip, target);
      }
      return target;
    }
  }

  const healthyTargets = getHealthyTargets();
  if (healthyTargets.length === 0) {
    console.warn(`[${new Date().toISOString()}] No healthy targets available!`);
    return null;
  }

  const target = healthyTargets[current % healthyTargets.length];
  current = (current + 1) % healthyTargets.length;

  if (config.stickySession.enabled) {
    sessionMap.set(ip, target);
  }

  return target;
}

async function checkTargetHealth(target) {
  return new Promise((resolve) => {
    if (isShuttingDown) {
      resolve({ isHealthy: false, error: "Shutting down" });
      return;
    }

    const healthConfig = config.healthCheck;
    const url = new URL(target);
    url.pathname = healthConfig.path;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: healthConfig.method,
      timeout: healthConfig.timeout,
      // For HTTPS, don't reject unauthorized certificates (useful for self-signed certs)
      ...(url.protocol === "https:" && { rejectUnauthorized: false }),
    };

    const requestModule = url.protocol === "https:" ? https : http;
    const req = requestModule.request(options, (res) => {
      // Only consider status code 200 as healthy
      const isHealthy = res.statusCode === 200;
      const statusCode = res.statusCode;
      activeHealthCheckRequests.delete(req);
      
      if (!isHealthy) {
        console.log(`[${new Date().toISOString()}] Health check for ${target} returned status ${statusCode} (expected 200)`);
      }
      
      resolve({ isHealthy, error: null, statusCode });
      req.destroy();
    });

    req.on("error", (err) => {
      activeHealthCheckRequests.delete(req);
      console.log(`[${new Date().toISOString()}] Health check error for ${target}: ${err.message}`);
      resolve({ isHealthy: false, error: err.message });
    });

    req.on("timeout", () => {
      activeHealthCheckRequests.delete(req);
      req.destroy();
      console.log(`[${new Date().toISOString()}] Health check timeout for ${target}`);
      resolve({ isHealthy: false, error: "Timeout" });
    });

    activeHealthCheckRequests.add(req);
    req.end();
  });
}

async function performHealthCheck(target) {
  const result = await checkTargetHealth(target);
  const health = targetHealth.get(target);
  const healthConfig = config.healthCheck;

  if (result.isHealthy) {
    health.successes += 1;
    health.failures = 0;

    if (!health.isHealthy && health.successes >= healthConfig.healthyThreshold) {
      health.isHealthy = true;
      console.log(`[${new Date().toISOString()}] Target ${target} is now HEALTHY (status: ${result.statusCode || 200})`);
    }
  } else {
    health.successes = 0;
    health.failures += 1;

    const errorMsg = result.statusCode 
      ? `Status code ${result.statusCode} (expected 200)` 
      : (result.error || "Unknown error");
    
    if (health.isHealthy && health.failures >= healthConfig.unhealthyThreshold) {
      health.isHealthy = false;
      console.log(`[${new Date().toISOString()}] Target ${target} is now UNHEALTHY: ${errorMsg}`);

      for (const [ip, cachedTarget] of sessionMap.entries()) {
        if (cachedTarget === target) {
          sessionMap.delete(ip);
        }
      }
    } else if (!health.isHealthy) {
      // Log ongoing failures even if not yet marked unhealthy
      console.log(`[${new Date().toISOString()}] Target ${target} health check failed (${health.failures}/${healthConfig.unhealthyThreshold}): ${errorMsg}`);
    }
  }
}

function startHealthChecks() {
  if (!config.healthCheck.enabled) {
    console.log("[Health Check] Health checks are disabled");
    return;
  }

  console.log(`[Health Check] Starting health checks (interval: ${config.healthCheck.interval}ms)`);
  console.log(`[Health Check] Health check path: ${config.healthCheck.path}`);
  console.log(`[Health Check] Targets: ${targets.join(", ")}`);

  targets.forEach((target) => {
    performHealthCheck(target);

    const interval = setInterval(() => {
      performHealthCheck(target);
    }, config.healthCheck.interval);

    healthCheckIntervals.set(target, interval);
  });
}

function stopHealthChecks() {
  healthCheckIntervals.forEach((interval) => clearInterval(interval));
  healthCheckIntervals.clear();
  
  activeHealthCheckRequests.forEach((req) => {
    req.destroy();
  });
  activeHealthCheckRequests.clear();
}

const server = http.createServer((req, res) => {
  const ip = getClientIp(req);
  const target = getTargetForIp(ip);

  if (!target) {
    const statusCode = 503;
    console.log(`[${new Date().toISOString()}] IP: ${ip} -> No healthy targets available | Status: ${statusCode}`);
    res.writeHead(statusCode);
    res.end("Service Unavailable: No healthy targets available");
    return;
  }

  console.log(`[${new Date().toISOString()}] IP: ${ip} -> Target: ${target} | Method: ${req.method} ${req.url}`);

  const proxyResHandler = (proxyRes) => {
    const statusCode = proxyRes.statusCode;
    console.log(`[${new Date().toISOString()}] IP: ${ip} -> Target: ${target} | Status: ${statusCode}`);
    proxy.off("proxyRes", proxyResHandler);
  };

  proxy.on("proxyRes", proxyResHandler);

  // Configure proxy options for HTTPS targets
  const url = new URL(target);
  const proxyOptions = {
    target: target,
    // For HTTPS targets, don't reject unauthorized certificates
    ...(url.protocol === "https:" && {
      secure: false, // Don't reject unauthorized SSL certificates
      changeOrigin: true, // Change the origin of the host header to the target URL
    }),
  };

  proxy.web(req, res, proxyOptions, (err) => {
    proxy.off("proxyRes", proxyResHandler);

    // Log detailed error information
    const errorDetails = err ? {
      message: err.message,
      code: err.code,
      syscall: err.syscall,
      address: err.address,
      port: err.port,
    } : "Unknown error";
    
    console.error(`[${new Date().toISOString()}] Proxy error for ${target}:`, errorDetails);

    const health = targetHealth.get(target);
    if (health) {
      health.failures += 1;
      performHealthCheck(target);
    }

    const statusCode = 502;
    console.log(`[${new Date().toISOString()}] IP: ${ip} -> Target: ${target} | Status: ${statusCode} (Bad Gateway) | Error: ${err?.message || "Unknown"}`);
    res.writeHead(statusCode);
    res.end("Bad Gateway");
  });
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`Sticky load balancer running on http://${config.server.host}:${config.server.port}`);
  console.log(`Sticky sessions: ${config.stickySession.enabled ? "ENABLED" : "DISABLED"}`);
  startHealthChecks();
});

if (config.stickySession.enabled) {
  setInterval(() => {
    sessionMap.clear();
    console.log(`[${new Date().toISOString()}] Sticky sessions reset`);
  }, config.stickySession.resetInterval);
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\nShutting down gracefully...");
  
  stopHealthChecks();

  const shutdownTimeout = setTimeout(() => {
    console.log("Shutdown timeout reached - forcing exit");
    server.closeAllConnections();
    process.exit(0);
  }, 5000);

  server.close(() => {
    clearTimeout(shutdownTimeout);
    console.log("Server closed - all connections finished");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);