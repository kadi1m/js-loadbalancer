export const config = {
  // Sticky session configuration
  stickySession: {
    enabled: false, // Enable or disable sticky sessions
    resetInterval: 24 * 60 * 60 * 1000, // Reset sticky sessions every 24 hours (in milliseconds)
  },

  // Health check configuration
  healthCheck: {
    enabled: true, // Enable or disable health checks
    interval: 5000, // Check health every 5 seconds (in milliseconds)
    timeout: 3000, // Request timeout for health checks (in milliseconds)
    path: "/", // Health check endpoint path
    method: "GET", // HTTP method for health check
    unhealthyThreshold: 2, // Number of consecutive failures before marking as unhealthy
    healthyThreshold: 1, // Number of consecutive successes before marking as healthy
  },

  // Failover configuration
  failover: {
    enabled: true, // Enable or disable failover mode
    // When enabled, if service 1 is down, all traffic is forwarded to service 2
  },

  // Load balancer server configuration
  server: {
    port: 8080, // Port the load balancer listens on
    host: "localhost", // Host the load balancer binds to
  },
};
