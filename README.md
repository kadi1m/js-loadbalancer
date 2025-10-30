# Load Balancer

A high-performance HTTP load balancer with sticky session support (IP-based) and automatic node failover using health checks.

## Features

- **Sticky Sessions (IP-based)**: Routes requests from the same IP address to the same backend server, ensuring session persistence
- **Health Checks**: Continuously monitors backend servers to ensure they're healthy and responsive
- **Automatic Failover**: Automatically removes unhealthy nodes from the pool and adds them back when they recover
- **Round-Robin Load Balancing**: Distributes traffic evenly across healthy backend servers
- **Graceful Shutdown**: Handles shutdown gracefully with connection cleanup

## Installation

1. Clone the repository or download the files
2. Install dependencies:

```bash
npm install
```

## Configuration

Edit `config.js` to configure the load balancer:

### Sticky Session Configuration

```javascript
stickySession: {
  enabled: true,              // Enable/disable sticky sessions
  resetInterval: 86400000    // Reset sticky sessions every 24 hours (in milliseconds)
}
```

### Health Check Configuration

```javascript
healthCheck: {
  enabled: true,             // Enable/disable health checks
  interval: 5000,            // Check health every 5 seconds (in milliseconds)
  timeout: 3000,             // Request timeout for health checks (in milliseconds)
  path: "/health",          // Health check endpoint path
  method: "GET",             // HTTP method for health check
  unhealthyThreshold: 2,    // Consecutive failures before marking as unhealthy
  healthyThreshold: 1       // Consecutive successes before marking as healthy
}
```

### Server Configuration

```javascript
server: {
  port: 8080,               // Port the load balancer listens on
  host: "localhost"         // Host the load balancer binds to
}
```

## Target Servers

Edit the `targets` array in `index.js` to specify your backend servers:

```javascript
const targets = [
  "http://192.168.1.208:3010",
  "http://192.168.1.112:3000",
];
```

## Usage

Start the load balancer:

```bash
node index.js
```

The load balancer will:
- Start listening on the configured port (default: 8080)
- Begin health checks for all target servers
- Route incoming requests to healthy backend servers

## How It Works

### Sticky Sessions (IP-based)

- When a client makes a request, the load balancer extracts the client's IP address
- If sticky sessions are enabled, the client's IP is mapped to a specific backend server
- Subsequent requests from the same IP address are routed to the same server
- Sticky session mappings are reset periodically (default: every 24 hours)

### Health Checks

- The load balancer periodically sends HTTP requests to each target server's health endpoint
- Default health check path: `/health`
- A server is marked as **unhealthy** after 2 consecutive failed health checks
- A server is marked as **healthy** after 1 successful health check (once it recovers)
- Unhealthy servers are automatically removed from the load balancing pool

### Node Failover

When a backend server becomes unhealthy:

1. The load balancer stops routing new requests to that server
2. Existing sticky session mappings pointing to the unhealthy server are removed
3. Clients are automatically redirected to healthy servers
4. When the server recovers, it's automatically added back to the pool

When all backend servers are unhealthy:

- The load balancer returns HTTP 503 (Service Unavailable) status code

## Logging

The load balancer logs the following information:

- Request logs: Client IP, target server, HTTP method, URL, and status code
- Health status changes: When servers become healthy or unhealthy
- Shutdown events: Graceful shutdown process

Example log output:

```
[2024-01-01T12:00:00.000Z] IP: 192.168.1.100 -> Target: http://192.168.1.208:3010 | Method: GET /api/data
[2024-01-01T12:00:00.050Z] IP: 192.168.1.100 -> Target: http://192.168.1.208:3010 | Status: 200
[2024-01-01T12:00:05.000Z] Target http://192.168.1.112:3000 is now UNHEALTHY: ECONNREFUSED
```

## Requirements

- Node.js (v14 or higher)
- npm

## Dependencies

- `http-proxy`: ^1.18.1

## License

ISC

