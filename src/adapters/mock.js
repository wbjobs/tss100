const BaseAdapter = require('./base');

class MockAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.mockData = config.mockData || this.generateMockData();
  }

  async connect() {
    this.connected = true;
    return true;
  }

  async collect(serviceName = null) {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    if (serviceName) {
      const filtered = {
        services: this.mockData.services.filter(s => s.name === serviceName),
        calls: this.mockData.calls.filter(
          c => c.from === serviceName || c.to === serviceName
        )
      };
      
      const relatedServices = new Set([serviceName]);
      filtered.calls.forEach(c => {
        relatedServices.add(c.from);
        relatedServices.add(c.to);
      });
      
      filtered.services = this.mockData.services.filter(
        s => relatedServices.has(s.name)
      );
      
      return filtered;
    }

    return this.mockData;
  }

  generateMockData() {
    const services = [
      {
        name: 'api-gateway',
        status: 'healthy',
        instanceCount: 3,
        cpuUsage: 45,
        memoryUsage: 62,
        uptime: '45d 12h',
        version: 'v2.3.1',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'auth-service',
        status: 'healthy',
        instanceCount: 2,
        cpuUsage: 28,
        memoryUsage: 45,
        uptime: '30d 8h',
        version: 'v1.8.0',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'user-service',
        status: 'healthy',
        instanceCount: 4,
        cpuUsage: 55,
        memoryUsage: 70,
        uptime: '20d 4h',
        version: 'v3.1.2',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'order-service',
        status: 'degraded',
        instanceCount: 2,
        cpuUsage: 85,
        memoryUsage: 88,
        uptime: '5d 2h',
        version: 'v2.0.0',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'payment-service',
        status: 'healthy',
        instanceCount: 3,
        cpuUsage: 35,
        memoryUsage: 50,
        uptime: '60d 18h',
        version: 'v1.5.3',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'inventory-service',
        status: 'unhealthy',
        instanceCount: 1,
        cpuUsage: 95,
        memoryUsage: 92,
        uptime: '1d 6h',
        version: 'v1.2.0',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'notification-service',
        status: 'healthy',
        instanceCount: 2,
        cpuUsage: 15,
        memoryUsage: 30,
        uptime: '90d 22h',
        version: 'v1.0.5',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'analytics-service',
        status: 'healthy',
        instanceCount: 2,
        cpuUsage: 60,
        memoryUsage: 75,
        uptime: '15d 10h',
        version: 'v2.1.0',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'product-service',
        status: 'healthy',
        instanceCount: 3,
        cpuUsage: 40,
        memoryUsage: 55,
        uptime: '25d 14h',
        version: 'v1.9.2',
        lastChecked: new Date().toISOString()
      },
      {
        name: 'search-service',
        status: 'degraded',
        instanceCount: 1,
        cpuUsage: 78,
        memoryUsage: 82,
        uptime: '3d 8h',
        version: 'v1.3.0',
        lastChecked: new Date().toISOString()
      }
    ];

    const calls = [
      { from: 'api-gateway', to: 'auth-service', avgLatency: 12, p99Latency: 45, errorRate: 0.2, requestCount: 150000 },
      { from: 'api-gateway', to: 'user-service', avgLatency: 25, p99Latency: 80, errorRate: 0.5, requestCount: 200000 },
      { from: 'api-gateway', to: 'order-service', avgLatency: 45, p99Latency: 150, errorRate: 2.1, requestCount: 80000 },
      { from: 'api-gateway', to: 'product-service', avgLatency: 18, p99Latency: 60, errorRate: 0.3, requestCount: 180000 },
      { from: 'api-gateway', to: 'search-service', avgLatency: 65, p99Latency: 200, errorRate: 1.8, requestCount: 95000 },
      { from: 'auth-service', to: 'user-service', avgLatency: 15, p99Latency: 50, errorRate: 0.1, requestCount: 100000 },
      { from: 'order-service', to: 'user-service', avgLatency: 20, p99Latency: 70, errorRate: 0.8, requestCount: 75000 },
      { from: 'order-service', to: 'payment-service', avgLatency: 85, p99Latency: 300, errorRate: 3.5, requestCount: 70000 },
      { from: 'order-service', to: 'inventory-service', avgLatency: 120, p99Latency: 500, errorRate: 8.2, requestCount: 72000 },
      { from: 'order-service', to: 'notification-service', avgLatency: 30, p99Latency: 90, errorRate: 0.4, requestCount: 68000 },
      { from: 'order-service', to: 'analytics-service', avgLatency: 35, p99Latency: 100, errorRate: 0.6, requestCount: 65000 },
      { from: 'payment-service', to: 'user-service', avgLatency: 10, p99Latency: 35, errorRate: 0.2, requestCount: 68000 },
      { from: 'product-service', to: 'inventory-service', avgLatency: 40, p99Latency: 120, errorRate: 5.5, requestCount: 120000 },
      { from: 'product-service', to: 'analytics-service', avgLatency: 25, p99Latency: 80, errorRate: 0.3, requestCount: 110000 },
      { from: 'search-service', to: 'product-service', avgLatency: 22, p99Latency: 75, errorRate: 0.7, requestCount: 90000 },
      { from: 'user-service', to: 'notification-service', avgLatency: 18, p99Latency: 55, errorRate: 0.2, requestCount: 85000 },
      { from: 'analytics-service', to: 'user-service', avgLatency: 12, p99Latency: 40, errorRate: 0.1, requestCount: 50000 },
      { from: 'analytics-service', to: 'product-service', avgLatency: 15, p99Latency: 45, errorRate: 0.15, requestCount: 45000 }
    ];

    return { services, calls };
  }
}

module.exports = MockAdapter;
